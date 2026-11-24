import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { authorizeStoreAccess } from '@/lib/store-access';
import { buildSourceEntryUrl } from '@/lib/reservation-sources';
import { getSourceById } from '@/lib/reservation-source-repository';

export const dynamic = 'force-dynamic';

// GET /api/stores/{storeId}/reservation-sources/{id}/qr - 経路の QR コード（PNG）。?download=1 で保存用
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string; id: string }> }) {
  try {
    const { storeId, id } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const source = await getSourceById(storeId, id);
    if (!source) return NextResponse.json({ error: '経路が見つかりません' }, { status: 404 });
    const url = new URL(request.url);
    const png = await QRCode.toBuffer(buildSourceEntryUrl(url.origin, source.code), { type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M' });
    const headers: Record<string, string> = { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (url.searchParams.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="qr-${source.code}.png"`;
    return new NextResponse(new Uint8Array(png), { status: 200, headers });
  } catch (error) {
    console.error('[API] reservation-sources qr error:', error);
    return NextResponse.json({ error: 'QR コードの生成に失敗しました' }, { status: 500 });
  }
}
