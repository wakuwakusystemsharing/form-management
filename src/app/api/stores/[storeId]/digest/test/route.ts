import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { sendDigestTest } from '@/lib/store-digest-service';

// POST /api/stores/{storeId}/digest/test - テスト送信（保存済みの送り先へ、いまの内容を送る）
//   body: { kind: 'morning' | 'monthly' }
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const kind = body?.kind;
    if (kind !== 'morning' && kind !== 'monthly') return NextResponse.json({ error: '送る内容を指定してください' }, { status: 400 });
    const result = await sendDigestTest(storeId, kind, new URL(request.url).origin);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.value, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] store digest test error:', error);
    return NextResponse.json({ error: 'テスト送信に失敗しました' }, { status: 500 });
  }
}
