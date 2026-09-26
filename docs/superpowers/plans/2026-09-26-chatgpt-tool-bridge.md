# ChatGPT Tool Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the private GitHub Issue → GitHub Actions → custom tool → private Issue result bridge for Semantic Compression and Jev Audit, usable from normal ChatGPT/mobile without RDC.

**Architecture:** `kinoko34077/testapp` is the private mailbox/orchestration repository. A dedicated `issues: opened` workflow validates one fenced JSON request envelope, serializes requests to make duplicate detection deterministic, dispatches only `semantic_compress` or `jev_audit`, and posts exactly one bounded structured result back to the originating Issue. Tool semantics remain owned by `kinotch-api` and `jev-audit`; this repository contains only transport, validation, thin adapters, safe projection, and CI.

**Tech Stack:** Node.js 26.10.0, built-in `node:test`, built-in `fetch`, `child_process.spawn`, GitHub Actions, GitHub REST API, Python 3.10+ only for the installed Jev CLI runtime.

**Spec:** `docs/superpowers/specs/2026-09-26-chatgpt-tool-bridge-design.md`

## Global Constraints

- Repository remains private; arbitrary request/result text must never be copied to public repositories, public Issues, public Actions summaries, or public artifacts.
- Initial request schema is `kinotch-tool-request-v1`; initial result schema is `kinotch-tool-result-v1`.
- Initial tools are exactly `semantic_compress` and `jev_audit`.
- Unknown top-level fields, unknown tool values, unsupported tool parameters, malformed JSON, and invalid identifiers fail closed before external/provider work.
- No generic prompt/model/provider override, shell command, executable path, environment assignment, or arbitrary CLI fragment may be supplied by request payload.
- Semantic Compression calls only `POST https://api.kinotch.workers.dev/v1/compress` with `COMPRESSION_API_TOKEN` from Actions Secrets.
- Semantic Compression request fields remain exactly `text` and `profile`; profiles remain `compact-v1` and `semantic-dense-v1`.
- Semantic Compression bridge-side input limit is 200,000 Unicode code points and must remain within the current 2.5 MiB API body limit.
- Jev v1 supports public GitHub repositories only. Private target-repository checkout is out of scope until a least-privilege credential design is approved.
- Jev profiles are exactly `development` and `generic` in this bridge version.
- Jev full mode audits the resolved target head SHA. Jev changed-only mode requires `base_ref` and depends on the sibling `jev-audit#9` explicit-base support plan before E2E acceptance.
- Workflow permissions start at `contents: read`, `issues: write` only.
- All bridge request workflows are serialized with one repository-wide concurrency group and `cancel-in-progress: false`; this makes duplicate-request checks race-free in v1.
- `COMPRESSION_API_TOKEN` and `TYPESAFE_API_KEY` are never committed, logged, echoed, included in summaries, or returned in Issue comments.
- Production service deploy/release, secret creation/rotation, and repository permission/security changes are not part of implementation.
- Production code follows RED → verify RED → GREEN → verify GREEN → refactor; no production function is added before its failing test exists.

## Review Focus

- Two Issues opened nearly simultaneously with the same `request_id`: only the first may execute provider-backed work; the second returns `duplicate_request`.
- A Semantic Compression request containing Japanese supplementary-plane characters near the 200,000-code-point boundary: validation counts Unicode code points rather than UTF-16 code units and does not exceed the API wire limit.
- A crafted repository/ref such as `owner/repo;rm -rf /` or `$(...)`: validation rejects it and no shell-interpreted execution path exists.
- An upstream response containing bearer-token-like data or a raw HTML/error body: safe projection must not copy it verbatim to the private Issue result.
- A Jev semantic result of `review`, `rework`, or `unknown`: workflow infrastructure still completes successfully and returns the Jev semantic status as data.

---

### Task 1: Runtime and test harness

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tests/helpers.mjs`
- Modify later: `README.md`

**Interfaces:**
- Consumes: Node.js 26.10.0 runtime.
- Produces: `npm test` running `node --test`; shared test helpers for fake fetch/spawn/event fixtures.

- [ ] **Step 1: Add a failing repository smoke test**

Create `tests/repository.test.mjs` asserting `package.json` declares `type: module`, Node `>=26.10.0`, and `npm test` maps to `node --test`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/repository.test.mjs`

