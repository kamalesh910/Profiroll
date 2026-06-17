# Design Document — csv-persistent-storage

## Overview

This design replaces the per-page `localStorage` calls in the Maintenance Management System (MMS)
with a thin abstraction layer that persists data as RFC 4180 CSV files organised in monthly
sub-folders. The change is transparent to the existing HTML/CSS UI; the seven static pages keep
every DOM element, CSS class, and event handler exactly as they are today. Only the two lines of
data I/O in each page (`localStorage.getItem` / `localStorage.setItem`) are redirected to the new
`csv-store.js` module.

### Goals

- Persistent, cross-session storage that survives browser-profile wipes.
- LAN-shareable data — multiple workstations read and write the same CSV files.
- Zero server-side deployment required (File System Access API path).
- Fully backward-compatible migration of existing `localStorage` data.

### Non-Goals

- Real-time push notifications between concurrent users.
- Database-level ACID transactions.
- Mobile / offline-first PWA caching.
- No server-side runtime or companion script required or supported.

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────┐
│                  Browser Page                       │
│  machines.html / breakdowns.html / spareparts.html  │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │           Existing page scripts             │   │
│  │  loadMachines() / saveMachines() / …        │   │
│  │           ↓  replaces localStorage          │   │
│  │  await CsvStore.load('machines')            │   │
│  │  await CsvStore.save('machines', records)   │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                │
│  ┌─────────────────▼───────────────────────────┐   │
│  │            csv-store.js                      │   │
│  │  • IOMode selection                          │   │
│  │  • CSV encode / decode (RFC 4180)            │   │
│  │  • Monthly folder routing                   │   │
│  │  • Write locking                            │   │
│  │  • In-memory record cache                   │   │
│  └────────┬────────────────────────┬───────────┘   │
│           │                        │               │
│  ┌────────▼────────┐    ┌──────────▼──────────┐   │
│  │  config-loader  │    │    io-adapter.js      │   │
│  │  .js            │    │                      │   │
│  │  Loads &        │    │  ┌──────────────┐    │   │
│  │  caches         │    │  │ FsapiAdapter │    │   │
│  │  config.json    │    │  └──────┬───────┘    │   │
│  └─────────────────┘    │         │             │   │
│                         │  ┌──────▼───────┐    │   │
│                         │  │ LocalStorage │    │   │
│                         │  │  Fallback    │    │   │
│                         │  └──────────────┘    │   │
│                         └───────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### I/O Mode Selection

The mode is chosen once at startup (inside `csv-store.js`) and cached for the page lifetime:

```
if window.showDirectoryPicker exists  → FSAPI mode (prompt user for folder)
else                                  → localStorage fallback
```

Once a mode is selected it cannot change mid-session (except the FSAPI → localStorage fallback
on permission revocation, which is handled transparently).

---

## Components and Interfaces

### config-loader.js

**Responsibility:** Fetch and parse `config.json`; expose defaults; display a warning banner when
the file is missing or malformed.

```js
// Public API
const Config = await ConfigLoader.load();
// Config shape (all fields always present after load):
// {
//   dataPath:              string,   // default: "data"
//   appTitle:              string,   // default: "Maintenance Management System"
//   defaultOperatingHours: number,   // default: 720
//   lockTimeoutSeconds:    number    // default: 10
// }
```

**Implementation notes:**
- Fetches `config.json` with `fetch('./config.json')`.
- On network error, JSON parse failure, or missing key: substitute the default for that key and
  inject the warning banner HTML (fixed-position, non-blocking, non-dismissible until reload).
- Caches the result in a module-level variable; subsequent calls return the cached object without
  re-fetching.
- Re-exports the default values as named constants for testability.

---

### csv-store.js

**Responsibility:** The central public API consumed by every page script. Handles routing,
encoding/decoding, locking, caching, and the identity stamp.

