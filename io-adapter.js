// io-adapter.js — I/O adapter implementations
// Two concrete adapters: FsapiAdapter (File System Access API) and LocalStorageAdapter (fallback).

export class FsapiAdapter {
  /**
   * @param {FileSystemDirectoryHandle} dirHandle — the root directory handle granted by the user.
   */
  constructor(dirHandle) {
    this._root = dirHandle;
  }

  /**
   * Navigate path segments from this._root to reach a directory handle.
   * Returns the handle, or throws if any segment is not found.
   *
   * @param {string[]} segments
   * @param {boolean} create — whether to create missing directories
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  async _navigateDir(segments, create = false) {
    let current = this._root;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment, { create });
    }
    return current;
  }

  /**
   * Read a file at the given relative path.
   * Returns the file's text content, or null if the file/path does not exist.
   *
   * @param {string} relPath — forward-slash separated relative path (e.g. "data/2026-06/machines.csv")
   * @returns {Promise<string|null>}
   */
  async readFile(relPath) {
    try {
      const segments = relPath.split('/').filter(Boolean);
      const filename = segments.pop();
      let dirHandle = this._root;
      for (const segment of segments) {
        dirHandle = await dirHandle.getDirectoryHandle(segment, { create: false });
      }
      const fileHandle = await dirHandle.getFileHandle(filename, { create: false });
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (err) {
      // Return null for any navigation or read error (NotFoundError, TypeError, etc.)
      return null;
    }
  }

  /**
   * Write content to a file at the given relative path.
   * Removes any existing file and writes fresh. Uses createWritable() which is atomic.
   *
   * @param {string} relPath — forward-slash separated relative path
   * @param {string} content — UTF-8 text content to write
   * @returns {Promise<void>}
   */
  async writeFile(relPath, content) {
    const segments = relPath.split('/').filter(Boolean);
    const filename = segments.pop();

    // Navigate to (creating if necessary) the parent directory
    let parentDir = this._root;
    for (const segment of segments) {
      parentDir = await parentDir.getDirectoryHandle(segment, { create: true });
    }

    // Remove the old file if it exists (ignore errors)
    try {
      await parentDir.removeEntry(filename, { recursive: false });
    } catch (_) {
      // File doesn't exist or removal failed — proceed anyway
    }

    // Create the file fresh and write atomically
    const fileHandle = await parentDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(content);
      await writable.close();
    } catch (writeErr) {
      // Attempt to close cleanly on write failure
      try { await writable.close(); } catch (_) { /* ignore */ }
      throw writeErr;
    }
  }

  /**
   * List the immediate contents of the directory at relPath.
   * Returns an array of { name, type } objects where type is 'directory' or 'file'.
   * Returns [] if the directory does not exist.
   *
   * @param {string} relPath — relative path to the directory, or '' / '.' for the root
   * @returns {Promise<Array<{name: string, type: 'directory'|'file'}>>}
   */
  async listDir(relPath) {
    try {
      let dirHandle = this._root;
      if (relPath && relPath !== '.') {
        const segments = relPath.split('/').filter(Boolean);
        for (const segment of segments) {
          dirHandle = await dirHandle.getDirectoryHandle(segment, { create: false });
        }
      }

      const entries = [];
      for await (const [name, handle] of dirHandle.entries()) {
        entries.push({
          name,
          type: handle.kind === 'directory' ? 'directory' : 'file',
        });
      }
      return entries;
    } catch (err) {
      // NotFoundError or any navigation error → return empty list
      return [];
    }
  }
}

export class LocalStorageAdapter {
  /** @param {string} relPath */
  async readFile(relPath) {
    return localStorage.getItem('mms_csv_' + relPath);
  }

  /**
   * @param {string} relPath
   * @param {string} content
   */
  async writeFile(relPath, content) {
    localStorage.setItem('mms_csv_' + relPath, content);
  }

  /**
   * Returns immediate children of the given directory prefix.
   * Scans all localStorage keys with prefix 'mms_csv_{relPath}/',
   * extracts the first path segment after that prefix, deduplicates,
   * and returns { name, type } entries where type is 'file' if the
   * key is a direct child or 'directory' if there are more sub-segments.
   *
   * @param {string} relPath
   * @returns {Promise<Array<{name: string, type: 'file'|'directory'}>>}
   */
  async listDir(relPath) {
    const prefix = 'mms_csv_' + (relPath ? relPath + '/' : '');
    const seen = new Map(); // name → type

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(prefix)) continue;

      const rest = key.slice(prefix.length); // everything after 'mms_csv_{relPath}/'
      if (!rest) continue;

      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) {
        // Direct child — it's a file
        const name = rest;
        if (!seen.has(name)) seen.set(name, 'file');
      } else {
        // Has more sub-segments — immediate child is a directory
        const name = rest.slice(0, slashIdx);
        seen.set(name, 'directory'); // directory wins over file if both somehow exist
      }
    }

    return Array.from(seen.entries()).map(([name, type]) => ({ name, type }));
  }
}
