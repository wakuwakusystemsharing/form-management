import { getMyWallPosts } from '@/lib/wall-service';
import { wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/** GET /api/walls/{storeId}/my-posts?id_token=&line_user_id=  本人の付箋一覧（削除以外。状態付き） */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const url = new URL(request.url);
    const result = await getMyWallPosts(storeId, {
      id_token: url.searchParams.get('id_token') ?? undefined,
      line_user_id: url.searchParams.get('line_user_id') ?? undefined,
      line_friend_flag: url.searchParams.get('friend') === '1',
    });
    return result.ok ? wallJson({ posts: result.posts }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('my-posts', error);
  }
}
