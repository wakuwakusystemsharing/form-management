import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, createAdminClient, isServiceAdmin } from '@/lib/supabase';
import { shouldSkipAuth } from '@/lib/env';

function getAccessToken(req: NextRequest) {
  const accessToken = req.cookies.get('sb-access-token')?.value;
  const authHeader = req.headers.get('authorization');
  return accessToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
}

async function requireAdminUser(req: NextRequest) {
  if (shouldSkipAuth()) {
    return { email: 'dev@localhost' };
  }

  const token = getAccessToken(req);
  if (!token) {
    return null;
  }

  const client = createAuthenticatedClient(token);
  if (!client) {
    return null;
  }

  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    return null;
  }

  if (!isServiceAdmin(user.email || '')) {
    return null;
  }

  return user;
}

export async function GET(req: NextRequest) {
  const user = await requireAdminUser(req);
  if (!user) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
  }

  const { data, error } = await (adminClient as any)
    .from('admin_settings')
    .select('key,value');

  if (error) {
    console.error('[API] Admin settings fetch error:', error);
    return NextResponse.json({ error: '設定の取得に失敗しました' }, { status: 500 });
  }

  const settings = (data || []).reduce((acc: Record<string, string>, row: { key: string; value: string | null }) => {
    acc[row.key] = row.value || '';
    return acc;
  }, {});

  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const user = await requireAdminUser(req);
  if (!user) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '無効なリクエストです' }, { status: 400 });
  }

  const allowedKeys = ['google_service_account_json', 'google_api_key'];
  const incomingSettings = body.settings || {};
  const now = new Date().toISOString();
  const rows = Object.entries(incomingSettings)
    .filter(([key]) => allowedKeys.includes(key))
    .map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : '',
      updated_at: now
    }));

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
  }

  const { error } = await (adminClient as any)
    .from('admin_settings')
    .upsert(rows, { onConflict: 'key' });

  if (error) {
    console.error('[API] Admin settings update error:', error);
    return NextResponse.json({ error: '設定の保存に失敗しました' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
