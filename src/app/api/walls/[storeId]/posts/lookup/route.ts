import { lookupWallPosts } from '@/lib/wall-service';
import { wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * GET /api/walls/{storeId}/posts/lookup?ids=a,b,c&id_token=
 * 「あとで読む」で端末に保存した付箋のうち、今も公開中のものだけを返す（最大 50 件。他店舗の ID は返らない）
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const url = new URL(request.url);
    const result = await lookupWallPosts(storeId, url.searchParams.get('ids') ?? '', {
      id_token: url.searchParams.get('id_token') ?? undefined,
      line_user_id: url.searchParams.get('line_user_id') ?? undefined,
      line_friend_flag: url.searchParams.get('friend') === '1',
    });
    return result.ok ? wallJson({ posts: result.posts }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('lookup', error);
  }
}
