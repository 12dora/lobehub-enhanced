/**
 * Sidecar limits. Queue and child deadlines sit inside AIHub's aborts
 * (exec 75s, download 150s, login start 30s, status 30s, revoke 45s).
 * Tests assert these numbers.
 */
export const BROKER_TOKEN_MIN = 32;
/**
 * HTTP JSON body cap. Document and table writers must reject their own JSON
 * above ~56 KB so the op / profile envelope still fits under this cap.
 */
export const MAX_BODY_BYTES = 64 * 1024;
export const STDOUT_CAP_BYTES = 1024 * 1024;
export const STDERR_CAP_BYTES = 64 * 1024;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const GLOBAL_CONCURRENCY = 4;
/** Profile lock + runner slot, one clock. Then TIMEOUT. */
export const QUEUE_TIMEOUT_MS = 10_000;
export const CHILD_TIMEOUT_MS = 50_000;
export const DOWNLOAD_TIMEOUT_MS = 100_000;
/** GET /v1/profiles/:profile/status queue (profile lock + slot). AIHub aborts at 30s. */
export const STATUS_QUEUE_MS = 5_000;
/** GET /v1/profiles/:profile/status child. */
export const STATUS_CHILD_MS = 15_000;
/** DELETE profile: each of pre-list, logout, and post-list. */
export const LOGOUT_CHILD_MS = 10_000;
/** DELETE profile total clock. AIHub aborts at 45s. Exhaustion is LOGOUT_FAILED. */
export const LOGOUT_TOTAL_MS = 35_000;
export const PROFILE_CACHE_MS = 10_000;
/** Cap on waiting for the device code, inside LOGIN_START_DEADLINE_MS. */
export const LOGIN_READY_MS = 20_000;
/** POST /v1/login: lock + profile snapshot + device code. */
export const LOGIN_START_DEADLINE_MS = 25_000;
/** DELETE of a pending login: wait for the device-login child to exit. */
export const LOGIN_CANCEL_WAIT_MS = 5_000;
/**
 * DELETE of a pending login: cap on the fresh `dws profile list`.
 * The queue wait and the child each use this cap.
 */
export const LOGIN_CANCEL_LIST_MS = 4_000;
export const LOGIN_CHILD_MS = 16 * 60 * 1000;
export const LOGIN_KEEP_MS = 30 * 60 * 1000;
export const MAX_PENDING_LOGINS = 10;
/** /healthz re-probes `dws version` in the background at most this often, including after a healthy startup. */
export const VERSION_RETRY_MS = 60_000;
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RETENTION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_MAX = 300;
export const CURSOR_MAX = 4096;

/** Contract E.1 broker ceilings. Tests assert these numbers. */
export const DOC_QUERY_MAX = 200;
export const DOC_TITLE_MAX = 100;
export const DOC_MARKDOWN_MAX = 20_000;
export const DOC_SEARCH_LIMIT_MAX = 10;
export const DOC_SEARCH_LIMIT_DEFAULT = 5;
export const WIKI_SPACE_LIMIT = 20;
export const WIKI_NODE_LIMIT_MAX = 30;
export const WIKI_NODE_LIMIT_DEFAULT = 20;
export const DRIVE_LIST_LIMIT = 20;
export const DRIVE_SEARCH_LIMIT_MAX = 10;
export const DRIVE_SEARCH_LIMIT_DEFAULT = 5;
export const SHEET_APPEND_ROWS_MAX = 50;
export const SHEET_APPEND_COLS_MAX = 30;
export const SHEET_READ_ROWS_MAX = 200;
export const SHEET_READ_COLS_MAX = 30;
export const SHEET_CELL_MAX = 500;
export const AITABLE_BASE_QUERY_MIN = 2;
export const AITABLE_BASE_QUERY_MAX = 100;
export const AITABLE_BASE_LIST_LIMIT = 10;
export const AITABLE_RECORD_QUERY_MAX = 50;
export const AITABLE_RECORD_QUERY_DEFAULT = 20;
export const AITABLE_RECORDS_MAX = 20;
export const AITABLE_FIELDS_MAX = 50;
export const AITABLE_CELL_MAX = 2000;
export const AITABLE_RECORD_QUERY_TEXT_MAX = 200;

export const DEFAULT_DWS_BIN = '/usr/local/bin/dws';
export const DEFAULT_CONFIG_DIR = '/var/lib/dws/config';
export const DEFAULT_KEYCHAIN_DIR = '/var/lib/dws/keychain';
export const DEFAULT_HOME = '/var/lib/dws/home';
export const DEFAULT_PORT = 8080;
