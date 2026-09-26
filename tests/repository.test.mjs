import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('repository declares the bridge node runtime and test command', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.engines.node, '>=26.10.0');
  assert.equal(pkg.scripts.test, 'node --test');
});
