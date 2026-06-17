// csv-store.js — ES module
// Central public API for CSV-based persistent storage.
// Tasks 5–15 build this file incrementally.

import { LocalStorageAdapter, FsapiAdapter } from './io-adapter.js';
import { ConfigLoader } from './config-loader.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _mode    = null;    // 'fsapi' | 'localstorage'
let _adapter = null;    // current adapter instance (FsapiAdapter | LocalStorageAdapter)
let _fsHandle = null;   // FileSystemDirectoryHandle (FSAPI mode only)
let _config  = null;    // loaded config object (set by CsvStore.init)

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encode an array of plain-object records to an RFC 4180 CSV string.
 *
 * Rules:
 *  - First line is the header row using `schema` column order.
 *  - Each subsequent line is one record.
 *  - A field value that contains `,`, `"`, `\r`, or `\n` is wrapped in
 *    double-quotes; any `"` inside the value is escaped as `""`.
 *  - Fields that contain none of those characters are written bare (no quotes).
 *  - Missing fields are treated as empty string.
 *  - Lines are separated by CRLF (\r\n) as required by RFC 4180.
 *
 * @param {Object[]} records  Array of plain objects.
 * @param {string[]} schema   Ordered list of column names.
 * @returns {string}          RFC 4180 CSV text (ends with a trailing CRLF).
 */
function _csvEncode(records, schema) {
  const CRLF = '\r\n';
  const SPECIAL = /[,"\r\n]/;

  /**
   * Encode a single field value according to RFC 4180.
   * @param {*} value
   * @returns {string}
   */
  function encodeField(value) {
    // Treat null / undefined as empty string.
    const str = value == null ? '' : String(value);
    if (SPECIAL.test(str)) {
      // Wrap in quotes and escape internal quotes.
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  const rows = [];

  // Header row.
  rows.push(schema.map(encodeField).join(','));

  // Data rows.
  for (const record of records) {
    const fields = schema.map((col) => encodeField(record[col]));
    rows.push(fields.join(','));
  }

  // RFC 4180 requires CRLF between records; we also append a trailing CRLF.
  return rows.join(CRLF) + CRLF;
}

/**
 * Decode an RFC 4180 CSV string back into an array of plain objects.
 *
 * Features:
 *  - Parses the header row; maps columns to object keys.
 *  - Handles quoted fields, embedded commas, `""` escape sequences, and
 *    embedded newlines inside quoted fields.
 *  - Skips rows whose field count differs from the header count and logs a
 *    console warning with the file path (if provided) and 1-based row number.
 *  - Coerces fields listed in `options.numericFields` to Number; substitutes 0
 *    and logs a warning for values that do not parse as a finite number.
 *  - Substitutes safe defaults for missing/empty required fields listed in
 *    `options.requiredFields` and logs a warning.
 *
 * @param {string}   text            RFC 4180 CSV text.
 * @param {string[]} schema          Ordered column name list (used as fallback
 *                                   when the CSV has no header; if the CSV has
 *                                   a header its values take precedence).
 * @param {object}   [options={}]
 * @param {Set<string>}         [options.numericFields]   Field names to coerce to Number.
 * @param {Map<string,*>}       [options.requiredFields]  Field name → safe default value.
 * @param {string}              [options.filePath]        Path shown in console warnings.
 * @returns {Object[]}  Decoded records (one per valid CSV data row).
 */
function _csvDecode(text, schema, options = {}) {
  const { numericFields = new Set(), requiredFields = new Map(), filePath = '' } = options;

  // ------------------------------------------------------------------
  // Step 1: tokenise the CSV text into a flat list of fields, tracking
  //         where each logical row starts.
  // ------------------------------------------------------------------

  /**
   * Parse the full CSV text into an array of rows, where each row is an
   * array of string fields.  Handles:
   *   - CRLF, LF, or CR line endings between records.
   *   - Quoted fields that may contain commas, quotes (as ""), or newlines.
   *   - Unquoted fields terminated by comma or record separator.
   *
   * Returns [] for empty / whitespace-only input.
   *
   * Algorithm: character-by-character state machine.
   * States: FIELD_START | UNQUOTED | QUOTED | AFTER_QUOTE
   */
  function parseRows(src) {
    const rows = [];
    const len = src.length;
    if (len === 0) return rows;

    // States
    const S_FIELD_START = 0; // beginning of a new field
    const S_UNQUOTED    = 1; // inside an unquoted field
    const S_QUOTED      = 2; // inside a quoted field
    const S_AFTER_QUOTE = 3; // just saw a closing " in a quoted field

    let state = S_FIELD_START;
    let fieldBuf = '';
    let currentRow = [];
    let pos = 0;

    // Helper: push the current field buffer and reset.
    function pushField() {
      currentRow.push(fieldBuf);
      fieldBuf = '';
    }

    // Helper: end a record row.
    function pushRow() {
      pushField();
      rows.push(currentRow);
      currentRow = [];
      state = S_FIELD_START;
    }

    while (pos < len) {
      const ch = src[pos];

      switch (state) {
        case S_FIELD_START:
          if (ch === '"') {
            state = S_QUOTED;
            pos++;
          } else if (ch === ',') {
            // Empty field
            pushField();
            pos++;
            // state stays S_FIELD_START for the next field
          } else if (ch === '\r') {
            // End of record (CRLF or bare CR)
            if (pos + 1 < len && src[pos + 1] === '\n') pos++; // consume LF
            pos++;
            pushRow();
          } else if (ch === '\n') {
            pos++;
            pushRow();
          } else {
            state = S_UNQUOTED;
            fieldBuf += ch;
            pos++;
          }
          break;

        case S_UNQUOTED:
          if (ch === ',') {
            pushField();
            pos++;
            state = S_FIELD_START;
          } else if (ch === '\r') {
            if (pos + 1 < len && src[pos + 1] === '\n') pos++;
            pos++;
            pushRow();
          } else if (ch === '\n') {
            pos++;
            pushRow();
          } else {
            fieldBuf += ch;
            pos++;
          }
          break;

        case S_QUOTED:
          if (ch === '"') {
            state = S_AFTER_QUOTE;
            pos++;
          } else {
            fieldBuf += ch;
            pos++;
          }
          break;

        case S_AFTER_QUOTE:
          if (ch === '"') {
            // Escaped quote inside quoted field: "" → "
            fieldBuf += '"';
            state = S_QUOTED;
            pos++;
          } else if (ch === ',') {
            // End of quoted field, followed by next field
            pushField();
            pos++;
            state = S_FIELD_START;
          } else if (ch === '\r') {
            if (pos + 1 < len && src[pos + 1] === '\n') pos++;
            pos++;
            pushRow();
          } else if (ch === '\n') {
            pos++;
            pushRow();
          } else {
            // Malformed: char after closing quote that isn't , or newline.
            // Treat as part of the field (lenient parsing).
            fieldBuf += ch;
            state = S_UNQUOTED;
            pos++;
          }
          break;
      }
    }

    // Flush any remaining content as the final record.
    // Only add a trailing row if there's content in the current row or field,
    // so we don't add a spurious empty row after a terminal newline.
    if (currentRow.length > 0 || fieldBuf.length > 0) {
      pushField();
      rows.push(currentRow);
    }

    return rows;
  }

  const allRows = parseRows(text);
  if (allRows.length === 0) return [];

  // ------------------------------------------------------------------
  // Step 2: extract the header row.
  // ------------------------------------------------------------------

  const headerRow = allRows[0];
  const dataRows  = allRows.slice(1);
  const headerCount = headerRow.length;

  // ------------------------------------------------------------------
  // Step 3: convert each data row to an object, applying validation.
  // ------------------------------------------------------------------

  const records = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2; // 1-based, header is row 1

    // 3a. Field-count check.
    if (row.length !== headerCount) {
      const where = filePath ? `"${filePath}"` : '(unknown file)';
      console.warn(
        `[CsvStore] Skipping row ${rowNumber} in ${where}: ` +
        `expected ${headerCount} fields but got ${row.length}.`
      );
      continue;
    }

    // 3b. Build initial object from header → field value mapping.
    const obj = {};
    for (let c = 0; c < headerCount; c++) {
      obj[headerRow[c]] = row[c];
    }

    // 3c. Numeric field coercion.
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(obj, field)) {
        const raw = obj[field];
        const num = Number(raw);
        if (!isFinite(num) || raw.trim() === '') {
          const where = filePath ? `"${filePath}"` : '(unknown file)';
          console.warn(
            `[CsvStore] Non-numeric value for field "${field}" at row ${rowNumber} ` +
            `in ${where}: "${raw}". Substituting 0.`
          );
          obj[field] = 0;
        } else {
          obj[field] = num;
        }
      }
    }

    // 3d. Required-field default substitution.
    for (const [field, defaultValue] of requiredFields) {
      const val = obj[field];
      if (val === undefined || val === null || val === '') {
        const where = filePath ? `"${filePath}"` : '(unknown file)';
        console.warn(
          `[CsvStore] Missing required field "${field}" at row ${rowNumber} ` +
          `in ${where}. Substituting default: ${JSON.stringify(defaultValue)}.`
        );
        obj[field] = defaultValue;
      }
    }

    records.push(obj);
  }

  return records;
}

