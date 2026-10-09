/**
 * 寄せ書きウォール（ローカル JSON モード）の結合テスト
 * 一時ディレクトリを cwd にして data/ を隔離する（プロジェクトの data/ には触れない）
 *
 * 要件のテスト項目:
 * - お客様向け API と店舗管理 API のレスポンスに、ユーザー ID（投稿者ハッシュ・通報者ハッシュ・LINE ユーザー ID）が含まれない
 * - 他人の付箋を削除できない
 * - 他店舗の付箋が取得できない（取得・削除・通報・公開操作）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let svc: typeof import('@/lib/wall-service');
let rules: typeof import('@/lib/wall-rules');

const CONSENT = () => ({ agreed: true, terms_version: rules.WALL_TERMS_VERSION });
const ACTOR = { user_id: null, email: 'owner@example.com', role: 'store' };

function writeData(name: string, rows: unknown[]) {
  fs.writeFileSync(path.join(tmpDir, 'data', name), JSON.stringify(rows));
}
function readData<T = Record<string, unknown>>(name: string): T[] {
  const f = path.join(tmpDir, 'data', name);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : [];
}

/** 再帰的にキーを探す（ユーザー識別子が混ざっていないか） */
function findForbiddenKeys(value: unknown, found: string[] = []): string[] {
  const forbidden = ['author_hash', 'reporter_hash', 'line_user_id', 'userId', 'user_id', 'line_display_name', 'display_name'];
  if (Array.isArray(value)) value.forEach((v) => findForbiddenKeys(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (forbidden.includes(k)) found.push(k);
      findForbiddenKeys(v, found);
    }
  }
  return found;
}
function containsString(value: unknown, needle: string): boolean {
  return JSON.stringify(value).includes(needle);
}

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-svc-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  svc = await import('@/lib/wall-service');
  rules = await import('@/lib/wall-rules');
});

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const f of ['wall_boards.json', 'wall_posts.json', 'wall_reports.json', 'wall_consents.json', 'wall_moderation_logs.json']) {
    const p = path.join(tmpDir, 'data', f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  writeData('stores.json', [
    { id: 'st1', name: '店1', theme_color: '#123456' },
    { id: 'st2', name: '店2' },
  ]);
  writeData('wall_boards.json', [
    { store_id: 'st1', enabled: true, moderation: 'instant', access_mode: 'login', theme: {}, ng_words: ['田中'] },
    { store_id: 'st2', enabled: true, moderation: 'instant', access_mode: 'login', theme: {}, ng_words: [] },
  ]);
});

// 投稿ごとに 31 秒ずつ進めた時刻を使う（30 秒間隔の制限に引っかからないように）
let clock = new Date('2026-10-09T01:00:00Z').getTime();
function tick(sec = 31): Date {
  clock += sec * 1000;
  return new Date(clock);
}

async function post(storeId: string, user: string, body: string, now = tick()) {
  const r = await svc.createWallPost(storeId, { line_user_id: user, body, consent: CONSENT() }, now);
  if (!r.ok) throw new Error(`post failed: ${r.status} ${r.error}`);
  return r;
}

