import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function docs() {
  const [readme, protocol] = await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../docs/REQUEST_PROTOCOL.md', import.meta.url), 'utf8'),
  ]);
  return `${readme}\n${protocol}`;
}

test('documents both bounded tools and request/result schemas', async () => {
  const text = await docs();
  for (const term of ['semantic_compress', 'jev_audit', 'kinotch-tool-request-v1', 'kinotch-tool-result-v1']) {
    assert.match(text, new RegExp(term));
  }
  assert.match(text, /normal ChatGPT|通常ChatGPT/i);
  assert.match(text, /mobile|スマホ/i);
  assert.match(text, /RDC/i);
});

test('documents privacy, credential, and capability boundaries', async () => {
  const text = await docs();
  assert.match(text, /private repository|private repo|非公開/i);
  assert.match(text, /COMPRESSION_API_TOKEN/);
  assert.match(text, /TYPESAFE_API_KEY/);
  assert.match(text, /public.*repository|public.*repo|公開repository/i);
  assert.match(text, /generic shell|arbitrary shell|任意.*shell/i);
  assert.match(text, /Actions Secrets|GitHub Actions Secrets/i);
  assert.doesNotMatch(text, /COMPRESSION_API_TOKEN\s*=\s*\S+/);
  assert.doesNotMatch(text, /TYPESAFE_API_KEY\s*=\s*\S+/);
});

test('protocol contains non-secret request examples for both tools', async () => {
  const text = await docs();
  assert.match(text, /"tool"\s*:\s*"semantic_compress"/);
  assert.match(text, /"tool"\s*:\s*"jev_audit"/);
  assert.match(text, /"mode"\s*:\s*"changed-only"/);
  assert.match(text, /"base_ref"/);
  assert.match(text, /issues:\s*opened|issues: opened/i);
});
