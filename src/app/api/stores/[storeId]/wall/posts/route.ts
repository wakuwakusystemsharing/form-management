import { authorizeStoreAccess } from '@/lib/store-access';
import { listAdminWallPosts } from '@/lib/wall-service';
import { wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * GET /api/stores/{storeId}/wall/posts?filter=all|published|pending|review|hidden|deleted|reported&cursor=&limit=&topic=&search=
 * 店舗管理用の付箋一覧。投稿者の情報は含めない（本人削除は本文も返さない）
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const url = new URL(request.url);
    const result = await listAdminWallPosts(storeId, {
      filter: url.searchParams.get('filter') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      topic: url.searchParams.get('topic') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
    });
    return result.ok ? wallJson({ posts: result.posts, next_cursor: result.next_cursor }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('admin list', error);
  }
}
