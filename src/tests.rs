use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, Response, StatusCode, header};
use clap::FromArgMatches;
use http_body_util::BodyExt;
use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

use crate::{ServeConfig, app, cli, hash_password};

const PASSWORD: &str = "correct horse battery staple";
const INDEX_HTML: &str = "<!doctype html><title>heimdall</title>";
const IMMUTABLE_JS: &str = "export const answer = 42; // long enough to be worth compressing";

static PASSWORD_HASH: LazyLock<String> = LazyLock::new(|| {
    let mut out = Vec::new();
    hash_password(format!("{PASSWORD}\n").as_bytes(), &mut out).unwrap();
    String::from_utf8(out).unwrap()
});

struct Server {
    root: TempDir,
    app: Router,
}

#[derive(Deserialize)]
struct SyncResponse {
    epoch: String,
    head: i64,
    ops: Vec<StoredOp>,
    more: bool,
}

#[derive(Deserialize)]
struct StoredOp {
    seq: i64,
    op: Box<RawValue>,
}

impl Server {
    fn new() -> Server {
        Server::with_flags(&[])
    }

    fn with_flags(flags: &[&str]) -> Server {
        let root = TempDir::new().unwrap();
        let web = root.path().join("web");
        std::fs::create_dir_all(web.join("_app/immutable")).unwrap();
        std::fs::write(web.join("index.html"), INDEX_HTML).unwrap();
        std::fs::write(web.join("_app/immutable/x.js"), IMMUTABLE_JS).unwrap();
        std::fs::write(root.path().join("hash"), PASSWORD_HASH.as_str()).unwrap();
        let app = start(root.path(), flags);
        Server { root, app }
    }

    fn restart(self) -> Server {
        let app = start(self.root.path(), &[]);
        Server { app, ..self }
    }

    async fn send(&self, request: Request<Body>) -> Response<Body> {
        self.app.clone().oneshot(request).await.unwrap()
    }

    async fn get(&self, path: &str) -> Response<Body> {
        self.send(Request::get(path).body(Body::empty()).unwrap())
            .await
    }

    async fn login_with(&self, password: &str) -> Response<Body> {
        self.send(json_post(
            "/api/login",
            None,
            &json!({ "password": password }).to_string(),
        ))
        .await
    }

    /// Signs in and returns the `name=value` pair to send back as the cookie.
    async fn login(&self) -> String {
        let response = self.login_with(PASSWORD).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        set_cookie(&response).split(';').next().unwrap().to_owned()
    }

    async fn sync_raw(&self, cookie: &str, body: String) -> Response<Body> {
        self.send(json_post("/api/sync", Some(cookie), &body)).await
    }

    async fn sync(&self, cookie: &str, after: i64, ops: &[&str]) -> SyncResponse {
        let response = self.sync_raw(cookie, sync_body(after, ops)).await;
        assert_eq!(response.status(), StatusCode::OK);
        serde_json::from_slice(&body_bytes(response).await).unwrap()
    }
}

fn start(root: &Path, flags: &[&str]) -> Router {
    let dir = |name: &str| root.join(name).to_str().unwrap().to_owned();
    let mut args = vec![
        "heimdall".to_owned(),
        format!("--data-dir={}", dir("data")),
        format!("--web-dir={}", dir("web")),
        format!("--password-hash-file={}", dir("hash")),
    ];
    args.extend(flags.iter().map(|flag| (*flag).to_owned()));
    let matches = cli().try_get_matches_from(args).unwrap();
    app(&ServeConfig::from_arg_matches(&matches).unwrap()).unwrap()
}

fn json_post(path: &str, cookie: Option<&str>, body: &str) -> Request<Body> {
    let mut request = Request::post(path).header(header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        request = request.header(header::COOKIE, cookie);
    }
    request.body(Body::from(body.to_owned())).unwrap()
}

