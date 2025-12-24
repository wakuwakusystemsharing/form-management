/**
 * GASエンドポイントへの送信（POST）用プロキシ
 * - ブラウザ（特にLINE in-app WebView）のCORS問題を回避するためサーバーサイドで中継する
 * - 管理画面で保存されているGAS exec URLのみを許可（簡易バリデーション）
 */

import { NextRequest, NextResponse } from 'next/server';

type SubmitRequestBody = {
  url?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SubmitRequestBody;
    const gasEndpoint = body?.url;

    if (!gasEndpoint) {
      return NextResponse.json({ error: 'url パラメータが必要です' }, { status: 400 });
    }

    // URL形式の検証
    try {
      new URL(gasEndpoint);
    } catch {
      return NextResponse.json({ error: '有効なURL形式ではありません' }, { status: 400 });
    }

    // Google Apps ScriptのURLパターンチェック
    const gasUrlPattern = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/;
    if (!gasUrlPattern.test(gasEndpoint)) {
      return NextResponse.json({ error: 'Google Apps ScriptのURL形式が正しくありません' }, { status: 400 });
    }

    // タイムアウトを設定（10秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(gasEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body?.payload ?? {}),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';
      let data: unknown = null;
      try {
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }
      } catch {
        // ignore parse error; we'll still surface status
      }

      if (!response.ok) {
        return NextResponse.json(
          {
            error: `GAS送信エラー: ${response.status} ${response.statusText}`,
            details: data,
          },
          { status: response.status }
        );
      }

      return NextResponse.json({ success: true, data });
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return NextResponse.json({ error: 'リクエストがタイムアウトしました（10秒）' }, { status: 408 });
      }

      if (fetchError instanceof Error) {
        return NextResponse.json({ error: `ネットワークエラー: ${fetchError.message}` }, { status: 500 });
      }

      return NextResponse.json({ error: 'ネットワークエラー' }, { status: 500 });
    }
  } catch (error) {
    console.error('GAS submit proxy error:', error);
    return NextResponse.json({ error: '内部サーバーエラー' }, { status: 500 });
  }
}


