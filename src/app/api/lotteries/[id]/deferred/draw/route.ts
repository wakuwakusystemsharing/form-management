import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getLotteryForm } from '@/lib/lottery-repository';
import { runDeferredDraw } from '@/lib/lottery-deferred-service';
import { logFormAudit } from '@/lib/form-audit';

/**
 * POST /api/lotteries/[id]/deferred/draw - 後日抽選の自動抽選（仮当選を作る）
 *   body: { force?: boolean }  締切前でも締め切って抽選する
 *   再実行すると前回の仮当選を破棄して引き直す
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => ({}))) as { force?: unknown };
    const result = await runDeferredDraw(form, { force: body.force === true });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await logFormAudit(request, {
      storeId: form.store_id, formId: id, formType: 'lottery', action: 'update',
      formName: form.config.basic_info.title || null,
      note: `後日抽選を実行（応募 ${result.data.applicants} 件 → 仮当選 ${result.data.provisional.length} 件）`,
    });
    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[API] Lottery deferred draw error:', error);
    return NextResponse.json({ error: '抽選の実行に失敗しました' }, { status: 500 });
  }
}
