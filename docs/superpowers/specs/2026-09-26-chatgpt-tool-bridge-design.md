# ChatGPT Tool Bridge Design

Status: proposed design for review  
Date: 2026-09-26  
Owning Issue: `testapp#1`  
Parent Work Order: `devflow#86`  
Related Issues: `kinotch-api#31`, `jev-audit#9`

## 1. Purpose

Repurpose the private repository `kinoko34077/testapp` into a bounded GitHub-native tool bridge that allows the normal ChatGPT conversation surface, including the mobile app, to invoke KiNoTch. custom tools without RDC or a machine-local agent being online.

The first supported tools are:

1. Semantic Compression（超圧縮）through the existing `kinotch-api` Production REST contract.
2. Jev Audit for explicit GitHub repository/ref scopes, preserving existing Jev Audit semantics.

From the user's perspective this behaves like a plugin/tool layer: the user asks for a supported operation in normal chat, ChatGPT emits a bounded request, the bridge executes it, and ChatGPT reads the result back. It is not an OpenAI Plugin registration; GitHub Issues and GitHub Actions provide the transport and execution orchestration.

## 2. Success criteria

The design is accepted only if all of the following can be implemented and verified:

- A normal ChatGPT/mobile conversation can initiate a supported request using GitHub operations exposed by the current ChatGPT GitHub connector.
- No RDC or self-hosted runner is required for the normal path.
- One private Issue represents one request and one correlated final result.
- GitHub Actions executes only allowlisted tool adapters and parameters.
- Semantic Compression calls the existing `POST /v1/compress` contract rather than reimplementing compression logic.
- Jev Audit operates on an explicit repository/ref and records exact audited SHA provenance.
- Private source text/results remain inside the private bridge repository and provider/service boundaries already required by the underlying tool.
- Secrets never appear in Issue content, repository files, logs, summaries, or result comments.
- Unknown fields, unsupported tools, duplicate request IDs, and malformed payloads fail closed before external/provider work.
- The result is readable through the normal ChatGPT GitHub connector and can be correlated to the originating request.

## 3. Architecture

```text
Normal ChatGPT / mobile
        |
        | GitHub connector: create private Issue
        v
kinoko34077/testapp (private)
        |
        | issues: opened
        v
GitHub Actions request workflow
        |
        +--> validate envelope / caller / tool / limits
        |
        +--> semantic-compress adapter
        |      |
        |      +--> POST https://api.kinotch.workers.dev/v1/compress
        |
        +--> jev-audit adapter
               |
               +--> resolve exact GitHub ref/SHA
               +--> checkout allowed target
               +--> execute approved Jev Audit path
        |
        v
bounded result envelope
        |
        | GitHub API using workflow GITHUB_TOKEN
        v
originating private Issue comment
        |
        v
Normal ChatGPT reads result
```

GitHub Actions owns orchestration only. Tool semantics remain owned by the existing Semantic Compression and Jev Audit implementations.

## 4. Repository role

`testapp` becomes the private control/mailbox repository for tool invocation. It does not become a copy of `kinotch-api`, `jev-audit`, or `devflow`.

Owned here:

- request/result protocol;
- request parsing and validation;
- GitHub Actions orchestration;
- tool-specific thin adapters;
- idempotency/concurrency boundaries;
- safe result projection;
- bridge tests and CI.

Not owned here:

- Semantic Compression prompts/models/profiles/provider logic;
- Jev Audit scoring/semantics/provider logic;
- cross-repository devflow policy;
- external service deployment/release authority.

## 5. Invocation transport

### 5.1 Why Issues are the initial trigger

The current normal ChatGPT GitHub connector can create Issues and read Issue comments, but generic `workflow_dispatch` is not exposed. `issues: opened` is therefore the first connector-reachable trigger.

A request MUST be created in the private bridge repository. Public sibling repository Issues are not valid transport for arbitrary chat text.

### 5.2 One Issue = one request

Each request Issue contains one machine-readable fenced JSON envelope and may include a short human-readable header outside the envelope.

Canonical request envelope v1:

```json
{
  "schema": "kinotch-tool-request-v1",
  "request_id": "req_<uuid-or-stable-random-id>",
  "tool": "semantic_compress",
  "parameters": {}
}
```

Allowed `tool` values in v1:

- `semantic_compress`
- `jev_audit`

No other tool value is accepted.

### 5.3 Request identity

`request_id` is supplied by the caller and validated as a bounded opaque identifier. The bridge stores no separate durable database in v1; duplicate detection is performed against the current request context and repository-visible bridge state defined by implementation tests.

A duplicate ID MUST NOT silently generate a second provider-backed execution. The bridge either rejects it as `duplicate_request` or handles an explicitly defined retry form added in a later schema version.