describe('お客様向け: 投稿・閲覧', () => {
  it('貼った付箋が新しい順に並び、本人の付箋だけ is_mine。レスポンスに投稿者の情報が無い', async () => {
    const a = await post('st1', 'U_alice', 'とても美味しかった');
    const b = await post('st1', 'U_bob', 'また来ます');
    expect(a.status).toBe('published');
    expect(a.post.is_mine).toBe(true);
    const asAlice = await svc.getPublicWall('st1', { line_user_id: 'U_alice' });
    expect(asAlice.ok).toBe(true);
    if (!asAlice.ok) return;
    expect(asAlice.data.posts.map((p) => p.id)).toEqual([b.post.id, a.post.id]);
    expect(asAlice.data.posts.map((p) => p.is_mine)).toEqual([false, true]);
    expect(asAlice.data.consented).toBe(true);
    expect(findForbiddenKeys(asAlice.data)).toEqual([]);
    expect(containsString(asAlice.data, 'U_alice')).toBe(false);
    expect(containsString(asAlice.data, 'U_bob')).toBe(false);
    expect(findForbiddenKeys(a)).toEqual([]);
    // DB には投稿者ハッシュが残っている（運営対応用）が、ユーザー ID 自体は保存しない
    const stored = readData<{ author_hash: string }>('wall_posts.json');
    expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.author_hash))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'data', 'wall_posts.json'), 'utf-8')).not.toContain('U_alice');
  });

  it('初回は同意が必要（428）。同意日時と規約バージョンを保存し、次回からは不要', async () => {
    const r = await svc.createWallPost('st1', { line_user_id: 'U_new', body: 'はじめまして' }, tick());
    expect(r).toMatchObject({ ok: false, status: 428, code: 'consent_required' });
    await post('st1', 'U_new', 'はじめまして');
    const consents = readData<{ terms_version: string; agreed_at: string }>('wall_consents.json');
    expect(consents).toHaveLength(1);
    expect(consents[0].terms_version).toBe(rules.WALL_TERMS_VERSION);
    expect(consents[0].agreed_at).toBeTruthy();
    const again = await svc.createWallPost('st1', { line_user_id: 'U_new', body: '2回目' }, tick());
    expect(again.ok).toBe(true);
  });

  it('1 日 3 件（本人削除も数える）と 30 秒間隔', async () => {
    const t0 = new Date('2026-10-10T01:00:00Z').getTime();
    const p1 = await post('st1', 'U_rate', '1', new Date(t0));
    const tooSoon = await svc.createWallPost('st1', { line_user_id: 'U_rate', body: '早すぎ', consent: CONSENT() }, new Date(t0 + 10_000));
    expect(tooSoon).toMatchObject({ ok: false, status: 429, code: 'interval' });
    await post('st1', 'U_rate', '2', new Date(t0 + 40_000));
    await svc.deleteWallPost('st1', p1.post.id, { line_user_id: 'U_rate' });
    await post('st1', 'U_rate', '3', new Date(t0 + 80_000));
    const fourth = await svc.createWallPost('st1', { line_user_id: 'U_rate', body: '4', consent: CONSENT() }, new Date(t0 + 120_000));
    expect(fourth).toMatchObject({ ok: false, status: 429, code: 'daily' });
    // 翌日（JST）は貼れる
    const nextDay = await svc.createWallPost('st1', { line_user_id: 'U_rate', body: '翌日', consent: CONSENT() }, new Date('2026-10-10T16:00:00Z'));
    expect(nextDay.ok).toBe(true);
  });

  it('NG ワード・承認制は保留（pending）で、ボードには出ない。案内文は同じ', async () => {
    const ng = await post('st1', 'U_ng', '店長の田中さん最高');
    expect(ng.status).toBe('pending');
    expect(ng.message).toBe('お店の確認後に表示されます');
    writeData('wall_boards.json', [{ store_id: 'st1', enabled: true, moderation: 'approval', access_mode: 'login', theme: {}, ng_words: [] }, { store_id: 'st2', enabled: true }]);
    const ap = await post('st1', 'U_ap', 'よかったです');
    expect(ap.status).toBe('pending');
    const wall = await svc.getPublicWall('st1', {});
    expect(wall.ok && wall.data.posts.map((p) => p.id)).toEqual([]);
    const admin = await svc.listAdminWallPosts('st1', { filter: 'pending' });
    expect(admin.ok && admin.posts.map((p) => [p.pending_reason, p.ng_hits])).toEqual([['approval', []], ['ng_word', ['田中']]]);
  });

  it('公開範囲: friend_only は友だちでないと閲覧も投稿もできない。friend_to_post は閲覧のみ可', async () => {
    writeData('wall_boards.json', [{ store_id: 'st1', enabled: true, access_mode: 'friend_only' }, { store_id: 'st2', enabled: true, access_mode: 'friend_to_post' }]);
    const v1 = await svc.getPublicWall('st1', { line_user_id: 'U1' });
    expect(v1.ok && [v1.data.can_view, v1.data.can_post]).toEqual([false, false]);
    const v1f = await svc.getPublicWall('st1', { line_user_id: 'U1', line_friend_flag: '1' });
    expect(v1f.ok && [v1f.data.can_view, v1f.data.can_post]).toEqual([true, true]);
    const v2 = await svc.getPublicWall('st2', { line_user_id: 'U1' });
    expect(v2.ok && [v2.data.can_view, v2.data.can_post]).toEqual([true, false]);
    const p = await svc.createWallPost('st2', { line_user_id: 'U1', body: 'x', consent: CONSENT() }, tick());
    expect(p).toMatchObject({ ok: false, status: 403, code: 'friend_required' });
  });

  it('ボードが無効なら投稿できず、付箋も返さない', async () => {
    writeData('wall_boards.json', [{ store_id: 'st1', enabled: false }]);
    expect(await svc.createWallPost('st1', { line_user_id: 'U1', body: 'x', consent: CONSENT() }, tick())).toMatchObject({ ok: false, status: 403 });
    const w = await svc.getPublicWall('st1', {});
    expect(w.ok && [w.data.board.enabled, w.data.posts.length]).toEqual([false, 0]);
  });
});

