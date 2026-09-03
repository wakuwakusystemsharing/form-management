import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryForm } from '@/lib/lottery-repository';
import { updateDeferredWinners } from '@/lib/lottery-deferred-service';

/**
 * PATCH /api/lotteries/[id]/deferred/winners - 仮当選の入替（確定前のみ）
 *   body: { remove?: entryId[], add?: [{ entry_id, prize_id }] }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => null)) as { remove?: unknown; add?: unknown } | null;
    const remove = Array.isArray(body?.remove) ? body!.remove.filter((v): v is string => typeof v === 'string') : [];
    const add = Array.isArray(body?.add)
      ? body!.add
          .filter((v): v is { entry_id: string; prize_id: string } =>
            !!v && typeof v === 'object' && typeof (v as { entry_id?: unknown }).entry_id === 'string' && typeof (v as { prize_id?: unknown }).prize_id === 'string')
      : [];
    if (remove.length === 0 && add.length === 0) {
      return NextResponse.json({ error: 'remove または add を指定してください' }, { status: 400 });
    }
    const result = await updateDeferredWinners(form, { remove, add });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[API] Lottery deferred winners error:', error);
    return NextResponse.json({ error: '仮当選の更新に失敗しました' }, { status: 500 });
  }
}
