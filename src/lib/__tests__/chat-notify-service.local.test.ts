/**
 * 1 対 1 トーク: 新着の通知（スタッフの LINE・メール）と、保存期間を過ぎた会話の自動削除（local = JSON）
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let tmpDir = '';
let originalCwd = '';
let service: typeof import('@/lib/chat-service');
let repo: typeof import('@/lib/chat-repository');
let digest: typeof import('@/lib/store-digest-repository');

const STORE = 'st0001';
/** 日本時間の昼（夜間ではない） */
const NOON = new Date('2026-11-25T03:00:00Z');
const ORIGIN = 'https://app.example';

let seq = 0;
const textEvent = (text: string, opts: { user?: string; at?: number; id?: string } = {}) => ({
  type: 'message',
  timestamp: opts.at ?? NOON.getTime(),
  source: { type: 'user', userId: opts.user ?? 'U1' },
  message: { id: opts.id ?? `m${++seq}`, type: 'text', text },
});

const lines: Array<{ token: string; to: string; text: string }> = [];
const mails: Array<{ to: string; subject: string; body: string; fromName?: string }> = [];
let lineOk = true;
const deps = (now: Date = NOON) => ({
  now,
  pushLine: async (token: string, to: string, text: string) => {
    lines.push({ token, to, text });
    return { ok: lineOk };
  },
  sendMail: async (params: { to: string; subject: string; body: string; fromName?: string }) => {
    mails.push(params);
    return { ok: true };
  },
});

const dataFile = (name: string) => path.join(tmpDir, 'data', name);
const record = (events: unknown[], now: Date = NOON) => service.recordChatInboundEvents(STORE, events, { verified: false, origin: ORIGIN }, deps(now));
const setNotify = async (patch: Record<string, unknown>) => {
  const r = await service.updateChatNotifySettings(STORE, { line: false, email: false, emails: [], quiet: { enabled: true, start: 22, end: 8 }, ...patch });
  expect(r.ok).toBe(true);
};

beforeAll(async () => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-notify-'));
  process.chdir(tmpDir);
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
  fs.writeFileSync(dataFile('stores.json'), JSON.stringify([{ id: STORE, name: 'テスト店', line_channel_access_token: 'store-token' }]));
  fs.writeFileSync(dataFile('customers.json'), JSON.stringify([{ id: 'c1', store_id: STORE, line_user_id: 'U1', name: '山田 花子' }]));
  service = await import('@/lib/chat-service');
  repo = await import('@/lib/chat-repository');
  digest = await import('@/lib/store-digest-repository');
}, 120000);

afterAll(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const f of ['chat.json', 'store_digest.json']) if (fs.existsSync(dataFile(f))) fs.rmSync(dataFile(f));
  lines.length = 0;
  mails.length = 0;
  lineOk = true;
  expect((await service.updateChatSettings(STORE, { enabled: true })).ok).toBe(true);
  await digest.upsertDigestStaff(STORE, 'Ustaff1', '店長');
  await digest.upsertDigestStaff(STORE, 'Ustaff2', 'スタッフ A');
});

describe('通知の設定', () => {
  it('既定は OFF。保存すると読み直せ、トークの ON / OFF・保存期間は変わらない', async () => {
    const before = await service.getChatNotifyView(STORE);
    expect(before).toMatchObject({ settings: { line: false, email: false, emails: [], quiet: { enabled: true, start: 22, end: 8 } }, chat_enabled: true, staff_count: 2, unavailable: false });
    await setNotify({ line: true, email: true, emails: ['a@example.com'], quiet: { enabled: false, start: 23, end: 7 } });
    expect((await service.getChatNotifyView(STORE)).settings).toEqual({ line: true, email: true, emails: ['a@example.com'], quiet: { enabled: false, start: 23, end: 7 } });
    expect(await service.getChatSettingsView(STORE)).toMatchObject({ enabled: true, retention_years: 1 });
    // トークの設定を変えても、通知の設定は残る
    await service.updateChatSettings(STORE, { retention_years: 2 });
    expect((await service.getChatNotifyView(STORE)).settings.emails).toEqual(['a@example.com']);
  });

  it('形のおかしい設定は 400 で断る', async () => {
    expect(await service.updateChatNotifySettings(STORE, { email: true, emails: ['abc'] })).toMatchObject({ ok: false, status: 400 });
    expect(await service.updateChatNotifySettings(STORE, { email: true, emails: [] })).toMatchObject({ ok: false, status: 400 });
  });

  it('画面に返す内容に、スタッフの LINE ユーザー ID を入れない', async () => {
    expect(JSON.stringify(await service.getChatNotifyView(STORE))).not.toContain('Ustaff');
  });
});