// ---------------------------------------------------------------------------
// Task 7.1 / 7.2 — I/O mode selection and FSAPI folder-picker flow
// ---------------------------------------------------------------------------

/**
 * Inject a fixed-position, non-dismissible fallback warning banner into <body>.
 * Only one banner is ever injected (guarded by the element id 'mms-io-fallback-banner').
 * Amber styling matches config-loader's banner.
 *
 * @param {string} msg  Human-readable warning text.
 */
function _showFallbackBanner(msg) {
  // Guard: only inject once per page session
  if (typeof document === 'undefined') return;
  if (document.getElementById('mms-io-fallback-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'mms-io-fallback-banner';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'right: 0',
    'z-index: 99999',
    'background: #fff3cd',
    'color: #856404',
    'border-bottom: 2px solid #ffc107',
    'padding: 10px 16px',
    'font-family: sans-serif',
    'font-size: 14px',
    'pointer-events: none',   // non-blocking — clicks pass through
  ].join('; ');
  banner.textContent = '⚠ ' + msg;

  const inject = () => {
    document.body.insertBefore(banner, document.body.firstChild);
  };

  if (document.body) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }
}

/**
 * Shared helper: switch to localStorage mode and show the fallback banner.
 * Safe to call more than once — the banner deduplication is handled by _showFallbackBanner.
 *
 * @param {string} msg  Message passed to the banner.
 */
function _fallbackToLocalStorage(msg) {
  _mode    = 'localstorage';
  _adapter = new LocalStorageAdapter();
  _showFallbackBanner(msg);
}

/**
 * Task 7.1 — select I/O mode at startup.
 *
 * - FSAPI available  → set _mode = 'fsapi'; adapter is wired on first I/O by
 *                      _ensureFsapiAdapter().
 * - FSAPI absent     → instantiate LocalStorageAdapter immediately and show the
 *                      non-dismissible fallback banner (Requirement 5.4).
 */
async function _initMode() {
  if (typeof window !== 'undefined' &&
      typeof window.showDirectoryPicker === 'function') {
    // FSAPI is available — defer folder picker until first I/O (Task 7.2)
    _mode = 'fsapi';
    // _adapter will be set by _ensureFsapiAdapter() on first I/O
  } else {
    // No FSAPI — use localStorage for the whole session (Requirement 5.4)
    _fallbackToLocalStorage(
      'localStorage fallback: CSV files will NOT be shared with other users. ' +
      'Use a Chromium-based browser for shared CSV storage.'
    );
  }
}

/**
 * Task 7.2 — ensure an FsapiAdapter is ready before any I/O operation.
 *
 * Called at the start of every I/O path when _mode === 'fsapi'.
 * - Already have a valid FsapiAdapter  → returns immediately.
 * - First call                         → opens the directory picker.
 *   - User grants access               → cache handle; create FsapiAdapter.
 *   - User dismisses (AbortError)      → fall back to localStorage + banner.
 * - Mid-session permission revocation  → callers must catch the resulting error
 *   from adapter methods and call _fallbackToLocalStorage themselves (see below).
 *
 * @returns {Promise<void>}
 */
async function _ensureFsapiAdapter() {
  // Already connected — nothing to do
  if (_adapter instanceof FsapiAdapter) return;

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _fsHandle = handle;
    _adapter  = new FsapiAdapter(_fsHandle);
  } catch (err) {
    // AbortError: user dismissed the picker (Requirement 5.3)
    // Any other unexpected error: also fall back gracefully
    _fallbackToLocalStorage(
      'Folder access was not granted. Data will not be shared with other users ' +
      'and will not persist across sessions in this browser.'
    );
  }
}

