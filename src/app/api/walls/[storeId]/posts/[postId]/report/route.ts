import { reportWallPost } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * POST /api/walls/{storeId}/posts/{postId}/report  body: { id_token, reason, line_friend_flag? }
 * reason: abuse（誹謗中傷）/ personal_info（個人情報）/ advertising（宣伝）/ other（その他）。3 件で確認待ち
 */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string; postId: string }> }) {
  try {
    const { storeId, postId } = await params;
    const result = await reportWallPost(storeId, postId, await readJsonBody(request));
    return result.ok ? wallJson({ success: true, message: result.message }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('report', error);
  }
}
