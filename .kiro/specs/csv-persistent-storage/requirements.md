# Requirements Document

## Introduction

The Maintenance Management System (MMS) is a pure-frontend application composed of static HTML/JS files
(`index.html`, `machines.html`, `breakdowns.html`, `spareparts.html`, `kpi.html`, `reports.html`,
`documents.html`). Currently all operational data — machines, breakdowns, and spare parts — is stored
exclusively in `localStorage`, which is scoped to a single browser profile and lost when the session
or browser data is cleared.

This feature replaces `localStorage` with CSV-based persistent storage so that data survives browser
restarts, is shared across multiple users on a LAN, and can be administered from the shared network
folder. A central `config.json` file governs paths and app-level defaults. Because the app is pure
HTML + JavaScript with no server-side runtime, the browser's **File System Access API** (FSAPI) is
the sole file I/O mechanism. The app is designed to be opened directly from a `file://` path or a
`\\server\share` UNC network path. The existing UI and visual styling must remain entirely unchanged.

---

## Glossary

- **App**: The set of static HTML/JS files that constitute the Maintenance Management System.
- **CSV_Store**: The subsystem responsible for reading, writing, and parsing CSV files on behalf of the App.
- **Config_Loader**: The subsystem that reads `config.json` and exposes its values to the rest of the App.
- **Data_Folder**: The root folder for persistent data files, whose path is specified in `config.json`
  (default: `data/`).
- **Monthly_Folder**: A sub-folder of Data_Folder named `YYYY-MM` (e.g. `data/2026-06/`) that groups
  CSV files by calendar month.
- **CSV_File**: A UTF-8 text file with a header row and one data row per record, stored inside a
  Monthly_Folder (e.g. `data/2026-06/breakdowns.csv`).
- **Record**: A single entry in a CSV_File (one machine, one breakdown event, one spare-part row).
- **User**: A person accessing the App from a workstation on the LAN.
- **Identity**: A human-readable label (display name) that identifies the User who created or last
  modified a Record.
- **Write_Lock**: A lightweight sentinel file (e.g. `data/locks/breakdowns.lock`) used to signal that
  a CSV_File is currently being written, reducing the chance of concurrent overwrites.
- **File_System_Access_API**: The W3C browser API (`window.showOpenFilePicker`,
  `window.showDirectoryPicker`) that lets a web page read and write local files with user permission.
- **Operating_Hours**: The number of production hours per month used as a denominator in MTTR/MTBF
  calculations; configurable via `config.json`.

---

## Requirements

---

### Requirement 1: Central Configuration File

**User Story:** As a system administrator, I want a single `config.json` file at the app root,
so that I can change data paths, the app title, and operating defaults without editing any HTML file.

#### Acceptance Criteria

1. THE Config_Loader SHALL read a file named `config.json` located in the same folder as `index.html`
   at application startup.

2. WHEN `config.json` is successfully parsed, THE Config_Loader SHALL expose the following keys to all
   pages: `dataPath` (string, default `"data"`), `appTitle` (string, default
   `"Maintenance Management System"`), `defaultOperatingHours` (number, default `720`), and
   `lockTimeoutSeconds` (number, default `10`).
   IF a key is present but has the wrong type, THE Config_Loader SHALL substitute the default value
   for that key and continue loading remaining keys normally.

3. IF `config.json` is missing, contains invalid JSON, or is missing individual keys, THEN THE
   Config_Loader SHALL fall back to the default values for every affected key and SHALL render a
   warning banner that is visible (not hidden via CSS or HTML attribute) and does not prevent
   interaction with other page elements, on all pages indicating that the configuration could not
   be fully loaded.

4. WHEN `appTitle` is set in `config.json`, THE App SHALL display that title in the browser tab and
   navbar across all pages.

5. WHEN `defaultOperatingHours` is set in `config.json`, THE App SHALL pre-populate the "Operating
   Hrs/Month" selector on `reports.html` and `kpi.html` with that value. IF the value does not
   match any available selector option, THE App SHALL fall back to the selector's built-in default.

6. THE Config_Loader SHALL cache the parsed configuration in memory for the lifetime of the page so
   that `config.json` is fetched at most once per page load.

---

### Requirement 2: Monthly CSV Folder Structure

**User Story:** As a maintenance engineer, I want data files organised into monthly folders,
so that I can easily archive, back up, or share a specific month's records.

#### Acceptance Criteria

