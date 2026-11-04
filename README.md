# KiNoTch. ChatGPT Tool Bridge

通常ChatGPT / mobile（スマホ）から、KiNoTch.独自ツールを GitHub Issues → Actions → 正規API 経由で呼ぶ bounded bridge。RDCは不要。

## 現行の公開／非公開の区別

- **公開リポジトリの `semantic_compress`**: 明示的に公開許可された**非機密テキストのみ**。専用 `kinotch-tool-request-v2` を使い、`public_non_sensitive` と公開承諾を必須とする。公開Issueの本文と結果は**投稿直後から誰でも閲覧可能**であり、処理後の拒否・削除でも取り消せない。作成前に利用者/agentが機密性を検査し、不確実なら投稿しない。静的secret scanは完全な機密判定ではない。
- **非公開リポジトリのv1**: 既存の `semantic_compress` / `jev_audit` を維持。公開リポジトリでv1やJevは動作しない。
- **PCからの非公開テキスト圧縮**: `kinotch-api` のAccess保護MCP / RESTを用いる。公開Issueには貼らない。

公開経路は認可済みOWNERの数値GitHub user IDのみをadmitし、**secret-free admission job**を通過した場合のみCompression API tokenを使用。公開経路にJev CLIやTYPESAFE_API_KEYは渡さない。

## v1 tools

- `semantic_compress` — 既存 `kinotch-api POST /v1/compress` 呼び出し。
- `jev_audit` — 公開repository/refのJev Audit（非公開transportでのみ使用）。

契約は `docs/REQUEST_PROTOCOL.md`（`kinotch-tool-request-v1` / `kinotch-tool-request-v2`、結果は `kinotch-tool-result-v1`）。任意shell／prompt／model proxyはない。

## 認証・安全

private向け経路は `COMPRESSION_API_TOKEN` および `TYPESAFE_API_KEY` のRepository Actions Secretsが必要。公開経路は `COMPRESSION_API_TOKEN` のみ。秘密値はIssue/commit/log/artifactへ出さない。安全確認なく鍵・repo可視性・権限を変更しない。

公開データについては **必ずIssue作成前に判定する**。公開後のGitHub Actions側チェックはAPI呼出の拒否であり、投稿済みデータの非公開化ではない。サンプルとnegative casesは`docs/REQUEST_PROTOCOL.md`を参照。
