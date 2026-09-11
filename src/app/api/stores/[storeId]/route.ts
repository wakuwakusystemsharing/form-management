import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Store } from '@/types/store';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { FOLLOW_DAYS_AFTER_OPTIONS } from '@/lib/follow-message-scheduler';
import { applyFollowSettingsToScheduledRows, backfillFollowMessagesForStore } from '@/lib/follow-message-repository';

const TIME_HH00_RE = /^([01]\d|2[0-3]):00$/;

/** 文面テンプレート（reminder_template / follow_template）の形式チェック */
function validateMessageTemplate(t: unknown, label: string): string | null {
  if (t === null || t === undefined) return null;
  if (typeof t !== 'object' || Array.isArray(t)) return `${label}の文面の形式が不正です`;
  const tt = t as Record<string, unknown>;
  for (const key of ['header_title', 'header_color', 'body_text', 'text_color', 'footer_text']) {
    if (key in tt && tt[key] !== undefined && typeof tt[key] !== 'string') return `${label}の文面の形式が不正です`;
  }
  for (const key of ['show_details', 'show_footer']) {
    if (key in tt && tt[key] !== undefined && typeof tt[key] !== 'boolean') return `${label}の文面の形式が不正です`;
  }
  if (typeof tt.body_text === 'string' && tt.body_text.length > 2000) return `${label}の本文は 2000 文字以内で指定してください`;
  return null;
}

/**
 * 予約リマインダー設定の入力検証（指定されたキーだけ検証。未指定は変更なし）
 * 送信 Function は reminder_time を「HH:00」で照合するため、それ以外の書式は保存させない
 */
function validateReminderSettings(body: Record<string, unknown>): string | null {
  if ('reminder_enabled' in body && typeof body.reminder_enabled !== 'boolean') {
    return '予約リマインダーの有効/無効の値が不正です';
  }
  if ('reminder_days_before' in body) {
    const n = body.reminder_days_before;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 30) {
      return '予約リマインダーの「何日前」は 1〜30 の整数で指定してください';
    }
  }
  if ('reminder_time' in body && (typeof body.reminder_time !== 'string' || !TIME_HH00_RE.test(body.reminder_time))) {
    return '予約リマインダーの送信時刻は HH:00 形式で指定してください';
  }
  if ('reminder_template' in body) {
    const err = validateMessageTemplate(body.reminder_template, '予約リマインダー');
    if (err) return err;
  }
  return null;
}

type FollowSettingKeys = 'follow_enabled' | 'follow_base' | 'follow_days_after' | 'follow_time';
const FOLLOW_SETTING_KEYS: FollowSettingKeys[] = ['follow_enabled', 'follow_base', 'follow_days_after', 'follow_time'];

/**
 * フォロー設定の変更を既存の配信予定に反映する（保存後に呼ぶ。失敗しても保存は成功扱い）
 * - OFF → ON: 未来の予約（LINE 経由）に予定を後付けする
 * - 基準日 / 何日後 / 時刻の変更: 未送信の予定を新設定で計算し直す
 */
async function syncFollowSettingsChange(storeId: string, before: Record<string, unknown> | null, after: Record<string, unknown>): Promise<void> {
  try {
    const turnedOn = before?.follow_enabled !== true && after.follow_enabled === true;
    const timingChanged = (['follow_base', 'follow_days_after', 'follow_time'] as const)
      .some((k) => before && before[k] !== after[k]);
    if (turnedOn) {
      const created = await backfillFollowMessagesForStore(storeId);
      console.log(`[follow-message] backfill on enable: store=${storeId} created=${created}`);
    }
    if (after.follow_enabled === true && timingChanged) {
      const updated = await applyFollowSettingsToScheduledRows(storeId);
      console.log(`[follow-message] settings applied: store=${storeId} updated=${updated}`);
    }
  } catch (e) {
    console.error('[follow-message] settings sync error:', e);
  }
}

/**
 * フォローメッセージ設定の入力検証（指定されたキーだけ検証。未指定は変更なし）
 * 不正なら日本語のエラーメッセージを返す
 */
