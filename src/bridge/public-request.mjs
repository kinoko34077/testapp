import { extractRequestEnvelope, isToolRequestIssue, validateRequestEnvelope } from './request.mjs';

export const TRUSTED_OWNER_ID = 79015263;
export const PUBLIC_SCHEMA = 'kinotch-tool-request-v2';
export const PUBLIC_TITLE = '[TOOL REQUEST] public semantic_compress';

const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/,
  /\bBearer\s+[^\s`"'<>]{12,}/i,
  /\b(?:password|passphrase|client_secret|api[_-]?key|private[_-]?key|access[_-]?token)\s*[:=]\s*[^\s`"'<>]{4,}/i,
  /https?:\/\/(?:drive\.google\.com\/(?:file\/d|drive\/folders)|docs\.google\.com\/(?:document|spreadsheets|presentation)\/d)\//i,
  /https?:\/\/github\.com\/kinoko34077\/(?:kinotch-knowledge|github-history-archive)\//i,
  /[A-Za-z]:\\Users\\[^\\\s]+/i,
  /\b(?:\+81[- ]?)?0[789]0[- ]?\d{4}[- ]?\d{4}\b/,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
];

export function assertPublicTextPreflight(text) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('public text is required');
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new TypeError('public text contains a protected-content signal');
  }
  return true;
}

/**
 * Public GitHub Issues disclose the body immediately. This admission check
 * prevents provider execution but CANNOT prevent a disclosure made at posting.
 * Callers must run the same preflight BEFORE creating a public Issue.
 */
export function admitPublicCompression(event) {
  const issue = event?.issue;
  if (event?.action !== 'opened' || event?.repository?.private !== false
    || event?.repository?.full_name !== 'kinoko34077/testapp'
    || event?.repository?.owner?.id !== TRUSTED_OWNER_ID
    || !issue || !Number.isSafeInteger(issue.number) || issue.number < 1
    || !isToolRequestIssue(issue)
    || issue.title !== PUBLIC_TITLE
    || issue.user?.id !== TRUSTED_OWNER_ID
    || issue.user?.login !== 'kinoko34077'
    || issue.author_association !== 'OWNER'
    || (event.sender != null && event.sender?.id !== TRUSTED_OWNER_ID)
    || typeof issue.body !== 'string') {
    throw new TypeError('public issue admission denied');
  }
  const body = issue.body.trim();
  if (!/^```json[ \t]*\r?\n[\s\S]*?\r?\n```$/.test(body)) {
    throw new TypeError('public request must consist of one json fence');
  }
  assertPublicTextPreflight(body);
  const request = validateRequestEnvelope(extractRequestEnvelope(body));
  // JSON escaping can conceal paths/secrets from raw Issue-body pattern checks.
  // Always scan the decoded text as well before any provider credential is used.
  if (typeof request.parameters?.text === 'string') assertPublicTextPreflight(request.parameters.text);
  if (request.schema !== PUBLIC_SCHEMA || request.tool !== 'semantic_compress'
      || request.data_classification !== 'public_non_sensitive'
      || request.acknowledge_public_disclosure !== true) {
    throw new TypeError('public request mode not authorized');
  }
  return request;
}