```js
// Public API
await CsvStore.init();                    // loads config, prompts for identity & folder if needed
await CsvStore.load(entity);             // returns Array<Record>  (merged across all monthly folders)
await CsvStore.save(entity, records);    // full overwrite of in-memory + flush to CSV
await CsvStore.append(entity, record);   // append a single new record
await CsvStore.update(entity, id, patch);// update one record by id
await CsvStore.remove(entity, id);       // delete one record by id
CsvStore.getUser();                      // returns current Identity string
```

`entity` is one of `'machines'` | `'breakdowns'` | `'spareparts'`.

**Internal structure:**

```
csv-store.js
  ├─ _config           — loaded Config object
  ├─ _mode             — 'fsapi' | 'localstorage'
  ├─ _fsHandle         — FileSystemDirectoryHandle (FSAPI mode only)
  ├─ _cache            — Map<entity, Record[]>  (merged in-memory store)
  ├─ _creationMonthMap — Map<recordId, 'YYYY-MM'>  (where each record lives on disk)
  ├─ _userIdentity     — string (from sessionStorage)
  │
  ├─ _initMode()       — selects I/O mode
  ├─ _ensureIdentity() — shows modal if mms_user_identity not in sessionStorage
  ├─ _loadAll(entity)  — reads all monthly CSV files, merges, populates cache
  ├─ _flush(entity, month, records) — writes one month's CSV atomically
  ├─ _acquireLock(entity, month)    — creates .lock file
  ├─ _releaseLock(entity, month)    — deletes .lock file
  ├─ _csvEncode(records, schema)    — Array<Record> → CSV string
  ├─ _csvDecode(text, schema)       — CSV string → Array<Record>
  └─ _showToast(msg, type)          — renders error/warning toast
```

---

### io-adapter.js

**Responsibility:** Abstract the three I/O backends behind a single interface so `csv-store.js`
never calls `fetch`, `FileSystemFileHandle`, or `localStorage` directly.

```js
// Interface (all methods async)
adapter.readFile(relPath)           // → string | null
adapter.writeFile(relPath, content) // → void (throws on failure)
adapter.listDir(relPath)            // → Array<{name, type}>
```

Two concrete implementations:

| Class | Mode | Notes |
|---|---|---|
| `FsapiAdapter` | fsapi | Uses cached `FileSystemDirectoryHandle` |
| `LocalStorageAdapter` | localstorage | Keys: `mms_csv_{relPath}` |

---

### Identity Modal

A small inline `<div>` injected by `csv-store.js` at the top of `<body>` using fixed positioning.
It is shown once per page session when `sessionStorage.mms_user_identity` is absent. The modal
blocks the main content (via a semi-transparent overlay) until a name is submitted or dismissed.
On dismiss, `"Unknown User"` is stored. After submission the navbar `👤 Engineer` span is updated
to show the entered name.

---

### Migration Dialog

Injected the same way as the Identity Modal. Shown once per session when:
- `localStorage` contains at least one of `mms_machines`, `mms_breakdowns`, `mms_spares`, AND
- No CSV files exist yet under `{dataPath}`.

User choices: **Migrate now** or **Skip (use localStorage this session)**.

---

## Data Models

### machines.csv

| Column | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✓ | Unique machine identifier (e.g. `BE760`) |
| `name` | string | ✓ | Human-readable machine name |
| `type` | string | | e.g. "Belt Conveyor" |
| `location` | string | | e.g. "Production Line 1" |
| `status` | string | | Running / Down / Maintenance / Standby |
| `date` | string | | ISO date of installation (`YYYY-MM-DD`) |
| `brand` | string | | |
| `serial` | string | | |
| `notes` | string | | May contain newlines (RFC 4180 quoted) |
| `createdBy` | string | | Identity of creator |
| `modifiedBy` | string | | Identity of last modifier |
| `createdAt` | string | | ISO 8601 timestamp |
| `modifiedAt` | string | | ISO 8601 timestamp |

### breakdowns.csv

