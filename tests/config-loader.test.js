// tests/config-loader.test.js
// Unit tests for ConfigLoader.load()
// Requirements: 1.1, 1.2, 1.3, 1.6

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigLoader, DEFAULT_CONFIG } from '../config-loader.js';

beforeEach(() => {
  // Reset the module-level cache between tests
  ConfigLoader._resetCache();
  // Clear any warning banners injected into the DOM
  const existing = document.getElementById('mms-config-warning');
  if (existing) existing.remove();
  // Reset fetch mock
  vi.restoreAllMocks();
});

describe('ConfigLoader.load()', () => {
  it('returns all 4 default keys when config.json fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const config = await ConfigLoader.load();

    expect(config).toMatchObject({
      dataPath: DEFAULT_CONFIG.dataPath,
      appTitle: DEFAULT_CONFIG.appTitle,
      defaultOperatingHours: DEFAULT_CONFIG.defaultOperatingHours,
      lockTimeoutSeconds: DEFAULT_CONFIG.lockTimeoutSeconds,
    });
  });

  it('returns parsed values when config.json returns valid JSON with all 4 keys', async () => {
    const customConfig = {
      dataPath: 'my-data',
      appTitle: 'My App',
      defaultOperatingHours: 500,
      lockTimeoutSeconds: 30,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(customConfig)),
    }));

    const config = await ConfigLoader.load();

    expect(config.dataPath).toBe('my-data');
    expect(config.appTitle).toBe('My App');
    expect(config.defaultOperatingHours).toBe(500);
    expect(config.lockTimeoutSeconds).toBe(30);
  });

  it('substitutes default for wrong-type value (dataPath as a number)', async () => {
    const badConfig = {
      dataPath: 42,                          // wrong type — should fall back to default
      appTitle: 'Valid Title',
      defaultOperatingHours: 600,
      lockTimeoutSeconds: 15,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(badConfig)),
    }));

    const config = await ConfigLoader.load();

    expect(config.dataPath).toBe(DEFAULT_CONFIG.dataPath);   // "data"
    expect(config.appTitle).toBe('Valid Title');              // valid keys still used
    expect(config.defaultOperatingHours).toBe(600);
    expect(config.lockTimeoutSeconds).toBe(15);
  });

  it('returns the same object reference on a second call (caching)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        dataPath: 'cached',
        appTitle: 'Cached App',
        defaultOperatingHours: 720,
        lockTimeoutSeconds: 10,
      })),
    }));

    const first = await ConfigLoader.load();
    const second = await ConfigLoader.load();

    expect(second).toBe(first); // strict reference equality
  });

  it('does not re-fetch on a second call (fetch called only once)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        dataPath: 'data',
        appTitle: 'App',
        defaultOperatingHours: 720,
        lockTimeoutSeconds: 10,
      })),
    });
    vi.stubGlobal('fetch', mockFetch);

    await ConfigLoader.load();
    await ConfigLoader.load();
    await ConfigLoader.load();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
