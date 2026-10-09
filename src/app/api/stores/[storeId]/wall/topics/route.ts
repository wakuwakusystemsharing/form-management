import { authorizeStoreAccess } from '@/lib/store-access';
import { listWallTopicsAdmin, saveWallTopicAdmin } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/** GET /api/stores/{storeId}/wall/topics - お題の一覧（開催中 / 予定 / 終了） */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await listWallTopicsAdmin(storeId);
    return result.ok ? wallJson({ topics: result.topics }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('topics list', error);
  }
}

/** POST /api/stores/{storeId}/wall/topics - お題の作成 { title, description, starts_on, ends_on } */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await saveWallTopicAdmin(storeId, null, await readJsonBody(request));
    return result.ok ? wallJson({ topic: result.topic }, 201) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('topics create', error);
  }
}