| Column | Type | Required | Notes |
|---|---|---|---|
| `ref` | string | ✓ | Unique BD reference (e.g. `BD-20241201-001`) |
| `machine` | string | ✓ | Machine ID (foreign key to machines) |
| `bdDate` | string | ✓ | Breakdown date `YYYY-MM-DD` |
| `status` | string | ✓ | Open / In Progress / Closed |
| `startTime` | string | | `HH:MM` |
| `endDate` | string | | `YYYY-MM-DD` |
| `endTime` | string | | `HH:MM` |
| `ttrMins` | number | | Time-to-repair in minutes (numeric) |
| `technician` | string | | |
| `operator` | string | | |
| `problem` | string | | May contain newlines |
| `action` | string | | May contain newlines |
| `rootCause` | string | | |
| `partsUsed` | string | | JSON-encoded array, stored as RFC 4180 quoted field |
| `history` | string | | JSON-encoded array of history entries |
| `createdBy` | string | | |
| `modifiedBy` | string | | |
| `createdAt` | string | | |
| `modifiedAt` | string | | |

### spareparts.csv

| Column | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✓ | Unique part ID (e.g. `SP-123456`) |
| `spareName` | string | ✓ | Part name / description |
| `machine` | string | | Associated machine ID |
| `storageLocation` | string | | |
| `compartment` | string | | |
| `specification` | string | | |
| `newUsedRepaired` | string | | Condition |
| `unitPrice` | number | | Numeric |
| `qtyInStock` | number | ✓ | Numeric |
| `minStockReq` | number | ✓ | Numeric |
| `leadTime` | string | | |
| `supplier` | string | | |
| `discontinued` | string | | "true" / "false" |
| `notes` | string | | |
| `movements` | string | | JSON-encoded array, RFC 4180 quoted |
| `createdBy` | string | | |
| `modifiedBy` | string | | |
| `createdAt` | string | | |
| `modifiedAt` | string | | |

### config.json (schema)

```json
{
  "dataPath": "data",
  "appTitle": "Maintenance Management System",
  "defaultOperatingHours": 720,
  "lockTimeoutSeconds": 10
}
```

### Write Lock files

Location: `{dataPath}/locks/{entity}-{YYYY-MM}.lock`  
Content (plain text):
```
{ "user": "Alice", "timestamp": "2026-06-15T09:34:12.000Z" }
```

### Folder Layout Example

