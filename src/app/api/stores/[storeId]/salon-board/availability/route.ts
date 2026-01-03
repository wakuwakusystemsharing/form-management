import { NextResponse } from 'next/server';
import { HotPepperScraper } from '@/lib/salon-board/scraper';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * ローカル環境用のファイルパス
 */
function getCredentialsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_credentials_${storeId}.json`);
}

/**
 * GET /api/stores/[storeId]/salon-board/availability
 * ホットペッパーから空き日程を取得
 *
 * Query parameters:
 * - date_from: 開始日 (YYYY-MM-DD) 必須
 * - date_to: 終了日 (YYYY-MM-DD) 必須
 * - stylist_id: スタッフID (オプション)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const startTime = Date.now();

  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);

    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const stylistId = searchParams.get('stylist_id');

    // バリデーション
    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: 'date_from と date_to は必須です' },
        { status: 400 }
      );
    }

    // 日付のバリデーション
    const dateFromParsed = new Date(dateFrom);
    const dateToParsed = new Date(dateTo);

    if (isNaN(dateFromParsed.getTime()) || isNaN(dateToParsed.getTime())) {
      return NextResponse.json(
        { error: '日付の形式が正しくありません (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    if (dateFromParsed > dateToParsed) {
      return NextResponse.json(
        { error: 'date_from は date_to より前である必要があります' },
        { status: 400 }
      );
    }

    // 日付範囲の制限（最大14日）
    const daysDiff = Math.ceil(
      (dateToParsed.getTime() - dateFromParsed.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff > 14) {
      return NextResponse.json(
        { error: '日付範囲は最大14日までです' },
        { status: 400 }
      );
    }

    // ホットペッパーIDを取得
    const env = getAppEnvironment();
    let hotpepperId: string | null = null;

    if (env === 'local') {
      // ローカル環境: JSON から取得
      const filePath = getCredentialsFilePath(storeId);

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const credentials = JSON.parse(data);
        hotpepperId = credentials.hotpepper_salon_id;
      }
    } else {
      // staging/production: Supabase から取得
      const adminClient = getSupabaseAdminClient();
      if (adminClient) {
        const { data } = await (adminClient as any)
          .from('salon_board_credentials')
          .select('hotpepper_salon_id')
          .eq('store_id', storeId)
          .single();
        hotpepperId = data?.hotpepper_salon_id;
      }
    }

    if (!hotpepperId) {
      return NextResponse.json(
        { error: 'ホットペッパーIDが設定されていません' },
        { status: 400 }
      );
    }

    // スクレイピング実行
    const scraper = new HotPepperScraper();
    const result = await scraper.getAvailability(
      hotpepperId,
      dateFromParsed,
      dateToParsed,
      stylistId || undefined
    );

    const duration = Date.now() - startTime;

    console.log(
      `[HotPepper] Availability fetch for store ${storeId}: ${result.success ? 'SUCCESS' : 'FAILED'}, ${result.slots.length} slots (${duration}ms)`
    );

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          date_from: dateFrom,
          date_to: dateTo,
          fetched_at: result.fetchedAt,
          duration_ms: duration,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      stylist_id: stylistId,
      available_slots: result.slots,
      total_slots: result.slots.length,
      fetched_at: result.fetchedAt,
      duration_ms: duration,
    });
  } catch (error) {
    console.error('[HotPepper] Availability fetch error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