1. THE CSV_Store SHALL organise persistent data files under the path
   `{dataPath}/{YYYY-MM}/{entity}.csv`, where `{dataPath}` is the value from `config.json`,
   `{YYYY-MM}` is the ISO calendar month of the current session, and `{entity}` is one of
   `machines`, `breakdowns`, or `spareparts`.

2. WHEN a new Record is saved, THE CSV_Store SHALL write it to the Monthly_Folder corresponding to
   the current calendar month (i.e. the month in which the save action occurs).

3. WHEN the App loads a list page (machines, breakdowns, spareparts), THE CSV_Store SHALL read
   data from **all** available Monthly_Folders and merge the results so that the UI displays the
   complete historical dataset. WHEN duplicate Record IDs exist across Monthly_Folders, THE
   CSV_Store SHALL keep the entry from the most-recent Monthly_Folder. WHEN a Monthly_Folder or
   CSV_File is unreadable, THE CSV_Store SHALL skip it, log a console warning identifying the
   path, and continue merging data from remaining folders without aborting.

4. WHEN a Record is edited or deleted, THE CSV_Store SHALL update the CSV_File in the Monthly_Folder
   that contains that Record's original creation month, not the current calendar month.

5. THE CSV_Store SHALL create any missing Monthly_Folder or CSV_File automatically on first write,
   without requiring the user to pre-create directory structures.

6. WHEN a CSV_File is created for the first time, THE CSV_Store SHALL write a header row as the
   first line of the file, containing column names that match the Record's field names in the same
   order used for every subsequent data row.

7. IF folder creation or CSV_File creation fails during a write operation, THEN THE CSV_Store SHALL
   surface an error to the User and leave any existing CSV data unchanged.

8. IF the target Record cannot be found in any Monthly_Folder during an edit or delete operation,
   THEN THE CSV_Store SHALL surface an error to the User and make no changes to any CSV_File.

---

### Requirement 3: CSV Read and Write Operations

**User Story:** As a maintenance engineer, I want my data entries saved to and loaded from CSV files,
so that records are available after I close and reopen the browser.

#### Acceptance Criteria

1. WHEN a User saves a new Record (machine, breakdown, or spare part), THE CSV_Store SHALL append
   a new row to the appropriate CSV_File within 2 seconds of the save action completing.

2. WHEN a User edits an existing Record, THE CSV_Store SHALL overwrite the row whose unique record
   identifier matches the edited Record in the CSV_File while preserving all other rows, completing
   within 2 seconds of the edit action.

3. WHEN a User deletes a Record, THE CSV_Store SHALL remove the row whose unique record identifier
   matches the deleted Record from the CSV_File while preserving all other rows, completing within
   2 seconds of the delete action.

4. WHEN the App page loads, THE CSV_Store SHALL read the relevant CSV_Files and populate the
   in-memory data store before the UI renders its first table row. IF a CSV_File cannot be read
   within 5 seconds of the page load, THE CSV_Store SHALL treat that file as absent, load an empty
   dataset for that entity, and surface a warning to the User.

5. THE CSV_Store SHALL encode all CSV values that contain commas, double-quotes, or newline
   characters by wrapping the value in double-quotes and escaping internal double-quotes as `""`,
   conforming to RFC 4180.

6. WHEN parsing a CSV_File, THE CSV_Store SHALL handle quoted fields, embedded commas, and embedded
   newlines such that a field written by the CSV_Store's encoder is read back with byte-for-byte
   identical content.

7. IF a CSV_File row contains a different number of fields than the header row, THEN THE CSV_Store
   SHALL skip that row and log a console warning identifying the file path and row number.

8. THE CSV_Store SHALL preserve the data types of numeric fields (e.g. `ttrMins`, `qtyInStock`,
   `minStockReq`, `unitPrice`) by converting CSV string values back to numbers on read. IF a
   numeric field contains a non-numeric string value, THE CSV_Store SHALL substitute `0` and log
   a console warning identifying the file path, row number, and field name.

---

### Requirement 5: File I/O Mechanism — File System Access API

**User Story:** As a user opening the app directly from a network share or local file path, I want
to grant folder access once per session, so that the app can read and write CSV files natively
without any companion server.

#### Acceptance Criteria

1. WHEN the browser supports `window.showDirectoryPicker`, THE CSV_Store SHALL prompt the User to
   select the Data_Folder using `window.showDirectoryPicker` on the first read or write operation
   of each page session (defined as the period from page load to page unload or close).

