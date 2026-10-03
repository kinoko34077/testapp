import { extractRequestEnvelope, isToolRequestIssue } from './request.mjs';

const API_VERSION = '2022-11-28';
const MAX_ISSUE_PAGES = 10;
const MAX_COMMENT_PAGES = 10;
const RESULT_STATUSES = new Set(['success', 'invalid_request', 'duplicate_request', 'tool_error', 'bridge_error']);

function githubError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function repositoryPath(repository) {
  if (typeof repository !== 'string') throw new TypeError('repository is required');
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new TypeError('repository must be owner/name');
  }
  return parts.map(encodeURIComponent).join('/');
}

export function createGitHubClient({ token, repository, fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('token is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const repoPath = repositoryPath(repository);
  const baseUrl = `https://api.github.com/repos/${repoPath}`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': API_VERSION,
  };

  async function api(path, { method = 'GET', body } = {}) {
    const options = { method, headers: { ...headers } };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetchImpl(`${baseUrl}${path}`, options);
    if (!response.ok) {
      throw githubError('UPSTREAM_HTTP_ERROR', `GitHub API request failed with HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw githubError('UPSTREAM_RESPONSE_INVALID', 'GitHub API returned invalid JSON');
    }
  }

  async function listIssues() {
    const issues = [];
    for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
      const batch = await api(`/issues?state=all&per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw githubError('UPSTREAM_RESPONSE_INVALID', 'GitHub issues response is invalid');
      issues.push(...batch);
      if (batch.length < 100) return issues;
    }
    throw githubError('ISSUE_SCAN_LIMIT', 'GitHub issue scan limit reached before duplicate check completed');
  }
  async function listComments(issueNumber) {
    const comments = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
      const batch = await api(`/issues/${issueNumber}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw githubError('UPSTREAM_RESPONSE_INVALID', 'GitHub comments response is invalid');
      comments.push(...batch);
      if (batch.length < 100) return comments;
    }
    throw githubError('COMMENT_SCAN_LIMIT', 'GitHub comment scan limit reached before idempotency check completed');
  }

  async function postComment(issueNumber, body) {
    await api(`/issues/${issueNumber}/comments`, { method: 'POST', body: { body } });
  }

  async function closeIssue(issueNumber) {
    await api(`/issues/${issueNumber}`, { method: 'PATCH', body: { state: 'closed' } });
  }

  function parseResultComment(body) {
    if (typeof body !== 'string') return null;
    const matches = [...body.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g)];
    if (matches.length !== 1) return null;
    try {
      const value = JSON.parse(matches[0][1]);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (value.schema !== 'kinotch-tool-result-v1') return null;
      if (!RESULT_STATUSES.has(value.status)) return null;
      if (!Object.prototype.hasOwnProperty.call(value, 'result')) return null;
      if (!value.provenance || typeof value.provenance !== 'object' || Array.isArray(value.provenance)) return null;
      return value;
    } catch {
      return null;
    }
  }

  async function findExistingResult(issueNumber) {
    const comments = await listComments(issueNumber);
    for (const comment of comments) {
      if (comment?.user?.login !== 'github-actions[bot]' || comment?.user?.type !== 'Bot') continue;
      const result = parseResultComment(comment.body);
      if (result) return result;
    }
    return null;
  }

  async function findRequestId(requestId, currentIssueNumber) {
    const issues = await listIssues();
    for (const issue of issues) {
      if (!Number.isInteger(issue?.number) || issue.number >= currentIssueNumber) continue;
      if (issue.pull_request || !isToolRequestIssue(issue) || typeof issue.body !== 'string') continue;
      try {
        const envelope = extractRequestEnvelope(issue.body);
        if (envelope?.request_id === requestId) return { issueNumber: issue.number };
      } catch {
        // Non-bridge and malformed historical Issues are not duplicates.
      }
    }
    return null;
  }

  return {
    listIssues,
    listComments,
    findExistingResult,
    postComment,
    closeIssue,
    findRequestId,
  };
}
