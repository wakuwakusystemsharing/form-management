import { NextResponse } from 'next/server';
import { getDecryptedCredentials } from '../../credentials/route';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type { SalonBoardMenu } from '@/types/salon-board';

const DATA_DIR = path.join(process.cwd(), 'data');

// スクレイパーサービスのURL（別サーバーで実行）
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:3001';

/**
 * ローカル環境用のファイルパス
 */
function getMenusFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_menus_${storeId}.json`);
}

function getCategoriesFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_categories_${storeId}.json`);
}

/**
 * POST /api/stores/[storeId]/salon-board/sync/menus
 * サロンボードからメニュー・クーポンをスクレイピングして同期（外部スクレイパーサービスを使用）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const startTime = Date.now();

  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // 認証情報を取得
    const credentials = await getDecryptedCredentials(storeId);
    if (!credentials) {
      return NextResponse.json(
        { success: false, error: '認証情報が設定されていません' },
        { status: 400 }
      );
    }

    // 外部スクレイパーサービスにメニュー取得を依頼
    const scraperResponse = await fetch(`${SCRAPER_SERVICE_URL}/api/scrape/menus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginId: credentials.loginId,
        password: credentials.password,
      }),
    });

    const menuResult = await scraperResponse.json();

    if (!menuResult.success) {
      return NextResponse.json(
        { success: false, error: menuResult.error || 'メニュー取得に失敗しました' },
        { status: scraperResponse.status }
      );
    }

    const duration = Date.now() - startTime;

    // メニューのみを取得（クーポンは別途対応）
    const allMenus: SalonBoardMenu[] = menuResult.data || [];

    console.log(
      `[SalonBoard] Menu sync for store ${storeId}: ${allMenus.length} menus (${duration}ms)`
    );

    if (env === 'local') {
      // ローカル環境: JSON に保存
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const now = new Date().toISOString();

      // カテゴリを抽出
      const categoriesMap = new Map<string, any>();
      allMenus.forEach(menu => {
        menu.categories?.forEach((cat: any) => {
          if (!categoriesMap.has(cat.id)) {
            categoriesMap.set(cat.id, {
              id: `sbcat_${storeId}_${cat.id}`,
              store_id: storeId,
              title: cat.title,
              thumbnail: cat.thumbnail || null,
              display_order: cat.order || 0,
              description: cat.description || null,
              type: cat.type || 'menu',
              text_content: cat.text_content || null,
              is_hidden: Boolean(cat.is_hidden),
              created_at: now,
              updated_at: now,
            });
          }
        });
      });

      // カテゴリ保存
      const categories = Array.from(categoriesMap.values());
      fs.writeFileSync(getCategoriesFilePath(storeId), JSON.stringify(categories, null, 2));

      // メニュー保存
      const menusToSave = allMenus.map(menu => ({
        id: `sbmenu_${storeId}_${menu.menu_id}`,
        store_id: storeId,
        menu_id: menu.menu_id,
        title: menu.title,
        custom_title: menu.custom_title || null,
        description: menu.description || null,
        custom_description: menu.custom_description || null,
        image_url: menu.image_url || null,
        original_image_url: menu.original_image_url || null,
        reservation_url: menu.reservation_url || null,
        type: menu.type,
        price: menu.price || null,
        custom_price: menu.custom_price || null,
        treatment_time: menu.treatment_time || null,
        visit_date_conditions: menu.visit_date_conditions || null,
        other_condition: menu.other_condition || null,
        menu_category_cd: menu.menu_category_cd || null,
        class: menu.class || null,
        is_hidden: menu.is_hidden || false,
        is_custom_title: menu.is_custom_title || false,
        is_custom_description: menu.is_custom_description || false,
        is_custom_price: menu.is_custom_price || false,
        is_price_range: menu.is_price_range || false,
        sync_source: 'salonboard',
        display_order: menu.display_order || 0,
        last_synced_at: now,
        created_at: now,
        updated_at: now,
        categories: menu.categories?.map((c: any) => categoriesMap.get(c.id)) || [],
      }));

      fs.writeFileSync(getMenusFilePath(storeId), JSON.stringify(menusToSave, null, 2));

      return NextResponse.json({
        success: true,
        items_synced: allMenus.length,
        menus: menusToSave,
        duration_ms: duration,
      });
    }

    // staging/production: Supabase対応
    // TODO: Supabase対応

    return NextResponse.json({
      success: true,
      items_synced: allMenus.length,
      menus: allMenus,
      duration_ms: duration,
    });
  } catch (error) {
    console.error('[SalonBoard] Menu sync error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Internal server error';

    // スクレイパーサービスに接続できない場合
    if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
      return NextResponse.json(
        {
          success: false,
          error: 'スクレイパーサービスに接続できません。サービスが起動しているか確認してください。',
          duration_ms: Date.now() - startTime,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
