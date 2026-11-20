import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { authorizeUpperAdminStoreAccess } from '@/lib/store-access';
import { getStoreLineToken } from '@/lib/broadcast-repository';
import { getStoreLineSecret } from '@/lib/line-secret-repository';
import { checkLineWebhook } from '@/lib/line-webhook-check';

export const dynamic = 'force-dynamic';

// POST /api/stores/{storeId}/line-webhook/test - 接続を確認（LINE に登録されている Webhook URL と、テストの通知を受け取れるか）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeUpperAdminStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (getAppEnvironment() === 'local') {
      return NextResponse.json({ error: 'local 環境では LINE に接続しないため、確認できません' }, { status: 400 });
    }
    const token = await getStoreLineToken(storeId);
    if (!token) {
      return NextResponse.json({ error: 'この店舗の LINE チャネルアクセストークンが未設定です（店舗編集で登録してください）' }, { status: 400 });
    }
    const state = await getStoreLineSecret(storeId);
    const result = await checkLineWebhook({ token, origin: new URL(request.url).origin, storeId, secretSet: state.status === 'set' });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] line-webhook test error:', error);
    return NextResponse.json({ error: '接続の確認に失敗しました' }, { status: 500 });
  }
}
