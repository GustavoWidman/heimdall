use std::path::Path;
use std::time::Duration;

use argon2::{ARGON2ID_IDENT, Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::Json;
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use eyre::{WrapErr, bail, eyre};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tokio::time::Instant;

use crate::{ApiError, AppState, db};

const COOKIE: &str = "heimdall_session";
/// 400 days, the longest lifetime browsers accept for a cookie.
const COOKIE_MAX_AGE_SECS: u64 = 34_560_000;
const MAX_BACKOFF: Duration = Duration::from_secs(30);

pub struct Auth {
    phc: String,
    throttle: Mutex<Throttle>,
}

/// Global rather than per client: there is one account, so every failure is a guess at
/// the same password no matter where it comes from.
#[derive(Default)]
struct Throttle {
    failures: u32,
    retry_at: Option<Instant>,
}

impl Auth {
    pub fn load(password_hash_file: &Path) -> eyre::Result<Auth> {
        let contents = std::fs::read_to_string(password_hash_file)
            .wrap_err_with(|| format!("reading {}", password_hash_file.display()))?;
        let phc = contents.trim().to_owned();
        let parsed = PasswordHash::new(&phc)
            .map_err(|e| eyre!("{} is not a PHC string: {e}", password_hash_file.display()))?;
        if parsed.algorithm != ARGON2ID_IDENT {
            bail!(
                "{} must hold an argon2id hash",
                password_hash_file.display()
            );
        }
        Ok(Auth {
            phc,
            throttle: Mutex::default(),
        })
    }
}

pub fn hash_password(password: &str) -> eyre::Result<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|e| eyre!("hashing the password: {e}"))
}

/// Proof that the request carries a live session.
pub struct Session;

impl FromRequestParts<AppState> for Session {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token_hash = session_token(&parts.headers)
            .map(hash_token)
            .ok_or(ApiError::Unauthenticated)?;
        let live = state
            .db
            .run(move |conn| db::touch_session(conn, &token_hash))
            .await?;
        if live {
            Ok(Session)
        } else {
            Err(ApiError::Unauthenticated)
        }
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    password: String,
}

pub async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    // Held across verification so concurrent guesses queue behind the back-off instead of
    // racing past it.
    let mut throttle = state.auth.throttle.lock().await;
    if let Some(retry_at) = throttle.retry_at
        && retry_at > Instant::now()
    {
        let wait = retry_at - Instant::now();
        return Err(ApiError::TooManyAttempts {
            retry_after_secs: wait.as_secs() + u64::from(wait.subsec_nanos() > 0),
        });
    }

    let phc = state.auth.phc.clone();
    let verified = tokio::task::spawn_blocking(move || {
        Argon2::default()
            .verify_password(request.password.as_bytes(), phc.as_str())
            .is_ok()
    })
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !verified {
        throttle.failures += 1;
        let backoff = Duration::from_secs(1 << (throttle.failures - 1).min(5)).min(MAX_BACKOFF);
        throttle.retry_at = Some(Instant::now() + backoff);
        return Err(ApiError::Unauthenticated);
    }
    *throttle = Throttle::default();
    drop(throttle);

    let token = URL_SAFE_NO_PAD.encode(db::random_bytes::<32>());
    let token_hash = hash_token(&token);
    state
        .db
        .run(move |conn| db::create_session(conn, &token_hash))
        .await?;
    Ok(with_cookie(&cookie(
        &token,
        COOKIE_MAX_AGE_SECS,
        state.secure_cookies,
    )))
}

/// Succeeds with or without a session, so a retried logout cannot fail.
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    if let Some(token_hash) = session_token(&headers).map(hash_token) {
        state
            .db
            .run(move |conn| db::delete_session(conn, &token_hash))
            .await?;
    }
    Ok(with_cookie(&cookie("", 0, state.secure_cookies)))
}

pub async fn session(_: Session) -> StatusCode {
    StatusCode::NO_CONTENT
}

fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .filter(|token| !token.is_empty())
}

/// Only the hash is stored, so a copy of the database does not hold usable sessions.
fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn cookie(value: &str, max_age_secs: u64, secure: bool) -> String {
    let secure = if secure { " Secure;" } else { "" };
    format!("{COOKIE}={value}; HttpOnly;{secure} SameSite=Strict; Path=/; Max-Age={max_age_secs}")
}

fn with_cookie(cookie: &str) -> Response {
    let value = header::HeaderValue::from_str(cookie).expect("cookies are ASCII");
    (StatusCode::NO_CONTENT, [(header::SET_COOKIE, value)]).into_response()
}
