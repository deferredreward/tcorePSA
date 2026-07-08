import { describe, it, expect } from 'vitest';
import { parseTsv } from './tsv.js';

describe('parseTsv', () => {
  it('parses rows keyed by the header row', () => {
    const text = 'Reference\tID\tQuote\n1:1\tabc1\thello\n1:2\tdef2\tworld';
    expect(parseTsv(text)).toEqual([
      { Reference: '1:1', ID: 'abc1', Quote: 'hello' },
      { Reference: '1:2', ID: 'def2', Quote: 'world' },
    ]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseTsv('')).toEqual([]);
  });

  it('strips trailing carriage returns from CRLF files', () => {
    const text = 'A\tB\r\n1\t2\r\n';
    expect(parseTsv(text)).toEqual([{ A: '1', B: '2' }]);
  });

  it('fills missing trailing cells with empty strings', () => {
    const text = 'A\tB\tC\n1\t2';
    expect(parseTsv(text)).toEqual([{ A: '1', B: '2', C: '' }]);
  });
});