// ---------------------------------------------------------------------------
// Identity management (Task 8.1 — Requirements 7.1, 7.2, 7.3, 10.4)
// ---------------------------------------------------------------------------

/** Currently resolved user identity for this session. Set by _ensureIdentity(). */
let _userIdentity = null;

/**
 * Ensures a user identity is stored in sessionStorage for this session.
 *
 * - If `sessionStorage.mms_user_identity` is already set, restores it and returns immediately.
 * - Otherwise, injects a fixed-position modal overlay prompting for a display name.
 * - On submit (button click or Enter key):
 *   - Trimmed length 1–100 → store trimmed name.
 *   - Empty / whitespace-only → store "Unknown User".
 * - On overlay dismiss (Escape key): store "Unknown User".
 * - After resolution: writes to sessionStorage, updates `_userIdentity`, updates the
 *   navbar "👤 Engineer" span, and removes the overlay from the DOM.
 *
 * @returns {Promise<void>}
 */
async function _ensureIdentity() {
  // 1. Check sessionStorage for an existing identity.
  const stored = sessionStorage.getItem('mms_user_identity');
  if (stored !== null) {
    _userIdentity = stored;
    return;
  }

  // 2. Build the modal overlay programmatically.
  const overlay = document.createElement('div');
  overlay.id = 'mms-identity-overlay';
  overlay.style.cssText = [
    'position: fixed',
    'inset: 0',
    'background: rgba(0,0,0,0.5)',
    'z-index: 100000',
    'display: flex',
    'align-items: center',
    'justify-content: center',
  ].join('; ');

  // Modal card
  const card = document.createElement('div');
  card.style.cssText = [
    'background: #ffffff',
    'padding: 32px 28px',
    'border-radius: 8px',
    'box-shadow: 0 8px 32px rgba(0,0,0,0.28)',
    'min-width: 320px',
    'max-width: 90vw',
    'font-family: sans-serif',
  ].join('; ');

  const heading = document.createElement('h2');
  heading.textContent = 'Enter Your Name';
  heading.style.cssText = 'margin: 0 0 8px 0; font-size: 1.25rem; color: #212529;';

  const desc = document.createElement('p');
  desc.textContent = 'Your name will be used to attribute changes.';
  desc.style.cssText = 'margin: 0 0 20px 0; font-size: 0.9rem; color: #6c757d;';

  const input = document.createElement('input');
  input.id = 'mms-identity-input';
  input.type = 'text';
  input.placeholder = 'Display name';
  input.maxLength = 100;
  input.style.cssText = [
    'display: block',
    'width: 100%',
    'box-sizing: border-box',
    'padding: 8px 12px',
    'font-size: 1rem',
    'border: 1px solid #ced4da',
    'border-radius: 4px',
    'margin-bottom: 16px',
    'outline: none',
  ].join('; ');

  const btn = document.createElement('button');
  btn.id = 'mms-identity-submit';
  btn.textContent = 'Continue';
  btn.style.cssText = [
    'display: block',
    'width: 100%',
    'padding: 9px 0',
    'font-size: 1rem',
    'background: #0d6efd',
    'color: #fff',
    'border: none',
    'border-radius: 4px',
    'cursor: pointer',
  ].join('; ');

  card.appendChild(heading);
  card.appendChild(desc);
  card.appendChild(input);
  card.appendChild(btn);
  overlay.appendChild(card);

  // 3. Return a Promise that resolves once the user submits or dismisses.
  return new Promise((resolve) => {
    /**
     * Resolve with a name derived from the input value, store it, update the
     * navbar, remove the overlay, and resolve the Promise.
     *
     * @param {string} rawValue  The raw input value (may be empty/whitespace).
     */
    function commit(rawValue) {
      const trimmed = rawValue.trim();
      const name = (trimmed.length >= 1 && trimmed.length <= 100) ? trimmed : 'Unknown User';

      sessionStorage.setItem('mms_user_identity', name);
      _userIdentity = name;

      // Update the navbar span that contains "👤"
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
        if (span.textContent.includes('👤')) {
          span.textContent = '👤 ' + name;
          break;
        }
      }

      // Also try the more specific selectors as a fallback
      if (!document.querySelector('span')) {
        const brand = document.querySelector('.navbar-brand, .navbar span');
        if (brand && brand.textContent.includes('👤')) {
          brand.textContent = '👤 ' + name;
        }
      }

      // Remove overlay
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }

      resolve();
    }

    // Button click handler
    btn.addEventListener('click', () => {
      commit(input.value);
    });

    // Enter key in the input field
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        commit(input.value);
      }
    });

    // Escape key dismisses the modal → store "Unknown User"
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKeyDown);
        commit('');
      }
    }
    document.addEventListener('keydown', onKeyDown);

    // 4. Append overlay to document.body (guard for DOMContentLoaded).
    function attachOverlay() {
      document.body.appendChild(overlay);
      // Focus the input so the user can start typing immediately
      input.focus();
    }

    if (document.body) {
      attachOverlay();
    } else {
      document.addEventListener('DOMContentLoaded', attachOverlay);
    }
  });
}

// ---------------------------------------------------------------------------
// Task 9 — Toast stub, read-only indicator, and write-lock logic
// (Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6)
// ---------------------------------------------------------------------------

/**
 * Show a notification toast to the user.
// Stub — full implementation in Task 15
// (moved to full implementation below)

/**
 * Inject (or update) a read-only indicator in the navbar while a lock is held
 * by another user (Requirement 6.5).
 *
 * Inserts a fixed-position <span id="mms-readonly-indicator"> if it doesn't
 * already exist. Uses fixed positioning so no existing page element is shifted
 * or reflowed (Requirement 10.4).
 *
 * @param {string} user  Name of the user who holds the lock.
 */
function _showReadOnlyIndicator(user) {
  if (typeof document === 'undefined') return;

  let indicator = document.getElementById('mms-readonly-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.id = 'mms-readonly-indicator';
    indicator.style.cssText = [
      'position: fixed',
      'top: 8px',
      'right: 16px',
      'z-index: 100001',
      'background: #dc3545',
      'color: #ffffff',
      'padding: 4px 10px',
      'border-radius: 4px',
      'font-family: sans-serif',
      'font-size: 13px',
      'font-weight: 600',
      'pointer-events: none',
      'box-shadow: 0 2px 6px rgba(0,0,0,0.25)',
    ].join('; ');

    const attach = () => document.body.appendChild(indicator);
    if (document.body) {
      attach();
    } else {
      document.addEventListener('DOMContentLoaded', attach);
    }
  }

  indicator.textContent = `🔒 Read-only (locked by ${user})`;
}

