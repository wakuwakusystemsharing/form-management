import { toggleWallEmpathyForViewer } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * POST /api/walls/{storeId}/posts/{postId}/empathy  body: { id_token, line_friend_flag? }
 * 「共感」を押す / 取り消す（公開中の付箋のみ。自分の付箋は不可。店舗が共感を OFF なら 404）
 * 押した人は hash だけを保存し、誰が押したかはお店にも出さない
 */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string; postId: string }> }) {
  try {
    const { storeId, postId } = await params;
    const result = await toggleWallEmpathyForViewer(storeId, postId, await readJsonBody(request));
    return result.ok ? wallJson({ empathized: result.empathized, empathy_count: result.empathy_count }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('empathy', error);
  }
}
