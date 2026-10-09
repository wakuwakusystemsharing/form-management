import { authorizeStoreAccess } from '@/lib/store-access';
import { deleteWallTopicAdmin, saveWallTopicAdmin } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/** PUT /api/stores/{storeId}/wall/topics/{topicId} - お題の更新 */
export async function PUT(request: Request, { params }: { params: Promise<{ storeId: string; topicId: string }> }) {
  try {
    const { storeId, topicId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await saveWallTopicAdmin(storeId, topicId, await readJsonBody(request));
    return result.ok ? wallJson({ topic: result.topic }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('topics update', error);
  }
}

/** DELETE /api/stores/{storeId}/wall/topics/{topicId} - お題の削除（付箋は残り、お題のラベルだけ外れる） */
export async function DELETE(request: Request, { params }: { params: Promise<{ storeId: string; topicId: string }> }) {
  try {
    const { storeId, topicId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const result = await deleteWallTopicAdmin(storeId, topicId);
    return result.ok ? wallJson({ success: true }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('topics delete', error);
  }
}
