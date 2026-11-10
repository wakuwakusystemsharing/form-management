import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getStoreLineToken } from '@/lib/broadcast-repository';
import { importLineFriends } from '@/lib/line-friend-customers';

const TIME_BUDGET_MS = 22 * 1000;
type Params = { params: Promise<{ storeId: string }> };

/* eslint-disable @typescript-eslint/no-explicit-any */

// GET /api/stores/{storeId}/line-friends/import - 予約なしの LINE 友だち（自動登録した顧客）の人数
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (getAppEnvironment() === 'local') return NextResponse.json({ friend_only_count: 0 });
    const adminClient = createAdminClient();
    if (!adminClient) return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    const { count, error } = await (adminClient as any).from('customers').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('line_friend_only', true);
    // 列が未適用の環境では 0 として返す
    return NextResponse.json({ friend_only_count: error ? 0 : count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] line-friends import count error:', error);
    return NextResponse.json({ error: '友だちの人数の取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/line-friends/import - LINE の友だち一覧から、顧客台帳にいない人を取り込む
//   認証済みアカウントのみ（未認証は 400 と案内文）。時間切れのときは remaining: true（もう一度呼ぶと続きから）
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (getAppEnvironment() === 'local') return NextResponse.json({ error: 'ローカル環境では友だちの取り込みは使えません' }, { status: 400 });
    const adminClient = createAdminClient();
    if (!adminClient) return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    const token = await getStoreLineToken(storeId);
    if (!token) return NextResponse.json({ error: 'この店舗の LINE チャネルアクセストークンが未設定です（店舗編集で登録してください）' }, { status: 400 });
    const result = await importLineFriends(adminClient, storeId, token, Date.now() + TIME_BUDGET_MS);
    if (result.error) return NextResponse.json({ error: result.error, imported: result.imported }, { status: result.status ?? 500 });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] line-friends import error:', error);
    return NextResponse.json({ error: '友だちの取り込みに失敗しました' }, { status: 500 });
  }
}
