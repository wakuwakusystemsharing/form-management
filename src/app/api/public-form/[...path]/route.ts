/**
 * Supabase StorageからフォームHTMLをプロキシ配信するAPIルート
 * Content-Typeを正しく設定してHTMLとして表示
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const filePath = path.join('/');
    
    // Supabase Storageからファイルを取得
    const supabase = createAdminClient();
    
    if (!supabase) {
      return new NextResponse('Supabase client initialization failed', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const { data, error } = await supabase.storage
      .from('forms')
      .download(filePath);

    if (error || !data) {
      console.error('Storage download error:', error);
      return new NextResponse('Form not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // BlobをTextに変換
    const html = await data.text();

    // HTMLとして正しく配信
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      }
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new NextResponse('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

