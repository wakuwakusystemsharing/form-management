import { getPublicWall } from '@/lib/wall-service';
import { wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * GET /api/walls/{storeId}?cursor=&limit=&id_token=&friend=1（local: &line_user_id=）
 * 公開 API。ボード設定 + 公開中の付箋（新しい順）。本人確認は任意（is_mine / 同意済みの判定に使う）。
 * レスポンスに投稿者の情報（ハッシュ・LINE ユーザー ID・表示名）は含めない
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const url = new URL(request.url);
    const result = await getPublicWall(
      storeId,
      {
        id_token: url.searchParams.get('id_token') ?? undefined,
        line_user_id: url.searchParams.get('line_user_id') ?? undefined,
        line_friend_flag: url.searchParams.get('friend') ?? undefined,
      },
      { cursor: url.searchParams.get('cursor') ?? undefined, limit: url.searchParams.get('limit') ?? undefined }
    );
    return result.ok ? wallJson(result.data) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('board', error);
  }
}