function validateFollowSettings(body: Record<string, unknown>): string | null {
  if ('follow_enabled' in body && typeof body.follow_enabled !== 'boolean') {
    return 'フォローメッセージの有効/無効の値が不正です';
  }
  if ('follow_base' in body && body.follow_base !== 'reservation_date' && body.follow_base !== 'created_at') {
    return 'フォローメッセージの基準日の値が不正です';
  }
  if ('follow_days_after' in body) {
    const n = body.follow_days_after;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 60) {
      return 'フォローメッセージの「何日後」は 1〜60 の整数で指定してください';
    }
    if (!FOLLOW_DAYS_AFTER_OPTIONS.includes(n)) {
      return 'フォローメッセージの「何日後」は選択肢の中から指定してください';
    }
  }
  if ('follow_time' in body && (typeof body.follow_time !== 'string' || !/^([01]\d|2[0-3]):00$/.test(body.follow_time))) {
    return 'フォローメッセージの送信時刻は HH:00 形式で指定してください';
  }
  if ('follow_template' in body) {
    const err = validateMessageTemplate(body.follow_template, 'フォローメッセージ');
    if (err) return err;
  }
  return null;
}

// 一時的なJSONファイルでのデータ保存（開発用）
const DATA_DIR = path.join(process.cwd(), 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');

// データディレクトリとファイルの初期化
function initializeDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(STORES_FILE)) {
    fs.writeFileSync(STORES_FILE, JSON.stringify([], null, 2));
  }
}

// 店舗データの読み込み
function readStores(): Store[] {
  initializeDataFile();
  const data = fs.readFileSync(STORES_FILE, 'utf-8');
  return JSON.parse(data);
}

// 店舗データの保存
function writeStores(stores: Store[]) {
  initializeDataFile();
  fs.writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2));
}

