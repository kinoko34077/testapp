import test from 'node:test';
import assert from 'node:assert/strict';

import { runIssueRequest } from '../src/bridge/run-request.mjs';

function body(request) {
  return `Tool request\n\n\`\`\`json\n${JSON.stringify(request, null, 2)}\n\`\`\``;
}

function request(tool, parameters, requestId = 'req_12345678') {
  return {
    schema: 'kinotch-tool-request-v1',
    request_id: requestId,
    tool,
    parameters,
  };
}

function eventFor(requestBody) {
  return {
    action: 'opened',
    issue: {
      number: 42,
      body: requestBody,
      user: { login: 'kinoko34077' },
      author_association: 'OWNER',
    },
    repository: {
      full_name: 'kinoko34077/testapp',
      owner: { login: 'kinoko34077' },
    },
  };
}
function harness({ duplicate = null, semanticResult, jevResult, toolError } = {}) {
  const comments = [];
  const closed = [];
  const calls = { semantic: 0, jev: 0 };
  const githubClient = {
    findRequestId: async () => duplicate,
    postComment: async (number, value) => comments.push({ number, value }),
    closeIssue: async (number) => closed.push(number),
  };
  const dependencies = {
    createGitHubClient: () => githubClient,
    runSemanticCompress: async () => {
      calls.semantic += 1;
      if (toolError) throw toolError;
      return semanticResult ?? {
        compressed_text: 'short', profile: 'compact-v1', prompt_version: 'v1', model: 'm',
        input_chars: 10, output_chars: 5, input_sha256: 'a'.repeat(64), output_sha256: 'b'.repeat(64),
        usage: {}, warnings: [],
      };
    },
    runJevAudit: async () => {
      calls.jev += 1;
      if (toolError) throw toolError;
      return jevResult ?? {
        status: 'review', risk: 0.7, profile: 'development', model: 'jev',
        repository: 'kinoko34077/jev-audit', head_sha: 'c'.repeat(40),
        coverage: { files_scanned: 3 }, findings: [],
      };
    },
  };
  return { dependencies, comments, closed, calls };
}

const env = {
  GITHUB_TOKEN: 'github-token',
  GITHUB_REPOSITORY: 'kinoko34077/testapp',
  GITHUB_RUN_ID: '1234',
  GITHUB_SHA: 'd'.repeat(40),
  COMPRESSION_API_TOKEN: 'compression-token',
  TYPESAFE_API_KEY: 'typesafe-token',
};
test('valid semantic request executes once, posts one result, then closes', async () => {
  const h = harness();
  const req = request('semantic_compress', { text: 'long text', profile: 'compact-v1' });
  const result = await runIssueRequest({ event: eventFor(body(req)), env, dependencies: h.dependencies });
  assert.equal(result.status, 'success');
  assert.equal(h.calls.semantic, 1);
  assert.equal(h.calls.jev, 0);
  assert.equal(h.comments.length, 1);
  assert.equal(h.closed.length, 1);
  assert.equal(h.closed[0], 42);
  const parsed = JSON.parse(h.comments[0].value.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(parsed.request_id, 'req_12345678');
  assert.equal(parsed.status, 'success');
});

test('invalid and duplicate requests never call a tool', async () => {
  const invalid = harness();
  const invalidResult = await runIssueRequest({
    event: eventFor('```json\n{"schema":"wrong"}\n```'), env, dependencies: invalid.dependencies,
  });
  assert.equal(invalidResult.status, 'invalid_request');
  assert.equal(invalid.calls.semantic + invalid.calls.jev, 0);
  assert.equal(invalid.comments.length, 1);
  assert.deepEqual(invalid.closed, [42]);

  const duplicate = harness({ duplicate: { issueNumber: 12 } });
  const req = request('semantic_compress', { text: 'x', profile: 'compact-v1' });
  const duplicateResult = await runIssueRequest({ event: eventFor(body(req)), env, dependencies: duplicate.dependencies });
  assert.equal(duplicateResult.status, 'duplicate_request');
  assert.equal(duplicate.calls.semantic + duplicate.calls.jev, 0);
  assert.equal(duplicate.comments.length, 1);
  assert.deepEqual(duplicate.closed, [42]);
});
test('tool failure is projected safely and issue is finalized once', async () => {
  const error = Object.assign(new Error('Bearer secret upstream body'), { code: 'UPSTREAM_HTTP_ERROR' });
  const h = harness({ toolError: error });
  const req = request('semantic_compress', { text: 'x', profile: 'compact-v1' });
  const result = await runIssueRequest({ event: eventFor(body(req)), env, dependencies: h.dependencies });
  assert.equal(result.status, 'tool_error');
  assert.equal(result.result.code, 'upstream_http_error');
  assert.equal(h.comments.length, 1);
  assert.deepEqual(h.closed, [42]);
  assert.doesNotMatch(h.comments[0].value, /Bearer secret|upstream body/);
});

test('jev review rework and unknown remain bridge success', async () => {
  for (const semanticStatus of ['review', 'rework', 'unknown']) {
    const h = harness({
      jevResult: {
        status: semanticStatus,
        risk: 0.8,
        profile: 'development',
        model: 'jev-test',
        repository: 'kinoko34077/jev-audit',
        head_sha: 'e'.repeat(40),
        coverage: { files_scanned: 2 },
        findings: [],
      },
    });
    const req = request('jev_audit', {
      repository: 'kinoko34077/jev-audit',
      ref: 'main',
      mode: 'full',
      profile: 'development',
    }, `req_${semanticStatus}1234`);
    const result = await runIssueRequest({ event: eventFor(body(req)), env, dependencies: h.dependencies });
    assert.equal(result.status, 'success');
    assert.equal(result.result.status, semanticStatus);
    assert.equal(h.calls.jev, 1);
    assert.equal(h.comments.length, 1);
    assert.deepEqual(h.closed, [42]);
  }
});
test('rejects non-opened or non-owner issue events before tool execution', async () => {
  for (const mutate of [
    (event) => { event.action = 'edited'; },
    (event) => { event.issue.user.login = 'other-user'; event.issue.author_association = 'NONE'; },
    (event) => { event.issue.number = 0; },
  ]) {
    const h = harness();
    const req = request('semantic_compress', { text: 'x', profile: 'compact-v1' });
    const event = eventFor(body(req));
    mutate(event);
    await assert.rejects(
      () => runIssueRequest({ event, env, dependencies: h.dependencies }),
      /event|issue|owner/i,
    );
    assert.equal(h.calls.semantic + h.calls.jev, 0);
    assert.equal(h.comments.length, 0);
  }
});
