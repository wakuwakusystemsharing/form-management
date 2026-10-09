/**
 * 予約フォーム設定のスナップショット（ローカル JSON モード）
 * 一時ディレクトリを cwd にして data/ を隔離する
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FormConfig } from '@/types/form';

let tmpDir = '';
let originalCwd = '';
let repo: typeof import('@/lib/form-snapshots');

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-snap-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  repo = await import('@/lib/form-snapshots');
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const cfg = (n: number) => ({ basic_info: { form_name: `v${n}` } } as unknown as FormConfig);

describe('form-snapshots（local）', () => {
  it('保存 → 一覧（新しい順・config なし）→ 取得（config 付き）', async () => {
    const a = await repo.createFormSnapshot({ store_id: 'st1', form_id: 'f1', config: cfg(1), reason: 'update', actor_email: 'a@example.com' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await repo.createFormSnapshot({ store_id: 'st1', form_id: 'f1', config: cfg(2), reason: 'sync', reason_label: '「LINE予約」から反映前', source_form_id: 'f0' });
    await repo.createFormSnapshot({ store_id: 'st1', form_id: 'f2', config: cfg(9), reason: 'update' });

    const list = await repo.listFormSnapshots('f1');
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    expect('config' in list[0]).toBe(false);
    expect(list[0]).toMatchObject({ reason: 'sync', reason_label: '「LINE予約」から反映前', source_form_id: 'f0' });
    expect(list[1]).toMatchObject({ reason: 'update', reason_label: '更新前', actor_email: 'a@example.com' });

    const one = await repo.getFormSnapshot('f1', a.id);
    expect(one?.config).toEqual(cfg(1));
    // 別フォームの ID では取れない
    expect(await repo.getFormSnapshot('f2', a.id)).toBeNull();
  });

  it('フォームごとに直近 20 件だけ保持する', async () => {
    for (let i = 0; i < 25; i++) {
      await repo.createFormSnapshot({ store_id: 'st1', form_id: 'f3', config: cfg(i), reason: 'update' });
    }
    const list = await repo.listFormSnapshots('f3', 100);
    expect(list).toHaveLength(repo.MAX_SNAPSHOTS_PER_FORM);
    // 他のフォームの行は消えていない
    expect((await repo.listFormSnapshots('f1')).length).toBe(2);
  });
});
