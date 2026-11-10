import { NextResponse } from 'next/server';
import { getBroadcastLinkTarget, incrementBroadcastTap } from '@/lib/broadcast-repository';
import { isBroadcastId } from '@/lib/broadcast-service';

/**
 * GET /go/b/{broadcastId}/{key} - 配信メッセージのボタンの計測リンク
 * タップ数を 1 増やして本来の URL へリダイレクトする（認証なし。URL は店舗が配信したものだけ）
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const { id, key } = await params;
  if (!isBroadcastId(id) || !/^\d{1,3}$/.test(key)) {
    return NextResponse.json({ error: 'リンクが正しくありません' }, { status: 404 });
  }
  const target = await getBroadcastLinkTarget(id, key).catch(() => null);
  if (!target || !/^https:\/\//i.test(target)) {
    return NextResponse.json({ error: 'リンク先が見つかりません' }, { status: 404 });
  }
  // 計測は待たない（リダイレクトを遅らせない）
  incrementBroadcastTap(id, key).catch(() => {});
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
