import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  preparePublicRepository,
  runJevAudit,
} from '../src/bridge/jev-audit.mjs';

function fakeSpawn(steps, calls) {
  const queue = [...steps];
  return (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    process.nextTick(() => {
      const step = queue.shift() ?? {};
      if (step.stdout) child.stdout.write(step.stdout);
      if (step.stderr) child.stderr.write(step.stderr);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', step.code ?? 0);
    });
    return child;
  };
}
async function withTempDir(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'bridge-jev-test-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function jevReport(status = 'review') {
  return {
    profile: 'development',
    files_scanned: 3,
    batches: 1,
    git: { head_sha: 'h'.repeat(40), base_sha: 'b'.repeat(40) },
    aggregate: {
      overall: { status, risk: 0.72, status_trigger: { kind: 'concrete_risk' } },
      highest_risk_batches: [{ index: 1, risk: 0.72, paths: ['src/a.py'] }],
    },
    coverage: { files_scanned: 3, sent_chars: 120, secret: 'drop' },
    provenance: { resolved_model: 'jev-test', git_head_sha: 'h'.repeat(40) },
    batch_audits: [{ source: 'must not return' }],
  };
}

test('prepares public repository with shell-free git argument arrays', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    const spawnImpl = fakeSpawn([
      {},
      {},
      { stdout: `${'a'.repeat(40)}\n` },
      {},
    ], calls);
    const prepared = await preparePublicRepository(
      {
        repository: 'kinoko34077/jev-audit',
        ref: 'main',
        mode: 'full',
        profile: 'development',
      },
      { spawnImpl, workDir },
    );
    assert.equal(prepared.headSha, 'a'.repeat(40));
    assert.equal(prepared.baseSha, undefined);
    assert.equal(calls[0].command, 'git');
    assert.deepEqual(calls[0].args.slice(0, 3), ['clone', '--filter=blob:none', '--no-checkout']);
    assert.equal(calls[0].args[3], 'https://github.com/kinoko34077/jev-audit.git');
    assert.equal(calls.every((call) => call.options.shell === false), true);
  });
});

test('changed-only resolves exact base/head and passes explicit base sha to jev', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    const head = '1'.repeat(40);
    const base = '2'.repeat(40);
    const spawnImpl = fakeSpawn([
      {},
      {},
      { stdout: `${head}\n` },
      {},
      {},
      { stdout: `${base}\n` },
      { stdout: JSON.stringify(jevReport('rework')) },
    ], calls);
    const result = await runJevAudit(
      {
        repository: 'kinoko34077/jev-audit',
        ref: 'feature/head',
        mode: 'changed-only',
        base_ref: 'main',
        profile: 'development',
      },
      { spawnImpl, workDir, typesafeApiKey: 'typesafe-secret' },
    );
    const jevCall = calls.at(-1);
    assert.equal(jevCall.command, 'jev-audit');
    assert.ok(jevCall.args.includes('--changed-only'));
    const baseIndex = jevCall.args.indexOf('--base-ref');
    assert.equal(jevCall.args[baseIndex + 1], base);
    assert.equal(jevCall.options.env.TYPESAFE_API_KEY, 'typesafe-secret');
    assert.equal(jevCall.args.join(' ').includes('typesafe-secret'), false);
    assert.equal(result.status, 'rework');
    assert.equal(result.head_sha, head);
    assert.equal(result.base_sha, base);
    assert.equal(result.batch_audits, undefined);
    assert.equal(result.coverage.secret, undefined);
  });
});

test('full mode invokes jev without changed-only flags and keeps semantic status as data', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    const head = '3'.repeat(40);
    const spawnImpl = fakeSpawn([
      {},
      {},
      { stdout: `${head}\n` },
      {},
      { stdout: JSON.stringify(jevReport('unknown')) },
    ], calls);
    const result = await runJevAudit(
      {
        repository: 'kinoko34077/jev-audit',
        ref: 'main',
        mode: 'full',
        profile: 'generic',
      },
      { spawnImpl, workDir, typesafeApiKey: 'typesafe-secret' },
    );
    const jevCall = calls.at(-1);
    assert.equal(jevCall.command, 'jev-audit');
    assert.equal(jevCall.args.includes('--changed-only'), false);
    assert.equal(jevCall.args.includes('--base-ref'), false);
    assert.equal(result.status, 'unknown');
    assert.equal(result.head_sha, head);
    assert.equal(result.base_sha, undefined);
  });
});

test('rejects unsafe direct repository or ref before spawning', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    for (const parameters of [
      { repository: 'owner/repo;rm', ref: 'main', mode: 'full', profile: 'development' },
      { repository: 'owner/repo', ref: '$(touch x)', mode: 'full', profile: 'development' },
    ]) {
      await assert.rejects(
        () => preparePublicRepository(parameters, { spawnImpl: fakeSpawn([], calls), workDir }),
        /repository|ref/i,
      );
    }
    assert.equal(calls.length, 0);
  });
});

