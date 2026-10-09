/**
 * 寄せ書きウォール API 共通: サービスの結果を NextResponse にする
 */
import { NextResponse } from 'next/server';
import type { WallError } from '@/lib/wall-service';

export function wallErrorResponse(e: WallError): NextResponse {
  return NextResponse.json(
    { error: e.error, ...(e.code ? { code: e.code } : {}), ...(e.detail ? { details: e.detail } : {}) },
    { status: e.status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export function wallJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function wallServerError(where: string, error: unknown): NextResponse {
  console.error(`[API] wall ${where} error:`, error instanceof Error ? error.message : error);
  return NextResponse.json({ error: '処理に失敗しました。時間をおいて再度お試しください' }, { status: 500 });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