describe('本人削除', () => {
  it('他人の付箋は削除できない（404）。本人は削除でき、一覧から消える', async () => {
    const a = await post('st1', 'U_owner', '消したい付箋');
    const other = await svc.deleteWallPost('st1', a.post.id, { line_user_id: 'U_other' });
    expect(other).toMatchObject({ ok: false, status: 404 });
    const mine = await svc.deleteWallPost('st1', a.post.id, { line_user_id: 'U_owner' });
    expect(mine).toEqual({ ok: true });
    const w = await svc.getPublicWall('st1', {});
    expect(w.ok && w.data.posts.map((p) => p.id)).not.toContain(a.post.id);
    // 2 回目は 404
    expect(await svc.deleteWallPost('st1', a.post.id, { line_user_id: 'U_owner' })).toMatchObject({ ok: false, status: 404 });
    // 店舗の一覧では本文を返さない
    const admin = await svc.listAdminWallPosts('st1', { filter: 'deleted' });
    expect(admin.ok && admin.posts[0].body).toBeNull();
  });
});

describe('他店舗の付箋', () => {
  it('取得・削除・通報・公開操作のどれもできない', async () => {
    const p = await post('st2', 'U_x', '店2の付箋');
    const w1 = await svc.getPublicWall('st1', {});
    expect(w1.ok && w1.data.posts.map((x) => x.id)).not.toContain(p.post.id);
    expect(await svc.deleteWallPost('st1', p.post.id, { line_user_id: 'U_x' })).toMatchObject({ ok: false, status: 404 });
    expect(await svc.reportWallPost('st1', p.post.id, { line_user_id: 'U_y', reason: 'abuse' })).toMatchObject({ ok: false, status: 404 });
    expect(await svc.moderateWallPost('st1', p.post.id, { action: 'hide', reason: 'terms_violation' }, ACTOR)).toMatchObject({ ok: false, status: 404 });
    const admin1 = await svc.listAdminWallPosts('st1', {});
    expect(admin1.ok && admin1.posts.map((x) => x.id)).not.toContain(p.post.id);
    // 同じ人でも店舗が違えば別人として扱われる（店舗 2 の付箋は店舗 1 では自分のものにならない）
    expect(readData<{ store_id: string; author_hash: string }>('wall_posts.json').find((r) => r.store_id === 'st2')?.author_hash)
      .not.toBe((await import('@/lib/wall-author-hash')).computeWallAuthorHash('st1', 'U_x'));
  });
});

