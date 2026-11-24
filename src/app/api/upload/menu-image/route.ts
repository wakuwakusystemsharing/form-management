/**
 * 画像アップロードAPI
 * メニュー・サブメニュー画像をSupabase Storageにアップロード
 * 古い画像があれば自動削除
 * 
 * POST /api/upload/menu-image
 * Body: FormData with 'file', 'storeId', 'menuId' or 'submenuId', optional 'oldImageUrl'
 */

import { NextRequest, NextResponse } from 'next/server';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';
import fs from 'fs';
import path from 'path';
import { authorizeStoreAccess } from '@/lib/store-access';

/**
 * 画像の URL / パスから、その画像が属する店舗 ID を取り出す（menu_images/{storeId}/… か submenu_images/{storeId}/…）。
 * それ以外の場所（フォームの HTML など）や、上の階層へ出るパスは null = 削除させない
 */
function imageStoreId(urlOrPath: string): string | null {
  if (!urlOrPath || urlOrPath.includes('..')) return null;
  const m = urlOrPath.match(/(?:^|\/)(?:menu_images|submenu_images)\/([A-Za-z0-9_-]{1,64})\/[^/?#]+(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const storeId = formData.get('storeId') as string;
    const menuId = formData.get('menuId') as string | null;
    const submenuId = formData.get('submenuId') as string | null;
    const oldImageUrl = formData.get('oldImageUrl') as string | null;

    // バリデーション
    if (!file || !storeId) {
      return NextResponse.json(
        { error: 'ファイルと店舗IDが必要です' },
        { status: 400 }
      );
    }

    // 画像のアップロードは、その店舗にアクセスできる人だけ（local は認証スキップ）
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) {
      return NextResponse.json({ error: '店舗IDが正しくありません' }, { status: 400 });
    }
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    // 保存先の名前に使うので、フォルダの区切りや上の階層へ出る文字を通さない
    const imageKey = menuId || submenuId || '';
    if (imageKey && (!/^[A-Za-z0-9_.-]{1,120}$/.test(imageKey) || imageKey.includes('..'))) {
      return NextResponse.json({ error: '画像の名前が正しくありません' }, { status: 400 });
    }

    if (!menuId && !submenuId) {
      return NextResponse.json(
        { error: 'menuIdまたはsubmenuIdが必要です' },
        { status: 400 }
      );
    }

    // ファイルサイズチェック（5MB制限）
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'ファイルサイズは5MB以下にしてください' },
        { status: 400 }
      );
    }

    // ファイルタイプチェック
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: '画像ファイル（JPEG, PNG, GIF, WebP）のみアップロード可能です' },
        { status: 400 }
      );
    }

    // ファイル拡張子取得
    const ext = file.name.split('.').pop() || 'jpg';

    // パス生成（アップロードごとに別のファイル名にする。同じ名前で上書きすると、画像は 1 年キャッシュされるため
    // 新しい形でトリミングし直しても古い画像が表示され続ける。古い画像は oldImageUrl で削除する）
    const stamp = Date.now().toString(36);
    const newPath = menuId
      ? `menu_images/${storeId}/${menuId}_${stamp}.${ext}`
      : `submenu_images/${storeId}/${submenuId}_${stamp}.${ext}`;

    // 古い画像を削除（存在する場合）
    // 古い画像は、この店舗の画像置き場にあるものだけ消す（ほかの店舗の画像やフォームの HTML を消させない）
    if (oldImageUrl && imageStoreId(oldImageUrl) === storeId) {
      const deployer = new SupabaseStorageDeployer();
      try {
        // ローカル開発環境の場合、ローカルファイルを削除
        if (oldImageUrl.startsWith('/')) {
          const localFilePath = path.join(process.cwd(), 'public', oldImageUrl);
          if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
            console.log(`[LOCAL MODE] Old image deleted: ${localFilePath}`);
          }
        } else {
          // 本番環境の場合、Supabase Storageから削除
          await deployer.deleteImage(oldImageUrl);
        }
      } catch (error) {
        console.warn('Failed to delete old image:', error);
        // 古い画像の削除失敗は続行する
      }
    }

    // 新しい画像をアップロード
    const deployer = new SupabaseStorageDeployer();
    const buffer = Buffer.from(await file.arrayBuffer());
    const storageUrl = await deployer.uploadImage(buffer, newPath);

    return NextResponse.json({
      success: true,
      url: storageUrl,
      path: newPath
    });
  } catch (error) {
    console.error('Image upload error:', error);
    return NextResponse.json(
      { error: '画像のアップロードに失敗しました' },
      { status: 500 }
    );
  }
}

// 画像削除API
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');

    if (!imageUrl) {
      return NextResponse.json(
        { error: '画像URLが必要です' },
        { status: 400 }
      );
    }

    // 消せるのは画像置き場の画像だけ。その画像の店舗にアクセスできる人だけ（local は認証スキップ）
    const storeId = imageStoreId(imageUrl);
    if (!storeId) {
      return NextResponse.json({ error: '削除できる画像ではありません' }, { status: 400 });
    }
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;

    const deployer = new SupabaseStorageDeployer();
    await deployer.deleteImage(imageUrl);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Image deletion error:', error);
    return NextResponse.json(
      { error: '画像の削除に失敗しました' },
      { status: 500 }
    );
  }
}
