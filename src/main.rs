//! The heimdall server: a durable relay for one user's sync ops, plus the static web app.
//! It stores ops byte for byte and hands them back by cursor. Every domain rule lives in
//! the client.

mod auth;
mod db;
mod sync;
#[cfg(test)]
mod tests;

use std::io::{IsTerminal, Read, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::{Args, FromArgMatches, Subcommand};
use eyre::WrapErr;
use tokio::sync::watch;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};

/// Without a subcommand, heimdall serves and takes the serve flags. The flags are not
/// parsed when a subcommand is given, so their env vars (the Nix package sets
/// HEIMDALL_WEB_DIR) do not make `heimdall hash-password` demand the rest of them.
fn cli() -> clap::Command {
    let cli = clap::Command::new("heimdall")
        .version(env!("CARGO_PKG_VERSION"))
        .about(env!("CARGO_PKG_DESCRIPTION"))
        .args_conflicts_with_subcommands(true)
        .subcommand_negates_reqs(true);
    ServeConfig::augment_args(Command::augment_subcommands(cli))
}

#[derive(Subcommand)]
enum Command {
    /// Print the argon2id PHC string of a password, for --password-hash-file. Prompts for it
    /// twice when stdin is a terminal; otherwise reads it from stdin to the end.
    HashPassword,
}

#[derive(Args, Clone)]
struct ServeConfig {
    #[arg(long, env = "HEIMDALL_LISTEN", default_value = "127.0.0.1:7979")]
    listen: SocketAddr,
    /// Directory holding the database.
    #[arg(long, env = "HEIMDALL_DATA_DIR")]
    data_dir: PathBuf,
    /// The built web app, served for every path outside /api.
    #[arg(long, env = "HEIMDALL_WEB_DIR")]
    web_dir: PathBuf,
    /// A file holding one argon2id PHC string, as printed by `heimdall hash-password`.
    #[arg(long, env = "HEIMDALL_PASSWORD_HASH_FILE")]
    password_hash_file: PathBuf,
    /// Leave `Secure` off the session cookie, for local development over plain http.
    #[arg(long, env = "HEIMDALL_INSECURE_COOKIES")]
    insecure_cookies: bool,
}

#[derive(Clone)]
struct AppState {
    db: db::Db,
    auth: Arc<auth::Auth>,
    /// The highest committed seq. Live listeners wake when it moves.
    head: watch::Sender<i64>,
    secure_cookies: bool,
}

