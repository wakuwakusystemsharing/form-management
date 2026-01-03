import { NextResponse } from 'next/server';
import { getDecryptedCredentials } from '../../credentials/route';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type { SalonBoardStylist } from '@/types/salon-board';

const DATA_DIR = path.join(process.cwd(), 'data');

// スクレイパーサービスのURL（別サーバーで実行）
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:3001';

/**
 * ローカル環境用のファイルパス
 */
function getStylistsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_stylists_${storeId}.json`);
}

/**
 * POST /api/stores/[storeId]/salon-board/sync/staff
 * サロンボードからスタッフ情報をスクレイピングして同期（外部スクレイパーサービスを使用）
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

    // 外部スクレイパーサービスにスタッフ取得を依頼
    const scraperResponse = await fetch(`${SCRAPER_SERVICE_URL}/api/scrape/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginId: credentials.loginId,
        password: credentials.password,
      }),
    });

    const staffResult = await scraperResponse.json();

    if (!staffResult.success) {
      return NextResponse.json(
        { success: false, error: staffResult.error || 'スタッフ取得に失敗しました' },
        { status: scraperResponse.status }
      );
    }

    const duration = Date.now() - startTime;

    console.log(
      `[SalonBoard] Staff sync for store ${storeId}: ${staffResult.data?.length || 0} staff (${duration}ms)`
    );

    if (env === 'local') {
      // ローカル環境: JSON に保存
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const now = new Date().toISOString();

      // スタッフを保存形式に変換
      const stylistsToSave: SalonBoardStylist[] = (staffResult.data || []).map((stylist: SalonBoardStylist) => ({
        id: `sbstylist_${storeId}_${stylist.stylist_id}`,
        store_id: storeId,
        stylist_id: stylist.stylist_id,
        name: stylist.name,
        name_kana: stylist.name_kana || null,
        custom_name: null,
        custom_name_kana: null,
        image_url: stylist.image_url || null,
        original_image_url: stylist.original_image_url || null,
        reservation_url: stylist.reservation_url || null,
        nomination_fee: stylist.nomination_fee || null,
        is_hidden: stylist.is_hidden || false,
        last_synced_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      }));

      // 既存のスタッフを読み込み（カスタム設定を保持）
      const filePath = getStylistsFilePath(storeId);
      let existingStylists: SalonBoardStylist[] = [];
      if (fs.existsSync(filePath)) {
        existingStylists = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }

      // マージ（カスタム設定を保持）
      stylistsToSave.forEach((newStylist: SalonBoardStylist) => {
        const index = existingStylists.findIndex(s => s.stylist_id === newStylist.stylist_id);
        if (index >= 0) {
          existingStylists[index] = {
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

      return NextResponse.json({
        success: true,
        items_synced: staffResult.data?.length || 0,
        stylists: existingStylists,
        duration_ms: duration,
      });
    }

    // staging/production: Supabase対応
    // TODO: Supabase対応

    return NextResponse.json({
      success: true,
      items_synced: staffResult.data?.length || 0,
      stylists: staffResult.data || [],
      duration_ms: duration,
    });
  } catch (error) {
    console.error('[SalonBoard] Staff sync error:', error);

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
