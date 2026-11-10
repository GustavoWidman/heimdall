use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::ApiError;

/// Entry `n` (from 0) moves the schema from `user_version = n` to `n + 1`.
const MIGRATIONS: &[&str] = &["
    CREATE TABLE ops (
        seq INTEGER PRIMARY KEY,
        hlc TEXT UNIQUE NOT NULL,
        body TEXT NOT NULL,
        received_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE sessions (
        token_hash BLOB PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE server (epoch TEXT NOT NULL) STRICT;
"];

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// One connection for the whole server. A single user sends a few requests a minute, and
/// SQLite has one writer anyway, so a pool would only add a second way to get a connection.
#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    pub fn open(data_dir: &Path) -> eyre::Result<Db> {
        std::fs::create_dir_all(data_dir)?;
        let mut conn = Connection::open(data_dir.join("heimdall.db"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
        )?;
        migrate(&mut conn)?;
        Ok(Db(Arc::new(Mutex::new(conn))))
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> T) -> T {
        let mut conn = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut conn)
    }

    pub async fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
    ) -> Result<T, ApiError> {
        let db = self.clone();
        tokio::task::spawn_blocking(move || db.with(f))
            .await
            .map_err(|e| ApiError::Internal(e.into()))?
            .map_err(|e| ApiError::Internal(e.into()))
    }
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version: i64 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (target, migration) in (1_i64..)
        .zip(MIGRATIONS)
        .filter(|(target, _)| *target > version)
    {
        tx.execute_batch(migration)?;
        tx.pragma_update(None, "user_version", target)?;
    }
    tx.execute(
        "INSERT INTO server (epoch) SELECT ?1 WHERE NOT EXISTS (SELECT 1 FROM server)",
        [URL_SAFE_NO_PAD.encode(random_bytes::<16>())],
    )?;
    tx.commit()
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).expect("the operating system provides randomness");
    bytes
}

pub fn now_ms() -> i64 {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    i64::try_from(since_epoch.as_millis()).unwrap_or(i64::MAX)
}

pub fn epoch(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT epoch FROM server", [], |row| row.get(0))
}

pub fn head(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM ops", [], |row| {
        row.get(0)
    })
}

/// Stores each `(hlc, body)` pair unless an op with that hlc is already stored, all in one
/// transaction. Returns how many ops were new.
pub fn insert_ops<'a>(
    conn: &mut Connection,
    ops: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> rusqlite::Result<usize> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut inserted = 0;
    {
        let mut insert =
            tx.prepare("INSERT OR IGNORE INTO ops (hlc, body, received_at) VALUES (?1, ?2, ?3)")?;
        let now = now_ms();
        for (hlc, body) in ops {
            inserted += insert.execute(params![hlc, body, now])?;
        }
    }
    tx.commit()?;
    Ok(inserted)
}

/// Up to `limit` `(seq, body)` rows with `seq > after`, in seq order.
pub fn ops_after(
    conn: &Connection,
    after: i64,
    limit: usize,
) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut select =
        conn.prepare_cached("SELECT seq, body FROM ops WHERE seq > ?1 ORDER BY seq LIMIT ?2")?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    select
        .query_map(params![after, limit], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

pub fn create_session(conn: &Connection, token_hash: &[u8]) -> rusqlite::Result<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO sessions (token_hash, created_at, last_seen_at) VALUES (?1, ?2, ?2)",
        params![token_hash, now],
    )?;
    Ok(())
}

/// Whether the session exists. Refreshes `last_seen_at` at most once a day, so polling and
/// live connections do not turn every authenticated read into a write.
pub fn touch_session(conn: &Connection, token_hash: &[u8]) -> rusqlite::Result<bool> {
    let last_seen: Option<i64> = conn
        .query_row(
            "SELECT last_seen_at FROM sessions WHERE token_hash = ?1",
            [token_hash],
            |row| row.get(0),
        )
        .optional()?;
    let Some(last_seen) = last_seen else {
        return Ok(false);
    };
    let now = now_ms();
    if now - last_seen > DAY_MS {
        conn.execute(
            "UPDATE sessions SET last_seen_at = ?2 WHERE token_hash = ?1",
            params![token_hash, now],
        )?;
    }
    Ok(true)
}

pub fn delete_session(conn: &Connection, token_hash: &[u8]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sessions WHERE token_hash = ?1", [token_hash])?;
    Ok(())
}
