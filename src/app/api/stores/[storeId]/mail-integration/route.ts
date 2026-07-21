// 外部予約メール連携: 店舗ごとの設定 API
// GET: 設定 + 所要時間ルールの取得（未設定なら integration: null）
// PUT: 設定の保存（初回は受信トークンを自動発行）+ ルールの全置き換え

import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 受信ドメイン（Resend Inbound）。独自ドメイン移行時は環境変数で上書き
const INBOUND_DOMAIN = process.env.RESEND_INBOUND_DOMAIN || 'aistioelku.resend.app';

async function authorizeStoreAccess(
  request: Request,
  storeId: string
): Promise<NextResponse | null> {
  const env = getAppEnvironment();
  if (env === 'local') return null;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const token =
    request.headers.get('cookie')
      ?.split(';')
      .find((c) => c.trim().startsWith('sb-access-token='))
      ?.trim()
      .substring('sb-access-token='.length) ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const authClient = createAuthenticatedClient(token);
  if (!authClient) {
    return NextResponse.json({ error: '認証に失敗しました' }, { status: 401 });
  }

  const hasAccess = await checkStoreAccess(user.id, storeId, user.email, authClient);
  if (!hasAccess) {
    return NextResponse.json({ error: 'この店舗へのアクセス権限がありません' }, { status: 403 });
  }

  return null;
}

function generateInboundToken(): string {
  // 推測不可な 12 文字の英数小文字トークン
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join('');
}

function buildInboundAddress(token: string): string {
  return `rsv-${token}@${INBOUND_DOMAIN}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();
    if (env === 'local') {
      return NextResponse.json({ available: false, reason: 'local 環境では利用できません' });
    }

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { data: integration } = await (adminClient as any)
      .from('external_mail_integrations')
      .select('store_id,enabled,inbound_token,default_duration_minutes,target_calendar_id')
      .eq('store_id', storeId)
      .single();

    const { data: rules } = await (adminClient as any)
      .from('menu_duration_rules')
      .select('id,keyword,duration_minutes,sort_order')
      .eq('store_id', storeId)
      .order('sort_order', { ascending: true });

    const { data: storeData } = await (adminClient as any)
      .from('stores')
      .select('google_calendar_id')
      .eq('id', storeId)
      .single();

    return NextResponse.json({
      available: true,
      integration: integration
        ? {
            enabled: integration.enabled === true,
            inbound_address: buildInboundAddress(integration.inbound_token),
            default_duration_minutes: integration.default_duration_minutes ?? 60,
            target_calendar_id: integration.target_calendar_id || '',
          }
        : null,
      rules: (rules || []).map((r: any) => ({
        keyword: r.keyword,
        duration_minutes: r.duration_minutes,
      })),
      has_store_calendar: !!storeData?.google_calendar_id,
    });
  } catch (error) {
    console.error('[mail-integration] GET error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();
    if (env === 'local') {
      return NextResponse.json({ error: 'local 環境では利用できません' }, { status: 400 });
    }

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const body = await request.json();
    const enabled = body.enabled === true;
    const defaultDurationRaw = Number(body.default_duration_minutes);
    const defaultDuration = Number.isFinite(defaultDurationRaw) && defaultDurationRaw >= 5 && defaultDurationRaw <= 600
      ? Math.floor(defaultDurationRaw)
      : 60;
    const targetCalendarId = typeof body.target_calendar_id === 'string' ? body.target_calendar_id.trim() : '';
    const rulesInput: Array<{ keyword?: unknown; duration_minutes?: unknown }> = Array.isArray(body.rules) ? body.rules : [];
    const rules = rulesInput
      .map((r) => ({
        keyword: typeof r.keyword === 'string' ? r.keyword.trim() : '',
        duration_minutes: Number(r.duration_minutes),
      }))
      .filter((r) => r.keyword && Number.isFinite(r.duration_minutes) && r.duration_minutes >= 5 && r.duration_minutes <= 600);

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    // 既存の設定を取得（トークンは一度発行したら変更しない = 店舗が案内済みのアドレスを壊さない）
    const { data: existing } = await (adminClient as any)
      .from('external_mail_integrations')
      .select('inbound_token')
      .eq('store_id', storeId)
      .single();
    const inboundToken = existing?.inbound_token || generateInboundToken();

    const { error: upsertError } = await (adminClient as any)
      .from('external_mail_integrations')
      .upsert({
        store_id: storeId,
        enabled,
        inbound_token: inboundToken,
        default_duration_minutes: defaultDuration,
        target_calendar_id: targetCalendarId || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id' });

    if (upsertError) {
      console.error('[mail-integration] upsert error:', upsertError);
      return NextResponse.json({ error: '設定の保存に失敗しました' }, { status: 500 });
    }

    // ルールは全置き換え（並び順 = 配列順）
    await (adminClient as any).from('menu_duration_rules').delete().eq('store_id', storeId);
    if (rules.length > 0) {
      const { error: rulesError } = await (adminClient as any).from('menu_duration_rules').insert(
        rules.map((r, index) => ({
          store_id: storeId,
          keyword: r.keyword,
          duration_minutes: Math.floor(r.duration_minutes),
          sort_order: index,
        }))
      );
      if (rulesError) {
        console.error('[mail-integration] rules insert error:', rulesError);
        return NextResponse.json({ error: '所要時間ルールの保存に失敗しました' }, { status: 500 });
      }
    }

    return NextResponse.json({
      integration: {
        enabled,
        inbound_address: buildInboundAddress(inboundToken),
        default_duration_minutes: defaultDuration,
        target_calendar_id: targetCalendarId,
      },
      rules,
    });
  } catch (error) {
    console.error('[mail-integration] PUT error:', error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
