import test from 'node:test';
import assert from 'node:assert/strict';

import { runSemanticCompress } from '../src/bridge/semantic-compress.mjs';
import { jsonResponse } from './helpers.mjs';

function success(overrides = {}) {
  return {
    compressed_text: '圧縮済み',
    profile: 'compact-v1',
    prompt_version: 'compact-v1.1',
    model: 'gemini-3.5-flash-lite',
    input_chars: 4,
    output_chars: 4,
    input_sha256: 'a'.repeat(64),
    output_sha256: 'b'.repeat(64),
    usage: {
      input_tokens: 10,
      system_prompt_tokens: 5,
      content_input_tokens: 5,
      output_tokens: 4,
      thought_tokens: 0,
      cached_tokens: 0,
      total_tokens: 14,
    },
    warnings: [],
    ...overrides,
  };
}
test('calls only the fixed compression endpoint contract', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse(200, success({ raw_secret: 'drop' }));
  };
  const result = await runSemanticCompress(
    { text: '圧縮対象', profile: 'compact-v1' },
    { token: 'compression-secret', fetchImpl },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.kinotch.workers.dev/v1/compress');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer compression-secret');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    text: '圧縮対象',
    profile: 'compact-v1',
  });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.raw_secret, undefined);
  assert.equal(result.compressed_text, '圧縮済み');
});

test('preserves supplementary-plane unicode and enforces code-point limit', async () => {
  const exact = '😀'.repeat(200_000);
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return jsonResponse(200, success({ input_chars: 200_000 }));
  };
  await runSemanticCompress(
    { text: exact, profile: 'compact-v1' },
    { token: 'x', fetchImpl },
  );
  assert.equal(Array.from(body.text).length, 200_000);
  await assert.rejects(
    () => runSemanticCompress(
      { text: `${exact}x`, profile: 'compact-v1' },
      { token: 'x', fetchImpl },
    ),
    /200000/,
  );
});

test('rejects non-2xx and malformed upstream responses without copying body', async () => {
  await assert.rejects(
    () => runSemanticCompress(
      { text: 'x', profile: 'compact-v1' },
      {
        token: 'x',
        fetchImpl: async () => new Response('<html>Bearer leaked</html>', { status: 502 }),
      },
    ),
    (error) => {
      assert.equal(error.code, 'UPSTREAM_HTTP_ERROR');
      assert.doesNotMatch(error.message, /Bearer|leaked/);
      return true;
    },
  );
  await assert.rejects(
    () => runSemanticCompress(
      { text: 'x', profile: 'compact-v1' },
      { token: 'x', fetchImpl: async () => jsonResponse(200, { profile: 'compact-v1' }) },
    ),
    (error) => error.code === 'UPSTREAM_RESPONSE_INVALID',
  );
});

test('maps aborted provider calls to timeout', async () => {
  await assert.rejects(
    () => runSemanticCompress(
      { text: 'x', profile: 'compact-v1' },
      {
        token: 'x',
        fetchImpl: async () => {
          throw Object.assign(new Error('provider details'), { name: 'TimeoutError' });
        },
      },
    ),
    (error) => error.code === 'TIMEOUT' && !/provider details/.test(error.message),
  );
});