2. WHEN the User grants folder access, THE CSV_Store SHALL cache the resulting `FileSystemDirectoryHandle`
   for the remainder of the page session so that subsequent reads and writes within that session
   do not re-prompt.

3. IF the User dismisses the folder picker without selecting a folder, THEN THE CSV_Store SHALL fall
   back to `localStorage` for the current session and SHALL display a non-dismissible warning banner
   for the remainder of the session informing the User that data will not be shared with other users.

4. WHEN the browser does not support the File System Access API, THE CSV_Store SHALL fall back to
   `localStorage` and SHALL display a non-dismissible banner for the remainder of the session
   advising the User to use a Chromium-based browser to enable shared CSV storage.

5. IF the cached `FileSystemDirectoryHandle`'s permission is revoked mid-session (e.g. the user
   revokes it via browser settings), THEN THE CSV_Store SHALL detect the permission failure on
   the next I/O attempt, fall back to `localStorage` for the remainder of the session, and display
   the same non-dismissible warning banner described in criterion 3.

---

### Requirement 6: Multi-User Concurrent Access and Write Locking

**User Story:** As a maintenance team, we want basic protection against two users overwriting the
same CSV file simultaneously, so that data from one user's save does not silently overwrite
another user's concurrent save.

#### Acceptance Criteria

1. WHEN a write to a CSV_File is initiated, THE CSV_Store SHALL attempt to create a Write_Lock file
   (`{dataPath}/locks/{entity}-{YYYY-MM}.lock`) via the File System Access API, containing the
   writing User's Identity and the ISO timestamp of lock acquisition. IF the lock file is created
   successfully, THE CSV_Store SHALL proceed with the write. IF the lock file cannot be created
   (e.g. due to an I/O error), THE CSV_Store SHALL abort the write and notify the User per
   criterion 6.

2. IF a Write_Lock file already exists and its timestamp is less than `lockTimeoutSeconds` seconds
   old, THEN THE CSV_Store SHALL abort the write, notify the User with a toast message identifying
   the locking User's Identity and the estimated unlock time (lock timestamp plus
   `lockTimeoutSeconds` seconds), and SHALL NOT corrupt the target CSV_File.

3. WHEN a write operation completes successfully or fails, THE CSV_Store SHALL delete the Write_Lock
   file within 500 milliseconds of the operation's conclusion.

4. IF a Write_Lock file exists and its timestamp is older than `lockTimeoutSeconds` seconds, THEN
   THE CSV_Store SHALL treat the lock as stale, delete it, and proceed with the write.

5. WHILE a Write_Lock held by another User is active on any data entity the current User is
   attempting to modify, THE CSV_Store SHALL display a read-only indicator in the UI navbar. WHEN
   the lock is released or expires, THE CSV_Store SHALL remove the read-only indicator.

6. IF the Write_Lock file creation itself fails due to an I/O error (distinct from the lock already
   existing), THEN THE CSV_Store SHALL abort the write and display a toast message describing the
   I/O failure.

---

### Requirement 7: User Identity

**User Story:** As a maintenance engineer, I want the app to know who I am, so that breakdown records
and stock adjustments are attributed to the correct person and write-lock messages are meaningful.

#### Acceptance Criteria

1. WHEN a User opens any App page and no Identity is stored in `sessionStorage` under the key
   `mms_user_identity`, THE App SHALL prompt the User to enter their display name via a modal dialog
   before the main UI content of that page is rendered.

2. WHEN the User submits a non-empty display name (trimmed length > 0 and ≤ 100 characters), THE
   App SHALL store that name in `sessionStorage` under the key `mms_user_identity` and SHALL display
   it in the navbar in place of the static text "👤 Engineer".

3. IF the User closes the name prompt without entering a name, or submits an empty or whitespace-only
   string, THEN THE App SHALL store `"Unknown User"` in `sessionStorage` under `mms_user_identity`
   and SHALL still render the main UI.

4. WHEN a Record is created, THE CSV_Store SHALL write the current User's Identity (from
   `sessionStorage`) into the `createdBy` field of the CSV row. WHEN a Record is modified, THE
   CSV_Store SHALL write the current User's Identity into the `modifiedBy` field of the CSV row,
   leaving `createdBy` unchanged.

5. THE App SHALL NOT require a password or server-side authentication — user identity is purely a
   display name for attribution purposes.

---

