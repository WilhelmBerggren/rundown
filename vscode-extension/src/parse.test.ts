import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMd, serializeCells, type ParsedCell } from './parse';

describe('parseMd', () => {
  it('returns [] for empty string', () => {
    assert.deepEqual(parseMd(''), []);
  });

  it('returns one markup cell for plain markdown', () => {
    assert.deepEqual(parseMd('# Hello\n\nsome text'), [
      { kind: 'markup', source: '# Hello\n\nsome text' },
    ]);
  });

  it('returns one code cell for a sh fence', () => {
    assert.deepEqual(parseMd('```sh\necho hi\n```'), [
      { kind: 'code', source: 'echo hi' },
    ]);
  });

  it('handles bash fence tag', () => {
    assert.deepEqual(parseMd('```bash\nls\n```'), [
      { kind: 'code', source: 'ls' },
    ]);
  });

  it('attaches output fence as code cell output', () => {
    assert.deepEqual(parseMd('```sh\necho hi\n```\n\n```output\nhello\n```'), [
      { kind: 'code', source: 'echo hi', output: 'hello\n' },
    ]);
  });

  it('skips output: label between code and output fence', () => {
    assert.deepEqual(
      parseMd('```sh\necho hi\n```\n\noutput:\n\n```output\nhello\n```'),
      [{ kind: 'code', source: 'echo hi', output: 'hello\n' }]
    );
  });

  it('treats standalone output: paragraph as markup text', () => {
    assert.deepEqual(parseMd('output:\n\nsome text'), [
      { kind: 'markup', source: 'output:\n\nsome text' },
    ]);
  });

  it('interleaves markup and code cells correctly', () => {
    assert.deepEqual(
      parseMd('intro\n\n```sh\necho hi\n```\n\nconclusion'),
      [
        { kind: 'markup', source: 'intro' },
        { kind: 'code', source: 'echo hi' },
        { kind: 'markup', source: 'conclusion' },
      ]
    );
  });
});

describe('serializeCells', () => {
  it('placeholder — implemented in Task 3', () => {
    // intentionally empty — tests added in Task 3
  });
});
