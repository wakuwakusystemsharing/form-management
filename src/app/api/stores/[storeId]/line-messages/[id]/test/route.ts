import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getLineFlexMessage, lineFlexSendMessages } from '@/lib/line-flex-repository';
import { pushLineMessages } from '@/lib/line-push';

type Params = { params: Promise<{ storeId: string; id: string }> };

async function getStoreToken(storeId: string): Promise<string | null> {
  if (getAppEnvironment() === 'local') {
    try {
      const stores = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'stores.json'), 'utf-8')) as Array<{ id: string; line_channel_access_token?: string }>;
      return stores.find((s) => s.id === storeId)?.line_channel_access_token || null;
    } catch {
      return null;
    }
  }
  const adminClient = createAdminClient();
  if (!adminClient) return null;
  const { data } = await (adminClient as any).from('stores').select('line_channel_access_token').eq('id', storeId).maybeSingle();
  return (data as { line_channel_access_token?: string } | null)?.line_channel_access_token || null;
}

// POST /api/stores/{storeId}/line-messages/{id}/test - 指定した LINE ユーザーへテスト送信（push。追加メッセージも含めて 1 回 = 無料通数 1 通消費）
//   body: { line_user_id: string }
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => ({}));
    const to = typeof body?.line_user_id === 'string' ? body.line_user_id.trim() : '';
    if (!/^U[0-9a-f]{32}$/i.test(to)) return NextResponse.json({ error: '送信先の LINE ユーザー ID が正しくありません（顧客管理から LINE 連携済みの顧客を選んでください）' }, { status: 400 });
    const message = await getLineFlexMessage(storeId, id);
    if (!message) return NextResponse.json({ error: 'メッセージが見つかりません' }, { status: 404 });
    const messages = lineFlexSendMessages(message);
    if (messages.length === 0) return NextResponse.json({ error: 'メッセージの内容が空です。保存し直してください' }, { status: 400 });
    const token = await getStoreToken(storeId);
    if (!token) return NextResponse.json({ error: 'この店舗の LINE チャネルアクセストークンが未設定です（店舗編集で登録してください）' }, { status: 400 });
    const result = await pushLineMessages(token, to, messages);
    if (!result.ok) {
      const detail = result.body.slice(0, 300);
      return NextResponse.json({ error: `LINE への送信に失敗しました（${result.status}）`, details: detail }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] line-messages test error:', error);
    return NextResponse.json({ error: 'テスト送信に失敗しました' }, { status: 500 });
  }
}
