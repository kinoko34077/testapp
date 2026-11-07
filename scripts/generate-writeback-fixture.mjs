// testapp#32: deterministic, public-source-only, scratch-branch E2E fixture.
// This generator never reads credentials, contacts services, or changes other paths.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'docs', 'REQUEST_PROTOCOL.md');
const output = path.join(root, 'data', 'writeback-e2e', 'generated.json');
const source = await readFile(input);
const expected = JSON.stringify({
  schema: 'writeback-testapp-e2e.v1',
  source: 'docs/REQUEST_PROTOCOL.md',
  source_sha256: createHash('sha256').update(source).digest('hex'),
  kind: 'non-production-fixture',
}) + '\n';

if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8');
  if (current !== expected) {
    console.error('E2E generated fixture differs from canonical input');
    process.exitCode = 1;
  } else {
    console.log('E2E generated fixture matches canonical input');
  }
} else if (process.argv.length === 2) {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, expected, 'utf8');
  console.log('Generated public E2E fixture');
} else {
  console.error('Only --check or no arguments are supported');
  process.exitCode = 2;
}
