import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helper';
import { getAppEnvironment } from '@/lib/env';
import { getSupabaseAdminClient, isMasterAdmin } from '@/lib/supabase';

/**
 * GET /api/master-admin/organizations
 * テナント一覧（マスター管理者のみ）
 */
export async function GET(request: NextRequest) {
  const env = getAppEnvironment();
  if (env === 'local') return NextResponse.json({ organizations: [] });

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });

  const { data: orgs, error } = await (supabase as any)
    .from('organizations')
    .select('id, name, slug, created_at')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: 'テナントの取得に失敗しました' }, { status: 500 });

  // 各テナントの管理者数と店舗数を取得
  const organizations = await Promise.all(
    (orgs || []).map(async (org: any) => {
      const { count: adminCount } = await (supabase as any)
        .from('system_admins')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id);
      const { count: storeCount } = await (supabase as any)
        .from('stores')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id);
      return { ...org, admin_count: adminCount || 0, store_count: storeCount || 0 };
    })
  );

  return NextResponse.json({ organizations });
}

/**
 * POST /api/master-admin/organizations
 * テナント作成（マスター管理者のみ）
 * Body: { name: string, slug: string }
 */
export async function POST(request: NextRequest) {
  const env = getAppEnvironment();
  if (env === 'local') return NextResponse.json({ error: 'ローカル環境では利用できません' }, { status: 400 });

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: '認証されていません' }, { status: 401 });
  if (!(await isMasterAdmin(user.id))) return NextResponse.json({ error: 'マスター管理者権限が必要です' }, { status: 403 });

  const body = await request.json();
  const { name, slug } = body;

  if (!name || !slug) return NextResponse.json({ error: 'テナント名とスラッグは必須です' }, { status: 400 });

  // slug バリデーション（英数字とハイフンのみ）
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && !/^[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ error: 'スラッグは英小文字、数字、ハイフンのみ使用できます' }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: 'データベース接続エラー' }, { status: 500 });

  const { data, error } = await (supabase as any)
    .from('organizations')
    .insert({ name, slug })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'このスラッグは既に使用されています' }, { status: 409 });
    }
    return NextResponse.json({ error: `テナントの作成に失敗しました: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ organization: data }, { status: 201 });
}
