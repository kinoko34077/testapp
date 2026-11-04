# ChatGPT Tool Bridge Request Protocol v1

通常ChatGPT / mobile（スマホ）から独自toolを呼ぶ受入契約。**private v1**と、公開してよいテキスト専用の**public v2**を明確に分ける。現在の`testapp` repositoryはpublic。

## Transport

1 request = 1 GitHub Issue。入口は`issues: opened`、通常経路にRDCは不要。ただし**public Issue本文は投稿時点で公開**（削除・close・後段検査では取り消せない）。非機密であることを投稿前に確認できない場合、public経路を使わない。

bridge requestとしてadmitするIssueは、タイトルを必ず`[TOOL REQUEST] `で始める。OWNER（数値GitHub ID `79015263`）が作成したmarker付きIssueだけが受入対象。private v1は従来経路、public v2は秘密値を渡さないadmission jobを先に通過する。通常Issueはworkflow/runtimeの両方でno-opとなり、result commentもcloseも行わない。private v1の不正requestは従来どおり`invalid_request`結果を返してclose。**public v2のadmission不合格は、secretをロードせずActionsのadmission jobで拒否される（Issueには最終コメントが投稿されない）**。

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

通常ChatGPT / mobileからは、privateならv1、publicなら後述のv2に従ってIssueを作成し、Actions完了後に同じIssueのresult commentを読み戻します。RDCやself-hosted runnerは不要です。


## Public Semantic Compression v2（公開非機密テキスト限定）

**利用前の必須確認**：GitHub public Issueへ投稿した瞬間から誰でも本文を読める。GitHub Actionsでのスキャンは**投稿後**であり機密漏洩を予防しない。作成側のユーザー/agentが**投稿前**に非機密であること・URL/個人情報/認証情報/他人の機密がないことを判断し、迷うならpublic Issueを作らず認証済みPC/MCP等の非公開経路を使用する。簡易正規表現の通過は非機密性の証明ではない。

公開モードのIssueタイトルは **`[TOOL REQUEST] public semantic_compress`** に固定し、本文を**以下のJSONフェンス1つだけ**で構成する。追加前置き、後書き、別のフェンス、未知field、v1形式は拒否。

```json
{
  "schema": "kinotch-tool-request-v2",
  "request_id": "req_public12345678",
  "tool": "semantic_compress",
  "parameters": {
    "text": "一般公開の商品紹介を短くする。固有の個人情報は含まない。",
    "profile": "semantic-dense-v1"
  },
  "data_classification": "public_non_sensitive",
  "acknowledge_public_disclosure": true
}
```

- `data_classification` と `acknowledge_public_disclosure` は**公開を認識した明示申告**であり、機密判定の自動的な合格証ではない。
- 依頼は`[TOOL REQUEST] `で始まるIssueタイトル、`issues:opened`、正規repo、ownerの**数値user ID** `79015263`が必須。ログイン名や`author_association`だけでは不可。
- public admission jobは秘密値なしで本文全体とschemaを検証。秘密鍵、代表的token、メール、電話、private Drive URL、専用private履歴repoへのリンクなどを検知した場合はプロバイダ呼出を拒否する。**すべての機密情報は検知できない**。
- 受入後にだけpublic compression jobが実行される。秘密値は`COMPRESSION_API_TOKEN`のみ。Jev、`TYPESAFE_API_KEY`、generic shell/CLI、private v1はpublic経路で無効。
- 検証失敗は**admission jobの失敗**として観測する。公開本文は既に表示されているため、公開してはいけない情報はそもそもIssueへ投稿しない。
- private v1と共通のプロバイダ契約は既存`kinotch-api POST /v1/compress`。API結果は`kinotch-tool-result-v1`でIssueコメントへ返す（**publicの場合は出力も公開**）。

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

private v1はprivate repository専用。public v2は**投稿前に公開同意した非機密の圧縮本文に限る**。GitHub公開Issue内の入力・結果は恒久的な公開情報として扱う。機密なチャット本文、private URL、credentials、PIIをpublicへ転記しない。いずれもActions summary、artifact、workflow logsへ本文/秘密値を複製しない。

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
