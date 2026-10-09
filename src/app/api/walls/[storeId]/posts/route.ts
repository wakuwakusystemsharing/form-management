import { createWallPost } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * POST /api/walls/{storeId}/posts
 * body: { id_token, line_friend_flag?, body, consent?: { agreed: true, terms_version } }（local: line_user_id）
 * 201: { post, status: 'published' | 'pending', message } / 428: 同意が必要 / 429: 1 日 3 件・30 秒の上限
 */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const result = await createWallPost(storeId, await readJsonBody(request));
    return result.ok ? wallJson({ post: result.post, status: result.status, message: result.message }, 201) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('post', error);
  }
}
