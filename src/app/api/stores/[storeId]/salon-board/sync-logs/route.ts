import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';
import type { SalonBoardSyncLog, SalonBoardSyncType, SalonBoardSyncStatus } from '@/types/salon-board';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * ローカル環境用のファイルパス
 */
function getSyncLogsFilePath(storeId: string): string {
  return path.join(DATA_DIR, `salon_board_sync_logs_${storeId}.json`);
}

/**
 * GET /api/stores/[storeId]/salon-board/sync-logs
 * 同期ログ一覧を取得
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const syncType = searchParams.get('sync_type') as SalonBoardSyncType | null;
    const status = searchParams.get('status') as SalonBoardSyncStatus | null;
    const env = getAppEnvironment();

    if (env === 'local') {
      // ローカル環境: JSON から読み込み
      const filePath = getSyncLogsFilePath(storeId);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json({ logs: [], total: 0 });
      }

      const data = fs.readFileSync(filePath, 'utf-8');
      let logs: SalonBoardSyncLog[] = JSON.parse(data);

      // フィルタリング
      if (syncType) {
        logs = logs.filter(l => l.sync_type === syncType);
      }
      if (status) {
        logs = logs.filter(l => l.status === status);
      }

      // 日時でソート（新しい順）
      logs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = logs.length;

      // ページネーション
      logs = logs.slice(offset, offset + limit);

      return NextResponse.json({ logs, total });
    }

    // staging/production: Supabase から取得
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // カウント取得
    let countQuery = adminClient
      .from('salon_board_sync_logs' as any)
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    if (syncType) {
      countQuery = countQuery.eq('sync_type', syncType);
    }
    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    const { count } = await countQuery;

    // データ取得
    let query = adminClient
      .from('salon_board_sync_logs' as any)
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (syncType) {
      query = query.eq('sync_type', syncType);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data: logs, error } = await query;

    if (error) {
      console.error('[API] Salon Board Sync Logs fetch error:', error);
      return NextResponse.json(
        { error: '同期ログの取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ logs: logs || [], total: count || 0 });
  } catch (error) {
    console.error('Sync logs fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * 内部用: 同期ログを作成
 */
export async function createSyncLog(
  storeId: string,
  logData: Omit<SalonBoardSyncLog, 'id' | 'store_id' | 'created_at'>
): Promise<SalonBoardSyncLog | null> {
  const env = getAppEnvironment();
  const now = new Date().toISOString();

  const newLog: SalonBoardSyncLog = {
    id: `synclog_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    store_id: storeId,
    ...logData,
    created_at: now,
  };

  if (env === 'local') {
    const filePath = getSyncLogsFilePath(storeId);
    let logs: SalonBoardSyncLog[] = [];

    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      logs = JSON.parse(data);
    }

    logs.push(newLog);

    // ディレクトリが存在しない場合は作成
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(logs, null, 2));

    return newLog;
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  const { data: log, error } = await adminClient
    .from('salon_board_sync_logs' as any)
    .insert({
      store_id: storeId,
      reservation_id: logData.reservation_id,
      sync_type: logData.sync_type,
      sync_direction: logData.sync_direction,
      status: logData.status,
      error_message: logData.error_message,
      retry_count: logData.retry_count,
      request_summary: logData.request_summary,
      response_summary: logData.response_summary,
      items_synced: logData.items_synced,
      started_at: logData.started_at,
      completed_at: logData.completed_at,
    } as any)
    .select()
    .single();

  if (error) {
    console.error('[API] Create sync log error:', error);
    return null;
  }

  return log as SalonBoardSyncLog;
}

/**
 * 内部用: 同期ログを更新
 */
export async function updateSyncLog(
  logId: string,
  updateData: Partial<SalonBoardSyncLog>
): Promise<boolean> {
  const env = getAppEnvironment();

  if (env === 'local') {
    // ローカル環境では全ファイルを検索する必要があるため、storeIdが必要
    // この関数はstoreIdを持つ場所から呼ばれる想定
    console.warn('[SyncLog] Local update not fully implemented');
    return false;
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await ((adminClient as any)
    .from('salon_board_sync_logs')
    .update(updateData)
    .eq('id', logId));

  if (error) {
    console.error('[API] Update sync log error:', error);
    return false;
  }

  return true;
}
