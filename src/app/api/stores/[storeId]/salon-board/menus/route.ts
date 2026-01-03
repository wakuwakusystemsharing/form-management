import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type { SalonBoardMenu } from '@/types/salon-board';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * ローカル環境用のファイルパス
 */
function getMenusFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_menus_${storeId}.json`);
}

/**
 * GET /api/stores/[storeId]/salon-board/menus
 * 同期済みメニュー・クーポン一覧を取得
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // 'coupon' | 'menu' | null
    const showHidden = searchParams.get('show_hidden') === 'true';
    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON から読み込み
      const filePath = getMenusFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json([]);
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      let menus: SalonBoardMenu[] = JSON.parse(data);

      // フィルタリング
      if (type) {
        menus = menus.filter(m => m.type === type);
      }
      if (!showHidden) {
        menus = menus.filter(m => !m.is_hidden);
      }

      // 表示順でソート
      menus.sort((a, b) => a.display_order - b.display_order);

      return NextResponse.json(menus);
    }

    // staging/production: Supabase から取得
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    let query = adminClient
      .from('salon_board_menus' as any)
      .select('*')
      .eq('store_id', storeId)
      .order('display_order', { ascending: true });

    if (type) {
      query = query.eq('type', type);
    }
    if (!showHidden) {
      query = query.eq('is_hidden', false);
    }

    const { data: menus, error } = await query;

    if (error) {
      console.error('[API] Salon Board Menus fetch error:', error);
      return NextResponse.json(
        { error: 'メニューの取得に失敗しました' },
        { status: 500 }
      );
    }

    // カテゴリとスタッフ関連を取得
    if (menus && (menus as any[]).length > 0) {
      const menuIds = (menus as any[]).map((m: any) => m.id);

      // カテゴリ関連を取得
      const { data: categoryRelations } = await adminClient
        .from('salon_board_menu_category_relations' as any)
        .select(`
          menu_id,
          category:salon_board_menu_categories(*)
        `)
        .in('menu_id', menuIds);

      // スタッフ関連を取得
      const { data: stylistRelations } = await adminClient
        .from('salon_board_menu_stylist_relations' as any)
        .select(`
          menu_id,
          stylist:salon_board_stylists(*)
        `)
        .in('menu_id', menuIds);

      // メニューにカテゴリとスタッフを紐付け
      const menusWithRelations = (menus as any[]).map((menu: any) => ({
        ...menu,
        categories: (categoryRelations as any[])
          ?.filter((r: any) => r.menu_id === menu.id)
          .map((r: any) => r.category) || [],
        stylists: (stylistRelations as any[])
          ?.filter((r: any) => r.menu_id === menu.id)
          .map((r: any) => r.stylist) || [],
      }));

      return NextResponse.json(menusWithRelations);
    }

    return NextResponse.json(menus || []);
  } catch (error) {
    console.error('Menus fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/stores/[storeId]/salon-board/menus
 * メニューの表示設定を更新
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const { menu_id, is_hidden, custom_title, custom_description, custom_price, display_order } = body;

    if (!menu_id) {
      return NextResponse.json(
        { error: 'menu_idは必須です' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON を更新
      const filePath = getMenusFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: 'メニューが見つかりません' },
          { status: 404 }
        );
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const menus: SalonBoardMenu[] = JSON.parse(data);
      const index = menus.findIndex(m => m.id === menu_id);

      if (index === -1) {
        return NextResponse.json(
          { error: 'メニューが見つかりません' },
          { status: 404 }
        );
      }

      menus[index] = {
        ...menus[index],
        ...(is_hidden !== undefined && { is_hidden }),
        ...(custom_title !== undefined && { custom_title, is_custom_title: !!custom_title }),
        ...(custom_description !== undefined && { custom_description, is_custom_description: !!custom_description }),
        ...(custom_price !== undefined && { custom_price, is_custom_price: !!custom_price }),
        ...(display_order !== undefined && { display_order }),
        updated_at: new Date().toISOString(),
      };

      fs.writeFileSync(filePath, JSON.stringify(menus, null, 2));

      return NextResponse.json({ success: true, menu: menus[index] });
    }

    // staging/production: Supabase を更新
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (is_hidden !== undefined) updateData.is_hidden = is_hidden;
    if (custom_title !== undefined) {
      updateData.custom_title = custom_title;
      updateData.is_custom_title = !!custom_title;
    }
    if (custom_description !== undefined) {
      updateData.custom_description = custom_description;
      updateData.is_custom_description = !!custom_description;
    }
    if (custom_price !== undefined) {
      updateData.custom_price = custom_price;
      updateData.is_custom_price = !!custom_price;
    }
    if (display_order !== undefined) updateData.display_order = display_order;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: menu, error } = await ((adminClient as any)
      .from('salon_board_menus')
      .update(updateData)
      .eq('id', menu_id)
      .eq('store_id', storeId)
      .select()
      .single() as any);

    if (error) {
      console.error('[API] Salon Board Menu update error:', error);
      return NextResponse.json(
        { error: 'メニューの更新に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, menu });
  } catch (error) {
    console.error('Menu update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
