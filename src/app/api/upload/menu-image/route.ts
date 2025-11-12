/**
 * 画像アップロードAPI
 * メニュー・サブメニュー画像をSupabase Storageにアップロード
 * 
 * POST /api/upload/menu-image
 * Body: FormData with 'file', 'storeId', 'menuId' or 'submenuId'
 */

import { NextRequest, NextResponse } from 'next/server';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const storeId = formData.get('storeId') as string;
    const menuId = formData.get('menuId') as string | null;
    const submenuId = formData.get('submenuId') as string | null;

    // バリデーション
    if (!file || !storeId) {
      return NextResponse.json(
        { error: 'ファイルと店舗IDが必要です' },
        { status: 400 }
      );
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

    // パス生成
    const path = menuId
      ? `menu_images/${storeId}/${menuId}.${ext}`
      : `submenu_images/${storeId}/${submenuId}.${ext}`;

    // Supabase Storageにアップロード
    const deployer = new SupabaseStorageDeployer();
    const buffer = Buffer.from(await file.arrayBuffer());
    const storageUrl = await deployer.uploadImage(buffer, path);

    return NextResponse.json({
      success: true,
      url: storageUrl,
      path: path
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
