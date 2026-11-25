import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getChatInboundImage } from '@/lib/chat-service';

export const dynamic = 'force-dynamic';

// GET /api/stores/{storeId}/chat/media/{messageId} - お客様から届いた画像（トークの画面用）
// 画像は公開していない置き場にあり、ここ（ログインと店舗の確認）を通してだけ読める。
// 他の店舗のメッセージ・画像の無いメッセージは 404
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string; messageId: string }> }) {
  try {
    const { storeId, messageId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const image = await getChatInboundImage(storeId, messageId);
    if (!image) return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 });
    return new NextResponse(new Uint8Array(image.data), {
      headers: {
        'Content-Type': image.contentType,
        // ログインした人のブラウザの中だけに残す（途中のサーバーには残さない）
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    console.error('[API] chat media error:', error);
    return NextResponse.json({ error: '画像の取得に失敗しました' }, { status: 500 });
  }
}
