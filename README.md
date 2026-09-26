# KiNoTch. ChatGPT Tool Bridge

通常ChatGPT / mobile（スマホ）から、KiNoTch.独自ツールをRDCなしで呼び出すためのprivate GitHub bridgeです。

GitHub Pluginそのものではなく、private Issueをrequest mailbox、GitHub Actionsを実行・受渡し層として使う「実質的な外部tool層」です。

## v1 tools

- `semantic_compress` — 既存Semantic Compression REST APIを呼び出す。
- `jev_audit` — 公開repository/refをcheckoutし、既存Jev Audit CLIを呼び出す。

Request schemaは`kinotch-tool-request-v1`、result schemaは`kinotch-tool-result-v1`です。詳細は`docs/REQUEST_PROTOCOL.md`を参照してください。

## Normal path

```text
Normal ChatGPT / mobile
  -> private repository Issue
  -> issues: opened
  -> GitHub Actions
  -> bounded adapter
  -> private Issue result comment
  -> ChatGPT readback
```

v1はgeneric shell / arbitrary shell / 任意CLIを提供しません。許可済みtoolとfieldだけをfail-closedで処理します。

Live provider実行にはrepositoryのGitHub Actions Secretsへ`COMPRESSION_API_TOKEN`と`TYPESAFE_API_KEY`を手動登録する必要があります。secret値はrepository contentへ保存しません。