/**
 * Remove the read-only indicator from the DOM (Requirement 6.5).
 * Safe to call when the indicator is not present.
 */
function _hideReadOnlyIndicator() {
  if (typeof document === 'undefined') return;
  const indicator = document.getElementById('mms-readonly-indicator');
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator);
  }
}

/**
 * Acquire a write lock for the given entity+month combination.
 *
 * Lock file path: `{dataPath}/locks/{entity}-{month}.lock`
 * Lock file content: JSON `{ user, timestamp }`
 *
 * Behaviour:
 *  - If no lock file exists (or the existing content is empty/blank): write a
 *    fresh lock and return.
 *  - If a lock file exists AND its timestamp is within `lockTimeoutSeconds`
 *    seconds of now: show a toast + read-only indicator and throw a conflict
 *    error — the caller must NOT proceed with the write.
 *  - If a lock file exists AND its timestamp is older than `lockTimeoutSeconds`
 *    seconds: treat as stale, overwrite it with our lock (delete-by-overwrite),
 *    and return.
 *  - If reading or writing the lock file fails with an I/O error: throw so the
 *    caller aborts the write (Requirement 6.6).
 *
 * @param {string} entity  e.g. 'machines' | 'breakdowns' | 'spareparts'
 * @param {string} month   e.g. '2026-06'
 * @returns {Promise<void>}
 * @throws {Error} On lock conflict or I/O failure.
 */
async function _acquireLock(entity, month) {
  const lockPath = `${_config.dataPath}/locks/${entity}-${month}.lock`;

  // 1. Attempt to read any existing lock file.
  let existing;
  try {
    existing = await _adapter.readFile(lockPath);
  } catch (err) {
    // I/O error reading the lock — abort and surface to user (Requirement 6.6)
    _showToast(`Lock I/O error: could not read lock file for ${entity}/${month}. ${err.message}`, 'error');
    throw new Error(`Lock I/O error (read): ${err.message}`);
  }

  // 2. Evaluate any existing lock content.
  if (existing && existing.trim() !== '') {
    let lockData;
    try {
      lockData = JSON.parse(existing);
    } catch (_) {
      // Malformed lock file — treat as stale and overwrite.
      lockData = null;
    }

    if (lockData && lockData.timestamp) {
      const ageSeconds = (Date.now() - new Date(lockData.timestamp).getTime()) / 1000;

      if (ageSeconds < _config.lockTimeoutSeconds) {
        // Fresh lock — conflict (Requirement 6.2)
        const unlockTime = new Date(
          new Date(lockData.timestamp).getTime() + _config.lockTimeoutSeconds * 1000
        ).toLocaleTimeString();

        _showToast(
          `File locked by "${lockData.user}". Estimated unlock: ${unlockTime}`,
          'warning'
        );
        _showReadOnlyIndicator(lockData.user);
        throw new Error(`Write conflict: file locked by ${lockData.user}`);
      }

      // Stale lock — fall through to overwrite (Requirement 6.4)
      // "Delete" by overwriting with empty string (adapter interface has no deleteFile)
      try {
        await _adapter.writeFile(lockPath, '');
      } catch (err) {
        _showToast(`Lock I/O error: could not clear stale lock for ${entity}/${month}. ${err.message}`, 'error');
        throw new Error(`Lock I/O error (stale-clear): ${err.message}`);
      }
    }
    // If lockData was malformed (null), fall through and overwrite below.
  }

  // 3. Write our own lock (Requirement 6.1)
  const lockContent = JSON.stringify({
    user: _userIdentity || 'Unknown User',
    timestamp: new Date().toISOString(),
  });

  try {
    await _adapter.writeFile(lockPath, lockContent);
  } catch (err) {
    // I/O error creating the lock — abort (Requirement 6.6)
    _showToast(`Lock I/O error: could not create lock for ${entity}/${month}. ${err.message}`, 'error');
    throw new Error(`Lock I/O error (write): ${err.message}`);
  }
}

/**
 * Release (delete) the write lock for the given entity+month combination.
 *
 * "Delete" is implemented as overwriting with an empty string because the
 * current adapter interface does not expose a deleteFile method.  The empty
 * string is treated as "no lock" by _acquireLock (Requirement 6.3).
 *
 * The deletion is scheduled via setTimeout(..., 0) so it runs asynchronously
 * after the calling write operation returns, while still completing well within
 * the 500 ms window required by Requirement 6.3.
 *
 * Also removes the read-only indicator from the navbar (Requirement 6.5).
 *
 * @param {string} entity  e.g. 'machines' | 'breakdowns' | 'spareparts'
 * @param {string} month   e.g. '2026-06'
 * @returns {void}  (fire-and-forget; errors are logged, not thrown)
 */
function _releaseLock(entity, month) {
  setTimeout(async () => {
    const lockPath = `${_config.dataPath}/locks/${entity}-${month}.lock`;
    try {
      await _adapter.writeFile(lockPath, '');
    } catch (err) {
      // Non-fatal: log but don't throw — the write itself has already completed
      console.warn(`[CsvStore] Failed to release lock for ${entity}/${month}:`, err);
    }
    _hideReadOnlyIndicator();
  }, 0);
}

// ---------------------------------------------------------------------------
// Entity schemas, numeric fields, and required fields (Task 10.1 / 10.3)
// ---------------------------------------------------------------------------

const SCHEMAS = {
  machines: [
    'id', 'name', 'type', 'location', 'status', 'date', 'brand', 'serial',
    'notes', 'createdBy', 'modifiedBy', 'createdAt', 'modifiedAt',
  ],
  breakdowns: [
    'ref', 'machine', 'bdDate', 'status', 'startTime', 'endDate', 'endTime',
    'ttrMins', 'technician', 'operator', 'problem', 'action', 'rootCause',
    'partsUsed', 'history', 'createdBy', 'modifiedBy', 'createdAt', 'modifiedAt',
  ],
  spareparts: [
    'id', 'spareName', 'machine', 'storageLocation', 'compartment', 'specification',
    'newUsedRepaired', 'unitPrice', 'qtyInStock', 'minStockReq', 'leadTime', 'supplier',
    'discontinued', 'notes', 'movements', 'createdBy', 'modifiedBy', 'createdAt', 'modifiedAt',
  ],
};