## 6. Semantic Compression request

Canonical v1 parameters:

```json
{
  "text": "<input text>",
  "profile": "semantic-dense-v1"
}
```

Allowed profiles are whatever the current public Semantic Compression contract explicitly allows at implementation time; the bridge does not invent profiles. Initial known profiles are `compact-v1` and `semantic-dense-v1`.

Rejected fields include, without limitation:

- arbitrary prompt/system prompt;
- model/provider override;
- temperature/sampling fields;
- tools/search configuration;
- endpoint override;
- shell/command fields.

Execution path:

```text
validated private Issue payload
  -> bridge adapter
  -> Authorization: Bearer <COMPRESSION_API_TOKEN from Actions Secret>
  -> POST /v1/compress
  -> validate expected response shape
  -> safe private result comment
```

The bridge MUST NOT log the raw request text or compressed output. The final Issue comment may contain the compressed output because the repository is private and the result must be readable by normal ChatGPT, but workflow logs/job summaries must remain metadata-only.

## 7. Jev Audit request

Canonical v1 repository-audit parameters:

```json
{
  "repository": "kinoko34077/example",
  "ref": "<branch/tag/full SHA>",
  "mode": "full",
  "profile": "development"
}
```

Changed-only form additionally requires an explicit base:

```json
{
  "repository": "kinoko34077/example",
  "ref": "<head ref/SHA>",
  "mode": "changed-only",
  "base_ref": "<base ref/SHA>",
  "profile": "development"
}
```

Requirements:

- Resolve requested refs to exact SHAs before provider-backed audit work.
- Record resolved head SHA in every result.
- Record resolved base SHA for changed-only.
- Do not derive changed-only semantics from accidental shallow checkout state.
- Do not accept shell fragments, executable paths, arbitrary CLI options, environment assignments, model overrides, or arbitrary local filesystem paths.
- Public repository support is the initial baseline.
- Private target-repository support is deferred until a least-privilege checkout credential design is explicitly accepted; the bridge repository being private does not itself grant Actions cross-repository private checkout access.

Implementation may use the existing Jev Audit CLI or Remote REST snapshot contract according to what best preserves exact current semantics. Repository/Git-aware full or changed-only auditing should prefer the Local CLI path when feasible. Explicit file-snapshot auditing remains owned by the existing Remote contract and is not reinvented here.

## 8. Result protocol

Every completed request produces exactly one final structured result comment, plus at most one bounded status comment if implementation proves it materially useful.

Canonical result envelope v1:

```json
{
  "schema": "kinotch-tool-result-v1",
  "request_id": "req_...",
  "tool": "semantic_compress",
  "status": "success",
  "result": {},
  "provenance": {
    "workflow_run_id": 0,
    "bridge_sha": "<full SHA>"
  }
}
```

Allowed status values:

- `success`
- `invalid_request`
- `duplicate_request`
- `tool_error`
- `bridge_error`

Unknown raw provider responses are never copied verbatim into the Issue. Errors are projected to bounded safe fields.

### 8.1 Semantic Compression result

May contain:

- `compressed_text`;
- profile;
- prompt version;
- model;
- input/output character counts;
- input/output hashes;
- usage fields already part of the public API contract;
- warnings already part of that contract.

### 8.2 Jev Audit result

May contain:

- tool/semantics/profile/model provenance exposed by Jev;
- bounded status/risk/local-status summary;
- bounded finding summaries/references;
- requested repository;
- resolved head SHA;
- resolved base SHA where applicable;
- coverage metadata that does not dump source content.

The bridge must not paste whole audited source files or raw provider bodies into result comments.

## 9. GitHub Actions security model

Initial workflow permissions are least privilege:

```yaml
permissions:
  contents: read
  issues: write
```

Additional permission is added only if an accepted implementation requires it.

Rules:

- Only run for Issues in this private repository.
- Validate event actor/caller conditions before consuming provider credentials.
- Do not run arbitrary content as shell.
- Parse JSON using a real parser, never shell interpolation/eval.
- Pass user-supplied strings through files/stdin/structured arguments rather than executable command construction.
- Mask and never echo secrets.
- Disable shell tracing around credential-bearing calls.
- Pin approved third-party Actions versions according to repository policy; prefer GitHub-owned actions and direct language/runtime commands.
- Apply `timeout-minutes` and concurrency bounds.
- Use a request-scoped concurrency key so accidental duplicate delivery cannot run the same Issue concurrently.

Required secrets are initially expected to include:

- `COMPRESSION_API_TOKEN`
- `TYPESAFE_API_KEY` only if the chosen Jev execution path requires direct provider-backed Local CLI execution in the bridge workflow.

Secret creation/rotation is an explicit user/admin step and is not performed by this implementation.

## 10. Privacy model

