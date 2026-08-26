import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { normalizeForm } from '@/lib/form-normalizer';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import {
  ACCESS_COOKIE,
  readCookie,
  verifyStoreAdmin,
  refreshManualSession,
  applySessionCookies,
  renderManualLoginPage,
} from '@/lib/manual-form-auth';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 店舗側手動予約フォーム（スタッフ用）の HTML を返す。
// 対象フォームの設定で通常フォームと同じ UI を生成し、最上部に必須の「お客様選択」を追加した
// 手動モード（LIFF 不使用・LINE メッセージ送信なし）で出力する。
//
// 認証:
//  1. 管理画面のアクセストークン Cookie が有効ならそのまま表示
//  2. 失効していても手動フォーム専用のリフレッシュ Cookie があればサーバー側で更新して表示
//  3. どちらも無ければ専用ログイン画面（店舗ID・メール・パスワード・30日保持）を返す

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // 常に最新のフォーム設定で表示（認証必須ページのためキャッシュしない）
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { storeId, formId } = await params;
    const env = getAppEnvironment();

    // ---- 認証（local はスキップ） ----
    let refreshed: { accessToken: string; refreshToken: string | null } | null = null;
    if (env !== 'local') {
      let authorized = false;
      const accessToken = readCookie(request, ACCESS_COOKIE);
      if (accessToken) {
        const verified = await verifyStoreAdmin(accessToken, storeId);
        authorized = verified.ok;
      }
      if (!authorized) {
        refreshed = await refreshManualSession(request, storeId);
        authorized = !!refreshed;
      }
      if (!authorized) {
        // 未認証: 専用ログイン画面（200 で HTML。JSON を見せない）
        return new NextResponse(renderManualLoginPage(storeId, formId), { status: 200, headers: HTML_HEADERS });
      }
    }

    // ---- フォーム取得 ----
    let rawForm: Record<string, unknown> | null = null;

    if (env === 'local') {
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

    const response = new NextResponse(html, { status: 200, headers: HTML_HEADERS });
    // リフレッシュで更新した場合は新しいトークンを Cookie に反映
    // （30日保持の有無はリフレッシュ Cookie の有無で判断できないため、更新時は保持ありとして再設定）
    if (refreshed) {
      applySessionCookies(response, {
        storeId,
        formId,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        remember: true,
      });
    }
    return response;
  } catch (error) {
    console.error('[API] manual-form error:', error);
    return NextResponse.json({ error: '手動予約フォームの生成に失敗しました' }, { status: 500 });
  }
}