// GET /api/stores/[storeId] - 個別店舗取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      const stores = readStores();
      const store = stores.find((s: Store) => s.id === storeId);
      
      if (!store) {
        return NextResponse.json(
          { error: '店舗が見つかりません' }, 
          { status: 404 }
        );
      }

      const { google_calendar_refresh_token: _t, ...storeSafe } = store as Store & { google_calendar_refresh_token?: string };
      return NextResponse.json(storeSafe);
    }

    // staging/production: Supabase から取得
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

     
    const { data: store, error } = await (adminClient as any)
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    if (error || !store) {
      console.error('[API] Store fetch error:', error);
      return NextResponse.json(
        { error: '店舗が見つかりません' },
        { status: 404 }
      );
    }

    const { google_calendar_refresh_token: _token, ...storeSafe } = store;
    return NextResponse.json(storeSafe);
  } catch (error) {
    console.error('Store fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// PUT /api/stores/[storeId] - 店舗情報更新
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const env = getAppEnvironment();

    const followError = validateFollowSettings(body || {});
    if (followError) {
      return NextResponse.json({ error: followError }, { status: 400 });
    }
    const reminderError = validateReminderSettings(body || {});
    if (reminderError) {
      return NextResponse.json({ error: reminderError }, { status: 400 });
    }
    const touchesFollowSettings = FOLLOW_SETTING_KEYS.some((k) => body && k in body);

    // ローカル環境: JSON を更新
    if (env === 'local') {
      const stores = readStores();
      const storeIndex = stores.findIndex((s: Store) => s.id === storeId);
      
      if (storeIndex === -1) {
        return NextResponse.json(
          { error: '店舗が見つかりません' }, 
          { status: 404 }
        );
      }

      // 更新データをマージ
      const updatedStore: Store = {
        ...stores[storeIndex],
        ...body,
        id: storeId, // IDは変更不可
        updated_at: new Date().toISOString()
      };

      const beforeStore = stores[storeIndex] as unknown as Record<string, unknown>;
      stores[storeIndex] = updatedStore;
      writeStores(stores);

      if (touchesFollowSettings) {
        await syncFollowSettingsChange(storeId, beforeStore, updatedStore as unknown as Record<string, unknown>);
      }

      return NextResponse.json(updatedStore);
    }

    // staging/production: Supabase を更新
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const updateData = {
      ...body,
      updated_at: new Date().toISOString()
    };

    // id, created_atは変更不可なので削除
    delete updateData.id;
    delete updateData.created_at;

    // フォロー設定の変更検知用に変更前の値を取っておく
    let beforeFollow: Record<string, unknown> | null = null;
    if (touchesFollowSettings) {
      const { data: prev } = await (adminClient as any)
        .from('stores')
        .select('follow_enabled,follow_base,follow_days_after,follow_time')
        .eq('id', storeId)
        .maybeSingle();
      beforeFollow = prev || null;
    }

     
    const { data: updatedStore, error } = await (adminClient as any)
      .from('stores')
      .update(updateData)
      .eq('id', storeId)
      .select()
      .single();

    if (error || !updatedStore) {
      console.error('[API] Store update error:', error);
      return NextResponse.json(
        { error: '店舗の更新に失敗しました' },
        { status: 500 }
      );
    }

    if (touchesFollowSettings) {
      await syncFollowSettingsChange(storeId, beforeFollow, updatedStore);
    }

    return NextResponse.json(updatedStore);
  } catch (error) {
    console.error('Store update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// DELETE /api/stores/[storeId] - 店舗削除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // ローカル環境: JSON から削除
    if (env === 'local') {
      const stores = readStores();
      const storeIndex = stores.findIndex((s: Store) => s.id === storeId);
      
      if (storeIndex === -1) {
        return NextResponse.json(
          { error: '店舗が見つかりません' }, 
          { status: 404 }
        );
      }

      // 関連予約フォーム数をチェック
      const formsFile = path.join(DATA_DIR, `forms_${storeId}.json`);
      let formCount = 0;
      if (fs.existsSync(formsFile)) {
        const formsData = JSON.parse(fs.readFileSync(formsFile, 'utf-8'));
        formCount = Array.isArray(formsData) ? formsData.length : 0;
      }

      // 関連アンケートフォーム数をチェック
      const surveysFile = path.join(DATA_DIR, `surveys_${storeId}.json`);
      let surveyFormCount = 0;
      if (fs.existsSync(surveysFile)) {
        const surveysData = JSON.parse(fs.readFileSync(surveysFile, 'utf-8'));
        surveyFormCount = Array.isArray(surveysData) ? surveysData.length : 0;
      }

      const totalFormCount = formCount + surveyFormCount;

      // フォーム数が0より大きい場合は削除不可
      if (totalFormCount > 0) {
        const formsMessage = formCount > 0 ? `予約フォーム ${formCount} 件` : '';
        const surveyMessage = surveyFormCount > 0 ? `アンケートフォーム ${surveyFormCount} 件` : '';
        const formList = [formsMessage, surveyMessage].filter(Boolean).join('、');
        
        return NextResponse.json(
          { 
            error: `店舗を削除できません。関連するフォームが存在します（${formList}）。先にすべてのフォームを削除してください。` 
          },
          { status: 400 }
        );
      }

      // 関連するフォームファイルを削除（念のため）
      if (fs.existsSync(formsFile)) {
        fs.unlinkSync(formsFile);
      }
      if (fs.existsSync(surveysFile)) {
        fs.unlinkSync(surveysFile);
      }

      // 店舗データを削除
      stores.splice(storeIndex, 1);
      writeStores(stores);

      return NextResponse.json({ message: '店舗を削除しました' });
    }

    // staging/production: Supabase から削除
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 関連フォーム数をチェック（予約フォーム）
     
    const { count: formsCount, error: formsCountError } = await (adminClient as any)
      .from('reservation_forms')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    if (formsCountError) {
      console.error('[API] Forms count error:', formsCountError);
      return NextResponse.json(
        { error: 'フォーム数の確認に失敗しました' },
        { status: 500 }
      );
    }

    // 関連アンケートフォーム数をチェック
     
    const { count: surveyFormsCount, error: surveyFormsCountError } = await (adminClient as any)
      .from('survey_forms')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    if (surveyFormsCountError) {
      console.error('[API] Survey forms count error:', surveyFormsCountError);
      return NextResponse.json(
        { error: 'アンケートフォーム数の確認に失敗しました' },
        { status: 500 }
      );
    }

    const totalFormCount = (formsCount || 0) + (surveyFormsCount || 0);

    // フォーム数が0より大きい場合は削除不可
    if (totalFormCount > 0) {
      const formsMessage = formsCount > 0 ? `予約フォーム ${formsCount} 件` : '';
      const surveyMessage = surveyFormsCount > 0 ? `アンケートフォーム ${surveyFormsCount} 件` : '';
      const formList = [formsMessage, surveyMessage].filter(Boolean).join('、');
      
      return NextResponse.json(
        { 
          error: `店舗を削除できません。関連するフォームが存在します（${formList}）。先にすべてのフォームを削除してください。` 
        },
        { status: 400 }
      );
    }

    // 関連フォームと予約データは CASCADE で自動削除される（migration設定済み）
     
    const { error } = await (adminClient as any)
      .from('stores')
      .delete()
      .eq('id', storeId);

    if (error) {
      console.error('[API] Store delete error:', error);
      return NextResponse.json(
        { error: '店舗の削除に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: '店舗を削除しました' });
  } catch (error) {
    console.error('Store delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
