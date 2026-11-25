import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getChatTemplates, updateChatTemplates } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

// GET /api/stores/{storeId}/chat/templates - 1 対 1 トークの定型文の一覧
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json({ templates: await getChatTemplates(storeId) }, NO_STORE);
  } catch (error) {
    console.error('[API] chat templates get error:', error);
    return NextResponse.json({ error: '定型文の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/chat/templates - 定型文を保存する（一覧をまるごと差し替える）
// { templates: [{ id?, title, text }] }（30 個まで・名前 30 文字まで・文 1000 文字まで）
export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => null);
    const result = await updateChatTemplates(storeId, body);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ templates: result.templates }, NO_STORE);
  } catch (error) {
    console.error('[API] chat templates save error:', error);
    return NextResponse.json({ error: '定型文の保存に失敗しました' }, { status: 500 });
  }
}
