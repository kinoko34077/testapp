import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA = '820762786026740c76f36085b0efc47a31fe5020';
const SETUP_PYTHON_SHA = '5fda3b95a4ea91299a34e894583c3862153e4b97';
const JEV_SHA = 'e05481517eb05c39112b092d03fd883951f2b97f';

async function workflow(name) {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
}

test('tool request workflow has bounded issue trigger and least privilege', async () => {
  const text = await workflow('tool-request.yml');
  assert.match(text, /issues:\s*\n\s*types:\s*\[opened\]/);
  assert.match(text, /permissions:\s*\n\s*contents:\s*read\s*\n\s*issues:\s*write/);
  assert.match(text, /group:\s*kinotch-tool-bridge-v1/);
  assert.match(text, /cancel-in-progress:\s*false/);
  assert.match(text, /timeout-minutes:\s*20/);
  assert.match(text, /github\.event\.repository\.private\s*==\s*true/);
  assert.match(text, /github\.event\.issue\.author_association\s*==\s*['"]OWNER['"]/);
  assert.match(text, /startsWith\(github\.event\.issue\.title,\s*['"]\[TOOL REQUEST\] ['"]\)/);
  assert.doesNotMatch(text, /MEMBER|COLLABORATOR/);
  assert.doesNotMatch(text, /pull_request_target/);
});

test('tool workflow pins actions and runtime versions', async () => {
  const text = await workflow('tool-request.yml');
  assert.match(text, new RegExp(`actions/checkout@${CHECKOUT_SHA}`));
  assert.match(text, new RegExp(`actions/setup-node@${SETUP_NODE_SHA}`));
  assert.match(text, new RegExp(`actions/setup-python@${SETUP_PYTHON_SHA}`));
  assert.match(text, /node-version:\s*['"]?26\.10\.0['"]?/);
  assert.match(text, /python-version:\s*['"]?3\.12['"]?/);
  assert.match(text, new RegExp(`jev-audit\\.git@${JEV_SHA}`));
});

test('private payloads are not interpolated into shell summaries or artifacts', async () => {
  const text = await workflow('tool-request.yml');
  assert.doesNotMatch(text, /github\.event\.issue\.body/);
  assert.doesNotMatch(text, /upload-artifact|GITHUB_STEP_SUMMARY/);
  assert.match(text, /node scripts\/run-request\.mjs "\$GITHUB_EVENT_PATH"/);
  assert.match(text, /COMPRESSION_API_TOKEN:\s*\$\{\{\s*secrets\.COMPRESSION_API_TOKEN\s*\}\}/);
  assert.match(text, /TYPESAFE_API_KEY:\s*\$\{\{\s*secrets\.TYPESAFE_API_KEY\s*\}\}/);
  assert.match(text, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
});

test('ci workflow is read-only and runs deterministic tests on node 26.10.0', async () => {
  const text = await workflow('ci.yml');
  assert.match(text, /pull_request:/);
  assert.match(text, /push:/);
  assert.match(text, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(text, new RegExp(`actions/checkout@${CHECKOUT_SHA}`));
  assert.match(text, new RegExp(`actions/setup-node@${SETUP_NODE_SHA}`));
  assert.match(text, /node-version:\s*['"]?26\.10\.0['"]?/);
  assert.match(text, /npm test/);
  assert.doesNotMatch(text, /issues:\s*write|secrets\./);
});

test('checkout never persists the workflow token into git config', async () => {
  for (const name of ['tool-request.yml', 'ci.yml']) {
    const text = await workflow(name);
    assert.match(text, /persist-credentials:\s*false/);
  }
});

test('public compression has secret-free admission and no Jev/TypeSafe capability', async () => {
  const text = await workflow('tool-request.yml');
  const admission = text.split('\n  public_admission:')[1]?.split('\n  public_compress:')[0];
  const publicRun = text.split('\n  public_compress:')[1];
  const privateRun = text.split('\n  private_bridge:')[1]?.split('\n  public_admission:')[0];
  assert.ok(admission && publicRun && privateRun, 'private and public jobs must remain isolated');
  assert.match(admission, /github\.event\.repository\.private\s*==\s*false/);
  assert.match(admission, /github\.event\.issue\.user\.id\s*==\s*79015263/);
  assert.match(admission, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(admission, /node scripts\/check-public-request\.mjs/);
  assert.doesNotMatch(admission, /issues:\s*write|secrets\.|TYPESAFE_API_KEY|COMPRESSION_API_TOKEN/);
  assert.match(publicRun, /needs:\s*public_admission/);
  assert.match(publicRun, /needs\.public_admission\.result\s*==\s*'success'/);
  assert.match(publicRun, /github\.event\.issue\.user\.id\s*==\s*79015263/);
  assert.match(publicRun, /COMPRESSION_API_TOKEN:\s*\$\{\{\s*secrets\.COMPRESSION_API_TOKEN\s*\}\}/);
  assert.doesNotMatch(publicRun, /TYPESAFE_API_KEY|Install Jev Audit|setup-python|\.\.\/\./);
  assert.match(privateRun, /github\.event\.repository\.private\s*==\s*true/);
  assert.match(privateRun, /TYPESAFE_API_KEY/);
});
