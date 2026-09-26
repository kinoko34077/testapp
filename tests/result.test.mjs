import test from 'node:test';
import assert from 'node:assert/strict';

import {
  failureResult,
  safeErrorCode,
  serializeResultComment,
  successResult,
} from '../src/bridge/result.mjs';

const request = {
  schema: 'kinotch-tool-request-v1',
  request_id: 'req_12345678',
  tool: 'semantic_compress',
  parameters: { text: 'secret input', profile: 'compact-v1' },
};
const provenance = {
  workflow_run_id: 42,
  bridge_sha: 'a'.repeat(40),
  token: 'must-not-leak',
};

test('success result projects only allowlisted semantic fields', () => {
  const envelope = successResult({
    request,
    provenance,
    result: {
      compressed_text: 'compressed',
      profile: 'compact-v1',
      prompt_version: 'compact-v1.1',
      model: 'gemini-test',
      input_chars: 12,
      output_chars: 5,
      input_sha256: 'b'.repeat(64),
      output_sha256: 'c'.repeat(64),
      usage: { input_tokens: 10, output_tokens: 4, secret: 'x' },
      warnings: ['possible_negation_loss'],
      raw_body: '<html>secret</html>',
      authorization: 'Bearer abc',
    },
  });
  assert.equal(envelope.schema, 'kinotch-tool-result-v1');
  assert.equal(envelope.status, 'success');
  assert.equal(envelope.result.compressed_text, 'compressed');
  assert.equal(envelope.result.raw_body, undefined);
  assert.equal(envelope.result.authorization, undefined);
  assert.equal(envelope.result.usage.secret, undefined);
  assert.deepEqual(envelope.provenance, {
    workflow_run_id: 42,
    bridge_sha: 'a'.repeat(40),
  });
});

test('failure result exposes a stable code without raw errors', () => {
  const envelope = failureResult({
    requestId: 'req_12345678',
    tool: 'semantic_compress',
    status: 'tool_error',
    code: 'upstream_http_error',
    provenance,
    error: new Error('Bearer top-secret raw html'),
  });
  const serialized = JSON.stringify(envelope);
  assert.equal(envelope.status, 'tool_error');
  assert.deepEqual(envelope.result, { code: 'upstream_http_error' });
  assert.doesNotMatch(serialized, /top-secret|raw html|Bearer/);
});

test('serializeResultComment emits exactly one fenced json block', () => {
  const envelope = failureResult({
    requestId: 'req_12345678',
    tool: 'jev_audit',
    status: 'invalid_request',
    code: 'invalid_request',
    provenance: { workflow_run_id: 7, bridge_sha: 'd'.repeat(40) },
  });
  const comment = serializeResultComment(envelope);
  assert.equal((comment.match(/```json/g) ?? []).length, 1);
  assert.match(comment, /kinotch-tool-result-v1/);
});

test('safeErrorCode maps only bounded known categories', () => {
  assert.equal(safeErrorCode(Object.assign(new Error('timeout body'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(safeErrorCode(Object.assign(new Error('x'), { code: 'UPSTREAM_HTTP_ERROR' })), 'upstream_http_error');
  assert.equal(safeErrorCode(new Error('Bearer secret')), 'internal_error');
});

test('jev semantic status remains tool data, not bridge failure', () => {
  const envelope = successResult({
    request: { ...request, tool: 'jev_audit' },
    provenance: { workflow_run_id: 9, bridge_sha: 'e'.repeat(40) },
    result: {
      status: 'rework',
      risk: 0.82,
      coverage: { files_scanned: 3, secret: 'drop' },
      repository: 'kinoko34077/example',
      head_sha: 'f'.repeat(40),
      base_sha: '0'.repeat(40),
      source: 'raw source must drop',
    },
  });
  assert.equal(envelope.status, 'success');
  assert.equal(envelope.result.status, 'rework');
  assert.equal(envelope.result.source, undefined);
  assert.equal(envelope.result.coverage.secret, undefined);
});

test('jev findings are deeply projected and cannot carry source payloads', () => {
  const envelope = successResult({
    request: { ...request, tool: 'jev_audit' },
    provenance: { workflow_run_id: 10, bridge_sha: 'f'.repeat(40) },
    result: {
      status: 'review',
      risk: 0.8,
      repository: 'kinoko34077/example',
      head_sha: '1'.repeat(40),
      coverage: { files_scanned: 1 },
      findings: [{ index: 1, risk: 0.8, paths: ['src/a.py'], source: 'private source', raw: { secret: true } }],
    },
  });
  assert.equal(envelope.result.findings.length, 1);
  assert.deepEqual(envelope.result.findings[0], {
    index: 1,
    risk: 0.8,
    paths: ['src/a.py'],
  });
  assert.doesNotMatch(JSON.stringify(envelope), /private source|secret/);
});
