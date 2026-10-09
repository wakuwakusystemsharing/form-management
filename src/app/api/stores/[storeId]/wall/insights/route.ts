import { authorizeStoreAccess } from '@/lib/store-access';
import { getWallInsights } from '@/lib/wall-service';
import { wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/** GET /api/stores/{storeId}/wall/insights - 見どころまとめ（週ごとの件数・よく出る言葉。本文と日時だけを使う） */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await getWallInsights(storeId);
    return result.ok ? wallJson({ insights: result.insights }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('insights', error);
  }
}