### Requirement 8: Backward Compatibility and Migration

**User Story:** As an existing user, I want my existing localStorage data preserved when I first
switch to CSV storage, so that I do not lose records I have already entered.

#### Acceptance Criteria

1. WHEN the App detects existing data in `localStorage` (keys `mms_machines`, `mms_breakdowns`,
   `mms_spares`) and no CSV_Files exist in any Monthly_Folder under the Data_Folder, THE App SHALL
   offer the User a one-time migration dialog to export the localStorage data into the appropriate
   CSV_Files.

2. WHEN the User accepts the migration, THE CSV_Store SHALL write the localStorage records into
   the Monthly_Folder corresponding to each record's creation date (using the `createdAt` field
   where available; if absent or unparseable as a date, using the current calendar month as
   fallback).

3. WHEN the migration for a given localStorage key completes successfully, THE App SHALL clear that
   specific `localStorage` key before proceeding to the next key, so that a partially completed
   migration does not leave successfully migrated data in both stores.

4. IF the migration fails for any entity, THEN THE App SHALL retain the `localStorage` data for
   that entity unchanged and SHALL display an error message within the migration dialog identifying
   which entities failed and why. Successfully migrated entities SHALL remain in their CSV_Files.

5. IF the User declines the migration dialog, THEN THE App SHALL suppress the migration offer for
   the remainder of the session and SHALL continue reading from `localStorage` for that session,
   without deleting any localStorage data.

6. WHILE CSV_Files are present, THE App SHALL read from CSV_Files rather than `localStorage`, even
   if `localStorage` also contains data for the same keys.

---

### Requirement 9: Data Integrity and Error Handling

**User Story:** As a maintenance engineer, I want the app to detect and report file I/O problems
clearly, so that I am never unaware of data that failed to save.

#### Acceptance Criteria

1. WHEN a save operation fails (network error, permission denied, disk full, or lock conflict), THE
   App SHALL display a non-dismissable error toast identifying the entity type, the operation
   attempted, and the reason for failure. The toast SHALL remain visible until the page is reloaded.

2. WHEN a CSV_File cannot be read on page load (missing, corrupted, or permission denied), THE
   App SHALL load an empty dataset for that entity and SHALL display a warning banner identifying
   which file failed to load.

3. WHEN a row is read from a CSV_File, THE CSV_Store SHALL validate that the row contains all
   required fields for its entity type (machines: `id`, `name`; breakdowns: `ref`, `machine`,
   `bdDate`, `status`; spareparts: `id`, `spareName`, `qtyInStock`, `minStockReq`) before adding
   it to the in-memory store.

4. IF a required field is missing from a CSV row, THEN THE CSV_Store SHALL substitute a safe
   default value (empty string `""` for text fields, `0` for numeric fields), log a console warning
   with the file path and row number, and continue loading remaining rows.

5. THE CSV_Store SHALL NOT delete or truncate an existing CSV_File unless the complete replacement
   content is ready to be written. WHEN the underlying filesystem supports atomic rename, THE
   CSV_Store SHALL use a write-then-rename pattern. WHEN atomic rename is not supported, THE
   CSV_Store SHALL write the new content to a temporary file first and replace the original only
   after the temporary write succeeds.

---

### Requirement 10: No UI Change Constraint

**User Story:** As a developer integrating this feature, I want the existing visual design and
layout to remain identical, so that end users are not confused and no retraining is required.

#### Acceptance Criteria

1. THE App SHALL retain all existing HTML structure, CSS classes, and inline styles on all seven pages
   (`index.html`, `machines.html`, `breakdowns.html`, `spareparts.html`, `kpi.html`, `reports.html`,
   `documents.html`) without modification.

2. WHILE CSV storage is active, THE App SHALL render the same DOM elements with the same CSS classes
   applied — including tables, badges, stats cards, modals, and charts — as it did with localStorage,
   with no existing element removed or structurally replaced, with data sourced from CSV_Files instead.

3. THE CSV_Store SHALL be implemented as a separate JavaScript module (`csv-store.js`) that the
   existing page scripts call in place of `localStorage.getItem` and `localStorage.setItem`,
   without requiring structural changes to the page HTML.

4. IF the File System Access API mode adds new UI elements (e.g. identity prompt, folder picker
   prompt, migration dialog, lock warning banner), THEN THE App SHALL position those elements
   using fixed or absolute positioning such that no existing page element is shifted, reflowed,
   or resized.
