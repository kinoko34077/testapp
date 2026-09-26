import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

const REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;
const PROFILES = new Set(['development', 'generic']);
const MODES = new Set(['full', 'changed-only']);
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_OUTPUT_BYTES = 2_000_000;
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const CHILD_ENV_KEYS = [
  'PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP',
  'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'COMSPEC',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'PYTHONUTF8', 'PYTHONIOENCODING',
];

function childEnv(baseEnv = process.env, extra = {}) {
  const env = {};
  for (const key of CHILD_ENV_KEYS) {
    if (typeof baseEnv?.[key] === 'string') env[key] = baseEnv[key];
  }
  return { ...env, ...extra };
}

function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const JEV_PROVIDER_ERROR_CODES = new Map([
  ['TypeSafeAuthenticationError', 'JEV_PROVIDER_AUTHENTICATION'],
  ['TypeSafePermissionDeniedError', 'JEV_PROVIDER_PERMISSION_DENIED'],
  ['TypeSafeNotFoundError', 'JEV_PROVIDER_NOT_FOUND'],
  ['TypeSafeBadRequestError', 'JEV_PROVIDER_BAD_REQUEST'],
  ['TypeSafeUnprocessableEntityError', 'JEV_PROVIDER_UNPROCESSABLE'],
  ['TypeSafeRateLimitError', 'JEV_PROVIDER_RATE_LIMIT'],
  ['TypeSafeInternalServerError', 'JEV_PROVIDER_INTERNAL'],
  ['TypeSafeAPIResponseValidationError', 'JEV_PROVIDER_RESPONSE_INVALID'],
  ['TypeSafeAPITimeoutError', 'JEV_PROVIDER_TIMEOUT'],
  ['TypeSafeAPIConnectionError', 'JEV_PROVIDER_CONNECTION'],
  ['TypeSafeAPIError', 'JEV_PROVIDER_API'],
  ['TypeSafeError', 'JEV_PROVIDER_CONFIG'],
]);

function classifyJevStderr(stderrPrefix) {
  const match = /^ERROR: ([A-Za-z][A-Za-z0-9_]*):/.exec(stderrPrefix);
  if (match && JEV_PROVIDER_ERROR_CODES.has(match[1])) {
    return JEV_PROVIDER_ERROR_CODES.get(match[1]);
  }
  if (/^ERROR: RuntimeError: Jev response(?: |$)/.test(stderrPrefix)) {
    return 'JEV_PROVIDER_RESPONSE_INVALID';
  }
  return null;
}

function validateRef(value, label) {
  if (typeof value !== 'string' || !REF_RE.test(value)) throw new TypeError(`${label} is invalid`);
  if (value.includes('..') || value.includes('//') || value.includes('@{') || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) {
    throw new TypeError(`${label} is invalid`);
  }
}

function validateParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError('parameters are invalid');
  if (!REPOSITORY_RE.test(parameters.repository ?? '')) throw new TypeError('repository is invalid');
  validateRef(parameters.ref, 'ref');
  if (!MODES.has(parameters.mode)) throw new TypeError('mode is invalid');
  if (!PROFILES.has(parameters.profile)) throw new TypeError('profile is invalid');
  if (parameters.mode === 'changed-only') validateRef(parameters.base_ref, 'base_ref');
}
function runProcess(command, args, {
  spawnImpl = nodeSpawn,
  cwd,
  env = childEnv(process.env),
  errorCode,
  classifyStderr,
  timeoutMs = PROCESS_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderrPrefix = '';
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill?.();
      reject(bridgeError(errorCode, `${command} timed out`));
    }, timeoutMs);

    function addOutput(chunk, capture) {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill?.();
        reject(bridgeError(errorCode, `${command} output exceeded limit`));
        return;
      }
      if (capture) {
        stdout += chunk;
      } else if (stderrPrefix.length < 512) {
        stderrPrefix += chunk.slice(0, 512 - stderrPrefix.length);
      }
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => addOutput(chunk, true));
    child.stderr?.on('data', (chunk) => addOutput(chunk, false));
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(bridgeError(errorCode, `${command} failed to start`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const classifiedCode = typeof classifyStderr === 'function'
          ? classifyStderr(stderrPrefix)
          : null;
        reject(bridgeError(classifiedCode ?? errorCode, `${command} exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function resolveFetchedCommit(targetDir, spawnImpl, env) {
  const output = await runProcess(
    'git',
    ['-C', targetDir, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
    { spawnImpl, env, errorCode: 'GIT_ERROR' },
  );
  const sha = output.trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw bridgeError('GIT_ERROR', 'git returned an invalid commit SHA');
  return sha;
}
export async function preparePublicRepository(
  parameters,
  { spawnImpl = nodeSpawn, workDir, baseEnv = process.env } = {},
) {
  validateParameters(parameters);
  if (typeof workDir !== 'string' || workDir.length === 0) throw new TypeError('workDir is required');
  const targetDir = await mkdtemp(path.join(workDir, 'repo-'));
  const remote = `https://github.com/${parameters.repository}.git`;
  const gitEnv = childEnv(baseEnv);
  try {
    await runProcess(
      'git',
      ['clone', '--filter=blob:none', '--no-checkout', remote, targetDir],
      { spawnImpl, env: gitEnv, errorCode: 'GIT_ERROR' },
    );
    await runProcess(
      'git',
      ['-C', targetDir, 'fetch', '--depth=1', 'origin', parameters.ref],
      { spawnImpl, env: gitEnv, errorCode: 'GIT_ERROR' },
    );
    const headSha = await resolveFetchedCommit(targetDir, spawnImpl, gitEnv);
    await runProcess(
      'git',
      ['-C', targetDir, 'checkout', '--detach', headSha],
      { spawnImpl, env: gitEnv, errorCode: 'GIT_ERROR' },
    );

    let baseSha;
    if (parameters.mode === 'changed-only') {
      await runProcess(
        'git',
        ['-C', targetDir, 'fetch', '--depth=1', 'origin', parameters.base_ref],
        { spawnImpl, env: gitEnv, errorCode: 'GIT_ERROR' },
      );
      baseSha = await resolveFetchedCommit(targetDir, spawnImpl, gitEnv);
    }
    return { targetDir, headSha, baseSha };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  }
}
function pick(object, keys) {
  const result = {};
  if (!object || typeof object !== 'object' || Array.isArray(object)) return result;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) result[key] = object[key];
  }
  return result;
}

function projectFinding(item) {
  return pick(item, [
    'index',
    'risk',
    'risk_driver',
    'paths',
    'concrete_issue',
    'review_probability',
    'rework_probability',
    'actionable_probability',
    'unknown_probability',
  ]);
}

function projectReport(report, parameters, prepared) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw bridgeError('JEV_RESPONSE_INVALID', 'Jev returned invalid JSON data');
  }
  const overall = report.aggregate?.overall;
  if (!overall || typeof overall.status !== 'string' || typeof overall.risk !== 'number') {
    throw bridgeError('JEV_RESPONSE_INVALID', 'Jev report schema is invalid');
  }
  const result = {
    status: overall.status,
    risk: overall.risk,
    reason: pick(overall.status_trigger, ['kind', 'batch_index', 'paths', 'value', 'risk_driver', 'concrete_issue', 'rework_probability']),
    profile: report.profile,
    model: report.provenance?.resolved_model,
    repository: parameters.repository,
    head_sha: prepared.headSha,
    coverage: pick(report.coverage, [
      'files_scanned',
      'file_entries_skipped',
      'files_skipped',
      'files_considered',
      'files_truncated',
      'excluded_directory_count',
      'sent_chars',
      'original_chars',
      'char_coverage',
    ]),
    findings: Array.isArray(report.aggregate?.highest_risk_batches)
      ? report.aggregate.highest_risk_batches.slice(0, 5).map(projectFinding)
      : [],
  };
  if (prepared.baseSha) result.base_sha = prepared.baseSha;
  return result;
}

export async function runJevAudit(
  parameters,
  { spawnImpl = nodeSpawn, workDir, typesafeApiKey, baseEnv = process.env } = {},
) {
  validateParameters(parameters);
  const prepared = await preparePublicRepository(parameters, { spawnImpl, workDir, baseEnv });
  try {
    const args = ['.', '--profile', parameters.profile, '--json', '--fail-on', 'never'];
    if (parameters.mode === 'changed-only') {
      args.push('--changed-only', '--base-ref', prepared.baseSha);
    }
    const stdout = await runProcess('jev-audit', args, {
      spawnImpl,
      cwd: prepared.targetDir,
      env: childEnv(
        baseEnv,
        typeof typesafeApiKey === 'string' && typesafeApiKey.length > 0
          ? { TYPESAFE_API_KEY: typesafeApiKey }
          : {},
      ),
      errorCode: 'JEV_ERROR',
      classifyStderr: classifyJevStderr,
    });
    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      throw bridgeError('JEV_RESPONSE_INVALID', 'Jev returned invalid JSON');
    }
    return projectReport(report, parameters, prepared);
  } finally {
    await rm(prepared.targetDir, { recursive: true, force: true });
  }
}