describe('通報', () => {
  it('3 人の通報で確認待ちになりボードから消える。同じ人の重複は 1 件。自分の付箋は通報できない', async () => {
    const p = await post('st1', 'U_author', '問題の付箋');
    expect(await svc.reportWallPost('st1', p.post.id, { line_user_id: 'U_author', reason: 'abuse' })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.reportWallPost('st1', p.post.id, { line_user_id: 'R1', reason: 'nonsense' })).toMatchObject({ ok: false, status: 400 });
    await svc.reportWallPost('st1', p.post.id, { line_user_id: 'R1', reason: 'abuse' });
    await svc.reportWallPost('st1', p.post.id, { line_user_id: 'R1', reason: 'abuse' }); // 重複
    await svc.reportWallPost('st1', p.post.id, { line_user_id: 'R2', reason: 'personal_info' });
    let w = await svc.getPublicWall('st1', {});
    expect(w.ok && w.data.posts.map((x) => x.id)).toContain(p.post.id);
    const third = await svc.reportWallPost('st1', p.post.id, { line_user_id: 'R3', reason: 'other' });
    expect(third.ok).toBe(true);
    expect(findForbiddenKeys(third)).toEqual([]);
    w = await svc.getPublicWall('st1', {});
    expect(w.ok && w.data.posts.map((x) => x.id)).not.toContain(p.post.id);
    const admin = await svc.listAdminWallPosts('st1', { filter: 'review' });
    expect(admin.ok).toBe(true);
    if (!admin.ok) return;
    expect(admin.posts[0]).toMatchObject({ id: p.post.id, status: 'review', report_count: 3, report_reasons: { abuse: 1, personal_info: 1, advertising: 0, other: 1 } });
    // 店舗管理 API にも通報者・投稿者の情報が無い
    expect(findForbiddenKeys(admin)).toEqual([]);
    for (const u of ['U_author', 'R1', 'R2', 'R3']) expect(containsString(admin, u)).toBe(false);
    // 確認待ちの付箋はお客様からさらに通報できない
    expect(await svc.reportWallPost('st1', p.post.id, { line_user_id: 'R4', reason: 'abuse' })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('店舗の公開 / 非公開', () => {
  it('非公開の理由は「規約違反」のみ。公開に戻すと通報数がリセットされ、記録が残る', async () => {
    const p = await post('st1', 'U_m', '普通の感想');
    expect(await svc.moderateWallPost('st1', p.post.id, { action: 'hide', reason: 'bad_review' }, ACTOR)).toMatchObject({ ok: false, status: 400 });
    expect(await svc.moderateWallPost('st1', p.post.id, { action: 'hide' }, ACTOR)).toMatchObject({ ok: false, status: 400 });
    const hidden = await svc.moderateWallPost('st1', p.post.id, { action: 'hide', reason: 'terms_violation' }, ACTOR);
    expect(hidden.ok && [hidden.post.status, hidden.post.hidden_reason]).toEqual(['hidden', 'terms_violation']);
    expect(findForbiddenKeys(hidden)).toEqual([]);
    let w = await svc.getPublicWall('st1', {});
    expect(w.ok && w.data.posts.map((x) => x.id)).not.toContain(p.post.id);
    const pub = await svc.moderateWallPost('st1', p.post.id, { action: 'publish' }, ACTOR);
    expect(pub.ok && [pub.post.status, pub.post.report_count]).toEqual(['published', 0]);
    w = await svc.getPublicWall('st1', {});
    expect(w.ok && w.data.posts.map((x) => x.id)).toContain(p.post.id);
    const logs = readData<{ action: string; reason: string | null; actor_email: string }>('wall_moderation_logs.json');
    expect(logs.map((l) => [l.action, l.reason])).toEqual([['hide', 'terms_violation'], ['publish', null]]);
    // 本人削除済みは操作できない
    await svc.deleteWallPost('st1', p.post.id, { line_user_id: 'U_m' });
    expect(await svc.moderateWallPost('st1', p.post.id, { action: 'publish' }, ACTOR)).toMatchObject({ ok: false, status: 400 });
  });

  it('設定の保存: 不正な色・NG ワード・LIFF ID は 400、正しい値は正規化して保存', async () => {
    expect(await svc.saveWallSettings('st1', { theme: { note_colors: ['#fff', '#000000', '#111111'] } })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveWallSettings('st1', { theme: { note_colors: ['#000000', '#111111'] } })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveWallSettings('st1', { ng_words: ['x'.repeat(31)] })).toMatchObject({ ok: false, status: 400 });
    expect(await svc.saveWallSettings('st1', { liff_id: 'bad' })).toMatchObject({ ok: false, status: 400 });
    const ok = await svc.saveWallSettings('st1', {
      enabled: true, liff_id: '1234567890-AbCdEfGh', moderation: 'approval', access_mode: 'friend_to_post',
      theme: { preset: 'chalkboard', note_colors: ['#AABBCC', '#112233', '#445566'], title: '黒板' }, ng_words: [' 競合店 ', '競合店'],
    });
    expect(ok.ok && ok.settings).toMatchObject({ enabled: true, liff_id: '1234567890-AbCdEfGh', moderation: 'approval', access_mode: 'friend_to_post', ng_words: ['競合店'] });
    expect(ok.ok && ok.settings.theme).toMatchObject({ preset: 'chalkboard', note_colors: ['#aabbcc', '#112233', '#445566'], title: '黒板' });
  });

  it('統計: 今週の投稿数・承認待ち・確認待ち', async () => {
    await post('st1', 'S1', 'a');
    await post('st1', 'S2', '店長の田中さん'); // NG → pending
    const s = await svc.getWallStats('st1', new Date(clock));
    expect(s.ok && s.stats).toEqual({ enabled: true, week_posts: 2, pending: 1, review: 0 });
  });
});

describe('ページング', () => {
  it('カーソルで続きを取得でき、重複しない', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await post('st1', `P${i}`, `付箋${i}`)).post.id);
    const page1 = await svc.getPublicWall('st1', {}, { limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.data.posts.map((p) => p.id)).toEqual([ids[4], ids[3]]);
    const page2 = await svc.getPublicWall('st1', {}, { limit: 2, cursor: page1.data.next_cursor });
    const page3 = page2.ok ? await svc.getPublicWall('st1', {}, { limit: 2, cursor: page2.data.next_cursor }) : null;
    expect(page2.ok && page2.data.posts.map((p) => p.id)).toEqual([ids[2], ids[1]]);
    expect(page3 && page3.ok && [page3.data.posts.map((p) => p.id), page3.data.next_cursor]).toEqual([[ids[0]], null]);
  });
});
