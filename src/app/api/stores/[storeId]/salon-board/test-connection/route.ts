import { NextResponse } from 'next/server';
import { getDecryptedCredentials } from '../credentials/route';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// スクレイパーサービスのURL（別サーバーで実行）
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL || 'http://localhost:3001';

/**
 * ローカル環境用のファイルパス
 */
function getCredentialsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_credentials_${storeId}.json`);
}

/**
 * POST /api/stores/[storeId]/salon-board/test-connection
 * サロンボードへの接続テストを実行（外部スクレイパーサービスを使用）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  const startTime = Date.now();

  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // 認証情報を取得（復号化）
    const credentials = await getDecryptedCredentials(storeId);
    if (!credentials) {
      return NextResponse.json(
        { success: false, error: '認証情報が設定されていません' },
        { status: 400 }
      );
    }

    // 外部スクレイパーサービスに接続テストを依頼
    const scraperResponse = await fetch(`${SCRAPER_SERVICE_URL}/api/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginId: credentials.loginId,
        password: credentials.password,
      }),
    });

    const testResult = await scraperResponse.json();

    const now = new Date().toISOString();
    const duration = Date.now() - startTime;

    // 結果を保存
    if (env === 'local') {
      // ローカル環境: JSON を更新
      const filePath = getCredentialsFilePath(storeId);

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        const existing = JSON.parse(data);

        const updated = {
          ...existing,
          connection_status: testResult.success ? 'connected' : 'failed',
          last_connection_test_at: now,
          last_connection_error: testResult.success ? null : testResult.error,
          updated_at: now,
        };

        fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
      }
    } else {
      // staging/production: Supabase を更新
      const adminClient = getSupabaseAdminClient();
      if (adminClient) {
        await (adminClient as any)
          .from('salon_board_credentials')
          .update({
            connection_status: testResult.success ? 'connected' : 'failed',
            last_connection_test_at: now,
            last_connection_error: testResult.success ? null : testResult.error,
          })
          .eq('store_id', storeId);
      }
    }

    console.log(
      `[SalonBoard] Connection test for store ${storeId}: ${testResult.success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`
    );

    return NextResponse.json({
      success: testResult.success,
      connection_status: testResult.success ? 'connected' : 'failed',
      error: testResult.error,
      tested_at: now,
      duration_ms: duration,
    });
  } catch (error) {
    console.error('[SalonBoard] Test connection error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // スクレイパーサービスに接続できない場合
    if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
      return NextResponse.json(
        {
          success: false,
          connection_status: 'failed',
          error: 'スクレイパーサービスに接続できません。サービスが起動しているか確認してください。',
          tested_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        connection_status: 'failed',
        error: errorMessage,
        tested_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
