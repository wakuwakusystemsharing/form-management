import { NextResponse } from 'next/server';
import { findLatestUserEntry, getLotteryForm, updateLotteryEntry } from '@/lib/lottery-repository';
import { getStoreForLottery, resolveLineUser, toDrawResponse } from '@/lib/lottery-service';

/**
 * 同一 LINE ユーザーの直近の抽選結果（再訪時の再表示用。公開 API・ID トークン検証あり）
 *
 * GET  /api/lotteries/[id]/my-result?id_token=...        （local: &line_user_id=...）
 * PATCH /api/lotteries/[id]/my-result  body: { id_token, line_user_id?, message_sent: true }
 *        → LIFF sendMessages 完了を記録
 */
async function resolve(request: Request, formId: string, body: Record<string, unknown>) {
  const form = await getLotteryForm(formId);
  if (!form) return { error: NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 }) };
  const store = await getStoreForLottery(form.store_id);
  if (!store) return { error: NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 }) };
  const resolved = await resolveLineUser(body, store);
  if (!resolved.ok) return { error: NextResponse.json({ error: resolved.error, details: resolved.detail ?? null }, { status: resolved.status }) };
  const entry = await findLatestUserEntry(form.id, resolved.user.userId);
  return { form, store, entry };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const body = {
      id_token: url.searchParams.get('id_token') ?? undefined,
      line_user_id: url.searchParams.get('line_user_id') ?? undefined,
    };
    const r = await resolve(request, id, body);
    if ('error' in r) return r.error;
    if (!r.entry) return NextResponse.json({ result: null });
    return NextResponse.json({ result: toDrawResponse(r.form, r.entry, r.store.name, true) });
  } catch (error) {
    console.error('[API] Lottery my-result error:', error);
    return NextResponse.json({ error: '抽選結果の取得に失敗しました' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: 'リクエストが不正です' }, { status: 400 });
    const r = await resolve(request, id, body);
    if ('error' in r) return r.error;
    if (!r.entry) return NextResponse.json({ error: '抽選結果が見つかりません' }, { status: 404 });
    if (body.message_sent === true && !r.entry.message_sent) {
      await updateLotteryEntry(r.entry.id, { message_sent: true });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Lottery my-result update error:', error);
    return NextResponse.json({ error: '抽選結果の更新に失敗しました' }, { status: 500 });
  }
}
