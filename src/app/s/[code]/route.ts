import { NextResponse } from 'next/server';
import { isBotUserAgent, pickSourceCode, resolveSourceRedirect } from '@/lib/reservation-sources';
import { getSourceByCode, getStoreForm, incrementSourceClick } from '@/lib/reservation-source-repository';

export const dynamic = 'force-dynamic';

function notFound(): NextResponse {
  return new NextResponse('このリンクは使えません。お手数ですが、お店にお問い合わせください。', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /s/{code} - 流入経路の URL（QR コードの中身）
 * 「読まれた数」を 1 増やして、予約フォームを ?src={code} 付きで開く（認証なし）。
 * 停止中の経路は数えず、?src= も付けない（通常のフォームとして開く）
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = pickSourceCode(raw);
  if (!code) return notFound();
  const source = await getSourceByCode(code);
  if (!source) return notFound();
  const form = await getStoreForm(source.store_id, source.form_id);
  const target = resolveSourceRedirect(source, form, new URL(request.url).origin);
  if (!target) return notFound();
  // 数えるのは待たない（お客様の移動を遅らせない）。検索ロボットやリンクの下見は数えない
  if (source.active && !isBotUserAgent(request.headers.get('user-agent'))) {
    incrementSourceClick(code).catch(() => {});
  }
  return NextResponse.redirect(target, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
