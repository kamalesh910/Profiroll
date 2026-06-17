// csv-codec.test.js — Unit + property-based tests for _csvEncode and _csvDecode
// Feature: csv-persistent-storage
// Requirements: 3.5, 3.6, 3.7, 3.8, 9.3, 9.4

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { _csvEncode, _csvDecode } from '../csv-store.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const SCHEMA = ['id', 'name', 'notes', 'ttrMins'];

function encode(records, schema = SCHEMA) {
  return _csvEncode(records, schema);
}

function decode(text, opts = {}) {
  return _csvDecode(text, SCHEMA, opts);
}

// ---------------------------------------------------------------------------
// _csvEncode — unit tests (Requirements 3.5, 3.6)
// ---------------------------------------------------------------------------

describe('_csvEncode — basic encoding (Req 3.5, 3.6)', () => {
  it('produces a header row from the schema', () => {
    const csv = encode([]);
    expect(csv).toBe('id,name,notes,ttrMins\r\n');
  });

  it('encodes a simple record with no special characters', () => {
    const csv = encode([{ id: 'M1', name: 'Pump', notes: '', ttrMins: 30 }]);
    expect(csv).toBe('id,name,notes,ttrMins\r\nM1,Pump,,30\r\n');
  });

  it('wraps fields containing a comma in double-quotes', () => {
    const csv = encode([{ id: 'M1', name: 'A,B', notes: '', ttrMins: 0 }]);
    expect(csv).toContain('"A,B"');
  });

  it('wraps fields containing a double-quote and escapes internal quotes', () => {
    const csv = encode([{ id: 'M1', name: 'say "hi"', notes: '', ttrMins: 0 }]);
    expect(csv).toContain('"say ""hi"""');
  });

  it('wraps fields containing a LF newline', () => {
    const csv = encode([{ id: 'M1', name: 'line1\nline2', notes: '', ttrMins: 0 }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('wraps fields containing a CRLF newline', () => {
    const csv = encode([{ id: 'M1', name: 'line1\r\nline2', notes: '', ttrMins: 0 }]);
    expect(csv).toContain('"line1\r\nline2"');
  });

  it('wraps fields containing a bare CR', () => {
    const csv = encode([{ id: 'M1', name: 'line1\rline2', notes: '', ttrMins: 0 }]);
    expect(csv).toContain('"line1\rline2"');
  });

  it('treats null / undefined field values as empty string', () => {
    const csv = encode([{ id: 'M1', name: null, notes: undefined, ttrMins: 0 }]);
    expect(csv).toBe('id,name,notes,ttrMins\r\nM1,,,0\r\n');
  });

  it('separates records with CRLF and appends a trailing CRLF', () => {
    const csv = encode([
      { id: 'A', name: 'Alpha', notes: '', ttrMins: 1 },
      { id: 'B', name: 'Beta',  notes: '', ttrMins: 2 },
    ]);
    const lines = csv.split('\r\n');
    // header + 2 data rows + empty string after trailing CRLF → 4 items
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
  });

  it('encodes multiple records correctly', () => {
    const records = [
      { id: 'R1', name: 'Alpha', notes: 'ok',  ttrMins: 5  },
      { id: 'R2', name: 'Beta',  notes: '',    ttrMins: 10 },
    ];
    const csv = encode(records);
    const decoded = decode(csv);
    expect(decoded).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// _csvDecode — basic parsing (Requirements 3.6)
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
// _csvDecode — quoted fields (Requirement 3.6)
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
// _csvDecode — LF-only line endings (robustness)
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

// ---------------------------------------------------------------------------
// _csvDecode — row field-count mismatch (Requirement 3.7)
// ---------------------------------------------------------------------------

describe('_csvDecode — row field-count mismatch (Req 3.7)', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('skips a row that has too few fields and does not throw', () => {
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
// _csvDecode — numeric field coercion (Requirement 3.8)
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
// _csvDecode — required-field defaults (Requirements 9.3, 9.4)
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
// Property 1: CSV round-trip identity
// Feature: csv-persistent-storage, Property 1: CSV round-trip identity
// Validates: Requirements 3.5, 3.6
// ---------------------------------------------------------------------------

describe('Property 1: CSV round-trip identity (Req 3.5, 3.6)', () => {
  // Arbitrary string generator that stresses RFC 4180 special characters
  // including commas, double-quotes, newlines, CRLF, and Unicode.
  const stressString = fc.oneof(
    fc.string(),
    fc.constant(','),
    fc.constant('"'),
    fc.constant('\n'),
    fc.constant('\r\n'),
    fc.constant('say "hello", world\r\nbye'),
    fc.string({ unit: 'binary' }), // Unicode stress
  );

  const recordArb = fc.record({
    id:      stressString,
    name:    stressString,
    notes:   stressString,
    // ttrMins stored as string so round-trip stays string→string
    ttrMins: stressString,
  });

  it('encode then decode returns byte-for-byte identical records', () => {
    fc.assert(
      fc.property(fc.array(recordArb, { minLength: 0, maxLength: 20 }), (records) => {
        const csv = _csvEncode(records, SCHEMA);
        const decoded = _csvDecode(csv, SCHEMA);
        // Each decoded record must match the original field values
        expect(decoded).toHaveLength(records.length);
        for (let i = 0; i < records.length; i++) {
          for (const col of SCHEMA) {
            const originalVal = records[i][col] == null ? '' : String(records[i][col]);
            expect(decoded[i][col]).toBe(originalVal);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Numeric field type preservation
// Feature: csv-persistent-storage, Property 2: Numeric field type preservation
// Validates: Requirements 3.8
// ---------------------------------------------------------------------------

describe('Property 2: Numeric field type preservation (Req 3.8)', () => {
  // Schema that includes a numeric field
  const NUM_SCHEMA = ['id', 'name', 'qty', 'price'];

  // Generate records with genuinely numeric values in qty and price
  const numericRecordArb = fc.record({
    id:    fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(',') && !s.includes('"') && !s.includes('\r') && !s.includes('\n')),
    name:  fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(',') && !s.includes('"') && !s.includes('\r') && !s.includes('\n')),
    qty:   fc.integer({ min: 0, max: 100000 }),
    price: fc.float({ min: 0, max: 1e6, noNaN: true, noDefaultInfinity: true }),
  });

  it('numeric fields are strictly equal (===) after encode→decode round-trip', () => {
    fc.assert(
      fc.property(fc.array(numericRecordArb, { minLength: 1, maxLength: 20 }), (records) => {
        const csv = _csvEncode(records, NUM_SCHEMA);
        const decoded = _csvDecode(csv, NUM_SCHEMA, {
          numericFields: new Set(['qty', 'price']),
        });

        expect(decoded).toHaveLength(records.length);
        for (let i = 0; i < records.length; i++) {
          // qty is integer — must round-trip exactly
          expect(decoded[i].qty).toBe(records[i].qty);
          expect(typeof decoded[i].qty).toBe('number');

          // price is float — use toBeCloseTo to handle float serialisation precision
          expect(decoded[i].price).toBeCloseTo(records[i].price, 5);
          expect(typeof decoded[i].price).toBe('number');
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Row-count mismatch rows are skipped without aborting the load
// Feature: csv-persistent-storage, Property 10
// Validates: Requirements 3.7, 9.4
// ---------------------------------------------------------------------------

describe('Property 10: Row-count mismatch rows are skipped (Req 3.7, 9.4)', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  // Generate a well-formed record (all values safe for bare CSV fields)
  const safeString = fc.string({ minLength: 0, maxLength: 20 }).filter(
    s => !s.includes(',') && !s.includes('"') && !s.includes('\r') && !s.includes('\n')
  );

  const safeRecordArb = fc.record({
    id:      safeString,
    name:    safeString,
    notes:   safeString,
    ttrMins: safeString,
  });

  it('skipping malformed rows never throws and valid rows are preserved', () => {
    fc.assert(
      fc.property(
        // Valid records
        fc.array(safeRecordArb, { minLength: 1, maxLength: 10 }),
        // Number of bad rows to inject (1–5)
        fc.integer({ min: 1, max: 5 }),
        // Inject position: before, between, or after valid rows
        fc.integer({ min: 0, max: 10 }),
        (validRecords, badCount, insertAt) => {
          // Build a valid CSV
          const goodCsv = _csvEncode(validRecords, SCHEMA);
          const lines = goodCsv.split('\r\n');
          // lines[0] = header, lines[1..N] = data rows, lines[N+1] = ''
          const header = lines[0];
          const dataLines = lines.slice(1).filter(l => l.length > 0);

          // Construct bad rows (wrong field count — 2 fields instead of 4)
          const badRows = Array.from({ length: badCount }, (_, k) => `bad_${k},only_two_fields`);

          // Interleave bad rows at a clamped position
          const pos = Math.min(insertAt, dataLines.length);
          const allDataLines = [
            ...dataLines.slice(0, pos),
            ...badRows,
            ...dataLines.slice(pos),
          ];

          const injectedCsv = [header, ...allDataLines, ''].join('\r\n');

          // Must not throw
          let result;
          expect(() => { result = _csvDecode(injectedCsv, SCHEMA); }).not.toThrow();

          // Must return exactly the valid rows
          expect(result).toHaveLength(validRecords.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Required-field validation substitutes safe defaults, never throws
// Feature: csv-persistent-storage, Property 15
// Validates: Requirements 9.3, 9.4
// ---------------------------------------------------------------------------

describe('Property 15: Required-field validation substitutes safe defaults (Req 9.3, 9.4)', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  const requiredOpts = {
    requiredFields: new Map([
      ['id',      ''],
      ['name',    'Unknown'],
      ['ttrMins', 0],
    ]),
    numericFields: new Set(['ttrMins']),
  };

  // Generate rows where required fields may be empty / absent
  const maybeEmptyString = fc.oneof(
    fc.constant(''),
    fc.string({ minLength: 1, maxLength: 20 }).filter(
      s => !s.includes(',') && !s.includes('"') && !s.includes('\r') && !s.includes('\n')
    ),
  );

  const rowArb = fc.record({
    id:      maybeEmptyString,
    name:    maybeEmptyString,
    notes:   maybeEmptyString,
    ttrMins: maybeEmptyString,
  });

  it('rows with absent/empty required fields are included with defaults, never throws', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 1, maxLength: 20 }), (rows) => {
        // Encode uses the SCHEMA, so all fields present as strings (possibly empty)
        const csv = _csvEncode(rows, SCHEMA);

        let result;
        expect(() => { result = _csvDecode(csv, SCHEMA, requiredOpts); }).not.toThrow();

        // All rows must be returned (none skipped due to required-field issues)
        expect(result).toHaveLength(rows.length);

        for (const rec of result) {
          // id: empty string is the default
          expect(typeof rec.id).toBe('string');
          // name: 'Unknown' is the default (or non-empty original)
          expect(typeof rec.name).toBe('string');
          // ttrMins: must be a number (0 default or parsed value)
          expect(typeof rec.ttrMins).toBe('number');
          expect(isFinite(rec.ttrMins)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
