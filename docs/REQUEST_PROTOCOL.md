# ChatGPT Tool Bridge Request Protocol v1

この文書は、通常ChatGPT / mobile（スマホ）からprivate repository `kinoko34077/testapp`を介して独自toolを呼び出すv1 protocolを定義する。

## Transport

1 request = 1 private repository Issue とする。入口はGitHub Actionsの`issues: opened`で、通常経路にRDCは不要。

Issue本文にはmachine-readableな`json` fenced blockを1個だけ置く。request schemaは`kinotch-tool-request-v1`、result schemaは`kinotch-tool-result-v1`。

bridgeはgeneric shell / arbitrary shell、任意CLI、任意model/provider/prompt、任意environment assignmentを提供しない。未知field/toolはprovider work前にfail-closedで拒否する。

## Common request envelope

```json
{
  "schema": "kinotch-tool-request-v1",
  "request_id": "req_example1234",
  "tool": "semantic_compress",
  "parameters": {}
}
```

`request_id`はrequestごとに一意なbounded identifierとする。同じIDの後発Issueは`duplicate_request`となり、provider-backed処理を再実行しない。

## Semantic Compression

```json
{
  "schema": "kinotch-tool-request-v1",
  "request_id": "req_compress1234",
  "tool": "semantic_compress",
  "parameters": {
    "text": "圧縮対象の本文",
    "profile": "semantic-dense-v1"
  }
}
```

許可profileは`compact-v1`と`semantic-dense-v1`。本文上限は200,000 Unicode code points。bridgeは既存`POST /v1/compress`だけを呼び、prompt/model/provider overrideは受け取らない。
Secret値はこの文書、Issue、commit、Actions summaryへ記録しません。secret作成・rotation・permission変更はbridge実装とは別の人間確認対象です。

## Unsupported operations

v1はgeneric shell / arbitrary shell、任意command、任意executable path、environment assignment、任意model/provider override、local filesystem path、code modification commandをrequest fieldとして受け付けません。

通常ChatGPT / mobileからは、このprotocolに従うprivate Issueを作成し、Actions完了後に同じIssueのresult commentを読み戻します。通常利用経路にRDCやself-hosted runnerは不要です。

## Jev Audit: full

v1の監査対象はpublic repositoryのみ。private target repositoryはleast-privilege checkout credential設計が別途承認されるまで対象外。

```json
{
  "schema": "kinotch-tool-request-v1",
  "request_id": "req_jevfull1234",
  "tool": "jev_audit",
  "parameters": {
    "repository": "kinoko34077/jev-audit",
    "ref": "main",
    "mode": "full",
    "profile": "development"
  }
}
```

許可profileは`development`と`generic`。requested refはprovider-backed audit前にexact commit SHAへ解決される。

## Jev Audit: changed-only

```json
{
  "schema": "kinotch-tool-request-v1",
  "request_id": "req_jevchange1234",
  "tool": "jev_audit",
  "parameters": {
    "repository": "kinoko34077/jev-audit",
    "ref": "main",
    "mode": "changed-only",
    "base_ref": "v0.2.12",
    "profile": "development"
  }
}
```

changed-onlyはhead refと`base_ref`をそれぞれexact SHAへ解決し、checkout済みheadをJev Auditの`--changed-only --base-ref <exact-base-sha>`へ渡す。Git stateを擬装してprovenanceを書き換えない。

## Result envelope

処理完了時は元Issueへ最終コメントを1件投稿し、その後Issueをcloseする。

```json
{
  "schema": "kinotch-tool-result-v1",
  "request_id": "req_example1234",
  "tool": "semantic_compress",
  "status": "success",
  "result": {},
  "provenance": {
    "workflow_run_id": 123,
    "bridge_sha": "0123456789012345678901234567890123456789"
  }
}
```

bridge statusは`success`、`invalid_request`、`duplicate_request`、`tool_error`、`bridge_error`のみ。Jevの`review`、`rework`、`unknown`はtool result内の意味判定であり、Actions infrastructure failureには変換しない。

raw provider body、Error stack、監査対象source全文、credentialはresultへコピーしない。

## Privacy and credentials

このtransportはprivate repository専用。Semantic Compressionのchat本文や結果をpublic Issue、public repository、Actions summary、artifactへ複製しない。

Live provider実行には、`kinoko34077/testapp`のGitHub Actions Secretsへ以下のsecret名を手動登録する。

- `COMPRESSION_API_TOKEN`
- `TYPESAFE_API_KEY`

値そのものはrepository file、Issue例、README、workflow outputへ記録しない。GitHub workflow用の`GITHUB_TOKEN`はGitHubがrunごとに提供するnative tokenを使用する。

## Unsupported in v1

- generic shell / arbitrary shell
- arbitrary command / CLI fragments
- arbitrary local filesystem access
- private target repository audit
- arbitrary model/provider/prompt overrides
- GUI/RDC操作の一般的な代替
