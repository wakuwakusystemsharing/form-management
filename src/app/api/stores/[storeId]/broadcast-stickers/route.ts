import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getAppEnvironment } from '@/lib/env';
import { deleteBroadcastSticker, insertBroadcastSticker, listBroadcastStickers } from '@/lib/broadcast-repository';

const noStore = { headers: { 'Cache-Control': 'no-store' } };
const STORE_STICKER_MAX = 30;
type Params = { params: Promise<{ storeId: string }> };

// GET /api/stores/{storeId}/broadcast-stickers - 共通 + 店舗のスタンプ
export async function GET(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json({ stickers: await listBroadcastStickers(storeId) }, noStore);
  } catch (error) {
    console.error('[API] broadcast stickers list error:', error);
    return NextResponse.json({ error: 'スタンプの取得に失敗しました' }, { status: 500 });
  }
}

// POST /api/stores/{storeId}/broadcast-stickers - 店舗のスタンプを追加（body: { label, url }。画像は先に /api/upload/menu-image へ）
export async function POST(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const label = (typeof body?.label === 'string' ? body.label.trim() : '').slice(0, 30) || 'スタンプ';
    // LINE に送れるのは https の画像だけ（local の確認用に / 始まりも許可）
    const okUrl = /^https:\/\/\S+$/i.test(url) || (getAppEnvironment() === 'local' && url.startsWith('/'));
    if (!okUrl) return NextResponse.json({ error: '画像をアップロードしてください（https の画像のみ）' }, { status: 400 });
    const existing = (await listBroadcastStickers(storeId)).filter((s) => s.store_id === storeId);
    if (existing.length >= STORE_STICKER_MAX) return NextResponse.json({ error: `店舗のスタンプは ${STORE_STICKER_MAX} 個までです` }, { status: 400 });
    const sticker = await insertBroadcastSticker({ store_id: storeId, label, url, sort: existing.length });
    return NextResponse.json({ sticker }, { status: 201, ...noStore });
  } catch (error) {
    console.error('[API] broadcast stickers create error:', error);
    return NextResponse.json({ error: 'スタンプの保存に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/stores/{storeId}/broadcast-stickers?id= - 店舗が追加したスタンプを削除（共通分は不可）
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const id = new URL(request.url).searchParams.get('id') || '';
    const ok = id ? await deleteBroadcastSticker(storeId, id) : false;
    if (!ok) return NextResponse.json({ error: 'スタンプが見つかりません（共通のスタンプは削除できません）' }, { status: 404 });
    return NextResponse.json({ success: true }, noStore);
  } catch (error) {
    console.error('[API] broadcast stickers delete error:', error);
    return NextResponse.json({ error: 'スタンプの削除に失敗しました' }, { status: 500 });
  }
}
