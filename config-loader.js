// config-loader.js — ES module
// Implements ConfigLoader.load() per Task 2.1 (Requirements 1.1, 1.2, 1.3, 1.6)

/**
 * Default configuration values. Exported as named constants for testability.
 */
export const DEFAULT_CONFIG = Object.freeze({
  dataPath: 'data',
  appTitle: 'Maintenance Management System',
  defaultOperatingHours: 720,
  lockTimeoutSeconds: 10,
});

// Module-level cache: null until first successful load
let _cachedConfig = null;

/**
 * Injects a fixed-position warning banner into <body> if one does not already exist.
 * The banner is non-dismissible and non-blocking (no overlay).
 * @param {string} message - Human-readable description of the problem.
 */
function _injectWarningBanner(message) {
  // Only inject once per page load
  if (document.getElementById('mms-config-warning')) return;

  const banner = document.createElement('div');
  banner.id = 'mms-config-warning';
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
  banner.textContent = '⚠ Configuration warning: ' + message;

  // Ensure <body> exists before injecting
  if (document.body) {
    document.body.insertBefore(banner, document.body.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertBefore(banner, document.body.firstChild);
    });
  }
}

/**
 * Type-guard helpers.
 */
const _isString = (v) => typeof v === 'string';
const _isNumber = (v) => typeof v === 'number' && !Number.isNaN(v);

/**
 * Validates and merges a raw parsed config object against the defaults.
 * Returns { config, problems } where `problems` is an array of strings describing
 * any substituted or missing keys.
 *
 * @param {unknown} raw - The parsed JSON value (may be any type).
 * @returns {{ config: typeof DEFAULT_CONFIG, problems: string[] }}
 */
function _mergeWithDefaults(raw) {
  const config = { ...DEFAULT_CONFIG };
  const problems = [];

  // raw must be a plain object for any key to be usable
  const isObj = raw !== null && typeof raw === 'object' && !Array.isArray(raw);

  // dataPath — must be string
  if (isObj && 'dataPath' in raw) {
    if (_isString(raw.dataPath)) {
      config.dataPath = raw.dataPath;
    } else {
      problems.push(`"dataPath" has wrong type (expected string); using default "${DEFAULT_CONFIG.dataPath}"`);
    }
  } else if (!isObj) {
    problems.push(`"dataPath" key absent; using default "${DEFAULT_CONFIG.dataPath}"`);
  } else {
    problems.push(`"dataPath" key absent; using default "${DEFAULT_CONFIG.dataPath}"`);
  }

  // appTitle — must be string
  if (isObj && 'appTitle' in raw) {
    if (_isString(raw.appTitle)) {
      config.appTitle = raw.appTitle;
    } else {
      problems.push(`"appTitle" has wrong type (expected string); using default "${DEFAULT_CONFIG.appTitle}"`);
    }
  } else if (!isObj) {
    problems.push(`"appTitle" key absent; using default "${DEFAULT_CONFIG.appTitle}"`);
  } else {
    problems.push(`"appTitle" key absent; using default "${DEFAULT_CONFIG.appTitle}"`);
  }

  // defaultOperatingHours — must be number
  if (isObj && 'defaultOperatingHours' in raw) {
    if (_isNumber(raw.defaultOperatingHours)) {
      config.defaultOperatingHours = raw.defaultOperatingHours;
    } else {
      problems.push(`"defaultOperatingHours" has wrong type (expected number); using default ${DEFAULT_CONFIG.defaultOperatingHours}`);
    }
  } else if (!isObj) {
    problems.push(`"defaultOperatingHours" key absent; using default ${DEFAULT_CONFIG.defaultOperatingHours}`);
  } else {
    problems.push(`"defaultOperatingHours" key absent; using default ${DEFAULT_CONFIG.defaultOperatingHours}`);
  }

  // lockTimeoutSeconds — must be number
  if (isObj && 'lockTimeoutSeconds' in raw) {
    if (_isNumber(raw.lockTimeoutSeconds)) {
      config.lockTimeoutSeconds = raw.lockTimeoutSeconds;
    } else {
      problems.push(`"lockTimeoutSeconds" has wrong type (expected number); using default ${DEFAULT_CONFIG.lockTimeoutSeconds}`);
    }
  } else if (!isObj) {
    problems.push(`"lockTimeoutSeconds" key absent; using default ${DEFAULT_CONFIG.lockTimeoutSeconds}`);
  } else {
    problems.push(`"lockTimeoutSeconds" key absent; using default ${DEFAULT_CONFIG.lockTimeoutSeconds}`);
  }

  return { config, problems };
}

/**
 * ConfigLoader — loads, validates, and caches config.json.
 *
 * Usage:
 *   const config = await ConfigLoader.load();
 */
export const ConfigLoader = {
  /**
   * Fetches ./config.json and returns a fully-validated config object.
   * Subsequent calls return the same cached object reference (Requirement 1.6).
   *
   * @returns {Promise<typeof DEFAULT_CONFIG>}
   */
  async load() {
    if (_cachedConfig !== null) {
      return _cachedConfig;
    }

    let raw;
    let fetchFailed = false;

    try {
      const response = await fetch('./config.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      raw = JSON.parse(text);
    } catch (err) {
      // Network error, non-200, or JSON parse failure → use all defaults
      fetchFailed = true;
      raw = null;
    }

    const { config, problems } = _mergeWithDefaults(raw);

    // Show banner if the file was missing / invalid, or if any key had an issue
    if (fetchFailed) {
      _injectWarningBanner(
        'config.json could not be loaded or parsed. All settings are using default values.'
      );
    } else if (problems.length > 0) {
      _injectWarningBanner(
        'config.json is missing or has invalid keys. Affected settings use default values: ' +
        problems.join('; ')
      );
    }

    _cachedConfig = config;
    return _cachedConfig;
  },

  /**
   * Resets the module-level cache. Intended for use in tests only.
   */
  _resetCache() {
    _cachedConfig = null;
  },
};