The bridge repository remains private.

Private payloads MAY exist in:

- the private request Issue;
- the private final result comment;
- ephemeral runner memory/files needed for execution.

Private payloads MUST NOT be intentionally copied to:

- public repositories;
- public Issues/PRs;
- committed repository files;
- Actions job summaries;
- workflow logs;
- public artifacts;
- devflow Control Issues;
- sibling project Current State documents.

Underlying service/provider privacy behavior remains governed by each tool's existing contract. The bridge adds no claim that provider calls are local-only.

## 11. Failure behavior

Validation failure:

- no provider/tool call;
- final result status `invalid_request`;
- bounded machine-readable error code;
- Issue may be closed after final result is posted.

Tool failure:

- preserve safe status and provenance;
- do not paste raw upstream response bodies;
- do not automatically retry provider-backed requests in v1 unless the underlying canonical contract already defines that retry.

Bridge infrastructure failure:

- workflow fails visibly;
- where possible post `bridge_error` without exposing secrets;
- leave enough run provenance for later diagnosis.

A Jev `review`/`rework` semantic result is not automatically an Actions infrastructure failure. Tool assessment and workflow execution status are separate dimensions.

## 12. Issue lifecycle

Recommended lifecycle:

```text
Issue opened
  -> workflow validates
  -> tool executes
  -> final structured result comment
  -> optional label/status update
  -> Issue closed by workflow after successful final result post
```

Invalid requests may also be closed after the failure result is posted.

Closing an Issue does not delete the request/result; GitHub history remains the durable audit trail.

## 13. Testing strategy

Implementation follows TDD.

Required deterministic tests before live E2E:

- request envelope parser accepts exact valid v1 forms;
- unknown top-level field/tool fails closed;
- Semantic Compression rejects prompt/model/provider/shell override fields;
- Jev Audit rejects CLI/shell/environment/path injection fields;
- duplicate request handling does not execute twice;
- result projection never includes configured secret values;
- raw upstream error bodies are not projected;
- changed-only requires explicit base and records exact base/head provenance;
- Jev semantic non-clear outcomes do not become infrastructure failure by default;
- logs/result helpers do not emit raw private text except the intended private Issue result body.

Live acceptance tests:

1. Normal ChatGPT creates one benign Semantic Compression request from mobile/normal chat and reads the private result.
2. Normal ChatGPT creates one Jev request against a public repository/ref and reads the private result.
3. One changed-only Jev request proves exact base/head resolution.
4. One invalid request proves no external/provider execution.

## 14. Repository structure target

Expected implementation shape:

```text
.github/
  workflows/
    tool-request.yml
src/
  bridge/
    request.js
    result.js
    semantic-compress.js
    jev-audit.js
    github.js
scripts/
  run-request.mjs
tests/
  request.test.mjs
  result.test.mjs
  semantic-compress.test.mjs
  jev-audit.test.mjs
  integration.test.mjs
docs/
  superpowers/
    specs/
      2026-09-26-chatgpt-tool-bridge-design.md
```

Node.js is the preferred bridge implementation language because the workflow orchestration, JSON/HTTP handling, and GitHub API calls are small and do not justify an additional framework. This does not constrain the language of the underlying tools.

No database, web server, Cloudflare Worker, queue service, self-hosted runner, or UI is introduced in v1.

## 15. Cross-repository ownership

- `testapp#1`: bridge transport/orchestration implementation and E2E acceptance.
- `kinotch-api#31`: Semantic Compression compatibility/security boundary and any change actually required in `kinotch-api`. If the bridge works against the existing contract without `kinotch-api` changes, this Issue records that no service change was required.
- `jev-audit#9`: Jev compatibility/execution contract and any change actually required in `jev-audit`. If the bridge can consume the existing package/CLI without changes, this Issue records that outcome.
- `devflow#86`: shared cross-repository objective and final acceptance across both tools.

Do not duplicate implementation state across all four Issues; detailed code/test evidence belongs to the repository that owns the change.

## 16. Non-goals

- OpenAI Plugin/App registration.
- Generic arbitrary tool registration in v1.
- Arbitrary remote shell/command execution.
- Generic LLM prompt/model proxy.
- GUI automation.
- Self-hosted runner dependency.
- Synchronous low-latency RPC guarantees.
- Private cross-repository Jev checkout before least-privilege credentials are designed.
- Production deploy/release of sibling services.
- Credential creation/rotation or repository security-setting mutation.

## 17. Rollback boundary

The bridge is isolated in a previously minimal private repository. Rollback is a normal revert PR removing or disabling the bridge workflow/code. Existing Semantic Compression and Jev Audit services remain unaffected because the bridge is only a caller.

If the bridge is disabled, normal direct REST/MCP/CLI paths remain unchanged.
