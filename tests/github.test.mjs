import test from 'node:test';
import assert from 'node:assert/strict';

import { createGitHubClient } from '../src/bridge/github.mjs';
import { jsonResponse } from './helpers.mjs';

const repo = 'kinoko34077/testapp';
const token = 'ghs_secret';

function requestBody(requestId) {
  return `\`\`\`json\n${JSON.stringify({
    schema: 'kinotch-tool-request-v1',
    request_id: requestId,
    tool: 'semantic_compress',
    parameters: { text: 'x', profile: 'compact-v1' },
  })}\n\`\`\``;
}

test('lists issues with auth headers and bounded pagination', async () => {
  const calls = [];
  const first = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, body: 'x' }));
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, calls.length === 1 ? first : [{ number: 101, body: 'y' }]);
  };
  const client = createGitHubClient({ token, repository: repo, fetchImpl });
  const issues = await client.listIssues();
  assert.equal(issues.length, 101);
  assert.match(calls[0].url, /per_page=100&page=1/);
  assert.match(calls[1].url, /page=2/);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.headers['X-GitHub-Api-Version'], '2022-11-28');
});

test('posts one issue comment and closes the issue', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, {});
  };
  const client = createGitHubClient({ token, repository: repo, fetchImpl });
  await client.postComment(12, 'safe result');
  await client.closeIssue(12);
  assert.match(calls[0].url, /\/issues\/12\/comments$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { body: 'safe result' });
  assert.match(calls[1].url, /\/issues\/12$/);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), { state: 'closed' });
});

test('findRequestId excludes current issue and ignores malformed bodies and PRs', async () => {
  const issues = [
    { number: 10, body: requestBody('req_duplicate1') },
    { number: 11, body: 'not a request' },
    { number: 12, body: requestBody('req_duplicate1') },
    { number: 13, body: requestBody('req_other123'), pull_request: {} },
  ];
  const fetchImpl = async () => jsonResponse(200, issues);
  const client = createGitHubClient({ token, repository: repo, fetchImpl });
  assert.deepEqual(await client.findRequestId('req_duplicate1', 12), { issueNumber: 10 });
  assert.equal(await client.findRequestId('req_other123', 12), null);
});

test('rejects missing credentials and non-ok github responses safely', async () => {
  assert.throws(
    () => createGitHubClient({ token: '', repository: repo, fetchImpl: fetch }),
    /token/i,
  );
  const client = createGitHubClient({
    token,
    repository: repo,
    fetchImpl: async () => new Response('<html>private upstream</html>', { status: 500 }),
  });
  await assert.rejects(() => client.listIssues(), (error) => {
    assert.equal(error.code, 'UPSTREAM_HTTP_ERROR');
    assert.doesNotMatch(String(error.message), /private upstream/);
    return true;
  });
});

test('duplicate detection never lets a later issue invalidate the first request', async () => {
  const issues = [
    { number: 12, body: requestBody('req_first123') },
    { number: 13, body: requestBody('req_first123') },
  ];
  const client = createGitHubClient({
    token,
    repository: repo,
    fetchImpl: async () => jsonResponse(200, issues),
  });
  assert.equal(await client.findRequestId('req_first123', 12), null);
  assert.deepEqual(await client.findRequestId('req_first123', 13), { issueNumber: 12 });
});

test('issue scan limit fails closed instead of allowing an incomplete duplicate check', async () => {
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ number: i + 1, body: 'not a request' }));
  const client = createGitHubClient({
    token,
    repository: repo,
    fetchImpl: async () => jsonResponse(200, fullPage),
  });
  await assert.rejects(
    () => client.listIssues(),
    (error) => error.code === 'ISSUE_SCAN_LIMIT',
  );
});

test('findExistingResult accepts only a bounded github-actions bot result comment', async () => {
  const result = {
    schema: 'kinotch-tool-result-v1', request_id: 'req_done1234',
    tool: 'semantic_compress', status: 'success', result: { compressed_text: 'x' }, provenance: {},
  };
  const comments = [
    { user: { login: 'kinoko34077', type: 'User' }, body: `\`\`\`json\n${JSON.stringify(result)}\n\`\`\`` },
    { user: { login: 'github-actions[bot]', type: 'Bot' }, body: 'not a bridge result' },
    { user: { login: 'github-actions[bot]', type: 'Bot' }, body: `\`\`\`json\n${JSON.stringify(result)}\n\`\`\`` },
  ];
  const client = createGitHubClient({
    token, repository: repo, fetchImpl: async (url) => {
      assert.match(String(url), /\/issues\/42\/comments\?/);
      return jsonResponse(200, comments);
    },
  });
  assert.deepEqual(await client.findExistingResult(42), result);
});
