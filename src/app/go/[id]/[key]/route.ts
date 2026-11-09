import { NextResponse } from 'next/server';
import { getLineFlexLinkTarget, incrementLineFlexTap } from '@/lib/line-flex-repository';
import { LINE_FLEX_ID_PATTERN } from '@/lib/line-flex-templates';

/**
 * GET /go/{messageId}/{key} - Flex Message のボタンの計測リンク
 * タップ数を 1 増やして本来の URL へリダイレクトする（認証なし。URL は店舗が公開したものだけ）
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  if (!LINE_FLEX_ID_PATTERN.test(id) || !/^\d{1,3}$/.test(key)) {
    return NextResponse.json({ error: 'リンクが正しくありません' }, { status: 404 });
  }
  const target = await getLineFlexLinkTarget(id, key).catch(() => null);
  if (!target || !/^https:\/\//i.test(target)) {
    return NextResponse.json({ error: 'リンク先が見つかりません' }, { status: 404 });
  }
  // 計測は待たない（リダイレクトを遅らせない）
  incrementLineFlexTap(id, key).catch(() => {});
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
