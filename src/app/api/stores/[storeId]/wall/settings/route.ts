import { authorizeStoreAccess } from '@/lib/store-access';
import { getWallSettings, saveWallSettings } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/** GET / PUT /api/stores/{storeId}/wall/settings - 寄せ書きのボード設定（店舗アクセスが必要） */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await getWallSettings(storeId);
    return result.ok ? wallJson(result) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('settings get', error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await saveWallSettings(storeId, await readJsonBody(request));
    return result.ok ? wallJson({ settings: result.settings }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('settings put', error);
  }
}
