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
    const newPath = menuId
      ? `menu_images/${storeId}/${menuId}.${ext}`
      : `submenu_images/${storeId}/${submenuId}.${ext}`;

    // 古い画像を削除（存在する場合）
    if (oldImageUrl) {
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
