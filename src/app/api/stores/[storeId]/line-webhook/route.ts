import { NextResponse } from 'next/server';
import { authorizeUpperAdminStoreAccess } from '@/lib/store-access';
import { buildLineWebhookUrl, normalizeChannelSecret } from '@/lib/line-signature';
import { deleteStoreLineSecret, getStoreLineSecret, setStoreLineSecret } from '@/lib/line-secret-repository';

export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

/** 画面に返す状態（シークレットそのものは返さない） */
async function buildStatus(request: Request, storeId: string) {
  const state = await getStoreLineSecret(storeId);
  return {
    secret_set: state.status === 'set',
    updated_at: state.status === 'set' ? state.updated_at : null,
    webhook_url: buildLineWebhookUrl(new URL(request.url).origin, storeId),
    ...(state.status === 'error' ? { error: 'チャネルシークレットの状態を読み取れませんでした' } : {}),
  };
}

// GET /api/stores/{storeId}/line-webhook - 署名チェックの状態（登録済みか・この店舗の Webhook URL）
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeUpperAdminStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json(await buildStatus(request, storeId), NO_STORE);
  } catch (error) {
    console.error('[API] line-webhook status error:', error);
    return NextResponse.json({ error: '状態の取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/stores/{storeId}/line-webhook - チャネルシークレットを登録 / 上書き（{ channel_secret }）
export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeUpperAdminStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const body = (await request.json().catch(() => null)) as { channel_secret?: unknown } | null;
    const secret = normalizeChannelSecret(body?.channel_secret);
    if (!secret) {
      return NextResponse.json({ error: 'チャネルシークレットの形式が正しくありません（LINE Developers の「チャネル基本設定」にある英数字 32 文字を貼り付けてください）' }, { status: 400 });
    }
    const err = await setStoreLineSecret(storeId, secret);
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    return NextResponse.json(await buildStatus(request, storeId), NO_STORE);
  } catch (error) {
    console.error('[API] line-webhook save error:', error);
    return NextResponse.json({ error: 'チャネルシークレットの保存に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/stores/{storeId}/line-webhook - チャネルシークレットを削除（署名のチェックをやめる）
export async function DELETE(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeUpperAdminStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const err = await deleteStoreLineSecret(storeId);
    if (err) return NextResponse.json({ error: err }, { status: 500 });
    return NextResponse.json(await buildStatus(request, storeId), NO_STORE);
  } catch (error) {
    console.error('[API] line-webhook delete error:', error);
    return NextResponse.json({ error: 'チャネルシークレットの削除に失敗しました' }, { status: 500 });
  }
}
