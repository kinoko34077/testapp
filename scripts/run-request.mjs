import { readFile } from 'node:fs/promises';

import { runIssueRequest } from '../src/bridge/run-request.mjs';

const eventPath = process.argv[2];
if (!eventPath) {
  process.stderr.write('bridge event path is required\n');
  process.exitCode = 2;
} else {
  try {
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    await runIssueRequest({ event, env: process.env });
  } catch {
    process.stderr.write('bridge request failed\n');
    process.exitCode = 1;
  }
}
