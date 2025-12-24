/**
 * GASエンドポイントの接続テスト用APIルート
 * サーバーサイドでプロキシすることでCORSエラーを回避
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const gasEndpoint = searchParams.get('url');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');

    if (!gasEndpoint || !startTime || !endTime) {
      return NextResponse.json(
        { error: 'url, startTime, endTime パラメータが必要です' },
        { status: 400 }
      );
    }

    // URL形式の検証
    try {
      new URL(gasEndpoint);
    } catch {
      return NextResponse.json(
        { error: '有効なURL形式ではありません' },
        { status: 400 }
      );
    }

    // Google Apps ScriptのURLパターンチェック
    const gasUrlPattern = /^https:\/\/script\.google\.com\/macros\/s\/[^\/]+\/exec/;
    if (!gasUrlPattern.test(gasEndpoint)) {
      return NextResponse.json(
        { error: 'Google Apps ScriptのURL形式が正しくありません' },
        { status: 400 }
      );
    }

    // GASエンドポイントにリクエストを送信
    const testUrl = `${gasEndpoint}?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
    
    // タイムアウトを設定（10秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return NextResponse.json(
          { error: `HTTPエラー: ${response.status} ${response.statusText}` },
          { status: response.status }
        );
      }

      const data = await response.json();

      // レスポンスが配列かどうかを確認
      if (!Array.isArray(data)) {
        return NextResponse.json(
          { error: 'レスポンスが配列形式ではありません' },
          { status: 400 }
        );
      }

      // レスポンスの構造を確認
      if (data.length > 0) {
        const firstItem = data[0];
        if (!firstItem.hasOwnProperty('startTime') || !firstItem.hasOwnProperty('endTime')) {
          return NextResponse.json(
            { error: 'レスポンスの形式が正しくありません（startTime, endTimeが必要です）' },
            { status: 400 }
          );
        }
      }

      return NextResponse.json({ success: true, data });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError') {
          return NextResponse.json(
            { error: 'リクエストがタイムアウトしました（10秒）' },
            { status: 408 }
          );
        }
        return NextResponse.json(
          { error: `ネットワークエラー: ${fetchError.message}` },
          { status: 500 }
        );
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('GAS endpoint test error:', error);
    return NextResponse.json(
      { error: '内部サーバーエラー' },
      { status: 500 }
    );
  }
}

