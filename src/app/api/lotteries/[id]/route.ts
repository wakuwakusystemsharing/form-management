import { NextResponse } from 'next/server';
import { logFormAudit } from '@/lib/form-audit';
import { getCurrentUserId } from '@/lib/auth-helper';
import { authorizeStoreAccess } from '@/lib/store-access';
import { normalizeLotteryConfig } from '@/lib/lottery-normalizer';
import { deleteLotteryForm, getLotteryForm, listEntriesForForm, updateLotteryForm } from '@/lib/lottery-repository';
import { validateLotteryConfigForSave } from '@/lib/lottery-service';
import type { LotteryFormStatus } from '@/types/lottery';

const FORM_STATUSES: LotteryFormStatus[] = ['active', 'inactive', 'paused'];

// GET /api/lotteries/[id] - 抽選フォーム取得（公開。静的 HTML 生成・プレビュー用）
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const form = await getLotteryForm(id);
    if (!form) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(form);
  } catch (error) {
    console.error('[API] Lottery form fetch error:', error);
    return NextResponse.json({ error: '抽選フォームの取得に失敗しました' }, { status: 500 });
  }
}

// PUT /api/lotteries/[id] - 抽選フォーム更新（フォームオブジェクト全体を渡す）
//   body: { config, status?, draft_config? }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getLotteryForm(id);
    if (!existing) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    const auth = await authorizeStoreAccess(request, existing.store_id);
    if (auth.response) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !body.config) {
      return NextResponse.json({ error: 'config は必須です' }, { status: 400 });
    }

    const config = normalizeLotteryConfig(body.config);
    const errors = validateLotteryConfigForSave(config);
    if (errors.length > 0) {
      return NextResponse.json({ error: '設定に不備があります', details: errors }, { status: 400 });
    }

    // 履歴がある状態で抽選方式を切り替えると在庫・確率の意味が変わるため禁止
    if (config.lottery_type !== existing.config.lottery_type) {
      const entries = await listEntriesForForm(id);
      if (entries.length > 0) {
        return NextResponse.json(
          { error: '抽選履歴があるため抽選方式（即時 / 後日）は変更できません。新しい抽選フォームを作成してください' },
          { status: 400 }
        );
      }
    }
    // 後日抽選は抽選実行後に賞品（当選数）を変えられない
    if (existing.config.lottery_type === 'deferred' && existing.deferred_draw_status !== 'accepting') {
      const before = JSON.stringify(existing.config.prizes);
      const after = JSON.stringify(config.prizes);
      if (before !== after) {
        return NextResponse.json({ error: '抽選実行後は賞品を変更できません' }, { status: 400 });
      }
    }

    const status: LotteryFormStatus = FORM_STATUSES.includes(body.status) ? body.status : existing.status;
    const currentUserId = await getCurrentUserId(request);
    const updated = await updateLotteryForm(id, {
      config,
      status,
      draft_status: 'none',
      draft_config: null,
      updated_by: currentUserId,
    });
    if (!updated) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }

    await logFormAudit(request, {
      storeId: updated.store_id,
      formId: id,
      formType: 'lottery',
      action: 'update',
      formName: updated.config.basic_info.title || null,
      before: { config: existing.config, status: existing.status } as unknown as Record<string, unknown>,
      after: { config: updated.config, status: updated.status } as unknown as Record<string, unknown>,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[API] Lottery form update error:', error);
    return NextResponse.json({ error: '抽選フォームの更新に失敗しました' }, { status: 500 });
  }
}

// DELETE /api/lotteries/[id] - 抽選フォーム削除（履歴もカスケード削除）
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getLotteryForm(id);
    if (!existing) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }
    const auth = await authorizeStoreAccess(request, existing.store_id);
    if (auth.response) return auth.response;

    const deleted = await deleteLotteryForm(id);
    if (!deleted) {
      return NextResponse.json({ error: '抽選フォームが見つかりません' }, { status: 404 });
    }

    await logFormAudit(request, {
      storeId: deleted.store_id,
      formId: id,
      formType: 'lottery',
      action: 'delete',
      formName: deleted.config.basic_info.title || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Lottery form delete error:', error);
    return NextResponse.json({ error: '抽選フォームの削除に失敗しました' }, { status: 500 });
  }
}