describe('新着の通知', () => {
  it('通知が OFF なら、何も送らない', async () => {
    await record([textEvent('こんにちは')]);
    expect(lines).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('スタッフ全員の LINE とメールに送る。本文は載せず、名前・未読の数・リンクだけ', async () => {
    await setNotify({ line: true, email: true, emails: ['a@example.com', 'b@example.com'] });
    await record([textEvent('膝が痛くて通院しています'), textEvent('明日の予約を変えたいです', { at: NOON.getTime() + 1000 })]);
    expect(lines.map((l) => [l.token, l.to])).toEqual([
      ['store-token', 'Ustaff1'],
      ['store-token', 'Ustaff2'],
    ]);
    expect(lines[0].text).toContain('山田 花子 様から新しいメッセージが届きました（未読 2 件）');
    expect(lines[0].text).toContain(`${ORIGIN}/${STORE}/admin?tab=chat`);
    expect(mails.map((m) => m.to)).toEqual(['a@example.com', 'b@example.com']);
    expect(mails[0]).toMatchObject({ subject: '【テスト店】山田 花子 様から新しいメッセージが届きました', fromName: 'テスト店' });
    // メッセージの内容は、通知のどこにも出さない
    const all = JSON.stringify([lines, mails]);
    expect(all).not.toContain('膝が痛くて');
    expect(all).not.toContain('予約を変えたい');
  });

  it('同じ会話については 10 分に 1 回まで。10 分たてばまた送る。別のお客様の会話は別に数える', async () => {
    await setNotify({ email: true, emails: ['a@example.com'] });
    await record([textEvent('1 通目')]);
    await record([textEvent('2 通目')], new Date(NOON.getTime() + 5 * 60000));
    expect(mails).toHaveLength(1);
    await record([textEvent('別の人です', { user: 'U2' })], new Date(NOON.getTime() + 6 * 60000));
    expect(mails).toHaveLength(2);
    expect(mails[1].subject).toContain('お客様から');
    await record([textEvent('3 通目')], new Date(NOON.getTime() + 10 * 60000));
    expect(mails).toHaveLength(3);
    expect(mails[2].body).toContain('（未読 3 件）');
  });

  it('フォームの送信文・コマンド・フォームに続く文では通知しない', async () => {
    await setNotify({ line: true, email: true, emails: ['a@example.com'] });
    await record([textEvent('【カット予約フォーム】\n《お名前》\n山田'), textEvent('ご予約ありがとうございます', { at: NOON.getTime() + 300 }), textEvent('予約確認', { at: NOON.getTime() + 60000 })]);
    expect(lines).toHaveLength(0);
    expect(mails).toHaveLength(0);
  });

  it('夜間は送らず、明けたあとの最初の新着と一緒に知らせる', async () => {
    await setNotify({ email: true, emails: ['a@example.com'] });
    const night = new Date('2026-11-25T14:30:00Z'); // 日本時間 23:30
    await record([textEvent('夜の 1 通目', { at: night.getTime() }), textEvent('夜の 2 通目', { at: night.getTime() + 1000 })], night);
    expect(mails).toHaveLength(0);
    expect(repo.readLocalChatData().threads[0]).toMatchObject({ unread_count: 2, notified_at: null });
    const morning = new Date('2026-11-25T23:30:00Z'); // 日本時間 翌 8:30
    await record([textEvent('朝の 1 通', { at: morning.getTime() })], morning);
    expect(mails).toHaveLength(1);
    expect(mails[0].body).toContain('（未読 3 件）');
  });

  it('同じ通知が LINE から送り直されても、もう一度は知らせない', async () => {
    await setNotify({ email: true, emails: ['a@example.com'], quiet: { enabled: false, start: 22, end: 8 } });
    const ev = textEvent('こんにちは', { id: 'same' });
    await record([ev]);
    await record([ev], new Date(NOON.getTime() + 20 * 60000));
    expect(mails).toHaveLength(1);
  });

  it('メッセージを送ってきた本人がスタッフのときは、その人には知らせない', async () => {
    await setNotify({ line: true });
    await record([textEvent('スタッフからのテストです', { user: 'Ustaff1' })]);
    expect(lines.map((l) => l.to)).toEqual(['Ustaff2']);
  });

  it('送信に失敗しても、保存の結果は変わらない', async () => {
    await setNotify({ line: true });
    lineOk = false;
    expect(await record([textEvent('こんにちは')])).toMatchObject({ saved: 1, failed: 0 });
    expect(repo.readLocalChatData().messages).toHaveLength(1);
  });

  it('会話を開いて既読にしたあとでも、前の通知から 10 分たつまでは送らない', async () => {
    await setNotify({ email: true, emails: ['a@example.com'] });
    await record([textEvent('1 通目')]);
    const id = repo.readLocalChatData().threads[0].id;
    await service.getChatThreadDetail(STORE, id);
    await record([textEvent('2 通目')], new Date(NOON.getTime() + 2 * 60000));
    expect(mails).toHaveLength(1);
  });
});

describe('テストの通知', () => {
  it('保存済みの送り先へ送る（夜間でも送る）。通知が OFF なら送らない', async () => {
    expect(await service.sendChatNotifyTest(STORE, ORIGIN, deps())).toMatchObject({ ok: false, status: 400 });
    await setNotify({ line: true, email: true, emails: ['a@example.com'] });
    const night = new Date('2026-11-25T14:30:00Z');
    expect(await service.sendChatNotifyTest(STORE, ORIGIN, deps(night))).toEqual({ ok: true, line_sent: 2, email_sent: 1, failed: 0 });
    expect(lines[0].text).toContain('テスト 様から新しいメッセージが届きました');
  });

  it('LINE だけ ON で、スタッフが登録されていなければ、理由を返す', async () => {
    await digest.deleteDigestStaff(STORE, { lineUserId: 'Ustaff1' });
    await digest.deleteDigestStaff(STORE, { lineUserId: 'Ustaff2' });
    await setNotify({ line: true });
    expect(await service.sendChatNotifyTest(STORE, ORIGIN, deps())).toMatchObject({ ok: false, status: 502 });
  });
});

describe('保存期間を過ぎた会話の自動削除', () => {
  const DAY = 86400000;
  const now = new Date('2028-01-10T00:00:00Z');
  const ago = (days: number) => now.getTime() - days * DAY;

  it('保存期間（1 年）より前のメッセージだけを消す。空になった古い会話は、会話ごと消す', async () => {
    await record([textEvent('古い 1', { at: ago(400) }), textEvent('古い 2', { at: ago(380) }), textEvent('新しい', { at: ago(10) })]);
    await record([textEvent('古い人', { user: 'U2', at: ago(500) })]);
    expect(await service.runChatRetention(now)).toEqual({ messages: 3, threads: 1, remaining: false });
    const { threads, messages } = repo.readLocalChatData();
    expect(messages.map((m) => m.text)).toEqual(['新しい']);
    expect(threads.map((t) => t.line_user_id)).toEqual(['U1']);
    // もう一度動かしても、何も消えない
    expect(await service.runChatRetention(now)).toEqual({ messages: 0, threads: 0, remaining: false });
  });

  it('保存期間が 3 年の店舗では、2 年前の会話は消さない。1 年に短くすると、次の実行で消える', async () => {
    await service.updateChatSettings(STORE, { retention_years: 3 });
    await record([textEvent('2 年前', { at: ago(730) })]);
    expect((await service.runChatRetention(now)).messages).toBe(0);
    await service.updateChatSettings(STORE, { retention_years: 1 });
    expect(await service.runChatRetention(now)).toEqual({ messages: 1, threads: 1, remaining: false });
  });

  it('トーク機能を OFF にした店舗の会話も、保存期間を過ぎたら消える', async () => {
    await record([textEvent('古い', { at: ago(400) })]);
    await service.updateChatSettings(STORE, { enabled: false });
    expect((await service.runChatRetention(now)).messages).toBe(1);
  });

  it('1 回の上限を超えるぶんは残し、次の実行で消す', async () => {
    await record(Array.from({ length: 5 }, (_, i) => textEvent(`古い ${i}`, { at: ago(400 + i) })));
    const first = await repo.purgeExpiredChat(now, 3);
    expect(first).toEqual({ messages: 3, threads: 0, remaining: true });
    // 古い順に消す
    expect(repo.readLocalChatData().messages.map((m) => m.text)).toEqual(['古い 1', '古い 0']);
    expect(await repo.purgeExpiredChat(now, 3)).toEqual({ messages: 2, threads: 1, remaining: false });
  });

  it('行だけを消す処理（purgeExpiredChat）は、画像を持つメッセージを消さない（画像のファイルを先に消す必要があるため）', async () => {
    await record([textEvent('古い', { at: ago(400), id: 'keep' })]);
    const file = dataFile('chat.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    data.messages[0].media_path = 'chat/st0001/x.jpg';
    fs.writeFileSync(file, JSON.stringify(data));
    expect(await repo.purgeExpiredChat(now)).toEqual({ messages: 0, threads: 0, remaining: false });
    expect(repo.readLocalChatData().messages).toHaveLength(1);
    // 1 日 1 回の自動削除（runChatRetention）は、先に画像を消してから行を消す
    expect(await service.runChatRetention(now)).toEqual({ messages: 1, threads: 1, remaining: false });
  });
});
