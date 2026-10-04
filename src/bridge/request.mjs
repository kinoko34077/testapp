export const TOOL_REQUEST_TITLE_PREFIX = '[TOOL REQUEST] ';
const REQUEST_SCHEMA = 'kinotch-tool-request-v1';
const REQUEST_KEYS = ['parameters', 'request_id', 'schema', 'tool'];
const COMPRESS_PROFILES = new Set(['compact-v1', 'semantic-dense-v1']);
const JEV_PROFILES = new Set(['development', 'generic']);
const JEV_MODES = new Set(['full', 'changed-only']);
const REQUEST_ID_RE = /^req_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/;

function fail(message) {
  throw new TypeError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    fail(`${label} fields are invalid`);
  }
}
function validateRef(value, label) {
  if (typeof value !== 'string' || !REF_RE.test(value)) fail(`${label} is invalid`);
  if (
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.endsWith('.lock')
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

export function isToolRequestIssue(issue) {
  return Boolean(
    issue
    && typeof issue.title === 'string'
    && issue.title.startsWith(TOOL_REQUEST_TITLE_PREFIX)
  );
}

export function countCodePoints(text) {
  if (typeof text !== 'string') fail('text must be a string');
  return Array.from(text).length;
}

export function extractRequestEnvelope(issueBody) {
  if (typeof issueBody !== 'string') fail('issue body must be a string');
  const matches = [...issueBody.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g)];
  if (matches.length !== 1) fail('request must contain exactly one fenced json block');
  try {
    return JSON.parse(matches[0][1]);
  } catch {
    fail('invalid json request envelope');
  }
}
function validateCompress(parameters) {
  assertExactKeys(parameters, ['profile', 'text'], 'semantic_compress parameters');
  if (typeof parameters.text !== 'string' || countCodePoints(parameters.text) === 0) {
    fail('text must be non-empty');
  }
  if (countCodePoints(parameters.text) > 200_000) fail('text exceeds 200000 code points');
  if (!COMPRESS_PROFILES.has(parameters.profile)) fail('profile is invalid');
  return { text: parameters.text, profile: parameters.profile };
}

function validateJev(parameters) {
  if (!isObject(parameters)) fail('jev_audit parameters must be an object');
  if (!JEV_MODES.has(parameters.mode)) fail('mode is invalid');
  const hasBaseRef = Object.prototype.hasOwnProperty.call(parameters, 'base_ref');
  if (parameters.mode === 'changed-only' && !hasBaseRef) fail('base_ref is required for changed-only');
  if (parameters.mode === 'full' && hasBaseRef) fail('base_ref is not allowed for full mode');
  const expected = parameters.mode === 'changed-only'
    ? ['base_ref', 'mode', 'profile', 'ref', 'repository']
    : ['mode', 'profile', 'ref', 'repository'];
  assertExactKeys(parameters, expected, 'jev_audit parameters');
  if (!REPOSITORY_RE.test(parameters.repository ?? '')) fail('repository is invalid');
  validateRef(parameters.ref, 'ref');
  if (!JEV_PROFILES.has(parameters.profile)) fail('profile is invalid');
  if (parameters.mode === 'changed-only') validateRef(parameters.base_ref, 'base_ref');
  return { ...parameters };
}

export function validateRequestEnvelope(value) {
  assertExactKeys(value, REQUEST_KEYS, 'request');
  if (value.schema !== REQUEST_SCHEMA) fail('schema is invalid');
  if (typeof value.request_id !== 'string' || !REQUEST_ID_RE.test(value.request_id)) {
    fail('request_id is invalid');
  }
  let parameters;
  if (value.tool === 'semantic_compress') {
    parameters = validateCompress(value.parameters);
  } else if (value.tool === 'jev_audit') {
    parameters = validateJev(value.parameters);
  } else {
    fail('tool is invalid');
  }
  return {
    schema: REQUEST_SCHEMA,
    request_id: value.request_id,
    tool: value.tool,
    parameters,
  };
}
