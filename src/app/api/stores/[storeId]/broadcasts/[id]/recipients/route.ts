import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getBroadcast, listBroadcastRecipients } from '@/lib/broadcast-repository';
import { isBroadcastId } from '@/lib/broadcast-service';

type Params = { params: Promise<{ storeId: string; id: string }> };

// GET /api/stores/{storeId}/broadcasts/{id}/recipients?status=&limit=&offset= - 配信ごとの宛先と結果
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    if (!isBroadcastId(id) || !(await getBroadcast(storeId, id))) return NextResponse.json({ error: '配信が見つかりません' }, { status: 404 });
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const result = await listBroadcastRecipients(id, {
      status: status === 'pending' || status === 'sent' || status === 'failed' || status === 'skipped' ? status : undefined,
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    // LINE ユーザー ID は画面に不要なので返さない
    return NextResponse.json(
      { total: result.total, recipients: result.recipients.map((r) => ({ id: r.id, customer_id: r.customer_id, display_name: r.display_name, status: r.status, error: r.error, sent_at: r.sent_at })) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[API] broadcast recipients error:', error);
    return NextResponse.json({ error: '宛先の取得に失敗しました' }, { status: 500 });
  }
}
