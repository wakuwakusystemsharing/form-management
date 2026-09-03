import { NextResponse } from 'next/server';
import { getLotteryForm } from '@/lib/lottery-repository';
import { StaticLotteryGenerator } from '@/lib/static-generator-lottery';

/**
 * GET /preview/[storeId]/lotteries/[formId] - 保存済み抽選フォームのプレビュー HTML
 * LIFF を使わず、抽選 API も呼ばない（演出・デザインの確認用）
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { storeId, formId } = await params;
    const form = await getLotteryForm(formId);
    if (!form || form.store_id !== storeId) {
      return new NextResponse('Form not found', { status: 404 });
    }
    // 下書きがあれば下書きを優先して表示
    const target = form.draft_config ? { ...form, config: form.draft_config } : form;
    const html = new StaticLotteryGenerator().generateHTML(target, 'preview');
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[Preview] Lottery preview error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
