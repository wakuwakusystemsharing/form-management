import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type { SalonBoardStylist } from '@/types/salon-board';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * ローカル環境用のファイルパス
 */
function getStylistsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_stylists_${storeId}.json`);
}

/**
 * GET /api/stores/[storeId]/salon-board/stylists
 * 同期済みスタッフ一覧を取得
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);
    const showHidden = searchParams.get('show_hidden') === 'true';
    const showDeleted = searchParams.get('show_deleted') === 'true';
    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON から読み込み
      const filePath = getStylistsFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json([]);
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      let stylists: SalonBoardStylist[] = JSON.parse(data);

      // フィルタリング
      if (!showHidden) {
        stylists = stylists.filter(s => !s.is_hidden);
      }
      if (!showDeleted) {
        stylists = stylists.filter(s => !s.deleted_at);
      }

      // 名前でソート
      stylists.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

      return NextResponse.json(stylists);
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
      .from('salon_board_stylists' as any)
      .select('*')
      .eq('store_id', storeId)
      .order('name', { ascending: true });

    if (!showHidden) {
      query = query.eq('is_hidden', false);
    }
    if (!showDeleted) {
      query = query.is('deleted_at', null);
    }

    const { data: stylists, error } = await query;

    if (error) {
      console.error('[API] Salon Board Stylists fetch error:', error);
      return NextResponse.json(
        { error: 'スタッフの取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(stylists || []);
  } catch (error) {
    console.error('Stylists fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/stores/[storeId]/salon-board/stylists
 * スタッフの表示設定を更新
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const { stylist_id, is_hidden, custom_name, custom_name_kana } = body;

    if (!stylist_id) {
      return NextResponse.json(
        { error: 'stylist_idは必須です' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON を更新
      const filePath = getStylistsFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json(
          { error: 'スタッフが見つかりません' },
          { status: 404 }
        );
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      const stylists: SalonBoardStylist[] = JSON.parse(data);
      const index = stylists.findIndex(s => s.id === stylist_id);

      if (index === -1) {
        return NextResponse.json(
          { error: 'スタッフが見つかりません' },
          { status: 404 }
        );
      }

      stylists[index] = {
        ...stylists[index],
        ...(is_hidden !== undefined && { is_hidden }),
        ...(custom_name !== undefined && { custom_name }),
        ...(custom_name_kana !== undefined && { custom_name_kana }),
        updated_at: new Date().toISOString(),
      };

      fs.writeFileSync(filePath, JSON.stringify(stylists, null, 2));

      return NextResponse.json({ success: true, stylist: stylists[index] });
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
    if (custom_name !== undefined) updateData.custom_name = custom_name;
    if (custom_name_kana !== undefined) updateData.custom_name_kana = custom_name_kana;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: stylist, error } = await ((adminClient as any)
      .from('salon_board_stylists')
      .update(updateData)
      .eq('id', stylist_id)
      .eq('store_id', storeId)
      .select()
      .single() as any);

    if (error) {
      console.error('[API] Salon Board Stylist update error:', error);
      return NextResponse.json(
        { error: 'スタッフの更新に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, stylist });
  } catch (error) {
    console.error('Stylist update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
