import test from 'node:test';
import assert from 'node:assert/strict';
import { admitPublicCompression, assertPublicTextPreflight, TRUSTED_OWNER_ID } from '../src/bridge/public-request.mjs';

const request = () => ({
  schema: 'kinotch-tool-request-v2',
  request_id: 'req_public12345678',
  tool: 'semantic_compress',
  parameters: { text: '一般公開できる商品説明を短くする。', profile: 'semantic-dense-v1' },
  data_classification: 'public_non_sensitive',
  acknowledge_public_disclosure: true,
});
const fence = (value) => ```json\n${JSON.stringify(value)}\n```;
function eventFor(payload = request()) {
  return {
    action: 'opened',
    repository: {
      full_name: 'kinoko34077/testapp',
      private: false,
      owner: { login: 'kinoko34077', id: TRUSTED_OWNER_ID },
    },
    issue: {
      number: 1234, title: '[TOOL REQUEST] public compression',
      user: { login: 'kinoko34077', id: TRUSTED_OWNER_ID },
      author_association: 'OWNER',
      body: fence(payload),
    },
    sender: { login: 'kinoko34077', id: TRUSTED_OWNER_ID },
  };
}

test('public v2 compression admits only owner with explicit publication acknowledgement', () => {
  assert.deepEqual(admitPublicCompression(eventFor()), request());
});
test('public admission rejects private v1 and missing/false publication acknowledgement', () => {
  const v1 = request();
  delete v1.data_classification;
  delete v1.acknowledge_public_disclosure;
  v1.schema = 'kinotch-tool-request-v1';
  assert.throws(() => admitPublicCompression(eventFor(v1)));
  for (const value of [false, undefined]) {
    const payload = request();
    if (value === undefined) delete payload.acknowledge_public_disclosure;
    else payload.acknowledge_public_disclosure = value;
    assert.throws(() => admitPublicCompression(eventFor(payload)));
  }
});
test('public path denies Jev, arbitrary fields, extra prose or multiple JSON fences', () => {
  const jev = request();
  jev.tool = 'jev_audit';
  jev.parameters = { repository: 'kinoko34077/testapp', ref: 'main', mode: 'full', profile: 'development' };
  assert.throws(() => admitPublicCompression(eventFor(jev)));
  const custom = request(); custom.custom_prompt = 'bypass';
  assert.throws(() => admitPublicCompression(eventFor(custom)));
  const e = eventFor();
  e.issue.body = 'extra\n' + e.issue.body;
  assert.throws(() => admitPublicCompression(e));
  e.issue.body = fence(request()) + '\n' + fence(request());
  assert.throws(() => admitPublicCompression(e));
});
test('public admission fails closed for wrong identity, repository, action or visibility', () => {
  for (const mutate of [
    (e) => { e.issue.user.id = 123; },
    (e) => { e.repository.owner.id = 123; },
    (e) => { e.sender.id = 123; },
    (e) => { e.issue.user.login = 'other'; },
    (e) => { e.issue.author_association = 'COLLABORATOR'; },
    (e) => { e.repository.private = true; },
    (e) => { e.repository.full_name = 'other/testapp'; },
    (e) => { e.action = 'edited'; },
    (e) => { e.issue.title = '[TASK] normal issue'; },
  ]) {
    const e = eventFor();
    mutate(e);
    assert.throws(() => admitPublicCompression(e));
  }
});
test('public preflight rejects high-signal secrets, emails, private links and filesystem homes', () => {
  for (const s of [
    '-----BEGIN PRIVATE KEY-----\nnot-real\n-----END PRIVATE KEY-----',
    'github_pat_' + 'A'.repeat(24),
    'sk-proj-' + 'x'.repeat(30),
    'Bearer ' + 'X'.repeat(24),
    'password=example-secret-value',
    'https://drive.google.com/file/d/0123456/view',
    'https://github.com/kinoko34077/kinotch-knowledge/issues/42',
    'contact@sample.example',
    'C:\\Users\\example\\private.txt',
    '080-1234-5678',
  ]) {
    assert.throws(() => assertPublicTextPreflight(s), /protected-content/);
    const e = eventFor();
    e.issue.body = fence({ ...request(), parameters: { text: s, profile: 'compact-v1' } });
    assert.throws(() => admitPublicCompression(e));
  }
});
test('plain public text is accepted; preflight is not a proof of confidentiality', () => {
  assert.equal(assertPublicTextPreflight('一般公開のイベント説明、公開済み仕様、製品紹介。'), true);
});
