# Supabase ベストプラクティス 2025

本ドキュメントは、form-management プロジェクトで採用する Supabase の最新ベストプラクティスをまとめています。定期的に参照・更新してください。

## 目次
1. [API キー管理](#1-api-キー管理)
2. [認証とセッション管理](#2-認証とセッション管理)
3. [Row Level Security (RLS)](#3-row-level-security-rls)
4. [JWT 署名キー](#4-jwt-署名キー)
5. [データベース関数](#5-データベース関数)
6. [Realtime の活用](#6-realtime-の活用)
7. [テスト戦略](#7-テスト戦略)
8. [セキュリティ監査](#8-セキュリティ監査)
9. [本番環境へのデプロイ](#9-本番環境へのデプロイ)
10. [パフォーマンス最適化](#10-パフォーマンス最適化)

---

## 1. API キー管理

### 概要
API キーは何がアプリケーションにアクセスしているかを認証します。Supabase では4つのタイプがあります：

| タイプ | 用途 | 特徴 |
|--------|------|------|
| **Publishable key** (`sb_publishable_...`) | ウェブページ、モバイルアプリ、CLI | 安全に公開可能、低権限 |
| **Secret key** (`sb_secret_...`) | バックエンド、Edge Function、管理ツール | バックエンドのみ使用、高権限 |
| `anon` (JWT) | 非推奨の低権限キー | 後方互換性のみ |
| `service_role` (JWT) | 非推奨の高権限キー | 後方互換性のみ |

**推奨**: `anon` / `service_role` から `publishable` / `secret` キーへの移行を進める

### ベストプラクティス

**低権限キー (Publishable) の使用**
```env
# フロントエンド環境変数 (.env.local に安全に含める)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx
```

**高権限キー (Secret) の保護**
```bash
# バックエンド環境変数 (.env にのみ、git ignore)
SUPABASE_SECRET_KEY=sb_secret_xxx
```

**キーが漏洩した場合**
- Supabase Dashboard の API Keys ページから即座に新キーを生成
- コンプロマイズされたキーを削除 (不可逆操作)
- ローテーションはダウンタイムなしで実行可能

---

## 2. 認証とセッション管理

### セッション機構

Supabase Auth は以下の流れでユーザセッションを管理：
1. ユーザがログイン → **アクセストークン (短命、デフォルト1時間)** + **リフレッシュトークン** を発行
2. アクセストークンはクライアント側で JWT として検証可能
3. リフレッシュトークンでアクセストークンを再発行

### 推奨設定

```typescript
// クライアント側: getClaims() を使用してトークン検証
const { data, error } = await supabase.auth.getClaims()
if (error) {
  // トークン無効 or 期限切れ
  console.error('Authentication failed:', error)
}
```

**キー変更への対応**
- Edge Function の "Verify JWT" 設定は無効化 (`--no-verify-jwt`)
- クライアント側で `supabase.auth.getClaims()` を使用する

---

## 3. Row Level Security (RLS)

### 基本原則

RLS はテーブル行レベルでアクセス制御。Supabase では **RLS 必須** (セキュリティ監査が推奨)。

### パフォーマンス最適化

RLS クエリの実行時間を改善する 6 つの手法：

#### 1. インデックスの追加
```sql
-- RLS で使用するカラムにインデックス追加
CREATE INDEX idx_user_id ON forms USING btree (user_id);
```
**効果**: 大規模テーブルで 100 倍以上の高速化

#### 2. 関数結果のラッピング (Init Plan)
```sql
-- 推奨
CREATE POLICY "user_access" ON forms
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- 非推奨 (毎行呼び出し)
CREATE POLICY "user_access" ON forms
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
```

#### 3. 明示的なフィルタ追加
```typescript
// RLS に加えて、クライアント側でも同じカラムでフィルタ
const { data } = await supabase
  .from('forms')
  .select()
  .eq('user_id', userId)  // RLS + フィルタ = 高速化
```

#### 4. Security Definer 関数の活用
```sql
-- join テーブルの RLS をバイパス
CREATE OR REPLACE FUNCTION get_user_team_ids()
RETURNS TABLE (team_id uuid)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT team_id FROM team_users WHERE user_id = auth.uid();
$$;

-- RLS ポリシーで使用
CREATE POLICY "team_access" ON projects
  FOR SELECT TO authenticated
  USING (team_id = ANY(get_user_team_ids()));
```

#### 5. JOIN 順序の最適化
```sql
-- 推奨: JOIN テーブルの条件が auth.uid() に依存
team_id IN (SELECT team_id FROM team_users WHERE user_id = auth.uid())

-- 非推奨: メインテーブルカラムが JOIN 条件
auth.uid() IN (SELECT user_id FROM team_users WHERE team_id = table.team_id)
```

#### 6. TO 句で role を指定
```sql
-- anonymous ユーザを早期に除外 (auth.uid() チェック不要)
CREATE POLICY "authenticated_only" ON forms
  FOR SELECT TO authenticated
  USING (TRUE);  -- auth.uid() チェック削除
```

### RLS テスト

```sql
-- ローカル環境でのテスト例
SET SESSION ROLE authenticated;
SET request.jwt.claims TO '{"role":"authenticated","sub":"user-uuid"}';

EXPLAIN ANALYZE SELECT * FROM forms WHERE user_id = '...';

SET SESSION ROLE postgres;
```

**パフォーマンス測定ツール**: Dashboard の SQL Editor で `EXPLAIN ANALYZE` を実行

---

## 4. JWT 署名キー

### Key Rotation Best Practices

Supabase では **非対称暗号** (RSA, Elliptic Curve) の採用が推奨。キー管理フロー：

```
Standby キー → Rotate (Current に昇格) → Previous used → Revoke
```

### アルゴリズム選択

| アルゴリズム | 推奨度 | 用途 |
|------------|--------|------|
| **ES256** (P-256 Elliptic Curve) | ⭐⭐⭐ | **推奨**: 高速、署名サイズが小さい |
| RS256 (RSA 2048) | ⭐⭐ | 互換性が必要な場合のみ |
| EdDSA (Ed25519) | ⭐⭐ | 将来対応予定 |
| HS256 (HMAC) | ❌ | **非推奨**: 本番環境は避ける |

### キー発行と検証

```bash
# CLI でキー生成
supabase gen signing-key --algorithm ES256
```

### 公開鍵ディスカバリー

```http
GET https://project-id.supabase.co/auth/v1/.well-known/jwks.json
```
- エッジキャッシュ: 10 分
- クライアントメモリキャッシュ: 10 分
- キャッシュリセット: 20 分ごと

---

## 5. データベース関数

### 関数設計原則

#### Security Invoker vs Definer
```sql
-- 推奨: INVOKER (デフォルト、ユーザの権限で実行)
CREATE FUNCTION get_user_data()
RETURNS TABLE (...)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT * FROM data WHERE user_id = auth.uid();
$$;

-- 特殊な場合のみ DEFINER (必ず search_path を設定)
CREATE FUNCTION admin_only()
RETURNS TABLE (...)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 明示的にスキーマを指定
  RETURN QUERY SELECT * FROM public.admin_data;
END;
$$;
```

#### 関数権限制御
```sql
-- デフォルト: すべての role が実行可能
-- 制限する場合:
REVOKE EXECUTE ON FUNCTION public.sensitive_data FROM anon, authenticated;

-- 特定 role のみ許可
GRANT EXECUTE ON FUNCTION public.admin_task TO authenticated;
```

#### 関数デバッグ・ロギング

```sql
CREATE FUNCTION process_order(order_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE LOG 'Processing order: %', order_id;
  
  -- 処理ロジック
  
  RAISE WARNING 'Order processed successfully';
  
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Order processing failed: %', SQLERRM;
END;
$$;
```

**ログ確認**: Dashboard > Logs > Postgres Logs

---

## 6. Realtime の活用

### Channel 設計

```typescript
// チャネル命名規則: scope:id:entity
const channel = supabase.channel('room:123:messages', {
  config: { private: true }  // 本番環境では必ず private
})

channel
  .on('broadcast', { event: 'message_sent' }, (payload) => {
    console.log('New message:', payload)
  })
  .subscribe()
```

### ベストプラクティス

**Clean up subscriptions**
```typescript
useEffect(() => {
  const channel = supabase.channel('room:123:messages')
  
  return () => {
    supabase.removeChannel(channel)  // クリーンアップ必須
  }
}, [])
```

**Presence vs Broadcast**
- **Presence**: ユーザのオンライン状態（計算コスト高）
- **Broadcast**: メッセージ送受信（推奨）
- **Postgres Changes**: DB 変更監視（開発用、低ユーザ向け）

---

## 7. テスト戦略

### RLS ポリシーテスト

**pgTAP (データベース単位テスト)**
```sql
-- supabase/tests/rls_policies.test.sql
BEGIN;
SELECT plan(4);

-- セットアップ
INSERT INTO auth.users (id, email) VALUES ('user-1', 'user1@test.com');
INSERT INTO forms (id, user_id, name) VALUES ('form-1', 'user-1', 'My Form');

-- テスト
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'user-1';

SELECT results_eq(
  'SELECT count(*) FROM forms',
  ARRAY[1::bigint],
  'User can see their own forms'
);

SELECT * FROM finish();
ROLLBACK;
```

**実行**
```bash
supabase test db
```

### アプリケーションテスト

```typescript
// vitest で RLS テスト
import { createClient } from '@supabase/supabase-js'

describe('RLS Policies', () => {
  it('should only show user own forms', async () => {
    const user1 = createClient(url, key, {
      auth: { session: session1 }
    })
    
    const { data } = await user1.from('forms').select()
    expect(data).toHaveLength(1)
  })
})
```

---

## 8. セキュリティ監査

### 常時チェック項目

Dashboard > Security Advisor で自動スキャン：

- [ ] すべての public テーブルに RLS 有効化
- [ ] RLS ポリシーが `anon` 役割に過度な権限付与していない
- [ ] 機密データ (auth.users) に適切なポリシー
- [ ] 認証が必要なエンドポイントで `authenticated` role チェック

### PGAudit による監査ログ

```sql
-- 監査対象の役割を設定
ALTER ROLE postgres SET pgaudit.log TO 'all';

-- 監査ログを確認
SELECT * FROM postgres_logs WHERE event_message LIKE 'AUDIT%'
ORDER BY timestamp DESC LIMIT 100;
```

---

## 9. 本番環境へのデプロイ

### デプロイ前チェックリスト

- [ ] RLS ポリシーが全テーブルに適用
- [ ] Edge Functions が読み取り専用キーを使用
- [ ] 環境変数が Vercel/本番環境に設定済み
- [ ] データベース バックアップが有効化
- [ ] SSL 強制が有効化
- [ ] Point-in-Time Recovery (PITR) が有効化（Team プラン以上）
- [ ] MFA が全ユーザに強制化（HIPAA 対応時）

### 段階的ロールアウト

```typescript
// feature flag で段階的公開
const useNewFeature = supabase.env.FEATURE_FLAG_NEW_FORM_ENGINE === 'true'
```

---

## 10. パフォーマンス最適化

### クエリ最適化

```typescript
// 推奨: 必要なカラムのみ選択
const { data } = await supabase
  .from('forms')
  .select('id, name, created_at')  // すべて取得しない
  .range(0, 10)

// 非推奨: すべて取得
const { data } = await supabase
  .from('forms')
  .select()
```

### インデックス戦略

```sql
-- アクセス頻度の高いカラムにインデックス
CREATE INDEX idx_forms_store_id ON forms(store_id);
CREATE INDEX idx_forms_user_id ON forms(user_id);
CREATE INDEX idx_forms_created_at ON forms(created_at DESC);

-- 複合インデックス
CREATE INDEX idx_forms_store_user ON forms(store_id, user_id);
```

### コネクション管理

```typescript
// PgBouncer デフォルト設定: 100 コネクション
// 必要に応じて Supabase Dashboard で増設

// バックエンド: コネクションプーリング
// (supabase.js ライブラリは自動管理)
```

---

## 参照資料

- [Supabase 公式 API キー管理](https://supabase.com/docs/guides/api/api-keys)
- [JWT 署名キー管理](https://supabase.com/docs/guides/auth/signing-keys)
- [RLS パフォーマンス最適化](https://github.com/orgs/supabase/discussions/14576)
- [データベーステスト](https://supabase.com/docs/guides/local-development/testing/overview)
- [Realtime ガイド](https://supabase.com/docs/guides/realtime/getting_started)
- [MCP (Model Context Protocol)](https://supabase.com/docs/guides/getting-started/mcp)

---

**最終更新**: 2025-10-16  
**次回レビュー予定**: 2025-12-31