const NUMERIC_FIELDS = {
  machines:    new Set([]),
  breakdowns:  new Set(['ttrMins']),
  spareparts:  new Set(['unitPrice', 'qtyInStock', 'minStockReq']),
};

const REQUIRED_FIELDS = {
  machines:   new Map([['id', ''], ['name', '']]),
  breakdowns: new Map([['ref', ''], ['machine', ''], ['bdDate', ''], ['status', '']]),
  spareparts: new Map([['id', ''], ['spareName', ''], ['qtyInStock', 0], ['minStockReq', 0]]),
};

// ---------------------------------------------------------------------------
// In-memory cache (Task 10.1 / 10.3)
// ---------------------------------------------------------------------------

/** entity → Record[]  (merged across all monthly folders) */
const _cache = new Map();

/** recordId → 'YYYY-MM'  (the most-recent folder that contains the record) */
const _creationMonthMap = new Map();

// ---------------------------------------------------------------------------
// Helpers (Task 10.1)
// ---------------------------------------------------------------------------

/**
 * Return the unique record identifier for the given entity type.
 *
 * @param {string} entity  — 'machines' | 'breakdowns' | 'spareparts'
 * @param {Object} record  — the plain-object record
 * @returns {string}
 */
function _getRecordId(entity, record) {
  if (entity === 'breakdowns') return record.ref;
  return record.id;
}

// ---------------------------------------------------------------------------
// Task 10.1 — _loadAll(entity): read and merge all monthly folders
// ---------------------------------------------------------------------------

/**
 * Load all monthly CSV files for `entity`, merge them (most-recent folder wins
 * on duplicate IDs), and populate `_cache` and `_creationMonthMap`.
 *
 * Algorithm:
 *  1. listDir(dataPath) → get all immediate children of the data root.
 *  2. Filter: only directories whose name matches /^\d{4}-\d{2}$/.
 *  3. Sort ascending (lexicographic YYYY-MM sort equals chronological order).
 *  4. For each folder in order: read the entity CSV file; decode; merge into a
 *     Map keyed by record ID — later (more-recent) folders overwrite earlier ones.
 *  5. Rebuild _creationMonthMap entries for all records touched.
 *  6. Commit merged records to _cache.
 *
 * On any unreadable folder or file: log a console warning and continue.
 *
 * Requirements: 2.1, 2.3, 3.4
 *
 * @param {string} entity — 'machines' | 'breakdowns' | 'spareparts'
 * @returns {Promise<void>}
 */
async function _loadAll(entity) {
  const dataPath = _config.dataPath;

  // Step 1–2: list dataPath and filter to YYYY-MM directories.
  let entries;
  try {
    entries = await _adapter.listDir(dataPath);
  } catch (err) {
    console.warn(`[CsvStore] Could not list data directory "${dataPath}": ${err.message}`);
    _cache.set(entity, []);
    return;
  }

  const monthFolders = entries
    .filter((e) => e.type === 'directory' && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort(); // lexicographic ascending == chronological for YYYY-MM

  // Step 3–4: read and merge.
  // The Map preserves last-write-wins semantics: iterating sorted folders means
  // each successive folder overwrites the same key when duplicates exist.
  const mergedMap = new Map(); // recordId → record

  for (const folder of monthFolders) {
    const filePath = `${dataPath}/${folder}/${entity}.csv`;

    let content;
    try {
      content = await _adapter.readFile(filePath);
    } catch (err) {
      console.warn(`[CsvStore] Could not read "${filePath}": ${err.message}`);
      continue;
    }

    if (content === null || content === undefined) {
      console.warn(`[CsvStore] Could not read "${filePath}": file not found or unreadable`);
      continue;
    }

    let records;
    try {
      records = _csvDecode(content, SCHEMAS[entity], {
        numericFields:  NUMERIC_FIELDS[entity],
        requiredFields: REQUIRED_FIELDS[entity],
        filePath,
      });
    } catch (err) {
      console.warn(`[CsvStore] Failed to decode "${filePath}": ${err.message}`);
      continue;
    }

    for (const record of records) {
      const id = _getRecordId(entity, record);
      mergedMap.set(id, record);
      // Track the most-recent folder for each record.
      _creationMonthMap.set(id, folder);
    }
  }

  // Step 6: commit to cache.
  _cache.set(entity, Array.from(mergedMap.values()));
}

// ---------------------------------------------------------------------------
// Task 15 — _showToast(msg, type): non-blocking notification component
// ---------------------------------------------------------------------------

/**
 * Display a toast notification at the bottom-right of the page.
 *
 * Severity:
 *  - 'error'   — red left-border; permanent (stays until page reload).
 *  - 'warning' — amber left-border; auto-dismisses after 6 seconds.
 *  - 'info'    — blue left-border; auto-dismisses after 4 seconds.
 *
 * A single `<div id="mms-toast-container">` is injected once; individual
 * toasts are appended as children so multiple messages can stack.
 *
 * @param {string} msg   — Human-readable message.
 * @param {'error'|'warning'|'info'} [type='info'] — Severity level.
 */
function _showToast(msg, type = 'info') {
  if (typeof document === 'undefined') return; // no DOM in test environments

  // Ensure the container exists.
  let container = document.getElementById('mms-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mms-toast-container';
    container.style.cssText = [
      'position: fixed',
      'bottom: 20px',
      'right: 20px',
      'z-index: 100001',
      'display: flex',
      'flex-direction: column',
      'gap: 8px',
      'pointer-events: none',
      'max-width: 380px',
    ].join('; ');
    const attach = () => document.body.appendChild(container);
    if (document.body) { attach(); }
    else { document.addEventListener('DOMContentLoaded', attach); }
  }

  const STYLES = {
    error:   { bg: '#fff0f0', border: '#dc3545', text: '#842029' },
    warning: { bg: '#fff3cd', border: '#ffc107', text: '#856404' },
    info:    { bg: '#e7f1ff', border: '#0d6efd', text: '#084298' },
  };
  const s = STYLES[type] || STYLES.info;

  const toast = document.createElement('div');
  toast.style.cssText = [
    'background: ' + s.bg,
    'color: ' + s.text,
    'border-left: 4px solid ' + s.border,
    'padding: 10px 14px',
    'border-radius: 4px',
    'font-family: sans-serif',
    'font-size: 14px',
    'box-shadow: 0 2px 8px rgba(0,0,0,0.15)',
    'pointer-events: auto',
    'word-break: break-word',
  ].join('; ');
  toast.textContent = msg;

  container.appendChild(toast);

  // Auto-dismiss non-error toasts.
  const DURATIONS = { warning: 6000, info: 4000 };
  if (type in DURATIONS) {
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, DURATIONS[type]);
  }
}