/// Splices raw op text into the request so the bytes the server sees are exactly these.
fn sync_body(after: i64, ops: &[&str]) -> String {
    format!(r#"{{"after":{after},"ops":[{}]}}"#, ops.join(","))
}

fn set_cookie(response: &Response<Body>) -> &str {
    response
        .headers()
        .get(header::SET_COOKIE)
        .expect("a Set-Cookie header")
        .to_str()
        .unwrap()
}

fn header_str(response: &Response<Body>, name: header::HeaderName) -> Option<&str> {
    response
        .headers()
        .get(name)
        .map(|value| value.to_str().unwrap())
}

async fn body_bytes(response: Response<Body>) -> Vec<u8> {
    response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec()
}

fn contract() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("contract/sync.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn op(n: usize) -> String {
    format!(r#"{{"hlc":"{n:023}","kind":"mark","id":"m_{n}","set":{{"at":{n}}}}}"#)
}

#[tokio::test]
async fn accepts_every_valid_contract_op() {
    let server = Server::new();
    let cookie = server.login().await;
    let contract = contract();
    let valid: Vec<String> = contract["valid_ops"]
        .as_array()
        .unwrap()
        .iter()
        .map(Value::to_string)
        .collect();

    for (n, op) in valid.iter().enumerate() {
        let response = server.sync(&cookie, 0, &[op]).await;
        assert_eq!(
            response.head,
            i64::try_from(n).unwrap() + 1,
            "valid_ops[{n}] stored"
        );
    }
    let pulled = server.sync(&cookie, 0, &[]).await;
    let pulled: Vec<&str> = pulled.ops.iter().map(|stored| stored.op.get()).collect();
    assert_eq!(pulled, valid);
}

#[tokio::test]
async fn rejects_every_invalid_contract_op_naming_its_index() {
    let server = Server::new();
    let cookie = server.login().await;
    let contract = contract();
    let valid = contract["valid_ops"][0].to_string();

    for case in contract["invalid_ops"].as_array().unwrap() {
        let invalid = case["op"].to_string();
        let response = server
            .sync_raw(&cookie, sync_body(0, &[&valid, &invalid]))
            .await;
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "{}",
            case["why"]
        );
        let error: Value = serde_json::from_slice(&body_bytes(response).await).unwrap();
        assert_eq!(error["index"], 1, "{}", case["why"]);
    }
    assert_eq!(
        server.sync(&cookie, 0, &[]).await.head,
        0,
        "a rejected request stores nothing"
    );
}

#[tokio::test]
async fn rejects_ops_over_the_size_limit() {
    let server = Server::new();
    let cookie = server.login().await;
    let padding = "x".repeat(16 * 1024);
    let big = format!(
        r#"{{"hlc":"{:023}","kind":"mark","id":"m","set":{{"pad":"{padding}"}}}}"#,
        1
    );
    let response = server.sync_raw(&cookie, sync_body(0, &[&big])).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn returns_ops_byte_for_byte_in_seq_order() {
    let server = Server::new();
    let cookie = server.login().await;
    let first = r#"{ "set" : {"z":1,  "a":[1.50, 2e3, "é"]}, "id":"x", "kind":"k", "hlc":"0000000000000000000000b" }"#;
    let second =
        r#"{"hlc":"0000000000000000000000a","kind":"k","id":"y","set":{"n":null},"extra":true}"#;
    server.sync(&cookie, 0, &[first, second]).await;

    let pulled = server.sync(&cookie, 0, &[]).await;
    let bodies: Vec<&str> = pulled.ops.iter().map(|stored| stored.op.get()).collect();
    assert_eq!(bodies, [first, second], "arrival order, not hlc order");
    assert!(pulled.ops[0].seq < pulled.ops[1].seq);
}

#[tokio::test]
async fn pushing_the_same_ops_twice_stores_them_once() {
    let server = Server::new();
    let cookie = server.login().await;
    let ops = [op(1), op(2), op(1)];
    let ops: Vec<&str> = ops.iter().map(String::as_str).collect();

    let first = server.sync(&cookie, 0, &ops).await;
    let second = server.sync(&cookie, 0, &ops).await;
    assert_eq!(first.head, 2);
    assert_eq!(second.head, 2);
    let bodies: Vec<&str> = second.ops.iter().map(|stored| stored.op.get()).collect();
    assert_eq!(bodies, [op(1), op(2)]);
}

#[tokio::test]
async fn pages_through_more_than_a_thousand_ops() {
    let server = Server::new();
    let cookie = server.login().await;
    let all: Vec<String> = (1..=2000).map(op).collect();
    for chunk in all.chunks(500) {
        let chunk: Vec<&str> = chunk.iter().map(String::as_str).collect();
        server.sync(&cookie, 0, &chunk).await;
    }

    let mut pulled = Vec::new();
    let mut after = 0;
    let mut pages = Vec::new();
    loop {
        let page = server.sync(&cookie, after, &[]).await;
        assert_eq!(page.head, 2000);
        pages.push((page.ops.len(), page.more));
        let Some(last) = page.ops.last() else { break };
        after = last.seq;
        pulled.extend(page.ops.iter().map(|stored| stored.op.get().to_owned()));
        if !page.more {
            break;
        }
    }
    assert_eq!(
        pages,
        [(1000, true), (1000, false)],
        "an exactly full last page has no more"
    );
    assert_eq!(pulled, all);
}

#[tokio::test]
async fn rejects_more_than_500_ops_per_request() {
    let server = Server::new();
    let cookie = server.login().await;
    let ops: Vec<String> = (1..=501).map(op).collect();
    let ops: Vec<&str> = ops.iter().map(String::as_str).collect();
    let response = server.sync_raw(&cookie, sync_body(0, &ops)).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn epoch_is_stable_across_restarts_and_unique_per_data_dir() {
    let server = Server::new();
    let cookie = server.login().await;
    let before = server.sync(&cookie, 0, &[&op(1)]).await;

    let server = server.restart();
    let after = server.sync(&cookie, 0, &[]).await;
    assert_eq!(after.epoch, before.epoch);
    assert_eq!(after.head, 1, "ops survive the restart");

    let other = Server::new();
    let other_cookie = other.login().await;
    assert_ne!(other.sync(&other_cookie, 0, &[]).await.epoch, before.epoch);
}

#[tokio::test]
async fn login_sets_a_lax_secure_session_cookie() {
    let server = Server::new();
    let response = server.login_with(PASSWORD).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cookie = set_cookie(&response);
    let (pair, attributes) = cookie.split_once("; ").unwrap();
    let token = pair.strip_prefix("heimdall_session=").unwrap();
    assert_eq!(token.len(), 43, "32 bytes in unpadded base64url");
    assert_eq!(
        attributes,
        "HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000"
    );
}

#[tokio::test]
async fn a_session_first_used_on_a_new_day_gets_its_cookie_renewed() {
    let server = Server::new();
    let cookie = server.login().await;

    let same_day = server.sync_raw(&cookie, sync_body(0, &[])).await;
    assert_eq!(same_day.status(), StatusCode::OK);
    assert!(same_day.headers().get(header::SET_COOKIE).is_none());

    let db = rusqlite::Connection::open(server.root.path().join("data/heimdall.db")).unwrap();
    db.execute(
        "UPDATE sessions SET last_seen_at = last_seen_at - 2 * 86400000",
        [],
    )
    .unwrap();

    let next_day = server.sync_raw(&cookie, sync_body(0, &[])).await;
    assert_eq!(next_day.status(), StatusCode::OK);
    assert_eq!(
        set_cookie(&next_day),
        format!("{cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000")
    );

    let again = server.sync_raw(&cookie, sync_body(0, &[])).await;
    assert!(
        again.headers().get(header::SET_COOKIE).is_none(),
        "once a day"
    );
}

#[tokio::test]
async fn insecure_cookies_flag_drops_only_secure() {
    let server = Server::with_flags(&["--insecure-cookies"]);
    let response = server.login_with(PASSWORD).await;
    let attributes = set_cookie(&response).split_once("; ").unwrap().1;
    assert_eq!(
        attributes,
        "HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000"
    );
}

#[tokio::test]
async fn wrong_password_backs_off_every_attempt() {
    let server = Server::new();
    let wrong = server.login_with("guess").await;
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);

    let throttled = server.login_with(PASSWORD).await;
    assert_eq!(
        throttled.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "even the right password waits"
    );
    let retry_after: u64 = header_str(&throttled, header::RETRY_AFTER)
        .unwrap()
        .parse()
        .unwrap();
    assert_eq!(retry_after, 1);

    tokio::time::sleep(Duration::from_secs(retry_after)).await;
    assert_eq!(
        server.login_with(PASSWORD).await.status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn back_off_doubles_after_each_failure() {
    let server = Server::new();
    assert_eq!(
        server.login_with("guess").await.status(),
        StatusCode::UNAUTHORIZED
    );
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(
        server.login_with("guess").await.status(),
        StatusCode::UNAUTHORIZED
    );
    let throttled = server.login_with(PASSWORD).await;
    assert_eq!(header_str(&throttled, header::RETRY_AFTER), Some("2"));
}

#[tokio::test]
async fn api_requires_a_session() {
    let server = Server::new();
    assert_eq!(
        server.get("/api/session").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        server.get("/api/live").await.status(),
        StatusCode::UNAUTHORIZED
    );
    let push = server
        .sync_raw("heimdall_session=forged", sync_body(0, &[&op(1)]))
        .await;
    assert_eq!(push.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(server.get("/api/health").await.status(), StatusCode::OK);
}

#[tokio::test]
async fn logout_ends_the_session() {
    let server = Server::new();
    let cookie = server.login().await;
    let with_cookie = |method: &str, path: &str| {
        Request::builder()
            .method(method)
            .uri(path)
            .header(header::COOKIE, format!("theme=dark; {cookie}"))
            .body(Body::empty())
            .unwrap()
    };
    assert_eq!(
        server
            .send(with_cookie("GET", "/api/session"))
            .await
            .status(),
        StatusCode::NO_CONTENT
    );

    let logout = server.send(with_cookie("POST", "/api/logout")).await;
    assert_eq!(logout.status(), StatusCode::NO_CONTENT);
    assert!(set_cookie(&logout).starts_with("heimdall_session=;"));
    assert!(set_cookie(&logout).ends_with("Max-Age=0"));

    assert_eq!(
        server
            .send(with_cookie("GET", "/api/session"))
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        server
            .send(with_cookie("POST", "/api/logout"))
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn refuses_posts_from_a_foreign_origin() {
    let server = Server::new();
    let login = |origin: &str, proto: Option<&str>| {
        let mut request = json_post(
            "/api/login",
            None,
            &json!({ "password": PASSWORD }).to_string(),
        );
        let headers = request.headers_mut();
        headers.insert(header::HOST, "heimdall.example".parse().unwrap());
        headers.insert(header::ORIGIN, origin.parse().unwrap());
        if let Some(proto) = proto {
            headers.insert("x-forwarded-proto", proto.parse().unwrap());
        }
        request
    };
    let forbidden = [
        ("https://evil.example", Some("https")),
        ("http://heimdall.example.evil", None),
        ("http://heimdall.example", Some("https")),
        ("null", None),
    ];
    for (origin, proto) in forbidden {
        let response = server.send(login(origin, proto)).await;
        assert_eq!(
            response.status(),
            StatusCode::FORBIDDEN,
            "{origin} via {proto:?}"
        );
    }

    let same = server
        .send(login("https://heimdall.example", Some("https")))
        .await;
    assert_eq!(same.status(), StatusCode::NO_CONTENT);
    let mut foreign_get = Request::get("/api/health").body(Body::empty()).unwrap();
    foreign_get
        .headers_mut()
        .insert(header::ORIGIN, "https://evil.example".parse().unwrap());
    assert_eq!(server.send(foreign_get).await.status(), StatusCode::OK);
}

#[tokio::test]
async fn live_emits_the_head_after_a_push() {
    let server = Server::new();
    let cookie = server.login().await;
    let request = Request::get("/api/live")
        .header(header::COOKIE, &cookie)
        .body(Body::empty())
        .unwrap();
    let response = server.send(request).await;
    assert_eq!(
        header_str(&response, header::CONTENT_TYPE),
        Some("text/event-stream")
    );
    let mut events = response.into_body();
    let mut next_event = async || {
        let frame = tokio::time::timeout(Duration::from_secs(5), events.frame())
            .await
            .expect("an event within 5 s")
            .unwrap()
            .unwrap();
        String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap()
    };

    assert_eq!(next_event().await, "event: head\ndata: {\"head\":0}\n\n");
    server.sync(&cookie, 0, &[&op(1), &op(2)]).await;
    assert_eq!(next_event().await, "event: head\ndata: {\"head\":2}\n\n");
}

#[tokio::test]
async fn deep_links_serve_the_spa_without_caching() {
    let server = Server::new();
    for path in ["/", "/day/2026-11-09"] {
        let response = server.get(path).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            header_str(&response, header::CACHE_CONTROL),
            Some("no-cache"),
            "{path}"
        );
        assert_eq!(body_bytes(response).await, INDEX_HTML.as_bytes(), "{path}");
    }
}

#[tokio::test]
async fn the_spa_is_never_answered_as_unmodified() {
    let server = Server::new();
    let first = server.get("/").await;
    assert!(first.headers().get(header::ETAG).is_none());
    assert!(first.headers().get(header::LAST_MODIFIED).is_none());

    let request = Request::get("/")
        .header(header::IF_MODIFIED_SINCE, "Fri, 01 Jan 2100 00:00:00 GMT")
        .header(header::IF_NONE_MATCH, "*")
        .body(Body::empty())
        .unwrap();
    let response = server.send(request).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body_bytes(response).await, INDEX_HTML.as_bytes());
}

#[tokio::test]
async fn immutable_assets_are_cached_for_a_year() {
    let server = Server::new();
    let response = server.get("/_app/immutable/x.js").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header_str(&response, header::CACHE_CONTROL),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(body_bytes(response).await, IMMUTABLE_JS.as_bytes());

    let missing = server.get("/_app/immutable/missing.js").await;
    assert_eq!(
        missing.status(),
        StatusCode::NOT_FOUND,
        "a missing asset is not the SPA"
    );
}

#[tokio::test]
async fn unknown_api_paths_are_not_the_spa() {
    let server = Server::new();
    let response = server.get("/api/unknown").await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_ne!(body_bytes(response).await, INDEX_HTML.as_bytes());
}

#[tokio::test]
async fn compresses_static_files_when_the_client_accepts_it() {
    let server = Server::new();
    for encoding in ["gzip", "br"] {
        let request = Request::get("/_app/immutable/x.js")
            .header(header::ACCEPT_ENCODING, encoding)
            .body(Body::empty())
            .unwrap();
        let response = server.send(request).await;
        assert_eq!(
            header_str(&response, header::CONTENT_ENCODING),
            Some(encoding)
        );
    }
}

#[tokio::test]
async fn compresses_a_pull_when_the_client_accepts_it() {
    let server = Server::new();
    let cookie = server.login().await;
    let request = Request::post("/api/sync")
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::ACCEPT_ENCODING, "gzip")
        .body(Body::from(r#"{"after":0,"ops":[]}"#))
        .unwrap();
    let response = server.send(request).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        header_str(&response, header::CONTENT_ENCODING),
        Some("gzip")
    );
}

#[tokio::test]
async fn sends_the_build_s_precompressed_copy_as_it_is() {
    let server = Server::new();
    let web = server.root.path().join("web");
    std::fs::write(web.join("_app/immutable/x.js.br"), b"brotli bytes").unwrap();
    std::fs::write(web.join("index.html.gz"), b"gzip bytes").unwrap();
    for (path, encoding, body) in [
        ("/_app/immutable/x.js", "br", &b"brotli bytes"[..]),
        ("/history/2026-11-10", "gzip", &b"gzip bytes"[..]),
    ] {
        let request = Request::get(path)
            .header(header::ACCEPT_ENCODING, "gzip, br")
            .body(Body::empty())
            .unwrap();
        let response = server.send(request).await;
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        assert_eq!(
            header_str(&response, header::CONTENT_ENCODING),
            Some(encoding),
            "{path}"
        );
        assert_eq!(body_bytes(response).await, body, "{path}");
    }
}

#[tokio::test]
async fn hash_password_output_is_accepted_by_the_server() {
    let mut out = Vec::new();
    hash_password("open sesame\r\n".as_bytes(), &mut out).unwrap();
    let phc = String::from_utf8(out).unwrap();
    assert!(phc.starts_with("$argon2id$"), "{phc}");

    let server = Server::new();
    std::fs::write(server.root.path().join("hash"), &phc).unwrap();
    let server = server.restart();
    assert_eq!(
        server.login_with("open sesame").await.status(),
        StatusCode::NO_CONTENT
    );
}

#[test]
fn hash_password_refuses_an_empty_password() {
    assert!(hash_password("\n".as_bytes(), Vec::new()).is_err());
}
