import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { uploadChatReplyImage } from '@/lib/chat-service';
import { CHAT_OUTBOUND_IMAGE_MAX_BYTES } from '@/lib/chat';

export const dynamic = 'force-dynamic';

// POST /api/stores/{storeId}/chat/images - 返信で送る画像をアップロードする（FormData の 'file'）
// JPEG / PNG・1MB まで（画面で縮めてから送る）。返ってきた url を、返信の API に image_url として渡す。
// 画像は LINE が取りに来るので公開の場所に置く（名前は推測できない 32 桁）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: '画像を選んでください' }, { status: 400 });
    if (file.size > CHAT_OUTBOUND_IMAGE_MAX_BYTES) return NextResponse.json({ error: '画像が大きすぎます（1MB まで）。もう一度、画像を選び直してください' }, { status: 400 });
    const result = await uploadChatReplyImage(storeId, Buffer.from(await file.arrayBuffer()));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ url: result.url }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] chat image upload error:', error);
    return NextResponse.json({ error: '画像のアップロードに失敗しました' }, { status: 500 });
  }
}
