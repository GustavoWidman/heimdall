use std::convert::Infallible;
use std::time::Duration;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use tokio_stream::StreamExt;
use tokio_stream::wrappers::WatchStream;

use crate::auth::Session;
use crate::{ApiError, AppState, db};

pub const MAX_OPS_PER_REQUEST: usize = 500;
pub const MAX_OPS_PER_RESPONSE: usize = 1000;
pub const MAX_OP_BYTES: usize = 16 * 1024;
pub const MAX_REQUEST_BYTES: usize = MAX_OPS_PER_REQUEST * MAX_OP_BYTES + 64 * 1024;
const HEARTBEAT: Duration = Duration::from_secs(25);

#[derive(Deserialize)]
struct SyncRequest {
    after: i64,
    /// Kept raw so each stored op is byte for byte what the client sent.
    ops: Vec<Box<RawValue>>,
}

#[derive(Serialize)]
pub struct SyncResponse {
    epoch: String,
    head: i64,
    ops: Vec<StoredOp>,
    more: bool,
}

#[derive(Serialize)]
struct StoredOp {
    seq: i64,
    op: Box<RawValue>,
}

/// The envelope is all the server knows of an op. `set` must be a non-empty object, and
/// what it holds belongs to the client.
#[derive(Deserialize)]
struct Envelope {
    hlc: String,
    kind: String,
    id: String,
    set: serde_json::Map<String, serde_json::Value>,
}

/// An op whose envelope passed validation, with its body exactly as received.
struct Op {
    hlc: String,
    body: String,
}

impl Op {
    fn parse(raw: &RawValue) -> Result<Op, &'static str> {
        let body = raw.get();
        if body.len() > MAX_OP_BYTES {
            return Err("op is larger than 16 KiB");
        }
        let envelope: Envelope = serde_json::from_str(body)
            .map_err(|_| "op must be an object with string hlc, kind, id, and an object set")?;
        if envelope.hlc.len() != 23 || !envelope.hlc.bytes().all(is_base36) {
            return Err("hlc must be 23 chars of [0-9a-z]");
        }
        if !is_kind(&envelope.kind) {
            return Err("kind must match ^[a-z][a-z0-9_]{0,31}$");
        }
        if !(1..=128).contains(&envelope.id.len()) || !envelope.id.bytes().all(is_id_byte) {
            return Err("id must be 1 to 128 chars of [A-Za-z0-9_:-]");
        }
        if envelope.set.is_empty() {
            return Err("set must have at least one key");
        }
        Ok(Op {
            hlc: envelope.hlc,
            body: body.to_owned(),
        })
    }
}

fn is_base36(byte: u8) -> bool {
    byte.is_ascii_digit() || byte.is_ascii_lowercase()
}

fn is_kind(kind: &str) -> bool {
    let mut bytes = kind.bytes();
    bytes.next().is_some_and(|first| first.is_ascii_lowercase())
        && kind.len() <= 32
        && bytes.all(|b| is_base36(b) || b == b'_')
}

fn is_id_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':' | b'-')
}

/// Pushes the request's ops and returns every op after the client's cursor, in one round
/// trip. Repeating a request stores nothing new, because an op's hlc is its identity.
pub async fn sync(
    session: Session,
    State(state): State<AppState>,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let request: SyncRequest = serde_json::from_slice(&body)
        .map_err(|e| ApiError::bad_request(format!("invalid sync request: {e}")))?;
    if request.after < 0 {
        return Err(ApiError::bad_request("after must not be negative"));
    }
    if request.ops.len() > MAX_OPS_PER_REQUEST {
        return Err(ApiError::bad_request(format!(
            "at most {MAX_OPS_PER_REQUEST} ops per request"
        )));
    }
    let ops = request
        .ops
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            Op::parse(raw).map_err(|why| ApiError::BadRequest {
                message: format!("op {index}: {why}"),
                index: Some(index),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let after = request.after;
    let (epoch, head, mut page) = state
        .db
        .run(move |conn| {
            db::insert_ops(
                conn,
                ops.iter().map(|op| (op.hlc.as_str(), op.body.as_str())),
            )?;
            let page = db::ops_after(conn, after, MAX_OPS_PER_RESPONSE + 1)?;
            Ok((db::epoch(conn)?, db::head(conn)?, page))
        })
        .await?;
    state.head.send_if_modified(|current| {
        let advanced = head > *current;
        *current = (*current).max(head);
        advanced
    });

    let more = page.len() > MAX_OPS_PER_RESPONSE;
    page.truncate(MAX_OPS_PER_RESPONSE);
    let ops = page
        .into_iter()
        .map(|(seq, body)| {
            let op = RawValue::from_string(body).map_err(|e| ApiError::Internal(e.into()))?;
            Ok(StoredOp { seq, op })
        })
        .collect::<Result<_, ApiError>>()?;
    Ok((
        session.renewal(),
        Json(SyncResponse {
            epoch,
            head,
            ops,
            more,
        }),
    ))
}

/// A poke, not a feed: it says the head moved, and the client pulls through `/api/sync`,
/// so ops arrive one way only.
pub async fn live(session: Session, State(state): State<AppState>) -> impl IntoResponse {
    let heads = WatchStream::new(state.head.subscribe()).map(|head| {
        Ok::<_, Infallible>(
            Event::default()
                .event("head")
                .data(format!("{{\"head\":{head}}}")),
        )
    });
    (
        session.renewal(),
        Sse::new(heads).keep_alive(KeepAlive::new().interval(HEARTBEAT)),
    )
}