test('does not expose git or jev stderr on process failures', async () => {
  await withTempDir(async (workDir) => {
    const gitCalls = [];
    await assert.rejects(
      () => preparePublicRepository(
        { repository: 'owner/repo', ref: 'main', mode: 'full', profile: 'development' },
        { spawnImpl: fakeSpawn([{ code: 1, stderr: 'Bearer git-secret raw detail' }], gitCalls), workDir },
      ),
      (error) => error.code === 'GIT_ERROR' && !/git-secret|raw detail|Bearer/.test(error.message),
    );
  });

  await withTempDir(async (workDir) => {
    const calls = [];
    const spawnImpl = fakeSpawn([
      {}, {}, { stdout: `${'4'.repeat(40)}\n` }, {},
      { code: 2, stderr: 'TYPESAFE_API_KEY=secret provider body' },
    ], calls);
    await assert.rejects(
      () => runJevAudit(
        { repository: 'owner/repo', ref: 'main', mode: 'full', profile: 'development' },
        { spawnImpl, workDir, typesafeApiKey: 'secret' },
      ),
      (error) => error.code === 'JEV_ERROR' && !/secret|provider body|TYPESAFE/.test(error.message),
    );
  });
});

test('classifies only allowlisted Jev provider exception prefixes without exposing stderr', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    const spawnImpl = fakeSpawn([
      {}, {}, { stdout: `${'4'.repeat(40)}\n` }, {},
      {
        code: 2,
        stderr: 'ERROR: TypeSafeUnprocessableEntityError: 422 private provider body TYPESAFE_API_KEY=secret\n',
      },
    ], calls);
    await assert.rejects(
      () => runJevAudit(
        { repository: 'owner/repo', ref: 'main', mode: 'full', profile: 'development' },
        { spawnImpl, workDir, typesafeApiKey: 'secret' },
      ),
      (error) => error.code === 'JEV_PROVIDER_UNPROCESSABLE'
        && !/private provider body|TYPESAFE_API_KEY|secret|422/.test(error.message),
    );
  });

  await withTempDir(async (workDir) => {
    const calls = [];
    const spawnImpl = fakeSpawn([
      {}, {}, { stdout: `${'4'.repeat(40)}\n` }, {},
      { code: 2, stderr: 'ERROR: EvilError: TypeSafeRateLimitError secret\n' },
    ], calls);
    await assert.rejects(
      () => runJevAudit(
        { repository: 'owner/repo', ref: 'main', mode: 'full', profile: 'development' },
        { spawnImpl, workDir, typesafeApiKey: 'secret' },
      ),
      (error) => error.code === 'JEV_ERROR' && !/EvilError|RateLimit|secret/.test(error.message),
    );
  });
});

test('git and jev child processes receive only the credentials they need', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    const head = '5'.repeat(40);
    const baseEnv = {
      PATH: 'safe-path',
      GITHUB_TOKEN: 'github-secret',
      COMPRESSION_API_TOKEN: 'compression-secret',
      TYPESAFE_API_KEY: 'old-typesafe-secret',
    };
    const spawnImpl = fakeSpawn([
      {}, {}, { stdout: `${head}\n` }, {},
      { stdout: JSON.stringify(jevReport('clear')) },
    ], calls);
    await runJevAudit(
      { repository: 'owner/repo', ref: 'main', mode: 'full', profile: 'development' },
      { spawnImpl, workDir, typesafeApiKey: 'new-typesafe-secret', baseEnv },
    );
    for (const call of calls.slice(0, -1)) {
      assert.equal(call.options.env.PATH, 'safe-path');
      assert.equal(call.options.env.GITHUB_TOKEN, undefined);
      assert.equal(call.options.env.COMPRESSION_API_TOKEN, undefined);
      assert.equal(call.options.env.TYPESAFE_API_KEY, undefined);
    }
    const jevCall = calls.at(-1);
    assert.equal(jevCall.options.env.PATH, 'safe-path');
    assert.equal(jevCall.options.env.TYPESAFE_API_KEY, 'new-typesafe-secret');
    assert.equal(jevCall.options.env.GITHUB_TOKEN, undefined);
    assert.equal(jevCall.options.env.COMPRESSION_API_TOKEN, undefined);
  });
});

test('clean changed-only can run without a provider key', async () => {
  await withTempDir(async (workDir) => {
    const calls = [];
    const same = '5'.repeat(40);
    const spawnImpl = fakeSpawn([
      {}, {}, { stdout: `${same}\n` }, {},
      {}, { stdout: `${same}\n` },
      { stdout: JSON.stringify(jevReport('clear')) },
    ], calls);
    const result = await runJevAudit(
      {
        repository: 'kinoko34077/jev-audit', ref: 'main', mode: 'changed-only',
        base_ref: 'main', profile: 'development',
      },
      { spawnImpl, workDir },
    );
    assert.equal(result.status, 'clear');
    assert.equal(result.head_sha, same);
    assert.equal(result.base_sha, same);
  });
});
