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
function projectJevFinding(item) {
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
  ]);
  projected.findings = Array.isArray(result?.findings)
    ? result.findings.slice(0, 5).map(projectJevFinding)
    : [];
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
    JEV_PROVIDER_AUTHENTICATION: 'jev_provider_authentication',
    JEV_PROVIDER_PERMISSION_DENIED: 'jev_provider_permission_denied',
    JEV_PROVIDER_NOT_FOUND: 'jev_provider_not_found',
    JEV_PROVIDER_BAD_REQUEST: 'jev_provider_bad_request',
    JEV_PROVIDER_UNPROCESSABLE: 'jev_provider_unprocessable',
    JEV_PROVIDER_RATE_LIMIT: 'jev_provider_rate_limit',
    JEV_PROVIDER_INTERNAL: 'jev_provider_internal',
    JEV_PROVIDER_RESPONSE_INVALID: 'jev_provider_response_invalid',
    JEV_PROVIDER_TIMEOUT: 'jev_provider_timeout',
    JEV_PROVIDER_CONNECTION: 'jev_provider_connection',
    JEV_PROVIDER_API: 'jev_provider_api',
    JEV_PROVIDER_CONFIG: 'jev_provider_config',
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
