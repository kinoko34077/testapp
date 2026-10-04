import { tmpdir } from 'node:os';

import { createGitHubClient as defaultCreateGitHubClient } from './github.mjs';
import { runJevAudit as defaultRunJevAudit } from './jev-audit.mjs';
import {
  extractRequestEnvelope,
  isToolRequestIssue,
  validateRequestEnvelope,
} from './request.mjs';
import {
  failureResult,
  safeErrorCode,
  serializeResultComment,
  successResult,
} from './result.mjs';
import { runSemanticCompress as defaultRunSemanticCompress } from './semantic-compress.mjs';

function validateEvent(event, env) {
  if (!event || event.action !== 'opened') throw new TypeError('event must be issues.opened');
  const issue = event.issue;
  if (!issue || !Number.isInteger(issue.number) || issue.number <= 0 || typeof issue.body !== 'string') {
    throw new TypeError('issue event is invalid');
  }
  const fullName = event.repository?.full_name;
  const owner = event.repository?.owner?.login;
  if (typeof fullName !== 'string' || fullName !== env.GITHUB_REPOSITORY) {
    throw new TypeError('event repository is invalid');
  }
  if (
    typeof owner !== 'string' ||
    issue.user?.login !== owner ||
    issue.author_association !== 'OWNER'
  ) {
    throw new TypeError('issue must be opened by repository owner');
  }
  return issue;
}

function provenance(env) {
  const workflowRunId = Number.parseInt(env.GITHUB_RUN_ID ?? '', 10);
  return {
    workflow_run_id: Number.isSafeInteger(workflowRunId) ? workflowRunId : 0,
    bridge_sha: typeof env.GITHUB_SHA === 'string' ? env.GITHUB_SHA : '',
  };
}
async function finalize(github, issueNumber, envelope) {
  await github.postComment(issueNumber, serializeResultComment(envelope));
  await github.closeIssue(issueNumber);
  return envelope;
}

export async function runIssueRequest({ event, env = process.env, dependencies = {} }) {
  if (!isToolRequestIssue(event?.issue)) {
    return { ignored: true, reason: 'not-tool-request' };
  }
  const issue = validateEvent(event, env);
  const createGitHubClient = dependencies.createGitHubClient ?? defaultCreateGitHubClient;
  const runSemanticCompress = dependencies.runSemanticCompress ?? defaultRunSemanticCompress;
  const runJevAudit = dependencies.runJevAudit ?? defaultRunJevAudit;
  const prov = provenance(env);
  const github = createGitHubClient({
    token: env.GITHUB_TOKEN,
    repository: env.GITHUB_REPOSITORY,
  });

  const existingResult = await github.findExistingResult(issue.number);
  if (existingResult) {
    await github.closeIssue(issue.number);
    return existingResult;
  }

  let request;
  try {
    request = validateRequestEnvelope(extractRequestEnvelope(issue.body));
  } catch {
    return finalize(github, issue.number, failureResult({
      requestId: null,
      tool: null,
      status: 'invalid_request',
      code: 'invalid_request',
      provenance: prov,
    }));
  }

  try {
    const duplicate = await github.findRequestId(request.request_id, issue.number);
    if (duplicate) {
      return finalize(github, issue.number, failureResult({
        requestId: request.request_id,
        tool: request.tool,
        status: 'duplicate_request',
        code: 'duplicate_request',
        provenance: prov,
      }));
    }
  } catch {
    return finalize(github, issue.number, failureResult({
      requestId: request.request_id,
      tool: request.tool,
      status: 'bridge_error',
      code: 'github_error',
      provenance: prov,
    }));
  }
  try {
    let toolResult;
    if (request.tool === 'semantic_compress') {
      toolResult = await runSemanticCompress(request.parameters, {
        token: env.COMPRESSION_API_TOKEN,
      });
    } else {
      toolResult = await runJevAudit(request.parameters, {
        workDir: env.RUNNER_TEMP || tmpdir(),
        typesafeApiKey: env.TYPESAFE_API_KEY,
      });
    }
    return finalize(github, issue.number, successResult({
      request,
      result: toolResult,
      provenance: prov,
    }));
  } catch (error) {
    return finalize(github, issue.number, failureResult({
      requestId: request.request_id,
      tool: request.tool,
      status: 'tool_error',
      code: safeErrorCode(error),
      provenance: prov,
    }));
  }
}
