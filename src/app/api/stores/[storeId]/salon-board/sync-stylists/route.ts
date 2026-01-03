import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type {
  SalonBoardStylist,
  ScrapedStylistData,
  SyncStylistsResponse,
} from '@/types/salon-board';
import { createSyncLog } from '../sync-logs/route';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * ローカル環境用のファイルパス
 */
function getStylistsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_stylists_${storeId}.json`);
}

/**
 * スクレイピングデータをDB形式に変換
 */
function convertScrapedStylist(scraped: ScrapedStylistData, storeId: string): SalonBoardStylist {
  const now = new Date().toISOString();
  return {
    id: `sbstylist_${storeId}_${scraped.stylist_id}`,
    store_id: storeId,
    stylist_id: scraped.stylist_id,
    name: scraped.name,
    name_kana: scraped.name_kana || null,
    custom_name: scraped.custom_name,
    custom_name_kana: scraped.custom_name_kana,
    image_url: scraped.image_url,
    original_image_url: scraped.original_image_url,
    reservation_url: scraped.reservation_url || null,
    nomination_fee: scraped.nomination_fee,
    is_hidden: Boolean(scraped.is_hidden),
    last_synced_at: now,
    created_at: scraped.created_at || now,
    updated_at: now,
    deleted_at: scraped.deleted_at,
  };
}

/**
 * POST /api/stores/[storeId]/salon-board/sync-stylists
 * スタッフを同期（外部からのデータを受け取って保存）
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
    const { stylists: scrapedStylists } = body as { stylists: ScrapedStylistData[] };

    if (!scrapedStylists || !Array.isArray(scrapedStylists)) {
      return NextResponse.json(
        { error: 'stylistsは配列である必要があります' },
        { status: 400 }
      );
    }

    const env = getAppEnvironment();
    const now = new Date().toISOString();

    // スタッフを変換
    const stylists = scrapedStylists.map(s => convertScrapedStylist(s, storeId));

    if (env === 'local') {
      // ローカル環境: JSON に保存
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      // 既存のスタッフを読み込み
      const filePath = getStylistsFilePath(storeId);
      let existingStylists: SalonBoardStylist[] = [];
      if (fs.existsSync(filePath)) {
        existingStylists = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }

      // 新しいスタッフで更新（upsert）
      stylists.forEach(newStylist => {
        const index = existingStylists.findIndex(s => s.stylist_id === newStylist.stylist_id);
        if (index >= 0) {
          // カスタム設定を保持
          existingStylists[index] = {
            ...existingStylists[index],
            ...newStylist,
            custom_name: existingStylists[index].custom_name,
            custom_name_kana: existingStylists[index].custom_name_kana,
            is_hidden: existingStylists[index].is_hidden,
          };
        } else {
          existingStylists.push(newStylist);
        }
      });

      fs.writeFileSync(filePath, JSON.stringify(existingStylists, null, 2));

      // 同期ログを作成
      await createSyncLog(storeId, {
        reservation_id: null,
        sync_type: 'stylist_sync',
        sync_direction: 'inbound',
        status: 'success',
        error_message: null,
        retry_count: 0,
        request_summary: { stylist_count: scrapedStylists.length },
        response_summary: null,
        items_synced: stylists.length,
        started_at: startTime,
        completed_at: now,
      });

      const response: SyncStylistsResponse = {
        success: true,
        items_synced: stylists.length,
        stylists: existingStylists,
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

    // 既存のスタッフを取得（カスタム設定を保持するため）
    const { data: existingStylists } = await adminClient
      .from('salon_board_stylists' as any)
      .select('stylist_id, custom_name, custom_name_kana, is_hidden')
      .eq('store_id', storeId);

    const existingMap = new Map(
      (existingStylists as any[])?.map((s: any) => [s.stylist_id, s]) || []
    );

    // カスタム設定を保持してupsert
    const stylistsToUpsert = stylists.map(s => {
      const existing = existingMap.get(s.stylist_id) as any;
      if (existing) {
        return {
          ...s,
          custom_name: existing.custom_name,
          custom_name_kana: existing.custom_name_kana,
          is_hidden: existing.is_hidden,
        };
      }
      return s;
    });

    const { error: upsertError } = await adminClient
      .from('salon_board_stylists' as any)
      .upsert(stylistsToUpsert as any, { onConflict: 'store_id,stylist_id' });

    if (upsertError) {
      console.error('[API] Stylists upsert error:', upsertError);

      // 同期ログを作成（失敗）
      await createSyncLog(storeId, {
        reservation_id: null,
        sync_type: 'stylist_sync',
        sync_direction: 'inbound',
        status: 'failed',
        error_message: upsertError.message,
        retry_count: 0,
        request_summary: { stylist_count: scrapedStylists.length },
        response_summary: null,
        items_synced: 0,
        started_at: startTime,
        completed_at: now,
      });

      return NextResponse.json(
        { error: 'スタッフの保存に失敗しました' },
        { status: 500 }
      );
    }

    // 同期ログを作成（成功）
    await createSyncLog(storeId, {
      reservation_id: null,
      sync_type: 'stylist_sync',
      sync_direction: 'inbound',
      status: 'success',
      error_message: null,
      retry_count: 0,
      request_summary: { stylist_count: scrapedStylists.length },
      response_summary: null,
      items_synced: stylists.length,
      started_at: startTime,
      completed_at: now,
    });

    // 保存したスタッフを取得して返す
    const { data: savedStylists } = await adminClient
      .from('salon_board_stylists' as any)
      .select('*')
      .eq('store_id', storeId)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    const response: SyncStylistsResponse = {
      success: true,
      items_synced: stylists.length,
      stylists: (savedStylists || []) as SalonBoardStylist[],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Stylist sync error:', error);

    // 同期ログを作成（失敗）
    if (storeId) {
      await createSyncLog(storeId, {
        reservation_id: null,
        sync_type: 'stylist_sync',
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
