# Devブランチセットアップガイド

このドキュメントでは、開発環境用のdevブランチを作成し、Vercelのdevelopment環境と連携させる手順を説明します。

## 📋 概要

devブランチは、開発中の機能をテストするための環境です。Supabaseのブランチ機能を使用して、staging環境とは完全に分離されたデータベース環境を提供します。

### 環境構成

- **Gitブランチ**: `dev`
- **Vercel環境**: Preview（Development）
- **Supabase**: Stagingプロジェクトのdevブランチ
- **URL**: Vercelが自動生成するPreview URL（例: `form-management-dev-xxx.vercel.app`）

## 🚀 セットアップ手順

### ステップ1: Supabase Devブランチの作成

1. **Supabase Dashboardにアクセス**
   - https://supabase.com/dashboard にログイン
   - **Stagingプロジェクト**を選択

2. **ブランチ作成**
   - 左メニューから **Branches** を選択
   - **Create Branch** をクリック
   - ブランチ名: `dev`
   - **Create** をクリック

   > ⚠️ **注意**: ブランチ作成には追加コストがかかる場合があります。Supabaseの料金プランを確認してください。
   > 
   > 📌 **重要**: Stagingプロジェクトを使用することで、本番環境への影響を完全に回避できます。

3. **ブランチの準備完了を待つ**
   - ブランチ作成には数分かかることがあります
   - ステータスが **Active** になるまで待機

### ステップ2: DevブランチのAPIキーを取得

1. **ブランチの設定ページにアクセス**
   - Branches → `dev` → **Settings** → **API**
   - または直接: `https://supabase.com/dashboard/project/[project-ref]/branches/dev/settings/api-keys/legacy`

2. **必要な情報をコピー**
   - **Project URL**: `NEXT_PUBLIC_SUPABASE_URL` に使用
   - **anon public**: `NEXT_PUBLIC_SUPABASE_ANON_KEY` に使用
   - **service_role**: `SUPABASE_SERVICE_ROLE_KEY` に使用（⚠️ 絶対に公開しない）

### ステップ3: Vercel環境変数の設定

1. **Vercel Dashboardにアクセス**
   - https://vercel.com/dashboard にログイン
   - プロジェクトを選択

2. **Environment Variablesを開く**
   - **Settings** → **Environment Variables**

3. **devブランチ用の環境変数を追加**
   - **Add New** をクリック
   - 以下の環境変数を追加（**Preview**環境を選択）:

   ```
   NEXT_PUBLIC_APP_ENV=staging
   NEXT_PUBLIC_SUPABASE_URL=<devブランチのURL>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<devブランチのanon-key>
   SUPABASE_SERVICE_ROLE_KEY=<devブランチのservice-role-key>
   ```

   > 📌 **重要**: 
   > - Environment は **Preview** を選択
   > - これにより、`dev`ブランチへのプッシュ時に自動的にこれらの環境変数が使用されます

4. **環境変数の確認**
   - 追加した環境変数が **Preview** 環境に設定されていることを確認
   - 必要に応じて、特定のブランチ（`dev`）のみに適用する設定も可能

### ステップ4: Gitブランチの作成とプッシュ

1. **ローカルでdevブランチを作成**
   ```bash
   git checkout -b dev
   git push -u origin dev
   ```

2. **Vercelの自動デプロイを確認**
   - Vercel Dashboard → **Deployments** を確認
   - `dev`ブランチへのプッシュが検出され、自動デプロイが開始されることを確認

### ステップ5: 動作確認

1. **デプロイ完了を待つ**
   - Vercel Dashboardでデプロイが完了するまで待機

2. **Preview URLにアクセス**
   - デプロイ完了後、Preview URLが生成されます
   - 例: `form-management-dev-xxx.vercel.app`

3. **Supabase接続の確認**
   - アプリケーションが正常に動作することを確認
   - Supabase Dashboard → Branches → `dev` → **Database** でデータが正しく保存されることを確認

## 🔧 環境変数の管理

### Vercelでの環境変数設定

Vercelでは、環境変数を以下のように設定できます：

- **Production**: `main`ブランチ用
- **Preview**: `dev`、`staging`、その他のブランチ用
- **Development**: ローカル開発環境用（通常は使用しない）

### ブランチ固有の環境変数

特定のブランチ（`dev`）のみに環境変数を適用する場合：

1. Vercel Dashboard → **Settings** → **Environment Variables**
2. 環境変数を追加する際、**Environment** で **Preview** を選択
3. **Add** をクリック
4. 必要に応じて、**Git Branch** で `dev` を指定（オプション）

## 🔄 ブランチの管理

### Supabaseブランチの操作

Supabase Dashboard → **Branches** から以下の操作が可能：

- **Merge**: devブランチの変更をstaging（メイン）にマージ
- **Reset**: devブランチをstaging（メイン）の状態にリセット
- **Rebase**: staging（メイン）の最新変更をdevブランチに取り込む
- **Delete**: devブランチを削除

### マイグレーションの適用

devブランチにマイグレーションを適用する場合：

1. **Supabase CLIを使用**（推奨）
   ```bash
   supabase link --project-ref <dev-branch-ref>
   supabase db push
   ```

2. **Supabase Dashboardを使用**
   - Branches → `dev` → **Database** → **Migrations**
   - 必要なマイグレーションを適用

## ⚠️ 注意事項

1. **コスト**
   - Supabaseブランチ機能は追加コストがかかる場合があります
   - 料金プランを確認してください

2. **データの分離**
   - devブランチのデータはstaging（メイン）とは完全に分離されています
   - stagingのデータはdevブランチにはコピーされません
   - 本番環境（Production）とは完全に独立しています

3. **環境変数の管理**
   - 機密情報（特に`SUPABASE_SERVICE_ROLE_KEY`）は絶対に公開しないでください
   - Vercelの環境変数設定で適切に管理してください

4. **ブランチの同期**
   - 定期的にstaging（メイン）の変更をdevブランチに取り込む（Rebase）ことを推奨
   - マイグレーションの適用順序に注意してください
   - stagingで検証済みの変更をdevブランチに取り込むことで、安定した開発環境を維持できます

## 🔍 トラブルシューティング

### 問題1: Vercelでdevブランチがデプロイされない

**解決策**:
- `vercel.json` の `git.deploymentEnabled.dev` が `true` になっているか確認
- Vercel Dashboard → **Settings** → **Git** でブランチの連携を確認

### 問題2: Supabaseに接続できない

**解決策**:
- 環境変数が正しく設定されているか確認（Vercel Dashboard）
- devブランチのAPIキーを使用しているか確認
- Supabase Dashboardでdevブランチのステータスが **Active** か確認

### 問題3: 環境変数が反映されない

**解決策**:
- 環境変数を追加/変更した後、新しいデプロイをトリガー
- Vercel Dashboard → **Deployments** → **Redeploy** を実行

## 📚 参考資料

- [Supabase Branching Documentation](https://supabase.com/docs/guides/cli/branching)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Vercel Git Integration](https://vercel.com/docs/concepts/git)

---

**最終更新**: 2025-01-31  
**担当**: AI Assistant (form-management プロジェクト)

