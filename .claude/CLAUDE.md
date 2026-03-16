# CLAUDE.md - このプロジェクトの絶対ルール（Claude Code用）

## Superpowers を常にフル活用（最重要）
このプロジェクトでは**Superpowersの全スキルを自動発動**させてください。  
- タスク開始時は自動で brainstorming → writing-plans を発動
- 実装時は test-driven-development + subagent-driven-development を強制
- 計画承認後のみ execute-plan / subagent-driven-development で進める
- ドキュメント変更時は documentation-auditor + living-documentation 風に検証→更新
- 完了時は verification-before-completion + finishing-a-development-branch でレビュー＆クリーンアップ

Superpowersが効いているか確認：計画を書くときは自動でPLAN.mdを作成し、サブエージェントを並列派遣するはずです。

## プロジェクト概要（簡略版）
- Next.js 16 App Router + pnpm
- LINE LIFF予約フォーム管理システム（サービス管理者 → 店舗管理者 → 顧客）
- フォームは静的HTML生成 → Supabase Storageデプロイ
- 環境: local (JSON) / staging / production (Supabase RLS)

## 必須コマンド & 環境変数
- パッケージ: 常に `pnpm install` / `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm type-check`
- シード: `pnpm seed:local` など
- 環境変数: .env.local をコピー、NEXT_PUBLIC_APP_ENV=local でJSONモード

詳細は docs/SETUP.md を参照。

## アーキテクチャ & 重要なパターン（要約）
- データ層: local=JSON / staging/prod=Supabase (RLS必須)
- フォーム正規化: normalizeForm() を必ず通す
- 静的HTML生成: StaticReservationGenerator / StaticSurveyGenerator
- デプロイ: SupabaseStorageDeployer → reservations/{storeId}/{formId}/index.html
- 認証: Middleware + API独立チェック、localはスキップ
- Google Calendar: service_account / store_oauth 2方式
- CRM: customer-utils.ts で自動紐付け・セグメント
- ID: 店舗=6文字ランダム or UUID、フォーム=12文字ランダム

詳細設計は docs/ARCHITECTURE.md に移行推奨（このファイルは短く保つ）。

## 開発ルール（絶対遵守）
- **TDD必須**: 実装前にテストを書く（Vitest + RTL推奨）
- **ドキュメント更新**: 変更時はSuperpowers経由で audit & 整理（docs/audit-report.md 生成）
- **API**: 環境分岐 + 日本語エラー + credentials: 'include'
- **NG**: npm/yarn使用、JSON直接編集、Vercel Blob使用
- **MUST**: コミット前 type-check、normalizeForm()使用、PUTは全体オブジェクト

## Git & ブランチ戦略
- dev → staging (PR必須) → main (PR必須)
- main force-push禁止

## 関連ドキュメント（ここに全部書かず分散）
- docs/SETUP.md          → 環境構築
- docs/WORKFLOW.md       → 日常フロー
- docs/ARCHITECTURE.md   → 詳細設計
- docs/API_SPECIFICATION.md → 全APIリファレンス
- docs/SUPABASE_BEST_PRACTICES.md → RLS・ベストプラクティス
- docs/BRANCH_PROTECTION.md → Gitルール

**今後の運用ルール（これを守って）**:
- このCLAUDE.mdを変更したいときは、Claudeに「CLAUDE.mdを最新の実装に合わせて更新して。Superpowersでauditしてから」と投げる
- ドキュメントが溜まったら、同じく「全ドキュメントをコードと照合して整理して」と依頼
- 新機能追加時は「Superpowersフル活用でbrainstorm → plan → TDD実装」と指定

これでOK？ 承認したら、Superpowersで自動計画開始して！