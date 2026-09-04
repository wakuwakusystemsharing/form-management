import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { authorizeStoreAccess } from '@/lib/store-access';
import { normalizeTags } from '@/lib/customer-chart';

const CUSTOMERS_FILE = path.join(process.cwd(), 'data', 'customers.json');
const MAX_TAGS = 50;

/**
 * GET /api/stores/[storeId]/customers/tags
 * 店舗の顧客に付いているタグを使用回数の多い順に返す（編集フォームの「よく使うタグ」候補）
 * レスポンス: { tags: [{ tag, count }] }
 */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const { response } = await authorizeStoreAccess(request, storeId);
  if (response) return response;

  try {
    let tagLists: unknown[] = [];

    if (getAppEnvironment() === 'local') {
      if (fs.existsSync(CUSTOMERS_FILE)) {
        const customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf-8')) as Array<{
          store_id: string;
          tags?: unknown;
        }>;
        tagLists = customers.filter((c) => c.store_id === storeId).map((c) => c.tags);
      }
    } else {
      const adminClient = createAdminClient();
      if (!adminClient) {
        return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
      }
      const { data, error } = await adminClient
        .from('customers')
        .select('tags')
        .eq('store_id', storeId)
        .not('tags', 'is', null);
      if (error) {
        console.error('タグ集計エラー:', error);
        return NextResponse.json({ error: 'タグの取得に失敗しました' }, { status: 500 });
      }
      tagLists = (data ?? []).map((row: { tags: unknown }) => row.tags);
    }

    const counts = new Map<string, number>();
    for (const list of tagLists) {
      for (const tag of normalizeTags(list)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'))
      .slice(0, MAX_TAGS);

    return NextResponse.json({ tags });
  } catch (error) {
    console.error('タグ取得エラー:', error);
    return NextResponse.json({ error: 'タグの取得に失敗しました' }, { status: 500 });
  }
}
