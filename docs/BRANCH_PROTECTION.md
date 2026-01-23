# ブランチ保護ルール設定ガイド

このドキュメントでは、Production < Staging < Development の階層的な制限を実現するためのGitHubブランチ保護ルールの設定方法を説明します。

## 📋 概要

安全な運用のため、以下の階層的な制限を設定します：

```
Production (main)
  ↑ PR のみ（staging からのみ）
Staging
  ↑ 直接プッシュ可能、または PR（dev または feature/* からのみ）
Development (dev)
  ↑ 直接プッシュ可能
```

## 🔒 ブランチ保護ルールの設定

### 1. GitHubリポジトリの設定にアクセス

1. GitHubリポジトリを開く
2. **Settings** → **Branches** を選択

### 2. main (Production) ブランチの保護ルール

**Add rule** をクリックし、以下の設定を行います：

#### Branch name pattern
```
main
```

#### 保護設定

✅ **Require a pull request before merging**
- ✅ Require approvals: `1` (推奨: 2)
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require review from Code Owners (推奨)

✅ **Require status checks to pass before merging**
- ✅ Require branches to be up to date before merging
- Status checks:
  - `lint-and-type-check`
  - `build`
  - `validate-branch-flow` (branch-protection.yml)
  - `check-commit-messages` (branch-protection.yml)

✅ **Require conversation resolution before merging**

✅ **Restrict who can push to matching branches**
- 管理者のみ許可（オプション）

✅ **Do not allow bypassing the above settings**
- 管理者も含めて全員に適用

✅ **Allow force pushes**: ❌ **無効化**
✅ **Allow deletions**: ❌ **無効化**

#### 追加設定（推奨）

✅ **Require linear history**
- マージコミットではなく、リベースまたはスカッシュマージを強制

✅ **Include administrators**
- 管理者も保護ルールに従う

---

### 3. staging ブランチの保護ルール

**Add rule** をクリックし、以下の設定を行います：

#### Branch name pattern
```
staging
```

#### 保護設定

⚠️ **Require a pull request before merging**: ❌ **無効化**（直接プッシュを許可）

✅ **Require status checks to pass before merging** (PR作成時のみ)
- ✅ Require branches to be up to date before merging
- Status checks:
  - `lint-and-type-check`
  - `build`
  - `validate-branch-flow` (branch-protection.yml)

✅ **Allow force pushes**: ❌ **無効化**（推奨）
✅ **Allow deletions**: ❌ **無効化**（推奨）

> **注意**: stagingブランチは直接プッシュ可能ですが、PR経由でのマージも引き続き利用できます。

---

### 4. dev ブランチの保護ルール（オプション）

開発用ブランチのため、保護ルールは最小限に設定：

#### Branch name pattern
```
dev
```

#### 保護設定

✅ **Require status checks to pass before merging** (PR作成時のみ)
- Status checks:
  - `lint-and-type-check`
  - `build`

✅ **Allow force pushes**: ✅ **有効化** (開発用のため)
✅ **Allow deletions**: ✅ **有効化** (開発用のため)

---

## 🔄 ワークフロー

### Development → Staging

1. **devブランチで開発**
   ```bash
   git checkout dev
   git add .
   git commit -m "feat: 新機能を追加"
   git push origin dev
   ```

2. **Pull Requestを作成**
   - Base: `staging`
   - Compare: `dev`
   - タイトル: `feat: 新機能を追加`

3. **レビュー & マージ**
   - コードレビュー
   - CI/CDチェックの成功確認
   - マージ

### Staging → Production

1. **stagingブランチで検証完了後**
   ```bash
   git checkout staging
   git pull origin staging
   # 動作確認
   ```

2. **Pull Requestを作成**
   - Base: `main`
   - Compare: `staging`
   - タイトル: `Release: v1.2.0` など

3. **レビュー & マージ**
   - コードレビュー（必須）
   - CI/CDチェックの成功確認
   - Staging環境での動作確認完了を確認
   - マージ

---

## 🚫 禁止事項

### ❌ 直接プッシュ

以下のブランチへの直接プッシュは**禁止**です：

- `main` (Production)

```bash
# ❌ 禁止
git push origin main

# ✅ 許可
git push origin staging
git push origin dev
```

### ❌ 不適切なマージフロー

以下のマージは**禁止**です：

- `dev` → `main` (直接)
- `feature/*` → `main` (直接)
- `main` → `staging` (逆方向)

```bash
# ❌ 禁止
git checkout main
git merge dev  # 直接マージは禁止

# ✅ 許可
# 1. dev → staging へのPR
# 2. staging → main へのPR
```

---

## 🔍 検証方法

### GitHub Actions による自動検証

以下のワークフローが自動的に検証します：

1. **branch-protection.yml**
   - PRのブランチフローを検証
   - コミットメッセージの形式をチェック

2. **prevent-direct-push.yml**
   - 直接プッシュを検出（警告）

### 手動確認

```bash
# 現在のブランチ確認
git branch

# リモートブランチ確認
git branch -r

# ブランチ保護ルールの確認
# GitHub Settings → Branches で確認
```

---

## 🛠 トラブルシューティング

### 問題1: PRがマージできない

**原因**: ブランチ保護ルールの要件を満たしていない

**解決策**:
- 必要なレビュー承認があるか確認
- CI/CDチェックが全て成功しているか確認
- ブランチが最新の状態か確認（`Update branch` ボタンを使用）

### 問題2: 直接プッシュができてしまう

**原因**: ブランチ保護ルールが正しく設定されていない

**解決策**:
- GitHub Settings → Branches で保護ルールを確認
- `Restrict who can push to matching branches` が有効か確認
- `Do not allow bypassing the above settings` が有効か確認

### 問題3: 緊急時の対応

**緊急バグ修正が必要な場合**:

1. **一時的に保護ルールを無効化**（管理者のみ）
2. 修正を適用
3. **保護ルールを再度有効化**
4. 事後レビューを実施

> ⚠️ **注意**: 緊急時の対応は記録を残し、事後レビューを必ず実施してください。

---

## 📚 参考資料

- [GitHub Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

## ✅ チェックリスト

ブランチ保護ルールの設定が完了したら、以下を確認してください：

- [ ] `main` ブランチの保護ルールが設定されている
- [ ] `staging` ブランチの保護ルールが設定されている
- [ ] `dev` ブランチは直接プッシュ可能
- [ ] GitHub Actions ワークフローが正常に動作している
- [ ] チームメンバーに保護ルールを共有した
- [ ] 緊急時の対応手順を文書化した

---

**最終更新**: 2025-01-31  
**担当**: AI Assistant (form-management プロジェクト)

