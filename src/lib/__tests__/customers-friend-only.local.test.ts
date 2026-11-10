/**
 * 顧客一覧 API（local）: 予約なしの LINE 友だち（line_friend_only）は既定で出さず、include_friends=1 で含める
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let route: typeof import('@/app/api/stores/[storeId]/customers/route');

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'customers-friend-only-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'data', 'customers.json'), JSON.stringify([
    { id: 'c1', store_id: 'st0001', name: '山田', phone: '090', tags: [], total_visits: 2, total_spent: 0, last_visit_date: '2026-11-01' },
    { id: 'c2', store_id: 'st0001', name: 'はなこ', line_user_id: 'U2', line_friend_only: true, tags: ['友だち'], total_visits: 0, total_spent: 0 },
    { id: 'c3', store_id: 'st0001', name: 'たろう', line_user_id: 'U3', line_friend_only: true, tags: [], total_visits: 0, total_spent: 0 },
    { id: 'x1', store_id: 'st0002', name: '他店の友だち', line_user_id: 'U9', line_friend_only: true, tags: [], total_visits: 0, total_spent: 0 },
  ]));
  route = await import('@/app/api/stores/[storeId]/customers/route');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const get = async (query = '') => {
  const res = await route.GET(new Request(`http://localhost/api/stores/st0001/customers${query}`), { params: Promise.resolve({ storeId: 'st0001' }) });
  return (await res.json()) as { customers: Array<{ id: string }>; total: number; friend_only_count: number };
};

describe('GET /api/stores/{storeId}/customers と予約なしの LINE 友だち', () => {
  it('既定では出さず、人数だけ friend_only_count で返す', async () => {
    const r = await get();
    expect(r.customers.map((c) => c.id)).toEqual(['c1']);
    expect(r.total).toBe(1);
    expect(r.friend_only_count).toBe(2);
  });
  it('include_friends=1 で含める。タグ・検索の絞り込みも効く', async () => {
    const all = await get('?include_friends=1');
    expect(all.customers.map((c) => c.id).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(all.total).toBe(3);
    const tagged = await get(`?include_friends=1&tag=${encodeURIComponent('友だち')}`);
    expect(tagged.customers.map((c) => c.id)).toEqual(['c2']);
    // 既定（含めない）だと、タグが付いていても出ない
    expect((await get(`?tag=${encodeURIComponent('友だち')}`)).customers).toEqual([]);
  });
});
