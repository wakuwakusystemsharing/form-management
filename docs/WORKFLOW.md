# 開発・運用フローガイド

このドキュメントでは、日常的な開発からデプロイまでの運用フローを説明します。

## 🌳 ブランチ戦略

```
main (Production - 本番)
  ↑ PR のみ（staging からのみ）
staging (Staging - 検証環境)
  ↑ 直接プッシュ可能、または PR（dev または feature/* からのみ）
dev (Development - 開発環境)
  ↑ 直接プッシュ可能
feature/* (機能開発ブランチ)
  ↑ dev にマージ、または staging にPR/直接push
```

### ブランチの役割

- **`main`**: 本番環境 (Production)
  - 常に安定した状態を保つ
  - **直接プッシュ禁止**（ブランチ保護ルール）
  - **staging からのPRのみ許可**
  - レビュー必須（1名以上、推奨: 2名）

- **`staging`**: ステージング環境 (Preview)
  - 本番デプロイ前の最終確認
  - **直接プッシュ可能**（開発効率のため）
  - **dev または feature/* からのPRも利用可能**
  - 本番と同じ構成でテスト

- **`dev`**: 開発環境 (Development)
  - 日常的な開発・実験的機能のテスト
  - **直接プッシュ可能**（開発用のため）
  - Supabase Stagingプロジェクトのdevブランチを使用

- **`feature/*`**: 機能開発ブランチ
  - 各機能ごとに作成
  - 例: `feature/add-menu-editor`, `feature/fix-auth`
  - dev にマージ、または staging にPR

### 🔒 階層的な制限

**Production < Staging < Development** の順序で制限がかかります：

- ✅ `dev` → `staging` へのPR: **許可**
- ✅ `staging` → `main` へのPR: **許可**
- ❌ `dev` → `main` への直接PR: **禁止**
- ❌ `feature/*` → `main` への直接PR: **禁止**
- ❌ `main` → `staging` への逆方向マージ: **禁止**

詳細は [`BRANCH_PROTECTION.md`](./BRANCH_PROTECTION.md) を参照してください。

---

## 📋 日常的な開発フロー

### 1. 新機能の開発開始

#### オプションA: devブランチで直接開発（推奨）

```bash
# devブランチで開発
git checkout dev
git pull origin dev
# 直接コミット・プッシュ可能
git add .
git commit -m "feat: 新機能を追加"
git push origin dev
```

#### オプションB: featureブランチで開発

```bash
# 最新の dev をベースに feature ブランチを作成
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name

# 例:
git checkout -b feature/add-coupon-selection
```

### 2. ローカルで開発

```bash
# 環境変数を設定 (初回のみ)
cp .env.local.example .env.local
# .env.local で NEXT_PUBLIC_APP_ENV=local に設定

# 開発サーバー起動
pnpm dev
# → http://localhost:3000

# 型チェック
pnpm type-check

# Lint
pnpm lint
```

### 3. コミット & Push

```bash
# 変更をコミット
git add .
git commit -m "feat: クーポン選択機能を追加"

# リモートに push
git push -u origin feature/your-feature-name
```

### 4. Staging 環境で確認

#### 4-1. Pull Request を作成

```bash
# GitHub で Pull Request を作成
# Base: staging ← Compare: dev または feature/your-feature-name
```

> ✅ **注意**: staging への直接プッシュが可能です。必要に応じてPR経由でのマージも利用できます。

#### 4-2. Staging 環境で動作確認

```
https://your-app-git-staging-yourteam.vercel.app
```

- Supabase (staging) のデータで確認
- Vercel Blob (staging) にデプロイされた静的HTML確認
- RLS の動作確認
- 予約フローの E2E テスト

### 5. 本番環境へデプロイ

#### 5-1. Staging → Main へ Pull Request

```bash
# GitHub で Pull Request を作成
# Base: main ← Compare: staging
# タイトル: "Release: v1.2.0" など
```

> ⚠️ **重要**: main への直接プッシュは**禁止**されています。必ず staging からのPR経由でマージしてください。

#### 5-2. レビュー & マージ

- **コードレビュー必須**（1名以上、推奨: 2名）
- CI/CD の成功確認
- Staging での動作確認完了を確認
- ブランチ保護ルールの要件を満たしていることを確認
- **Merge Pull Request**

#### 5-3. 本番デプロイ

```bash
# main ブランチへのマージで自動デプロイ
# Vercel が自動で Production にデプロイ
```

#### 5-4. 本番環境で動作確認

```
https://your-app.vercel.app
```

- 本番 Supabase のデータ確認
- 顧客向けフォームの動作確認
- 予約データの保存確認

---

## 🔄 定型作業フロー

### 緊急バグ修正 (Hotfix)

> ⚠️ **注意**: 緊急時でも基本的なフロー（dev → staging → main）を守ることを推奨します。

#### 方法1: 通常フロー（推奨）

```bash
# dev ブランチで修正
git checkout dev
git pull origin dev
git checkout -b hotfix/fix-critical-bug

# 修正 & コミット
git add .
git commit -m "fix: 予約保存時のエラーを修正"
git push origin hotfix/fix-critical-bug

# dev にマージ
git checkout dev
git merge hotfix/fix-critical-bug
git push origin dev

# staging へのPRを作成・マージ
# GitHub: Base: staging ← Compare: hotfix/fix-critical-bug

# Staging で確認後、main へのPRを作成・マージ
# GitHub: Base: main ← Compare: staging
```

#### 方法2: 緊急時のみ（管理者権限必要）

```bash
# 1. GitHub Settings → Branches で一時的に保護ルールを無効化（管理者のみ）

# 2. staging から hotfix ブランチを作成
git checkout staging
git pull origin staging
git checkout -b hotfix/fix-critical-bug

# 3. 修正 & コミット
git add .
git commit -m "fix: 予約保存時のエラーを修正"
git push origin hotfix/fix-critical-bug

# 4. staging にマージ
git checkout staging
git merge hotfix/fix-critical-bug
git push origin staging

# 5. Staging で確認後、main にマージ
git checkout main
git merge hotfix/fix-critical-bug
git push origin main

# 6. 保護ルールを再度有効化（管理者のみ）

# 7. hotfix ブランチを削除
git branch -d hotfix/fix-critical-bug
git push origin --delete hotfix/fix-critical-bug

# 8. 事後レビューを実施
```

### 定期リリース (毎週金曜など)

```bash
# 1. Staging で最終確認
# 2. GitHub で Release Pull Request 作成
#    Base: main ← Compare: staging
#    タイトル: "Release: 2025-01-10"
# 3. レビュー & マージ
# 4. GitHub でリリースタグを作成
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

---

## 🧪 テスト方針

### ローカル (dev)

```bash
# 型チェック
pnpm type-check

# Lint
pnpm lint

# ビルド確認
pnpm build
```

### Staging

- **手動テスト**
  - 全フォーム編集フロー
  - 予約フロー (顧客視点)
  - 管理画面の操作
  - 画像アップロード

- **データ確認**
  - Supabase Dashboard でデータ確認
  - Vercel Blob で静的HTML確認

### Production

- **スモークテスト** (デプロイ後すぐ)
  - トップページアクセス
  - 1つのフォームで予約テスト
  - 管理画面ログイン

---

## 📊 環境ごとの確認ポイント

| 確認項目 | dev | staging | production |
|---------|-----|---------|------------|
| データ永続化 | JSON ファイル | Supabase (staging) | Supabase (prod) |
| Storage パス | `/static-forms/` | `reservations/`, `surveys/` | `reservations/`, `surveys/` |
| 環境変数 | `.env.local` | Vercel Preview 環境変数 | Vercel Production 環境変数 |
| デプロイ | `pnpm dev` | `git push origin staging` | `git push origin main` |

---

## 🚨 トラブルシューティング

### Staging デプロイが失敗する

```bash
# CI/CD ログを確認
# GitHub Actions の Logs を確認
# Vercel Dashboard の Deployments を確認

# ローカルでビルド確認
pnpm build
```

### 環境変数が反映されない

```bash
# Vercel Dashboard で環境変数を確認
# Preview / Production の設定を確認

# ローカルで環境変数を同期
pnpm vercel env pull .env.local
```

### Staging と Production でデータが混ざる

```bash
# 環境変数の確認
# NEXT_PUBLIC_APP_ENV が正しく設定されているか
# SUPABASE_URL が staging/prod で別々か確認
```

---

## 📚 関連コマンド

### ブランチ管理

```bash
# 現在のブランチ確認
git branch

# ブランチ一覧 (リモート含む)
git branch -a

# ブランチ切替
git checkout staging

# ブランチ削除
git branch -d feature/old-feature
git push origin --delete feature/old-feature
```

### デプロイ状態確認

```bash
# Vercel のデプロイ一覧
vercel list

# 現在のデプロイ URL
vercel inspect
```

---

## 🎯 ベストプラクティス

1. **小さく頻繁にコミット**
   - 1つの機能 = 1つのコミット
   - コミットメッセージは明確に

2. **Staging で必ず確認**
   - 本番デプロイ前に必ず Staging で動作確認
   - 予約データの保存確認は必須

3. **環境変数の管理**
   - `.env.local` は Git にコミットしない
   - 環境変数変更時は Vercel Dashboard で設定

4. **定期的なリリース**
   - 毎週金曜日に定期リリース
   - 緊急バグは即座に Hotfix

5. **ドキュメント更新**
   - 新機能追加時は README / SETUP.md を更新
   - API 変更時は `.github/copilot-instructions.md` を更新

---

## 📖 参考ドキュメント

- [SETUP.md](SETUP.md) - 環境構築ガイド
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - AI エージェント向けガイド
- [README.md](README.md) - プロジェクト概要
