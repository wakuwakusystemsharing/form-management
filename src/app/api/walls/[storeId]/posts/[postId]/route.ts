import { deleteWallPost } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * DELETE /api/walls/{storeId}/posts/{postId}  body: { id_token }（local: line_user_id）
 * 本人の付箋だけ削除できる（他人・他店舗・存在しない付箋はすべて 404）
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ storeId: string; postId: string }> }) {
  try {
    const { storeId, postId } = await params;
    const result = await deleteWallPost(storeId, postId, await readJsonBody(request));
    return result.ok ? wallJson({ success: true }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('delete', error);
  }
}
