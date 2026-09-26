import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('request cli entry reads an event path and invokes runIssueRequest', async () => {
  const source = await readFile(new URL('../scripts/run-request.mjs', import.meta.url), 'utf8');
  assert.match(source, /readFile/);
  assert.match(source, /runIssueRequest/);
  assert.match(source, /process\.argv\[2\]/);
  assert.doesNotMatch(source, /console\.log|console\.error/);
});