```
data/
  locks/
    machines-2026-06.lock       ← present only during active writes
  2026-05/
    machines.csv
    breakdowns.csv
    spareparts.csv
  2026-06/
    machines.csv
    breakdowns.csv
    spareparts.csv
config.json
index.html
csv-store.js
config-loader.js
io-adapter.js
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of
a system — essentially, a formal statement about what the system should do. Properties serve as the
bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: CSV round-trip identity

*For any* array of Records written to CSV by the encoder, decoding the resulting CSV string with
the decoder shall produce an array of Records with byte-for-byte identical field values, including
fields that contain commas, double-quotes, newlines, and Unicode characters.

**Validates: Requirements 3.5, 3.6**

---

### Property 2: Numeric field type preservation

*For any* Record whose numeric fields (`ttrMins`, `qtyInStock`, `minStockReq`, `unitPrice`) hold
valid numbers, encoding the Record to CSV and then decoding it shall yield the original number
values (not strings), and the values shall be strictly equal (`===`) to the originals.

**Validates: Requirements 3.8**

---

### Property 3: Append grows the merged dataset by exactly one

*For any* starting dataset and any new Record whose ID does not already exist in the dataset,
appending the Record via `CsvStore.append` and then calling `CsvStore.load` for the same entity
shall return a dataset whose length is exactly one greater than before, and which contains the
appended Record.

**Validates: Requirements 3.1, 2.2**

---

### Property 4: Update is idempotent on the target record

*For any* dataset containing a Record R, applying `CsvStore.update` with the same patch twice in
succession shall yield the same result as applying it once — the record in the loaded dataset is
identical after both applications, and no other records are modified.

**Validates: Requirements 3.2**

---

### Property 5: Delete removes exactly one record and preserves the rest

*For any* dataset of N records, deleting a record by ID via `CsvStore.remove` and then calling
`CsvStore.load` shall return a dataset of N−1 records, the deleted record shall not appear, and
all remaining records shall be unchanged.

**Validates: Requirements 3.3**

---

### Property 6: Most-recent-folder wins on duplicate IDs

*For any* collection of monthly CSV folders that contain records with overlapping IDs, calling
`CsvStore.load` shall return a merged dataset where, for every duplicated ID, the Record from the
most-recent Monthly_Folder (by `YYYY-MM` sort order) is kept and the older one is discarded.

**Validates: Requirements 2.3**

---

### Property 7: Config defaults are always present regardless of config.json content

*For any* `config.json` string — including the empty string, invalid JSON, a JSON object with
missing keys, and a JSON object with wrong-typed values — `ConfigLoader.load()` shall return an
object containing all four required keys (`dataPath`, `appTitle`, `defaultOperatingHours`,
`lockTimeoutSeconds`), each key holding a value of the correct type.

**Validates: Requirements 1.2, 1.3**

---

### Property 8: Stale lock detection

*For any* lock file whose timestamp is more than `lockTimeoutSeconds` seconds in the past,
the locking logic shall treat the lock as stale and proceed with the write without raising a
conflict error. *For any* lock file whose timestamp is within `lockTimeoutSeconds` seconds,
the locking logic shall abort the write and surface a conflict notification identifying the
locking user.

**Validates: Requirements 6.2, 6.4**

---

### Property 9: Migration preserves all record counts

*For any* localStorage dataset (machines, breakdowns, spareparts), running the migration shall
produce CSV files whose total merged record count equals the count of records in localStorage,
and each Record in the CSV files shall have field values byte-for-byte identical to the
corresponding record in localStorage.

**Validates: Requirements 8.1, 8.2**

---

### Property 10: Row-count mismatch rows are skipped without aborting the load

*For any* CSV file that contains M header columns, a row with a different number of fields shall
be silently skipped (with a console warning), and `CsvStore.load` shall return all valid rows in
the file, unchanged, without throwing an exception.

**Validates: Requirements 3.7, 9.4**

---

### Property 11: Valid identity is always stored in sessionStorage

*For any* non-empty, non-whitespace-only display name of length ≤ 100 submitted to the identity
modal, `sessionStorage.getItem('mms_user_identity')` shall equal the trimmed name. *For any*
empty or whitespace-only submission (or dismissal), it shall equal `"Unknown User"`.

**Validates: Requirements 7.2, 7.3**

---

### Property 12: Identity is stamped on every create and update

*For any* Record being created and any current user identity string I, the resulting CSV row's
`createdBy` field shall equal I. *For any* Record being updated with identity I, the `modifiedBy`
field shall equal I and `createdBy` shall remain unchanged from its original value.

**Validates: Requirements 7.4**

---

### Property 13: Edit and delete target the record's creation-month folder

*For any* dataset where a Record was originally created in month M (stored in `_creationMonthMap`),
calling `CsvStore.update` or `CsvStore.remove` for that Record's ID shall write to the file at
`{dataPath}/{M}/{entity}.csv`, not to the current calendar month's folder.

**Validates: Requirements 2.4**

---

### Property 14: Config fetch is cached — at most one network request per page load

*For any* number N ≥ 1 of calls to `ConfigLoader.load()` within the same page session, exactly
one `fetch` call to `config.json` shall be issued, and all N calls shall return an object that is
strictly equal (same reference) to the object returned by the first call.

**Validates: Requirements 1.6**

---

### Property 15: Required-field validation substitutes safe defaults, never throws

*For any* CSV row of an entity type, if a required field is absent or empty, the decoded Record
shall contain a safe default value for that field (empty string `""` for text fields, `0` for
numeric fields), and `CsvStore.load` shall include the row in the returned dataset rather than
throwing an exception or omitting the row silently.

**Validates: Requirements 9.3, 9.4**

---

## Error Handling

### Error classification

| Situation | Severity | User-facing action |
|---|---|---|
| `config.json` missing / invalid JSON | Warning | Fixed warning banner; app continues with defaults |
| CSV file unreadable on page load | Warning | Warning banner; entity loads empty |
| Row field count mismatch | Info | Console warning; row skipped |
| Save fails (network / permission / disk) | Error | Non-dismissible error toast until reload |
| Lock conflict (another user writing) | Warning | Dismissible toast with user name + estimated unlock |
| Lock file I/O error | Error | Non-dismissible toast; write aborted |
| FSAPI picker dismissed | Info | LocalStorage fallback banner (non-dismissible) |
| FSAPI permission revoked mid-session | Warning | Same banner as picker dismissed |
| Migration failure (partial) | Error | Dialog lists failed entities; successful entities retained |

### Toast component

A single `<div id="mms-toast">` element is injected once by `csv-store.js` with fixed positioning
at the bottom-right (so it does not reflow any existing layout). Severity styles:

- **error** — red left-border, permanent until page reload.
- **warning** — amber left-border, visible for ≥ 5 seconds.
- **info** — blue left-border, auto-dismisses after 4 seconds.

### Atomic write strategy

In FSAPI mode, the `FileSystemWritableFileStream` API writes to a temporary swap file inside the
directory (`{entity}.tmp`), then renames it over the target file using `move()`. If the write step
fails, the original file is untouched. If the rename fails, the `.tmp` file is cleaned up.

In localStorage fallback mode, `JSON.stringify` + `setItem` is effectively atomic within a
single-threaded JS context.

---

## Testing Strategy

### Unit tests (Vitest)

Focus on pure functions that require no I/O:

- `csvEncode` / `csvDecode` — round-trip with generated inputs (property tests, see below).
- `ConfigLoader.load` — with mocked `fetch` returning various malformed and missing payloads.
- Lock timestamp staleness logic — with injected `Date.now()` mock.
- Migration record mapping — verifying `createdAt` → Monthly_Folder routing.
- Field validation and type coercion — numeric fields, missing required fields.

### Property-based tests (fast-check)

One property-based test per correctness property (Properties 1–15). Each test runs a minimum of
**100 iterations** with randomly generated inputs. Tag format in code:

```
// Feature: csv-persistent-storage, Property 1: CSV round-trip identity
```

Key generators:

- `fc.record({...})` with `fc.string()`, `fc.float()`, `fc.integer()` matching each entity schema.
- String generators explicitly include `','`, `'"'`, `'\n'`, `'\r\n'`, and Unicode characters to
  stress-test the RFC 4180 encoder.
- Monthly-folder collections generated with `fc.array(fc.record({month, records}))` for merge
  and duplicate-ID tests (Properties 5, 6, 13).
- `fc.date()` and `fc.constantFrom(undefined, null, 'invalid', '2024-03-15')` for migration
  folder-routing tests (Property 8).
- `fc.string()` with whitespace-bias for identity validation (Properties 11, 12).

### Integration tests

These use a mock FSAPI handle:

- Round-trip: page load → CRUD operations → page reload → verify data persists.
- Multi-folder merge: manually place CSV fixtures in two monthly folders, load, verify merge.
- Lock acquisition and release: spawn two pseudo-concurrent write attempts, verify no corruption.
- Migration: seed `localStorage`, trigger dialog, verify CSV files created and localStorage cleared.

### Manual / smoke tests

- Open app in Firefox (no FSAPI) → verify localStorage fallback banner appears.
- Revoke FSAPI permission mid-session → verify banner and continued localStorage fallback.
- Concurrent write from two browser tabs → verify lock toast appears in second tab.