// ---------------------------------------------------------------------------
// Task 13.1 — Migration detection and _showMigrationDialog()
// (Requirements 8.1, 10.4)
// ---------------------------------------------------------------------------

/**
 * Show a fixed-position migration dialog that offers the user the option to
 * migrate existing localStorage data to CSV files.
 *
 * Dialog contains:
 *  - Heading: "Migrate existing data to CSV?"
 *  - Description paragraph
 *  - "Migrate now" button (blue)
 *  - "Skip" button (grey)
 *
 * The dialog uses the same overlay/card pattern as the identity modal so that
 * no existing page element is shifted or reflowed (Requirement 10.4).
 *
 * @returns {Promise<'migrate'|'skip'>}  Resolves when the user clicks a button.
 */
async function _showMigrationDialog() {
  const overlay = document.createElement('div');
  overlay.id = 'mms-migration-overlay';
  overlay.style.cssText = [
    'position: fixed',
    'inset: 0',
    'background: rgba(0,0,0,0.5)',
    'z-index: 100000',
    'display: flex',
    'align-items: center',
    'justify-content: center',
  ].join('; ');

  // Modal card
  const card = document.createElement('div');
  card.style.cssText = [
    'background: #ffffff',
    'padding: 32px 28px',
    'border-radius: 8px',
    'box-shadow: 0 8px 32px rgba(0,0,0,0.28)',
    'min-width: 340px',
    'max-width: 90vw',
    'font-family: sans-serif',
  ].join('; ');

  const heading = document.createElement('h2');
  heading.textContent = 'Migrate existing data to CSV?';
  heading.style.cssText = 'margin: 0 0 12px 0; font-size: 1.25rem; color: #212529;';

  const desc = document.createElement('p');
  desc.textContent =
    'Existing data in browser storage (machines, breakdowns, spare parts) can be exported to ' +
    'CSV files for shared access.';
  desc.style.cssText = 'margin: 0 0 24px 0; font-size: 0.9rem; color: #6c757d; line-height: 1.5;';

  const migrateBtn = document.createElement('button');
  migrateBtn.id = 'mms-migrate-now';
  migrateBtn.textContent = 'Migrate now';
  migrateBtn.style.cssText = [
    'display: block',
    'width: 100%',
    'padding: 9px 0',
    'font-size: 1rem',
    'background: #0d6efd',
    'color: #fff',
    'border: none',
    'border-radius: 4px',
    'cursor: pointer',
    'margin-bottom: 10px',
  ].join('; ');

  const skipBtn = document.createElement('button');
  skipBtn.id = 'mms-migrate-skip';
  skipBtn.textContent = 'Skip';
  skipBtn.style.cssText = [
    'display: block',
    'width: 100%',
    'padding: 9px 0',
    'font-size: 1rem',
    'background: #6c757d',
    'color: #fff',
    'border: none',
    'border-radius: 4px',
    'cursor: pointer',
  ].join('; ');

  card.appendChild(heading);
  card.appendChild(desc);
  card.appendChild(migrateBtn);
  card.appendChild(skipBtn);
  overlay.appendChild(card);

  return new Promise((resolve) => {
    function close(choice) {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      resolve(choice);
    }

    migrateBtn.addEventListener('click', () => close('migrate'));
    skipBtn.addEventListener('click',    () => close('skip'));

    const attach = () => document.body.appendChild(overlay);
    if (document.body) {
      attach();
    } else {
      document.addEventListener('DOMContentLoaded', attach);
    }
  });
}

/**
 * Check whether a one-time migration from localStorage to CSV should be
 * offered, and if so, present the migration dialog.
 *
 * Migration conditions (both must be true — Requirement 8.1):
 *  1. At least one of `mms_machines`, `mms_breakdowns`, `mms_spares` exists in
 *     localStorage (i.e. legacy data is present).
 *  2. No YYYY-MM sub-directories exist under `_config.dataPath` (i.e. no CSV
 *     files have been written yet).
 *
 * If either condition is false, the function returns `null` immediately
 * (no dialog is shown).
 *
 * If both conditions are true, the migration dialog is injected and this
 * function blocks until the user clicks "Migrate now" or "Skip".
 *
 * @returns {Promise<'migrate'|'skip'|null>}
 *   'migrate' — user chose to migrate,
 *   'skip'    — user chose to skip (suppress dialog for this session),
 *   null      — migration is not applicable.
 */
async function _checkAndShowMigrationDialog() {
  // Condition 1: legacy localStorage keys present?
  const hasLegacyData =
    localStorage.getItem('mms_machines')   !== null ||
    localStorage.getItem('mms_breakdowns') !== null ||
    localStorage.getItem('mms_spares')     !== null;

  if (!hasLegacyData) return null;

  // Condition 2: no YYYY-MM folders under dataPath?
  let hasExistingCsvFolders = false;
  try {
    const entries = await _adapter.listDir(_config.dataPath);
    hasExistingCsvFolders = entries.some(
      (e) => e.type === 'directory' && /^\d{4}-\d{2}$/.test(e.name)
    );
  } catch (_err) {
    // If we can't list the directory (e.g. it doesn't exist yet), treat it as
    // having no CSV folders — migration is still applicable.
    hasExistingCsvFolders = false;
  }

  if (hasExistingCsvFolders) return null;

  // Both conditions met — show the dialog.
  if (typeof document === 'undefined') return null; // non-browser environment
  return _showMigrationDialog();
}

/**
 * Task 13.2 — Execute migration from localStorage to CSV files.
 *
 * Steps:
 *  1. Parse each localStorage JSON array (mms_machines, mms_breakdowns, mms_spares).
 *  2. Route each record to its `createdAt`-derived month (or current month as fallback).
 *  3. Write CSV files via `_flush`.
 *  4. On successful migration of each entity: delete that localStorage key.
 *  5. On failure for any entity: retain its localStorage data; display per-entity error.
 *
 * Requirements: 8.2, 8.3, 8.4, 8.5
 *
 * @returns {Promise<void>}
 */
