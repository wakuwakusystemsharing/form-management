import { authorizeStoreAccess } from '@/lib/store-access';
import { getWallStats } from '@/lib/wall-service';
import { wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/** GET /api/stores/{storeId}/wall/stats - ダッシュボード用（直近 7 日の投稿数・承認待ち・確認待ち） */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await getWallStats(storeId);
    return result.ok ? wallJson({ stats: result.stats }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('stats', error);
  }
}