Expected: FAIL because `package.json` does not exist.

- [ ] **Step 3: Add the minimal runtime scaffold**

Create `package.json` with no runtime dependencies, `type: "module"`, `engines.node: ">=26.10.0"`, and `scripts.test: "node --test"`. Add `.gitignore` for `node_modules/`, `.tmp/`, coverage/test scratch files, and local secret files.

- [ ] **Step 4: Verify GREEN and full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `chore: add bridge node test harness`

### Task 2: Request extraction and strict v1 validation

**Files:**
- Create: `src/bridge/request.mjs`
- Create: `tests/request.test.mjs`

**Interfaces:**
- Produces:
  - `extractRequestEnvelope(issueBody: string) -> unknown`
  - `validateRequestEnvelope(value: unknown) -> ValidatedRequest`
  - `countCodePoints(text: string) -> number`
- `ValidatedRequest` is one of:
  - `{ schema, request_id, tool: "semantic_compress", parameters: { text, profile } }`
  - `{ schema, request_id, tool: "jev_audit", parameters: { repository, ref, mode, profile, base_ref? } }`

- [ ] **Step 1: Write failing parser/validation tests**

Cover: exactly one fenced `json` block; malformed/multiple/no JSON blocks; exact top-level fields; `request_id` bounded opaque format; allowed tool values; Semantic Compression exact fields/profile/non-empty text/200,000-code-point limit; Jev exact fields; repository `owner/name` format; bounded safe ref; `mode` in `full|changed-only`; `base_ref` required only for changed-only; profile in `development|generic`; injected shell/CLI/environment fields rejected.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/request.test.mjs`

Expected: FAIL because request module does not exist.

- [ ] **Step 3: Implement minimal request parser and validator**

Use JSON parsing and explicit key-set comparison only. Do not use `eval`, shell parsing, YAML, or permissive object spreading. Count code points with `Array.from(text).length` or an equivalent code-point iterator.

- [ ] **Step 4: Verify GREEN and suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: validate bounded tool requests`

### Task 3: Result envelope and safe error projection

**Files:**
- Create: `src/bridge/result.mjs`
- Create: `tests/result.test.mjs`

**Interfaces:**
- Produces:
  - `successResult({ request, result, provenance }) -> ToolResultEnvelope`
  - `failureResult({ requestId, tool, status, code, provenance }) -> ToolResultEnvelope`
  - `serializeResultComment(envelope) -> string`
  - `safeErrorCode(error) -> string`
- Allowed statuses: `success`, `invalid_request`, `duplicate_request`, `tool_error`, `bridge_error`.

- [ ] **Step 1: Write failing result/redaction tests**

Assert exact schema/status enums, no raw Error stack/upstream body, no environment/token field leakage, one fenced JSON result block, and Jev semantic statuses remain nested tool data rather than bridge failure status.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/result.test.mjs`

Expected: FAIL because result module does not exist.

- [ ] **Step 3: Implement minimal result helpers**

Project only allowlisted fields. Errors become stable bounded codes such as `invalid_request`, `upstream_http_error`, `timeout`, `git_error`, `jev_error`, `internal_error`.

- [ ] **Step 4: Verify GREEN and suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add safe structured tool results`

### Task 4: Private GitHub mailbox and deterministic idempotency

**Files:**
- Create: `src/bridge/github.mjs`
- Create: `tests/github.test.mjs`

**Interfaces:**
- Produces:
  - `createGitHubClient({ token, repository, fetchImpl })`
  - client methods `listIssues()`, `postComment(issueNumber, body)`, `closeIssue(issueNumber)`, `findRequestId(requestId, currentIssueNumber)`.

- [ ] **Step 1: Write failing GitHub client tests**