async function _executeMigration() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const entities = ['machines', 'breakdowns', 'spareparts'];
  const storageKeys = { machines: 'mms_machines', breakdowns: 'mms_breakdowns', spareparts: 'mms_spares' };
  
  for (const entity of entities) {
    const storageKey = storageKeys[entity];
    const rawData = localStorage.getItem(storageKey);
    
    if (!rawData) continue; // Skip if this entity doesn't exist in localStorage
    
    try {
      const records = JSON.parse(rawData);
      if (!Array.isArray(records)) continue;
      
      // Group records by creation month
      const monthMap = new Map(); // month → [records]
      
      for (const record of records) {
        let month = currentMonth;
        
        // Try to extract month from createdAt field
        if (record.createdAt) {
          try {
            const date = new Date(record.createdAt);
            if (!isNaN(date.getTime())) {
              month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            }
          } catch (_e) {
            // fallback to current month
          }
        }
        
        if (!monthMap.has(month)) monthMap.set(month, []);
        monthMap.get(month).push(record);
      }
      
      // Write each month's records via _flush (which will acquire locks)
      for (const [month, monthRecords] of monthMap) {
        await _acquireLock(entity, month);
        try {
          await _flush(entity, month, monthRecords);
          // Track creation month for each record
          for (const record of monthRecords) {
            const id = _getRecordId(entity, record);
            _creationMonthMap.set(id, month);
          }
          // Update cache
          const existing = _cache.get(entity) || [];
          const merged = [...existing];
          for (const newRecord of monthRecords) {
            const idx = merged.findIndex(r => _getRecordId(entity, r) === _getRecordId(entity, newRecord));
            if (idx >= 0) {
              merged[idx] = newRecord;
            } else {
              merged.push(newRecord);
            }
          }
          _cache.set(entity, merged);
        } finally {
          _releaseLock(entity, month);
        }
      }
      
      // Successful migration for this entity — delete the localStorage key
      localStorage.removeItem(storageKey);
      _showToast(`Migration complete for ${entity}`, 'info');
    } catch (err) {
      // On failure — retain localStorage data and show error
      _showToast(`Migration failed for ${entity}: ${err.message}`, 'error');
    }
  }
}

// ---------------------------------------------------------------------------
// Task 10.3 — _flush(entity, month, records): atomic CSV write for one month
// ---------------------------------------------------------------------------

/**
 * Encode `records` to CSV and write them to `{dataPath}/{month}/{entity}.csv`
 * using the adapter's write-then-rename strategy.
 *
 * - Missing monthly folder and CSV file are created automatically on first write
 *   (the adapter's writeFile creates parent directories as needed).
 * - The header row is always written as the first line (part of _csvEncode output).
 * - On any write failure: display an error toast and rethrow so the caller can
 *   leave `_cache` untouched.
 *
 * Requirements: 2.1, 2.5, 2.6, 2.7, 9.1, 9.5
 *
 * @param {string}   entity   — 'machines' | 'breakdowns' | 'spareparts'
 * @param {string}   month    — 'YYYY-MM' folder name
 * @param {Object[]} records  — the full set of records for this entity in this month
 * @returns {Promise<void>}   — resolves on success; rejects on failure
 */
