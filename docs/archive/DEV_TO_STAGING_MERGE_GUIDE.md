# dev → staging マージ手順ガイド

dev を staging にマージする際の、コンフリクト解消と Supabase 同期の進め方です。

## 1. 現状サマリ

### 1.1 Git の状態

- **staging**: 現在のブランチ。origin/staging と同期済み。
- **dev**: staging より **30 コミット以上先行**（CRM、LINE、サブドメイン、RLS 英語化、パスワードリセットなど）。
- **マージ時にコンフリクトするファイル（5 件）**:
  1. `src/app/admin/[storeId]/page.tsx`
  2. `src/app/admin/page.tsx`
  3. `src/components/FormEditor/Reservation/BasicInfoEditor.tsx`
  4. `src/lib/form-normalizer.ts`
  5. `src/lib/static-generator-reservation.ts`

### 1.2 Supabase の差分（staging と dev）

| 項目 | staging | dev |
|------|---------|-----|
| **予約フォームテーブル** | `forms` | `reservation_forms`（リネーム済み） |
| **店舗** | `stores` のみ | `stores` + `subdomain`, `custom_domain`, `created_by`, `updated_by` |
| **予約** | 基本カラムのみ | + `line_user_id`, `customer_id` |
| **アンケート** | `survey_forms` のみ | `survey_forms` + `created_by`, `updated_by`、別テーブル `surveys` |
| **CRM** | なし | `customers`, `customer_visits`, `customer_interactions` |
| **適用済みマイグレーション** | 14 本（別バージョン体系） | 22 本 |

staging の DB は「テーブル名・カラム・RLS」が dev より古いため、**先に staging の Supabase を dev に合わせてからコードをマージする**流れが安全です。

---

## 2. 推奨の進め方（2 フェーズ）

### フェーズ 1: Staging の Supabase を dev のスキーマに合わせる

**目的**: マージ後のコード（dev ベース）が staging 環境でそのまま動くようにする。

1. **dev ブランチのマイグレーション内容を確認**
   - リポジトリ上で `dev` の `supabase/migrations/` を参照。
   - staging に**まだない**変更だけを抜き出す（テーブル名変更・追加カラム・新テーブル・RLS など）。

2. **staging 用の「同期マイグレーション」を 1 本（または数本）にまとめる**
   - 既に staging に入っている変更はスキップする。
   - 以下をまとめた SQL を用意するイメージ:
     - `forms` → `reservation_forms` のリネームと FK/RLS の付け替え
     - `stores`: `subdomain`, `custom_domain`, `created_by`, `updated_by` 追加
     - `reservations`: `line_user_id`, `customer_id` 追加
     - `survey_forms`: `created_by`, `updated_by` 追加
     - 新規テーブル: `surveys`, `customers`, `customer_visits`, `customer_interactions`
     - RLS の追加・名前変更（dev で英語化している部分）
   - ファイル名例: `YYYYMMDDHHMMSS_staging_sync_with_dev_schema.sql`

3. **Staging の Supabase に適用**
   - **MCP (user-staging-wakuwaku)** の `apply_migration` を使う。
   - 上記 SQL を `query`、適切な `name`（例: `staging_sync_with_dev_schema`）で実行。
   - 適用後、Dashboard または MCP の `list_tables` / `list_migrations` でテーブル・マイグレーション一覧を確認。

4. **本番（main）用のマイグレーションとしても残す**
   - 同じ SQL を `supabase/migrations/` にファイルとして追加し、**staging でマージが終わったあと** main に上げるときにそのまま使えるようにする。

※ dev の既存マイグレーションファイルをそのまま staging に「全部流す」と、staging 側のマイグレーション履歴（別バージョン）とぶつかる可能性があるため、**差分だけを 1 本にまとめたマイグレーション**を推奨しています。

---

### フェーズ 2: dev を staging にマージしてコンフリクトを解消

**前提**: フェーズ 1 で staging の DB が dev のスキーマと一致していること。

1. **staging でマージ実行**
   ```bash
   git checkout staging
   git pull origin staging
   git merge dev
   ```

2. **コンフリクト 5 ファイルの解消**
   - 基本的に **dev の内容を採用**してよい（テーブル名 `reservation_forms`、CRM・LINE・サブドメインなどの新機能が入っているため）。
   - 各ファイルで `<<<<<<<`, `=======`, `>>>>>>>` を削除し、dev 側のコードを残す形で保存。
   - 解消後:
     ```bash
     git add <解消したファイル>
     git status   # 他にコンフリクトがないことを確認
     ```

3. **ビルド・テスト**
   ```bash
   pnpm install
   pnpm run build
   pnpm run lint
   ```
   - 必要なら MCP の cursor-ide-browser 等で staging の URL を開き、管理画面・予約フォーム・アンケートが動くか確認。

4. **マージコミット**
   ```bash
   git commit -m "Merge branch 'dev' into staging"
   git push origin staging
   ```

---

## 3. コンフリクト解消のポイント（5 ファイル）

- **`src/app/admin/[storeId]/page.tsx`**  
  - 店舗管理者用画面。dev は CRM・サブドメイン・認証まわりが入っているため、**dev を採用**。
- **`src/app/admin/page.tsx`**  
  - 管理トップ。同様に **dev を採用**。
- **`src/components/FormEditor/Reservation/BasicInfoEditor.tsx`**  
  - フォーム設定。dev のカラム・テーブル名に合わせるため **dev を採用**。
- **`src/lib/form-normalizer.ts`**  
  - フォーム正規化。dev の `reservation_forms` / 設定構造に合わせるため **dev を採用**。
- **`src/lib/static-generator-reservation.ts`**  
  - 静的 HTML 生成。dev のストレージパス・設定に合わせるため **dev を採用**。

いずれも「staging だけの特別な修正」がなければ、**dev 側で統一**して問題ありません。

---

## 4. ロールバックしたい場合

- **マージだけ戻す**
  ```bash
  git checkout staging
  git reset --hard origin/staging
  ```
- **Staging の Supabase**
  - フェーズ 1 で入れたマイグレーションは、Supabase のマイグレーション履歴から確認し、必要ならダッシュボードや SQL で手動ロールバック（手順は別途ドキュメント化推奨）。

---

## 5. チェックリスト

- [ ] フェーズ 1: dev のマイグレーション内容を確認し、staging 用の「同期マイグレーション」SQL を作成した
- [ ] フェーズ 1: MCP (user-staging-wakuwaku) で staging にマイグレーションを適用した
- [ ] フェーズ 1: `list_tables` / `list_migrations` で staging のスキーマを確認した
- [ ] フェーズ 2: `git merge dev` で 5 ファイルのコンフリクトを解消した（いずれも dev 採用）
- [ ] フェーズ 2: `pnpm run build` と `pnpm run lint` が通った
- [ ] フェーズ 2: （可能なら）staging の画面で管理・予約・アンケートを確認した
- [ ] フェーズ 2: `git push origin staging` でマージを反映した
- [ ] 同じマイグレーションを `supabase/migrations/` に追加し、main にマージするときに使えるようにした

---

## 6. MCP の利用

- **user-staging-wakuwaku**: staging の Supabase にマイグレーション適用・テーブル一覧確認。
- **user-dev-wakuwaku**: dev の Supabase のスキーマ参照（差分確認用）。
- **cursor-ide-browser**: staging のフロントの動作確認（任意）。

この順序（先に DB、後にコードマージ）で進めると、コンフリクト解消後も「staging の DB と dev のコード」の不整合を避けやすくなります。
