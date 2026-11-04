import { readFile } from 'node:fs/promises';
import { admitPublicCompression } from '../src/bridge/public-request.mjs';

try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new TypeError('expected event path');
  const event = JSON.parse(await readFile(path, 'utf8'));
  admitPublicCompression(event);
  process.stdout.write('public compression admission: accepted\n');
} catch {
  process.stderr.write('public compression admission: denied (no provider call)\n');
  process.exitCode = 1;
}
