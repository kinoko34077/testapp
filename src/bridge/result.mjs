const RESULT_SCHEMA = 'kinotch-tool-result-v1';
const STATUSES = new Set([
  'success',
  'invalid_request',
  'duplicate_request',
  'tool_error',
  'bridge_error',
]);
const USAGE_KEYS = [
  'input_tokens',
  'system_prompt_tokens',
  'content_input_tokens',
  'output_tokens',
  'thought_tokens',
  'cached_tokens',
  'total_tokens',
];
const COVERAGE_KEYS = [
  'files_scanned',
  'file_entries_skipped',
  'files_skipped',
  'files_considered',
  'files_truncated',
  'excluded_directory_count',
  'sent_chars',
  'original_chars',
  'char_coverage',
];
function pick(object, keys) {
  const result = {};
  if (!object || typeof object !== 'object' || Array.isArray(object)) return result;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) result[key] = object[key];
  }
  return result;
}

function projectProvenance(provenance) {
  return pick(provenance, ['workflow_run_id', 'bridge_sha']);
}

function projectSemantic(result) {
  const projected = pick(result, [
    'compressed_text',
    'profile',
    'prompt_version',
    'model',
    'input_chars',
    'output_chars',
    'input_sha256',
    'output_sha256',
    'warnings',
  ]);
  projected.usage = pick(result?.usage, USAGE_KEYS);
  return projected;
}
function projectJev(result) {
  const projected = pick(result, [
    'status',
    'risk',
    'local_status',
    'reason',
    'profile',
    'model',
    'repository',
    'head_sha',
    'base_sha',
    'findings',
  ]);
  projected.coverage = pick(result?.coverage, COVERAGE_KEYS);
  return projected;
}

export function safeErrorCode(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  const map = {
    INVALID_REQUEST: 'invalid_request',
    UPSTREAM_HTTP_ERROR: 'upstream_http_error',
    ETIMEDOUT: 'timeout',
    TIMEOUT: 'timeout',
    GIT_ERROR: 'git_error',
    JEV_ERROR: 'jev_error',
    INTERNAL_ERROR: 'internal_error',
  };
  return map[code] ?? 'internal_error';
}
export function successResult({ request, result, provenance }) {
  const projected = request.tool === 'semantic_compress'
    ? projectSemantic(result)
    : projectJev(result);
  return {
    schema: RESULT_SCHEMA,
    request_id: request.request_id,
    tool: request.tool,
    status: 'success',
    result: projected,
    provenance: projectProvenance(provenance),
  };
}

export function failureResult({ requestId, tool, status, code, provenance }) {
  if (!STATUSES.has(status) || status === 'success') {
    throw new TypeError('failure status is invalid');
  }
  return {
    schema: RESULT_SCHEMA,
    request_id: requestId ?? null,
    tool: tool ?? null,
    status,
    result: { code },
    provenance: projectProvenance(provenance),
  };
}

export function serializeResultComment(envelope) {
  return `\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\``;
}
