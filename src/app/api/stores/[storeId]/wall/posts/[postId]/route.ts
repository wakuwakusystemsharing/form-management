import { authorizeStoreAccess } from '@/lib/store-access';
import { getAppEnvironment } from '@/lib/env';
import { getCurrentUserRole } from '@/lib/auth-helper';
import { moderateWallPost } from '@/lib/wall-service';
import { readJsonBody, wallErrorResponse, wallJson, wallServerError } from '@/lib/wall-http';

/**
 * PATCH /api/stores/{storeId}/wall/posts/{postId}
 * body: { action: 'publish' } または { action: 'hide', reason: 'terms_violation' }（非公開の理由は規約違反のみ）
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ storeId: string; postId: string }> }) {
  try {
    const { storeId, postId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    const role = getAppEnvironment() === 'local' ? null : await getCurrentUserRole(request).catch(() => null);
    const result = await moderateWallPost(storeId, postId, await readJsonBody(request), {
      user_id: role?.userId ?? auth.user?.id ?? null,
      email: role?.email ?? auth.user?.email ?? null,
      role: role?.role ?? null,
    });
    return result.ok ? wallJson({ post: result.post }) : wallErrorResponse(result);
  } catch (error) {
    return wallServerError('moderate', error);
  }
}
