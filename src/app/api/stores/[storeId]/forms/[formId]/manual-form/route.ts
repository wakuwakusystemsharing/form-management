import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient, createAuthenticatedClient, checkStoreAccess } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/auth-helper';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 店舗側手動予約フォーム（スタッフ用）の HTML を返す。
// 対象フォームの設定で通常フォームと同じ UI を生成し、最上部に必須の「お客様選択」を追加した
// 手動モード（LIFF 不使用・LINE メッセージ送信なし）で出力する。店舗管理者のみアクセス可。

async function authorizeStoreAccess(
  request: Request,
  storeId: string
): Promise<NextResponse | null> {
  const env = getAppEnvironment();
  if (env === 'local') return null;

  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: '認証が必要です。店舗管理画面からアクセスしてください。' }, { status: 401 });
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { storeId, formId } = await params;

    const authError = await authorizeStoreAccess(request, storeId);
    if (authError) return authError;

    const env = getAppEnvironment();
    let rawForm: Record<string, unknown> | null = null;

    if (env === 'local') {
      // ローカル環境: JSON ファイルから取得
      const formsPath = path.join(process.cwd(), 'data', `forms_${storeId}.json`);
      if (fs.existsSync(formsPath)) {
        const forms = JSON.parse(fs.readFileSync(formsPath, 'utf-8')) as Array<Record<string, unknown>>;
        rawForm = forms.find((f) => f.id === formId) || null;
      }
    } else {
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
      }
      const { data } = await (adminClient as any)
        .from('reservation_forms')
        .select('*')
        .eq('id', formId)
        .eq('store_id', storeId)
        .single();
      rawForm = data || null;
    }

    if (!rawForm) {
      return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    }

    const normalized = normalizeForm(rawForm);

    // 手動フォームは LINE 識別 ID の紐付けが目的のため LINE タイプのみ
    if ((normalized.config?.form_type ?? 'line') !== 'line') {
      return NextResponse.json(
        { error: 'Web予約フォームでは店舗側手動予約フォームは使用できません（LINEタイプのフォームのみ対応）' },
        { status: 400 }
      );
    }

    const generator = new StaticReservationGenerator();
    const html = generator.generateHTML(normalized.config, formId, storeId, 'manual');

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // 常に最新のフォーム設定で表示（認証必須ページのためキャッシュしない）
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    console.error('[API] manual-form error:', error);
    return NextResponse.json({ error: '手動予約フォームの生成に失敗しました' }, { status: 500 });
  }
}
