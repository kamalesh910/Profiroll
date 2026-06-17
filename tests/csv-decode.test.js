// csv-decode.test.js — Unit tests for _csvDecode (Task 5.3)
// Requirements: 3.6, 3.7, 3.8, 9.3, 9.4

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _csvEncode, _csvDecode } from '../csv-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCHEMA = ['id', 'name', 'notes', 'ttrMins'];

function encode(records) {
  return _csvEncode(records, SCHEMA);
}

function decode(text, opts = {}) {
  return _csvDecode(text, SCHEMA, opts);
}

// ---------------------------------------------------------------------------
// Basic parsing
// ---------------------------------------------------------------------------

describe('_csvDecode — basic parsing', () => {
  it('returns [] for empty string', () => {
    expect(decode('')).toEqual([]);
  });

  it('returns [] for header-only CSV', () => {
    expect(decode('id,name,notes,ttrMins\r\n')).toEqual([]);
  });

  it('parses a simple row with no special characters', () => {
    const csv = 'id,name,notes,ttrMins\r\nBE760,Conveyor Belt,,30\r\n';
    const result = decode(csv);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'BE760', name: 'Conveyor Belt', notes: '', ttrMins: '30' });
  });

  it('parses multiple rows', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,Alpha,,10\r\nB,Beta,,20\r\n';
    const result = decode(csv);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('A');
    expect(result[1].id).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// RFC 4180 quoted fields (Requirement 3.6)
// ---------------------------------------------------------------------------

describe('_csvDecode — quoted fields (Req 3.6)', () => {
  it('handles embedded comma in a quoted field', () => {
    const csv = 'id,name,notes,ttrMins\r\n"001","Name, With Comma","note",5\r\n';
    const result = decode(csv);
    expect(result[0].name).toBe('Name, With Comma');
  });

  it('handles "" escape sequences inside quoted field', () => {
    const csv = 'id,name,notes,ttrMins\r\n"002",Name,"He said ""hello""",10\r\n';
    const result = decode(csv);
    expect(result[0].notes).toBe('He said "hello"');
  });

  it('handles embedded newline (LF) inside a quoted field', () => {
    const csv = 'id,name,notes,ttrMins\r\n"003",Name,"line1\nline2",15\r\n';
    const result = decode(csv);
    expect(result[0].notes).toBe('line1\nline2');
  });

  it('handles embedded CRLF inside a quoted field', () => {
    const csv = 'id,name,notes,ttrMins\r\n"004",Name,"line1\r\nline2",20\r\n';
    const result = decode(csv);
    expect(result[0].notes).toBe('line1\r\nline2');
  });

  it('round-trips a record with all special characters via encode→decode', () => {
    const original = [
      { id: 'X1', name: 'A,B', notes: 'say "hello"\nworld', ttrMins: 42 }
    ];
    const csv = encode(original);
    const decoded = decode(csv);
    expect(decoded[0].id).toBe('X1');
    expect(decoded[0].name).toBe('A,B');
    expect(decoded[0].notes).toBe('say "hello"\nworld');
  });
});

// ---------------------------------------------------------------------------
// Row field-count mismatch — skipped with warning (Requirement 3.7)
// ---------------------------------------------------------------------------

describe('_csvDecode — row field-count mismatch (Req 3.7)', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('skips a row that has too few fields and does not throw', () => {
    // Row 2 has only 2 fields instead of 4
    const csv = 'id,name,notes,ttrMins\r\nBE760,Conveyor\r\nGOOD,OK,,5\r\n';
    const result = decode(csv, { filePath: 'data/2026-06/breakdowns.csv' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('GOOD');
  });

  it('skips a row that has too many fields and does not throw', () => {
    const csv = 'id,name,notes,ttrMins\r\nX,Y,Z,1,EXTRA\r\nGOOD,OK,,5\r\n';
    const result = decode(csv);
    expect(result).toHaveLength(1);
  });

  it('logs a console.warn with file path and row number for a bad row', () => {
    const csv = 'id,name,notes,ttrMins\r\nBAD,row\r\n';
    decode(csv, { filePath: 'data/2026-06/breakdowns.csv' });
    expect(console.warn).toHaveBeenCalledOnce();
    const msg = console.warn.mock.calls[0][0];
    expect(msg).toMatch(/row 2/i);
    expect(msg).toMatch(/breakdowns\.csv/);
  });
});

// ---------------------------------------------------------------------------
// Numeric field coercion (Requirement 3.8)
// ---------------------------------------------------------------------------

describe('_csvDecode — numeric coercion (Req 3.8)', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  const numericOpts = { numericFields: new Set(['ttrMins']) };

  it('coerces a valid numeric string to a Number', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,B,,45\r\n';
    const result = decode(csv, numericOpts);
    expect(result[0].ttrMins).toBe(45);
    expect(typeof result[0].ttrMins).toBe('number');
  });

  it('coerces a decimal numeric string to Number', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,B,,3.14\r\n';
    const result = decode(csv, numericOpts);
    expect(result[0].ttrMins).toBeCloseTo(3.14);
    expect(typeof result[0].ttrMins).toBe('number');
  });

  it('substitutes 0 for a non-numeric string and warns', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,B,,NotANumber\r\n';
    const result = decode(csv, { numericFields: new Set(['ttrMins']), filePath: 'f.csv' });
    expect(result[0].ttrMins).toBe(0);
    expect(console.warn).toHaveBeenCalledOnce();
    const msg = console.warn.mock.calls[0][0];
    expect(msg).toMatch(/ttrMins/);
  });

  it('substitutes 0 for an empty string in a numeric field and warns', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,B,,\r\n';
    const result = decode(csv, numericOpts);
    expect(result[0].ttrMins).toBe(0);
  });

  it('does not modify non-numeric fields', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,Hello,,10\r\n';
    const result = decode(csv, numericOpts);
    expect(result[0].name).toBe('Hello');
    expect(typeof result[0].name).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Required-field defaults (Requirements 9.3, 9.4)
// ---------------------------------------------------------------------------

describe('_csvDecode — required field defaults (Req 9.3, 9.4)', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  const requiredOpts = {
    requiredFields: new Map([['id', ''], ['name', ''], ['ttrMins', 0]]),
    numericFields: new Set(['ttrMins']),
  };

  it('substitutes "" for a missing text required field', () => {
    const csv = 'id,name,notes,ttrMins\r\n,MyName,,5\r\n';
    const result = decode(csv, requiredOpts);
    expect(result[0].id).toBe('');
    expect(console.warn).toHaveBeenCalled();
  });

  it('substitutes 0 for a missing numeric required field', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,B,,\r\n';
    const result = decode(csv, { ...requiredOpts, filePath: 'test.csv' });
    expect(result[0].ttrMins).toBe(0);
  });

  it('includes the row in results even when a required field was substituted', () => {
    const csv = 'id,name,notes,ttrMins\r\n,Missing,,5\r\n';
    const result = decode(csv, requiredOpts);
    expect(result).toHaveLength(1);
  });

  it('does not warn for required fields that are present and non-empty', () => {
    const csv = 'id,name,notes,ttrMins\r\nA,B,,10\r\n';
    decode(csv, requiredOpts);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// LF-only line endings (robustness)
// ---------------------------------------------------------------------------

describe('_csvDecode — LF-only line endings', () => {
  it('parses CSV with LF-only line endings', () => {
    const csv = 'id,name,notes,ttrMins\nA,Alpha,,10\nB,Beta,,20\n';
    const result = decode(csv);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('A');
    expect(result[1].id).toBe('B');
  });
});
