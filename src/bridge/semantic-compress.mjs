import { countCodePoints } from './request.mjs';

const DEFAULT_ENDPOINT = 'https://api.kinotch.workers.dev/v1/compress';
const PROFILES = new Set(['compact-v1', 'semantic-dense-v1']);
const USAGE_KEYS = [
  'input_tokens',
  'system_prompt_tokens',
  'content_input_tokens',
  'output_tokens',
  'thought_tokens',
  'cached_tokens',
  'total_tokens',
];
const RESULT_KEYS = [
  'compressed_text',
  'profile',
  'prompt_version',
  'model',
  'input_chars',
  'output_chars',
  'input_sha256',
  'output_sha256',
  'warnings',
];

function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function project(object, keys) {
  const result = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) result[key] = object[key];
  }
  return result;
}

function validateParameters(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new TypeError('parameters are invalid');
  }
  if (typeof parameters.text !== 'string' || countCodePoints(parameters.text) === 0) {
    throw new TypeError('text must be non-empty');
  }
  if (countCodePoints(parameters.text) > 200_000) {
    throw new TypeError('text exceeds 200000 code points');
  }
  if (!PROFILES.has(parameters.profile)) throw new TypeError('profile is invalid');
}

function projectResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API returned invalid data');
  }
  for (const key of ['compressed_text', 'profile', 'prompt_version', 'model']) {
    if (typeof body[key] !== 'string' || body[key].length === 0) {
      throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API response schema is invalid');
    }
  }
  for (const key of ['input_chars', 'output_chars']) {
    if (!Number.isInteger(body[key]) || body[key] < 0) {
      throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API response schema is invalid');
    }
  }
  for (const key of ['input_sha256', 'output_sha256']) {
    if (typeof body[key] !== 'string' || !/^[0-9a-f]{64}$/.test(body[key])) {
      throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API response schema is invalid');
    }
  }
  if (!body.usage || typeof body.usage !== 'object' || Array.isArray(body.usage)) {
    throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API response schema is invalid');
  }
  if (!Array.isArray(body.warnings) || body.warnings.some((item) => typeof item !== 'string')) {
    throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API response schema is invalid');
  }
  const result = project(body, RESULT_KEYS);
  result.usage = project(body.usage, USAGE_KEYS);
  return result;
}

export async function runSemanticCompress(
  parameters,
  { token, fetchImpl = fetch, endpoint = DEFAULT_ENDPOINT } = {},
) {
  validateParameters(parameters);
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('token is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: parameters.text, profile: parameters.profile }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw bridgeError('TIMEOUT', 'Compression API request timed out');
    }
    throw bridgeError('UPSTREAM_CONNECTION_ERROR', 'Compression API request failed');
  }

  if (!response.ok) {
    throw bridgeError('UPSTREAM_HTTP_ERROR', `Compression API request failed with HTTP ${response.status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw bridgeError('UPSTREAM_RESPONSE_INVALID', 'Compression API returned invalid JSON');
  }
  return projectResponse(body);
}
