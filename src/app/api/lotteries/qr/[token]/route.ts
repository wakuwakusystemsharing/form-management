import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { buildQrPayload, QR_TOKEN_PATTERN } from '@/lib/lottery-qr';

/**
 * GET /api/lotteries/qr/[token].png - 当選 QR コードの PNG 画像
 *
 * 認証なし（QR トークンそのものが秘密。32 文字ランダムで推測不可）。
 * 静的フォームの結果画面と Bot の Flex メッセージから参照される。
 * QR の中身は `{baseUrl}/r/{token}`（店舗スタッフ用スキャン画面が読み取る）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: raw } = await params;
    const token = decodeURIComponent(raw || '').replace(/\.png$/i, '');
    if (!QR_TOKEN_PATTERN.test(token)) {
      return NextResponse.json({ error: 'トークンが不正です' }, { status: 400 });
    }
    const png = await QRCode.toBuffer(buildQrPayload(token), {
      type: 'png',
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[API] Lottery QR error:', error);
    return NextResponse.json({ error: 'QR コードの生成に失敗しました' }, { status: 500 });
  }
}