#[derive(Debug)]
enum ApiError {
    BadRequest {
        message: String,
        index: Option<usize>,
    },
    Unauthenticated,
    Forbidden,
    NotFound,
    TooManyAttempts {
        retry_after_secs: u64,
    },
    Internal(eyre::Report),
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> ApiError {
        ApiError::BadRequest {
            message: message.into(),
            index: None,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::BadRequest { message, .. } => (StatusCode::BAD_REQUEST, message.as_str()),
            ApiError::Unauthenticated => (StatusCode::UNAUTHORIZED, "not signed in"),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, "cross-origin request"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not found"),
            ApiError::TooManyAttempts { .. } => {
                (StatusCode::TOO_MANY_REQUESTS, "too many attempts")
            }
            ApiError::Internal(report) => {
                tracing::error!("{report:?}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        };
        let mut body = serde_json::json!({ "error": message });
        if let ApiError::BadRequest {
            index: Some(index), ..
        } = self
        {
            body["index"] = index.into();
        }
        let mut response = (status, Json(body)).into_response();
        if let ApiError::TooManyAttempts { retry_after_secs } = self {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, retry_after_secs.into());
        }
        response
    }
}

fn app(config: &ServeConfig) -> eyre::Result<Router> {
    let db = db::Db::open(&config.data_dir)
        .wrap_err_with(|| format!("opening the database in {}", config.data_dir.display()))?;
    let auth = auth::Auth::load(&config.password_hash_file)?;
    let head = db.with(|conn| db::head(conn))?;
    let state = AppState {
        db,
        auth: Arc::new(auth),
        head: watch::Sender::new(head),
        secure_cookies: !config.insecure_cookies,
    };

    // A page of a thousand ops is about 180 KiB of JSON that gzip shrinks ninefold; brotli
    // saves a few percent more for about 10 MiB of encoder memory. /live stays
    // uncompressed: a compressor would hold its events back.
    let pull = Router::new()
        .route(
            "/sync",
            post(sync::sync).layer(DefaultBodyLimit::max(sync::MAX_REQUEST_BYTES)),
        )
        .layer(CompressionLayer::new().no_br());
    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/session", get(auth::session))
        .merge(pull)
        .route("/live", get(sync::live))
        .fallback(|| async { ApiError::NotFound });

    Ok(Router::new()
        .nest("/api", api)
        .merge(web(&config.web_dir))
        .layer(middleware::from_fn(same_origin))
        .with_state(state))
}

/// The static SPA. Unknown paths get `index.html` so client routes deep-link, except under
/// `/_app`, where a missing asset must be a 404 rather than an HTML page. A `.br` or `.gz`
/// the build wrote beside a file is sent as it is; anything else is compressed per response.
fn web(web_dir: &Path) -> Router<AppState> {
    let index = ServeFile::new(web_dir.join("index.html"))
        .precompressed_br()
        .precompressed_gzip();
    let spa = ServeDir::new(web_dir)
        .precompressed_br()
        .precompressed_gzip()
        .fallback(index);
    let assets = ServeDir::new(web_dir.join("_app"))
        .precompressed_br()
        .precompressed_gzip();
    Router::new()
        .nest_service("/_app", assets)
        .fallback_service(spa)
        .layer(middleware::from_fn(cache_control))
        .layer(CompressionLayer::new())
}

/// Hashed build assets never change, so browsers keep them for a year. Everything else,
/// `index.html` and the service worker first of all, is fetched again on every load so a
/// deploy reaches clients. Those files are small, and their validators cannot be trusted:
/// in the Nix store every file has the same mtime, so a new `index.html` of the same size
/// would look unmodified.
async fn cache_control(mut request: Request, next: Next) -> Response {
    let immutable = request.uri().path().starts_with("/_app/immutable/");
    if !immutable {
        let headers = request.headers_mut();
        headers.remove(header::IF_MODIFIED_SINCE);
        headers.remove(header::IF_NONE_MATCH);
    }
    let mut response = next.run(request).await;
    if immutable {
        if response.status().is_success() {
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        }
    } else {
        let headers = response.headers_mut();
        headers.remove(header::LAST_MODIFIED);
        headers.remove(header::ETAG);
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    response
}

/// Refuses state-changing requests sent from another origin. Together with the SameSite
/// cookie this is the CSRF defense.
async fn same_origin(request: Request, next: Next) -> Response {
    let safe = matches!(*request.method(), Method::GET | Method::HEAD);
    match request.headers().get(header::ORIGIN) {
        Some(origin) if !safe && !is_same_origin(origin, &request) => {
            ApiError::Forbidden.into_response()
        }
        _ => next.run(request).await,
    }
}

fn is_same_origin(origin: &HeaderValue, request: &Request) -> bool {
    let headers: &HeaderMap = request.headers();
    // Behind a TLS-terminating proxy the request arrives over http; the proxy reports the
    // scheme the browser used.
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map_or("http", str::trim);
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            request
                .uri()
                .authority()
                .map(|authority| authority.as_str())
        });
    match (origin.to_str(), host) {
        (Ok(origin), Some(host)) => origin.eq_ignore_ascii_case(&format!("{scheme}://{host}")),
        _ => false,
    }
}

/// Asks on the terminal without echoing, twice, so a typo does not become the password.
fn prompt_password(mut output: impl Write) -> eyre::Result<()> {
    let password = rpassword::prompt_password("password: ").wrap_err("reading the password")?;
    if password.is_empty() {
        eyre::bail!("the password is empty");
    }
    if rpassword::prompt_password("again: ").wrap_err("reading the password")? != password {
        eyre::bail!("the passwords differ");
    }
    writeln!(output, "{}", auth::hash_password(&password)?)?;
    Ok(())
}

fn hash_password(mut input: impl Read, mut output: impl Write) -> eyre::Result<()> {
    let mut password = String::new();
    input
        .read_to_string(&mut password)
        .wrap_err("reading the password from stdin")?;
    let password = password
        .strip_suffix('\n')
        .map_or(password.as_str(), |line| {
            line.strip_suffix('\r').unwrap_or(line)
        });
    if password.is_empty() {
        eyre::bail!("the password on stdin is empty");
    }
    writeln!(output, "{}", auth::hash_password(password)?)?;
    Ok(())
}

async fn serve(config: ServeConfig) -> eyre::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let app = app(&config)?;
    let listener = tokio::net::TcpListener::bind(config.listen)
        .await
        .wrap_err_with(|| format!("binding {}", config.listen))?;
    tracing::info!("listening on {}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    let matches = cli().get_matches();
    if matches.subcommand().is_some() {
        match Command::from_arg_matches(&matches).unwrap_or_else(|e| e.exit()) {
            Command::HashPassword if std::io::stdin().is_terminal() => {
                prompt_password(std::io::stdout())
            }
            Command::HashPassword => hash_password(std::io::stdin(), std::io::stdout()),
        }
    } else {
        serve(ServeConfig::from_arg_matches(&matches).unwrap_or_else(|e| e.exit())).await
    }
}
