/**
 * 店舗単位の管理 API 共通の認可チェック
 *
 * - local 環境: 認証スキップ（null を返す）
 * - それ以外: getCurrentUser → checkStoreAccess（マスター / システム管理者 / 店舗管理者）
 *
 * 失敗時はそのまま返せる NextResponse を返し、成功時は null と認証ユーザーを返す。
 * 顧客 API（customers/route.ts）の authorizeStoreAccess と同じ挙動を共通化したもの。
 */
import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { checkStoreAccess, createAuthenticatedClient, getSupabaseAdminClient, isServiceAdmin } from '@/lib/supabase';
import { getCurrentUser, getCurrentUserRole } from '@/lib/auth-helper';

export interface StoreAccessResult {
  response: NextResponse | null;
  user: { id: string; email: string | undefined } | null;
}

function extractAccessToken(request: Request): string | null {
  const cookieToken = request.headers
    .get('cookie')
    ?.split(';')
    .find((c) => c.trim().startsWith('sb-access-token='))
    ?.trim()
    .substring('sb-access-token='.length);
  const bearer = request.headers.get('authorization')?.replace('Bearer ', '');
  return cookieToken || bearer || null;
}

export async function authorizeStoreAccess(request: Request, storeId: string): Promise<StoreAccessResult> {
  if (getAppEnvironment() === 'local') {
    return { response: null, user: null };
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return { response: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), user: null };
  }

  const token = extractAccessToken(request);
  if (!token) {
    return { response: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), user: null };
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    return { response: NextResponse.json({ error: '認証に失敗しました' }, { status: 401 }), user: null };
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    return { response: NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 }), user };
  }

  return { response: null, user };
}

/**
 * 運営（マスター管理者・システム管理者）か。移行期間中の旧方式（メールアドレスで判定するサービス管理者）も運営として扱う
 * （checkStoreAccess・店舗作成の権限チェックと同じ扱い）
 */
async function resolveUpperRole(request: Request): Promise<{ upper: boolean; master: boolean }> {
  const role = await getCurrentUserRole(request);
  if (role?.role === 'master') return { upper: true, master: true };
  if (role?.role === 'system') return { upper: true, master: false };
  if (role?.email && isServiceAdmin(role.email)) return { upper: true, master: true };
  return { upper: false, master: false };
}

/**
 * 弊社（マスター管理者・システム管理者）だけが行える操作の認可チェック。
 * 店舗へのアクセス権に加えて、役割が運営であることを確認する（店舗管理者は 403）。
 * 画面でボタンを隠すだけにせず、API 側でも必ずこれを通す。local 環境は認証スキップ
 */
export async function authorizeUpperAdminStoreAccess(request: Request, storeId: string): Promise<StoreAccessResult> {
  const auth = await authorizeStoreAccess(request, storeId);
  if (auth.response || getAppEnvironment() === 'local') return auth;
  if (!(await resolveUpperRole(request)).upper) {
    return { response: NextResponse.json({ error: 'この操作は管理者（運営）だけが行えます' }, { status: 403 }), user: auth.user };
  }
  return auth;
}

/**
 * その店舗を「誰として」見ているか（店舗情報の出し分け用。エラーにはしない）。
 * - upper  … 運営で、この店舗にアクセスできる。local 環境もこれ
 * - store  … この店舗の店舗管理者
 * - public … ログインしていない / この店舗にアクセスできない
 * master = マスター管理者か（テナントの付け替えなど、マスターだけの操作の判定用）
 */
export async function resolveStoreViewer(request: Request, storeId: string): Promise<{ viewer: 'public' | 'store' | 'upper'; master: boolean }> {
  if (getAppEnvironment() === 'local') return { viewer: 'upper', master: true };
  try {
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return { viewer: 'public', master: false };
    const role = await resolveUpperRole(request);
    return role.upper ? { viewer: 'upper', master: role.master } : { viewer: 'store', master: false };
  } catch {
    return { viewer: 'public', master: false };
  }
}

/** ID から店舗をたどって認可するときの対象（テーブル名と、見つからないときの文言） */
const RECORD_TABLES = {
  reservation_form: { table: 'reservation_forms', notFound: 'フォームが見つかりません' },
  survey_form: { table: 'survey_forms', notFound: 'フォームが見つかりません' },
  reservation: { table: 'reservations', notFound: '予約が見つかりません' },
} as const;
export type StoreRecordKind = keyof typeof RECORD_TABLES;

/**
 * フォーム ID・アンケート ID・予約 ID で呼ばれる管理 API の認可チェック。
 * その行が属する店舗を調べてから、店舗へのアクセス権（マスター / システム管理者 / 店舗管理者）を確認する。
 * - local 環境: 認証スキップ
 * - 行が無い: 404 / 未ログイン: 401 / 別の店舗: 403
 * 成功時は storeId（その行の店舗）も返す
 */
export async function authorizeRecordStoreAccess(request: Request, kind: StoreRecordKind, id: string): Promise<StoreAccessResult & { storeId: string | null }> {
  if (getAppEnvironment() === 'local') return { response: null, user: null, storeId: null };
  const def = RECORD_TABLES[kind];
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) return { response: NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 }), user: null, storeId: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (adminClient as any).from(def.table).select('store_id').eq('id', id).maybeSingle();
  if (error) {
    console.error('[authorizeRecordStoreAccess] lookup error:', error.message);
    return { response: NextResponse.json({ error: '権限の確認に失敗しました' }, { status: 500 }), user: null, storeId: null };
  }
  const storeId = typeof data?.store_id === 'string' ? data.store_id : null;
  if (!storeId) return { response: NextResponse.json({ error: def.notFound }, { status: 404 }), user: null, storeId: null };
  const auth = await authorizeStoreAccess(request, storeId);
  return { ...auth, storeId };
}
