# MCP (Model Context Protocol) セットアップガイド

本ドキュメントは、`form-management` プロジェクトで Cursor および他の AI ツールを MCP 経由で Supabase と連携させるためのセットアップ手順をまとめています。

## 目次
1. [概要](#概要)
2. [前提条件](#前提条件)
3. [Supabase MCP サーバのセットアップ](#supabase-mcp-サーバのセットアップ)
4. [Firecrawl MCP サーバのセットアップ](#firecrawl-mcp-サーバのセットアップ)
5. [セキュリティベストプラクティス](#セキュリティベストプラクティス)
6. [トラブルシューティング](#トラブルシューティング)

---

## 概要

**MCP (Model Context Protocol)** は、LLM (Claude, Cursor など) を外部ツール・サービスに接続するための標準プロトコルです。

### メリット
- AI アシスタントがプロジェクトのデータベーススキーマを理解
- 開発中にリアルタイムでデータベースを参照・クエリ可能
- Supabase リソースの効率的な検索と操作
- コード生成時の精度向上

### 現在のセットアップ

このプロジェクトでは、`.cursor/mcp.json` に以下の MCP サーバを設定しています：

- **Supabase MCP**: Supabase プロジェクトのメタデータ・データベース構造にアクセス
- **Firecrawl MCP**: Web スクレイピングと LLM ベースのデータ抽出

---

## 前提条件

### 1. Node.js と npm/pnpm のインストール
```bash
node --version  # v18 以上推奨
pnpm --version  # v8 以上
```

### 2. Supabase プロジェクトの作成
- [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクトを作成
- プロジェクト参照 (Project Ref) をメモ: `ohplaysshllkinaiqksb` (例)

### 3. 個人アクセストークン (PAT) の作成

Supabase で以下の手順で PAT を生成：

1. [Supabase Settings > Tokens](https://supabase.com/dashboard/account/tokens) を開く
2. **+ Generate new token** をクリック
3. トークン名: `"Cursor MCP Server"` (例)
4. **Generate token** → トークンをコピー (一度だけ表示)
5. 安全に保管 (環境変数またはパスワードマネージャー)

---

## Supabase MCP サーバのセットアップ

### ステップ 1: 環境変数の設定

`.cursor/mcp.json` に個人アクセストークンを設定します：

**macOS / Linux:**
```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=ohplaysshllkinaiqksb"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "your-personal-access-token-here"
      }
    }
  }
}
```

**Windows (CMD):**
```json
{
  "mcpServers": {
    "supabase": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=ohplaysshllkinaiqksb"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "your-personal-access-token-here"
      }
    }
  }
}
```

**Windows (pnpm):**
```json
{
  "mcpServers": {
    "supabase": {
      "command": "cmd",
      "args": [
        "/c",
        "pnpm",
        "dlx",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=ohplaysshllkinaiqksb"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "your-personal-access-token-here"
      }
    }
  }
}
```

### ステップ 2: Cursor での接続確認

1. Cursor を再起動
2. **Settings > MCP** を開く
3. 接続ステータスが **🟢 Active** になることを確認
4. ハンマーアイコン 🔨 をクリックして利用可能なツールを表示

### ステップ 3: 使用例

Cursor のチャットで以下のように問い合わせ：

```
「このプロジェクトのテーブル構造を教えて」
「forms テーブルのスキーマは？」
「stores と forms の関連性は？」
```

---

## Firecrawl MCP サーバのセットアップ

### ステップ 1: Firecrawl API キーの取得

1. [Firecrawl Dashboard](https://app.firecrawl.dev) でアカウント作成
2. **API Keys** から新しいキーを生成
3. キーを安全に保管

### ステップ 2: `.cursor/mcp.json` に追加

```json
{
  "mcpServers": {
    "supabase": {
      // ... Supabase 設定 ...
    },
    "Firecrawl": {
      "command": "env",
      "args": [
        "FIRECRAWL_API_KEY=your-firecrawl-api-key",
        "npx",
        "-y",
        "firecrawl-mcp"
      ]
    }
  }
}
```

### ステップ 3: 使用例

```
「https://example.com のコンテンツをスクレイプして」
「このページから特定の情報を抽出して」
```

---

## セキュリティベストプラクティス

### ⚠️ 重要: トークンを安全に管理

**✅ 推奨:**
```bash
# 環境変数から読み込み (シェルスクリプト)
export SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase_token)
```

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=ohplaysshllkinaiqksb"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}
```

**❌ 非推奨:**
- `.cursor/mcp.json` にトークンをベタ書き
- Git にコミット
- チャットやメールで共有
- GitHub Actions などで使用 (除外処理なし)

### 読み取り専用モード

```json
"args": [
  "-y",
  "@supabase/mcp-server-supabase@latest",
  "--read-only",  // ← 必ず付与
  "--project-ref=..."
]
```

**効果:**
- すべてのクエリが読み取り専用 Postgres ロールで実行
- 誤ったデータ変更を防止

### Prompt Injection 対策

MCP クライアント (Cursor など) は、ツール実行前に **必ず確認を求める**設定を使用。

実行するクエリを必ず確認してから承認してください。

### 開発環境のみ接続

**本番データへのアクセスは厳禁。** 開発環境専用の `--project-ref` を使用。

```json
// ✅ 開発環境のみ
"--project-ref=development-project-ref"

// ❌ 本番環境
"--project-ref=production-project-ref"  // 避ける
```

---

## トラブルシューティング

### 問題 1: MCP サーバが起動しない

**症状**: Cursor の Settings > MCP で 🔴 Inactive が表示される

**解決策:**
```bash
# 手動でテスト実行
npx -y @supabase/mcp-server-supabase@latest --read-only --project-ref=...
```

エラーメッセージを確認し、以下をチェック：
- トークンが有効か？ (Dashboard で確認)
- プロジェクト参照は正しいか？
- インターネット接続は OK か？

### 問題 2: "Authentication failed" エラー

**原因**: トークン無効、期限切れ

**解決策:**
1. Supabase Dashboard で新しいトークンを生成
2. `.cursor/mcp.json` を更新
3. Cursor を再起動

### 問題 3: クエリが遅い

**原因**: 大規模データの読み込み

**解決策:**
```json
"args": [
  "-y",
  "@supabase/mcp-server-supabase@latest",
  "--read-only",
  "--project-ref=...",
  "--feature-groups=docs,database"  // 不要な機能を無効化
]
```

### 問題 4: "Permission denied" エラー

**原因**: トークンの権限が不足

**解決策:**
- Supabase Dashboard でトークン権限を確認
- 必要に応じて新トークンを生成 (より高い権限)

---

## 高度な設定

### プロジェクトスコープの指定

複数の Supabase プロジェクトがある場合、スコープを指定：

```json
{
  "mcpServers": {
    "supabase-staging": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=staging-ref"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "..."
      }
    },
    "supabase-dev": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--read-only",
        "--project-ref=dev-ref"
      ],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

### 機能グループの制限

セキュリティのため、不要な機能を無効化：

```json
"args": [
  "-y",
  "@supabase/mcp-server-supabase@latest",
  "--read-only",
  "--project-ref=...",
  "--feature-groups=database,docs"  // database と docs のみ有効
]
```

利用可能なグループ:
- `docs`: Supabase ドキュメント検索
- `database`: テーブル・スキーマ表示
- `account`: プロジェクト設定 (読み取り)
- `debugging`: ログ・メトリクス
- `development`: ローカルセットアップ
- `functions`: Edge Function
- `branching`: ブランチ管理
- `storage`: ストレージ

---

## よくある質問

### Q: 本番環境で使用できるか？

**A**: セキュリティ上の理由から、**本番環境には接続しない**ことを強く推奨。
開発・ステージング環境のみで使用してください。

### Q: トークンを失った場合は？

**A**: Supabase Dashboard で古いトークンを無効化し、新しいものを生成。

### Q: 複数人で同じプロジェクトを開発する場合は？

**A**: 各開発者が自分自身のトークンを生成し、`.cursor/mcp.json` の環境変数で管理。
トークンを Git にコミットしない。

### Q: Cursor 以外のエディタで使用できるか？

**A**: はい。VSCode Copilot、Claude Desktop、Windsurf など、MCP 対応の任意のツールで使用可能。
各ツール向けの設定方法については [Supabase MCP 公式ガイド](https://supabase.com/docs/guides/getting-started/mcp) を参照。

---

## 参考資料

- [Supabase MCP 公式ドキュメント](https://supabase.com/docs/guides/getting-started/mcp)
- [MCP 仕様](https://modelcontextprotocol.io/)
- [GitHub: supabase-mcp](https://github.com/supabase-community/supabase-mcp)
- [Firecrawl MCP](https://www.firecrawl.dev/)

---

**最終更新**: 2025-10-16  
**次回レビュー予定**: 2025-12-31  
**担当**: AI Assistant (form-management プロジェクト)
