import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type {
  SalonBoardMenu,
  SalonBoardCategory,
  SalonBoardStylist,
  ScrapedMenuData,
  SyncMenusResponse,
} from '@/types/salon-board';
import { createSyncLog } from '../sync-logs/route';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * ローカル環境用のファイルパス
 */
function getMenusFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_menus_${storeId}.json`);
}

function getCategoriesFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_categories_${storeId}.json`);
}

function getStylistsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_stylists_${storeId}.json`);
}

/**
 * スクレイピングデータをDB形式に変換
 */
function convertScrapedMenu(scraped: ScrapedMenuData, storeId: string): Omit<SalonBoardMenu, 'categories' | 'stylists'> {
  const now = new Date().toISOString();
  return {
    id: `sbmenu_${storeId}_${scraped.menu_id}`,
    store_id: storeId,
    menu_id: scraped.menu_id,
    title: scraped.title,
    custom_title: scraped.custom_title || null,
    description: scraped.description || null,
    custom_description: scraped.custom_description || null,
    image_url: scraped.image_url,
    original_image_url: scraped.original_image_url,
    reservation_url: scraped.reservation_url,
    type: scraped.type,
    price: scraped.price || null,
    custom_price: scraped.custom_price,
    treatment_time: scraped.treatment_time || null,
    visit_date_conditions: scraped.visit_date_conditions,
    other_condition: scraped.other_condition,
    menu_category_cd: scraped.menu_category_cd,
    class: scraped.class,
    is_hidden: scraped.is_hidden,
    is_custom_title: scraped.is_custom_title,
    is_custom_description: scraped.is_custom_description,
    is_custom_price: scraped.is_custom_price,
    is_price_range: scraped.is_price_range,
    sync_source: scraped.sync_source || 'salonboard',
    display_order: scraped.order || 0,
    last_synced_at: now,
    created_at: scraped.created_at || now,
    updated_at: now,
  };
}

/**
 * POST /api/stores/[storeId]/salon-board/sync-menus
 * メニュー・クーポンを同期（外部からのデータを受け取って保存）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const startTime = new Date().toISOString();
  let storeId = '';

  try {
    const resolvedParams = await params;
    storeId = resolvedParams.storeId;
    const body = await request.json();
    const { menus: scrapedMenus } = body as { menus: ScrapedMenuData[] };

    if (!scrapedMenus || !Array.isArray(scrapedMenus)) {
      return NextResponse.json(
        { error: 'menusは配列である必要があります' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();
    const now = new Date().toISOString();

    // カテゴリとスタッフを抽出
    const categoriesMap = new Map<number, SalonBoardCategory>();
    const stylistsMap = new Map<number, SalonBoardStylist>();

    scrapedMenus.forEach(menu => {
      menu.categories?.forEach(cat => {
        if (!categoriesMap.has(cat.id)) {
          categoriesMap.set(cat.id, {
            id: `sbcat_${storeId}_${cat.id}`,
            store_id: storeId,
            title: cat.title,
            thumbnail: cat.thumbnail,
            display_order: cat.order || 0,
            description: cat.description,
            type: cat.type || 'menu',
            text_content: cat.text_content,
            is_hidden: Boolean(cat.is_hidden),
            created_at: cat.created_at || now,
            updated_at: now,
          });
        }
      });

      menu.stylists?.forEach(stylist => {
        if (!stylistsMap.has(stylist.id)) {
          stylistsMap.set(stylist.id, {
            id: `sbstylist_${storeId}_${stylist.stylist_id}`,
            store_id: storeId,
            stylist_id: stylist.stylist_id,
            name: stylist.name,
            name_kana: stylist.name_kana || null,
            custom_name: stylist.custom_name,
            custom_name_kana: stylist.custom_name_kana,
            image_url: stylist.image_url,
            original_image_url: stylist.original_image_url,
            reservation_url: stylist.reservation_url || null,
            nomination_fee: stylist.nomination_fee,
            is_hidden: Boolean(stylist.is_hidden),
            last_synced_at: now,
            created_at: stylist.created_at || now,
            updated_at: now,
            deleted_at: stylist.deleted_at,
          });
        }
      });
    });

    const categories = Array.from(categoriesMap.values());
    const stylists = Array.from(stylistsMap.values());

    // メニューを変換
    const menus = scrapedMenus.map(m => convertScrapedMenu(m, storeId));

    if (env === 'local') {
      // ローカル環境: JSON に保存
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // カテゴリ保存
      fs.writeFileSync(getCategoriesFilePath(storeId), JSON.stringify(categories, null, 2));

      // スタッフ保存（既存とマージ）
      const stylistsFilePath = getStylistsFilePath(storeId);
      let existingStylists: SalonBoardStylist[] = [];
      if (fs.existsSync(stylistsFilePath)) {
        existingStylists = JSON.parse(fs.readFileSync(stylistsFilePath, 'utf-8'));
      }
      // 新しいスタッフで更新
      stylists.forEach(newStylist => {
        const index = existingStylists.findIndex(s => s.stylist_id === newStylist.stylist_id);
        if (index >= 0) {
          existingStylists[index] = { ...existingStylists[index], ...newStylist };
        } else {
          existingStylists.push(newStylist);
        }
      });
      fs.writeFileSync(stylistsFilePath, JSON.stringify(existingStylists, null, 2));

      // メニュー保存（カテゴリ・スタッフ関連を含む）
      const menusWithRelations = menus.map((menu, index) => ({
        ...menu,
        categories: scrapedMenus[index].categories?.map(c => categoriesMap.get(c.id)) || [],
        stylists: scrapedMenus[index].stylists?.map(s => stylistsMap.get(s.id)) || [],
      }));
      fs.writeFileSync(getMenusFilePath(storeId), JSON.stringify(menusWithRelations, null, 2));

      // 同期ログを作成
      await createSyncLog(storeId, {
        reservation_id: null,
        sync_type: 'menu_sync',
        sync_direction: 'inbound',
        status: 'success',
        error_message: null,
        retry_count: 0,
        request_summary: { menu_count: scrapedMenus.length },
        response_summary: null,
        items_synced: menus.length,
        started_at: startTime,
        completed_at: now,
      });

      const response: SyncMenusResponse = {
        success: true,
        items_synced: menus.length,
        menus: menusWithRelations as SalonBoardMenu[],
      };

      return NextResponse.json(response);
    }

    // staging/production: Supabase に保存
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // トランザクション的に処理
    // 1. カテゴリをupsert
    if (categories.length > 0) {
      const { error: catError } = await adminClient
        .from('salon_board_menu_categories' as any)
        .upsert(categories as any, { onConflict: 'id' });

      if (catError) {
        console.error('[API] Categories upsert error:', catError);
      }
    }

    // 2. スタッフをupsert
    if (stylists.length > 0) {
      const { error: stylistError } = await adminClient
        .from('salon_board_stylists' as any)
        .upsert(stylists as any, { onConflict: 'store_id,stylist_id' });

      if (stylistError) {
        console.error('[API] Stylists upsert error:', stylistError);
      }
    }

    // 3. メニューをupsert
    const { error: menuError } = await adminClient
      .from('salon_board_menus' as any)
      .upsert(menus as any, { onConflict: 'store_id,menu_id' });

    if (menuError) {
      console.error('[API] Menus upsert error:', menuError);

      // 同期ログを作成（失敗）
      await createSyncLog(storeId, {
        reservation_id: null,
        sync_type: 'menu_sync',
        sync_direction: 'inbound',
        status: 'failed',
        error_message: menuError.message,
        retry_count: 0,
        request_summary: { menu_count: scrapedMenus.length },
        response_summary: null,
        items_synced: 0,
        started_at: startTime,
        completed_at: now,
      });

      return NextResponse.json(
        { error: 'メニューの保存に失敗しました' },
        { status: 500 }
      );
    }

    // 4. 既存の関連を削除して再作成
    const menuIds = menus.map(m => m.id);

    // カテゴリ関連を削除
    await adminClient
      .from('salon_board_menu_category_relations' as any)
      .delete()
      .in('menu_id', menuIds);

    // スタッフ関連を削除
    await adminClient
      .from('salon_board_menu_stylist_relations' as any)
      .delete()
      .in('menu_id', menuIds);

    // カテゴリ関連を作成
    const categoryRelations: { menu_id: string; category_id: string }[] = [];
    scrapedMenus.forEach((scraped, index) => {
      scraped.categories?.forEach(cat => {
        categoryRelations.push({
          menu_id: menus[index].id,
          category_id: `sbcat_${storeId}_${cat.id}`,
        });
      });
    });

    if (categoryRelations.length > 0) {
      await adminClient
        .from('salon_board_menu_category_relations' as any)
        .insert(categoryRelations as any);
    }

    // スタッフ関連を作成
    const stylistRelations: { menu_id: string; stylist_id: string }[] = [];
    scrapedMenus.forEach((scraped, index) => {
      scraped.stylists?.forEach(stylist => {
        stylistRelations.push({
          menu_id: menus[index].id,
          stylist_id: `sbstylist_${storeId}_${stylist.stylist_id}`,
        });
      });
    });

    if (stylistRelations.length > 0) {
      await adminClient
        .from('salon_board_menu_stylist_relations' as any)
        .insert(stylistRelations as any);
    }

    // 同期ログを作成（成功）
    await createSyncLog(storeId, {
      reservation_id: null,
      sync_type: 'menu_sync',
      sync_direction: 'inbound',
      status: 'success',
      error_message: null,
      retry_count: 0,
      request_summary: { menu_count: scrapedMenus.length },
      response_summary: null,
      items_synced: menus.length,
      started_at: startTime,
      completed_at: now,
    });

    // 保存したメニューを取得して返す
    const { data: savedMenus } = await adminClient
      .from('salon_board_menus' as any)
      .select('*')
      .eq('store_id', storeId)
      .order('display_order', { ascending: true });

    const response: SyncMenusResponse = {
      success: true,
      items_synced: menus.length,
      menus: (savedMenus || []) as SalonBoardMenu[],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Menu sync error:', error);

    // 同期ログを作成（失敗）
    if (storeId) {
      await createSyncLog(storeId, {
        reservation_id: null,
        sync_type: 'menu_sync',
        sync_direction: 'inbound',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        retry_count: 0,
        request_summary: null,
        response_summary: null,
        items_synced: 0,
        started_at: startTime,
        completed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
