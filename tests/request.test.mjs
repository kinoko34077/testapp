import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countCodePoints,
  extractRequestEnvelope,
  validateRequestEnvelope,
} from '../src/bridge/request.mjs';

function fenced(value) {
  return `request\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

const base = {
  schema: 'kinotch-tool-request-v1',
  request_id: 'req_12345678',
};

function compress(overrides = {}) {
  return {
    ...base,
    tool: 'semantic_compress',
    parameters: { text: '圧縮対象', profile: 'semantic-dense-v1' },
    ...overrides,
  };
}
function jev(overrides = {}) {
  return {
    ...base,
    tool: 'jev_audit',
    parameters: {
      repository: 'kinoko34077/jev-audit',
      ref: 'main',
      mode: 'full',
      profile: 'development',
    },
    ...overrides,
  };
}

test('extracts exactly one fenced json request envelope', () => {
  const request = compress();
  assert.deepEqual(extractRequestEnvelope(fenced(request)), request);
  assert.throws(() => extractRequestEnvelope('no json block'), /exactly one/i);
  assert.throws(
    () => extractRequestEnvelope(`${fenced(request)}\n${fenced(request)}`),
    /exactly one/i,
  );
  assert.throws(() => extractRequestEnvelope('```json\n{broken}\n```'), /invalid json/i);
});

test('validates exact semantic compression schema', () => {
  assert.deepEqual(validateRequestEnvelope(compress()), compress());
  assert.deepEqual(
    validateRequestEnvelope(
      compress({ parameters: { text: 'x', profile: 'compact-v1' } }),
    ).parameters.profile,
    'compact-v1',
  );
  assert.throws(() => validateRequestEnvelope({ ...compress(), extra: true }), /fields/i);
  assert.throws(
    () => validateRequestEnvelope(compress({ request_id: 'bad id' })),
    /request_id/i,
  );
  assert.throws(
    () => validateRequestEnvelope(compress({ tool: 'shell' })),
    /tool/i,
  );
  assert.throws(
    () => validateRequestEnvelope(compress({ parameters: { text: '', profile: 'compact-v1' } })),
    /text/i,
  );
  assert.throws(
    () => validateRequestEnvelope(compress({ parameters: { text: 'x', profile: 'other' } })),
    /profile/i,
  );
  assert.throws(
    () => validateRequestEnvelope(compress({ parameters: { text: 'x', profile: 'compact-v1', model: 'x' } })),
    /fields/i,
  );
});

test('counts unicode code points and enforces compression limit', () => {
  assert.equal(countCodePoints('A😀𠮷'), 3);
  const exact = '😀'.repeat(200_000);
  assert.equal(validateRequestEnvelope(
    compress({ parameters: { text: exact, profile: 'compact-v1' } }),
  ).parameters.text, exact);
  assert.throws(
    () => validateRequestEnvelope(
      compress({ parameters: { text: `${exact}x`, profile: 'compact-v1' } }),
    ),
    /200000/i,
  );
});

test('validates bounded jev full and changed-only requests', () => {
  assert.deepEqual(validateRequestEnvelope(jev()), jev());
  const changed = jev({
    parameters: {
      repository: 'kinoko34077/jev-audit',
      ref: 'feature/a.b-c_1',
      mode: 'changed-only',
      base_ref: 'main',
      profile: 'generic',
    },
  });
  assert.deepEqual(validateRequestEnvelope(changed), changed);
  assert.throws(
    () => validateRequestEnvelope(jev({ parameters: { ...jev().parameters, mode: 'changed-only' } })),
    /base_ref/i,
  );
  assert.throws(
    () => validateRequestEnvelope(jev({ parameters: { ...jev().parameters, base_ref: 'main' } })),
    /base_ref/i,
  );
  assert.throws(
    () => validateRequestEnvelope(jev({ parameters: { ...jev().parameters, profile: 'custom' } })),
    /profile/i,
  );
});

test('rejects unsafe repository refs and injected execution fields', () => {
  for (const repository of ['owner/repo;rm-rf', 'owner', '../repo', 'owner/repo extra']) {
    assert.throws(
      () => validateRequestEnvelope(jev({ parameters: { ...jev().parameters, repository } })),
      /repository/i,
    );
  }
  for (const ref of ['$(touch pwn)', 'main;rm', '--help', 'a..b', 'a b']) {
    assert.throws(
      () => validateRequestEnvelope(jev({ parameters: { ...jev().parameters, ref } })),
      /ref/i,
    );
  }
  assert.throws(
    () => validateRequestEnvelope(jev({ parameters: { ...jev().parameters, command: 'rm -rf /' } })),
    /fields/i,
  );
  assert.throws(
    () => validateRequestEnvelope({ ...jev(), env: { TYPESAFE_API_KEY: 'x' } }),
    /fields/i,
  );
});