Use an injected fake `fetchImpl`. Cover pagination, authenticated headers, issue comment endpoint, close endpoint, and duplicate detection that parses prior Issue bodies without logging them. Confirm current Issue is excluded from duplicate matches.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/github.test.mjs`

Expected: FAIL because GitHub client does not exist.

- [ ] **Step 3: Implement minimal GitHub REST client**

Use `Authorization: Bearer <GITHUB_TOKEN>`, GitHub API version header, and bounded pagination. No request/result body is logged.

- [ ] **Step 4: Verify GREEN and suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add private github mailbox client`

### Task 5: Semantic Compression adapter

**Files:**
- Create: `src/bridge/semantic-compress.mjs`
- Create: `tests/semantic-compress.test.mjs`

**Interfaces:**
- Produces: `runSemanticCompress(parameters, { token, fetchImpl, endpoint = "https://api.kinotch.workers.dev/v1/compress" }) -> Promise<SemanticCompressionResult>`.

- [ ] **Step 1: Write failing adapter tests**

Assert POST method, exact `text`/`profile` body, bearer auth, JSON content type, timeout handling, accepted success schema, bounded allowlisted result fields, and generic safe failure on non-2xx/malformed upstream data. Include supplementary-plane Unicode boundary coverage.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/semantic-compress.test.mjs`

Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement minimal adapter**

Use built-in `fetch` and `AbortSignal.timeout(55_000)`. Never print request text, compressed text, token, or raw upstream error body.

- [ ] **Step 4: Verify GREEN and suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add semantic compression adapter`

### Task 6: Jev public-repository adapter

**Files:**
- Create: `src/bridge/jev-audit.mjs`
- Create: `tests/jev-audit.test.mjs`

**Interfaces:**
- Produces:
  - `preparePublicRepository(parameters, { spawnImpl, workDir }) -> Promise<{ targetDir, headSha, baseSha? }>`
  - `runJevAudit(parameters, { spawnImpl, workDir, typesafeApiKey }) -> Promise<JevBridgeResult>`
- External executable calls use `spawn(command, args, { shell: false, ... })` only.

- [ ] **Step 1: Write failing repository/ref and process-argument tests**

Cover safe public GitHub URL construction, no shell interpolation, exact head SHA resolution, full-mode checkout, changed-only base/head resolution, Jev profile allowlist, and CLI invocation with `--json --fail-on never`. Changed-only must pass the sibling Jev explicit-base option defined by `jev-audit#9`; do not simulate base→head by mutating Git HEAD/provenance.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/jev-audit.test.mjs`

Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement minimal Git/CLI orchestration**

Use child-process argument arrays and a request-scoped temporary directory. Full mode checks out resolved head. Changed-only checks out resolved head and invokes Jev with the explicit base ref once the sibling feature is available. The bridge returns its own `{ repository, head_sha, base_sha }` provenance alongside allowlisted Jev report fields.

- [ ] **Step 4: Verify GREEN using a fake spawn, then run full suite**

Run: `npm test`

Expected: PASS without network/provider calls.

- [ ] **Step 5: Commit**

Commit message: `feat: add jev audit repository adapter`

### Task 7: Request orchestrator and Issue lifecycle

**Files:**
- Create: `src/bridge/run-request.mjs`
- Create: `scripts/run-request.mjs`
- Create: `tests/integration.test.mjs`

**Interfaces:**
- Produces:
  - `runIssueRequest({ event, env, dependencies }) -> Promise<ToolResultEnvelope>`
  - CLI entry `node scripts/run-request.mjs <event-json-path>`.

- [ ] **Step 1: Write failing integration tests**

Cover valid Semantic Compression request, valid Jev request, malformed request with zero tool calls, duplicate ID with zero tool calls, upstream tool failure, exactly one final comment, Issue close after final comment, and semantic Jev `review/rework/unknown` returning bridge `success`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/integration.test.mjs`

Expected: FAIL because orchestrator does not exist.

- [ ] **Step 3: Implement minimal orchestrator**

Read the GitHub event JSON, require `issues.opened`, validate the Issue author/number/body, perform duplicate check, dispatch one allowlisted adapter, post one structured result comment, and close the Issue. Do not log request/result payloads.