async function _flush(entity, month, records) {
  const schema     = SCHEMAS[entity];
  const csvContent = _csvEncode(records, schema);
  const path       = `${_config.dataPath}/${month}/${entity}.csv`;

  try {
    await _adapter.writeFile(path, csvContent);
  } catch (err) {
    _showToast(`Failed to save ${entity}: ${err.message}`, 'error');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API — Tasks 11.1, 11.2, 11.3 (Requirements 1.1, 2.2, 3.1, 3.4, 5.1, 7.1, 7.4, 9.2)
// ---------------------------------------------------------------------------

export const CsvStore = {

  /**
   * Task 11.1 — Initialise the store.
   *
   * Sequence:
   *  1. Load configuration (stores result into module-level _config).
   *  2. Select I/O mode (FSAPI vs localStorage fallback).
   *  3. Check and offer migration from localStorage to CSV (if applicable).
   *  4. Ensure user identity is resolved (modal if not already in sessionStorage).
   *
   * Requirements: 1.1, 5.1, 7.1, 8.1, 8.2
   *
   * @returns {Promise<void>}
   */
  async init() {
    _config = await ConfigLoader.load();
    await _initMode();
    
    // Check if migration is needed and offer the dialog (Task 13.1)
    const migrationChoice = await _checkAndShowMigrationDialog();
    if (migrationChoice === 'migrate') {
      await _executeMigration(); // Task 13.2
    }
    
    await _ensureIdentity();
  },

  /**
   * Task 11.2 — Load all records for an entity (merged across all monthly folders).
   *
   * - If this is the first load for the entity (cache miss), reads all monthly
   *   CSV files via _loadAll(entity).  A 5-second timeout guards against slow
   *   network shares; on expiry the store falls back to an empty dataset and
   *   surfaces a warning toast (Requirement 3.4 / 9.2).
   * - In FSAPI mode, ensures the folder-picker has been resolved before any I/O
   *   (Requirement 5.1).
   * - Returns the cached array (always an Array, never undefined).
   *
   * Requirements: 3.4, 9.2
   *
   * @param {string} entity — 'machines' | 'breakdowns' | 'spareparts'
   * @returns {Promise<Object[]>}
   */
  async load(entity) {
    if (_mode === 'fsapi') await _ensureFsapiAdapter();

    if (!_cache.has(entity)) {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Load timeout')), 5000)
      );
      try {
        await Promise.race([_loadAll(entity), timeout]);
      } catch (err) {
        _showToast(
          `Warning: could not load ${entity} within 5 seconds. Using empty dataset.`,
          'warning'
        );
        _cache.set(entity, []);
      }
    }

    return _cache.get(entity) || [];
  },

  /**
   * Task 11.3 — Append a single new record for an entity.
   *
   * Steps:
   *  1. In FSAPI mode, ensure the folder-picker adapter is ready.
   *  2. Stamp `createdBy` (from _userIdentity) and `createdAt` (ISO timestamp).
   *  3. Compute the current calendar month (YYYY-MM).
   *  4. Acquire write lock for this entity+month.
   *  5. Append stamped record to the in-memory cache.
   *  6. Determine which records in the cache belong to the current month (via
   *     _creationMonthMap) and flush only those to disk.
   *  7. Track the new record's month in _creationMonthMap.
   *  8. Release the lock (always, even on flush failure).
   *
   * Requirements: 2.2, 3.1, 7.4
   *
   * @param {string} entity — 'machines' | 'breakdowns' | 'spareparts'
   * @param {Object} record — plain-object record (without createdBy / createdAt)
   * @returns {Promise<void>}
   */
  async append(entity, record) {
    if (_mode === 'fsapi') await _ensureFsapiAdapter();

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const stamped = {
      ...record,
      createdBy: _userIdentity || 'Unknown User',
      createdAt: now.toISOString(),
    };

    await _acquireLock(entity, month);
    try {
      // Append to cache first.
      const existing = _cache.get(entity) || [];
      const updated = [...existing, stamped];
      _cache.set(entity, updated);

      // Track this record's creation month before flush so the filter below works.
      const id = _getRecordId(entity, stamped);
      _creationMonthMap.set(id, month);

      // Flush only the current month's records (Requirement 2.2).
      const monthRecords = updated.filter(
        (r) => _creationMonthMap.get(_getRecordId(entity, r)) === month
      );
      await _flush(entity, month, monthRecords);
    } finally {
      _releaseLock(entity, month);
    }
  },

  /**
   * Full overwrite — used by migration and legacy callers that replace the entire
   * dataset for an entity.
   *
   * All records are assigned to the current calendar month in _creationMonthMap
   * unless they already have an entry there (preserving original months on
   * re-saves after a load).
   *
   * @param {string}   entity  — 'machines' | 'breakdowns' | 'spareparts'
   * @param {Object[]} records — full replacement dataset
   * @returns {Promise<void>}
   */
  async save(entity, records) {
    if (_mode === 'fsapi') await _ensureFsapiAdapter();

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    _cache.set(entity, records);

    for (const record of records) {
      const id = _getRecordId(entity, record);
      if (!_creationMonthMap.has(id)) _creationMonthMap.set(id, month);
    }

    await _acquireLock(entity, month);
    try {
      await _flush(entity, month, records);
    } finally {
      _releaseLock(entity, month);
    }
  },

  /**
   * Returns the current user identity string (from sessionStorage, resolved by
   * _ensureIdentity during init).
   *
   * @returns {string|null}
   */
  getUser() {
    return _userIdentity;
  },

  /**
   * Task 11.5 — Update an existing record by ID.
   *
   * Steps:
   *  1. In FSAPI mode, ensure the folder-picker adapter is ready.
   *  2. Look up the record's creation month in _creationMonthMap; surface an
   *     error toast and throw if not found (Requirement 2.4, 2.8).
   *  3. Locate the record in _cache by ID; surface error if absent.
   *  4. Merge patch over the original, preserving createdBy and createdAt,
   *     and stamping modifiedBy / modifiedAt (Requirements 7.4, 2.8).
   *  5. Write the updated record back to _cache.
   *  6. Acquire write lock for the record's original month; flush only that
   *     month's records; release lock (Requirement 2.4, 3.2).
   *
   * Requirements: 2.4, 3.2, 7.4, 2.8
   *
   * @param {string} entity — 'machines' | 'breakdowns' | 'spareparts'
   * @param {string} id     — unique record identifier
   * @param {Object} patch  — partial record fields to apply
   * @returns {Promise<void>}
   */
  async update(entity, id, patch) {
    if (_mode === 'fsapi') await _ensureFsapiAdapter();

    const month = _creationMonthMap.get(id);
    if (!month) {
      _showToast(`Cannot update ${entity} record "${id}": record not found.`, 'error');
      throw new Error(`Record "${id}" not found in ${entity}`);
    }

    const now = new Date();
    const records = _cache.get(entity) || [];
    const idx = records.findIndex(r => _getRecordId(entity, r) === id);
    if (idx === -1) {
      _showToast(`Cannot update ${entity} record "${id}": not in cache.`, 'error');
      throw new Error(`Record "${id}" not found in ${entity} cache`);
    }

    const original = records[idx];
    const updated = {
      ...original,
      ...patch,
      createdBy: original.createdBy,   // preserve createdBy (Req 2.8, 7.4)
      createdAt: original.createdAt,   // preserve createdAt
      modifiedBy: _userIdentity || 'Unknown User',
      modifiedAt: now.toISOString(),
    };

    const updatedRecords = [...records];
    updatedRecords[idx] = updated;
    _cache.set(entity, updatedRecords);

    // Flush only the original month's records
    const monthRecords = updatedRecords.filter(
      r => _creationMonthMap.get(_getRecordId(entity, r)) === month
    );

    await _acquireLock(entity, month);
    try {
      await _flush(entity, month, monthRecords);
    } finally {
      _releaseLock(entity, month);
    }
  },

  /**
   * Task 11.8 — Remove a record by ID.
   *
   * Steps:
   *  1. In FSAPI mode, ensure the folder-picker adapter is ready.
   *  2. Look up the record's creation month in _creationMonthMap; surface an
   *     error toast and throw if not found (Requirement 2.4, 2.8).
   *  3. Filter the record out of _cache and delete its _creationMonthMap entry.
   *  4. Acquire write lock for the record's original month; flush the remaining
   *     records for that month; release lock (Requirement 2.4, 3.3).
   *
   * Requirements: 2.4, 3.3, 2.8
   *
   * @param {string} entity — 'machines' | 'breakdowns' | 'spareparts'
   * @param {string} id     — unique record identifier
   * @returns {Promise<void>}
   */
  async remove(entity, id) {
    if (_mode === 'fsapi') await _ensureFsapiAdapter();

    const month = _creationMonthMap.get(id);
    if (!month) {
      _showToast(`Cannot delete ${entity} record "${id}": record not found.`, 'error');
      throw new Error(`Record "${id}" not found in ${entity}`);
    }

    const records = _cache.get(entity) || [];
    const filtered = records.filter(r => _getRecordId(entity, r) !== id);
    _cache.set(entity, filtered);
    _creationMonthMap.delete(id);

    // Flush the original month's remaining records
    const monthRecords = filtered.filter(
      r => _creationMonthMap.get(_getRecordId(entity, r)) === month
    );

    await _acquireLock(entity, month);
    try {
      await _flush(entity, month, monthRecords);
    } finally {
      _releaseLock(entity, month);
    }
  },
};

// ---------------------------------------------------------------------------
// Named exports for testability
// ---------------------------------------------------------------------------

export { _csvEncode, _csvDecode, _ensureIdentity };
export { _userIdentity };
export { _cache, _creationMonthMap };
export { SCHEMAS, NUMERIC_FIELDS, REQUIRED_FIELDS };
export { _getRecordId, _loadAll, _flush, _showToast };