- [ ] **Step 4: Verify GREEN and suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: orchestrate private tool requests`

### Task 8: Actions request workflow and repository CI

**Files:**
- Create: `.github/workflows/tool-request.yml`
- Create: `.github/workflows/ci.yml`
- Create: `tests/workflow.test.mjs`

**Interfaces:**
- `tool-request.yml` consumes private `issues: opened` events and `COMPRESSION_API_TOKEN` / `TYPESAFE_API_KEY` secrets.
- `ci.yml` runs deterministic `npm test` on push/PR.

- [ ] **Step 1: Write failing workflow contract tests**

Read YAML as text and assert required trigger, `permissions: contents: read` + `issues: write`, repository-wide serialized concurrency with `cancel-in-progress: false`, finite timeout, Node 26.10.0 setup, no `pull_request_target`, no `run:` interpolation of Issue body, and no artifact/job-summary upload of private payloads.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workflow.test.mjs`

Expected: FAIL because workflows do not exist.

- [ ] **Step 3: Add minimal workflows**

Use GitHub-owned pinned Actions consistent with current project practice. `tool-request.yml` checks out this bridge code, sets up Node 26.10.0 and Python, installs the pinned Jev runtime required by `jev-audit#9`, then executes `node scripts/run-request.mjs "$GITHUB_EVENT_PATH"`. Pass secrets only through `env`, never command arguments or workflow outputs.

- [ ] **Step 4: Verify GREEN and suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `ci: add private tool request workflow`

### Task 9: User-facing repository entry point and deterministic verification

**Files:**
- Modify: `README.md`
- Create: `docs/REQUEST_PROTOCOL.md`
- Create: `tests/docs.test.mjs`

**Interfaces:**
- Documents exact normal-chat request envelope examples for `semantic_compress` and `jev_audit`, result schema, privacy boundary, required secret names, and unsupported operations.

- [ ] **Step 1: Write failing documentation contract test**

Assert documentation names both tools, both schemas, private-repo-only transport, required secret names, no secret values, no generic shell capability, and explicit public-target-only Jev v1 limitation.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/docs.test.mjs`

Expected: FAIL until docs are updated.

- [ ] **Step 3: Write concise README/protocol docs**

Keep examples non-sensitive. State that normal ChatGPT/mobile creates the request Issue; users do not need RDC. State that secrets must be added manually in repository Actions Secrets before live provider E2E.

- [ ] **Step 4: Run complete deterministic verification**

Run: `npm test`

Expected: all tests PASS with no provider/network credentials required.

- [ ] **Step 5: Commit**

Commit message: `docs: document chatgpt tool bridge protocol`

### Task 10: PR verification and live E2E handoff

**Files:**
- No new production files unless verification finds a defect; defects require a new failing test first.
- Update: `testapp#1`, `devflow#32`, `devflow#86`, `kinotch-api#31`, `jev-audit#9` with evidence only after relevant verification.

**Interfaces:**
- Deterministic implementation is complete before credentials are required.
- Live E2E additionally requires repository Actions Secrets `COMPRESSION_API_TOKEN` and `TYPESAFE_API_KEY` to exist.

- [ ] **Step 1: Run full local/CI-equivalent suite**

Run: `npm test`

Expected: PASS with pristine output.

- [ ] **Step 2: Open implementation PR and inspect Actions**

Verify CI passes and review the exact diff for private-data logging, shell injection, permission expansion, and unbounded provider calls.

- [ ] **Step 3: Stop at the credential boundary if secrets are absent**

Record the exact required user/admin action: add `COMPRESSION_API_TOKEN` and `TYPESAFE_API_KEY` to `kinoko34077/testapp` Actions Secrets. Do not create/rotate credentials from the implementation flow.

- [ ] **Step 4: Run real normal-chat/mobile E2E once secrets exist**

From normal ChatGPT/mobile, create one benign `semantic_compress` request and read the result; create one Jev full request against a public repository and read the result; create one Jev changed-only request with explicit base/head and read the exact provenance; create one invalid request and prove no provider call occurred.

- [ ] **Step 5: Reconcile canonical state**

Only after successful evidence, update `testapp#1` and `devflow#32/#86`; update `kinotch-api#31` to record no service code change if the existing REST contract remained sufficient; update `jev-audit#9` with the accepted explicit-base implementation/verification evidence.
