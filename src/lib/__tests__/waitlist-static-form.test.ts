/**
 * 空き待ち（キャンセル待ち）の予約フォーム側:
 * 満席（✕）の時間をタップして登録 / あなたの空き待ち / 空きのお知らせから開いたとき（?waitlist=）
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

const EID = '3f2b8c1e-1111-4222-8333-444455556666';
const hours = { open: '09:00', close: '18:00', closed: false };

function buildForm(waitlist?: Record<string, unknown>, over: Record<string, unknown> = {}): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        categories: [{ id: 'cat1', name: 'カット', menus: [{ id: 'm1', name: 'カット', price: 4000, duration: 60 }, { id: 'm2', name: 'カラー', price: 6000, duration: 90 }] }],
      },
      calendar_settings: {
        booking_mode: 'calendar',
        business_hours: { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours },
        advance_booking_days: 60,
        ...(waitlist ? { waitlist } : {}),
        ...over,
      },
    },
  } as never);
}

const html = (form: Form, mode?: 'manual' | 'preview') => new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, mode as never);

// 3 日後の 14:00〜15:00 が埋まっている
const target = new Date();
target.setDate(target.getDate() + 3);
target.setHours(0, 0, 0, 0);
const pad = (n: number) => String(n).padStart(2, '0');
const DATE = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
const at = (h: number) => new Date(target.getFullYear(), target.getMonth(), target.getDate(), h, 0, 0).toISOString();
const BUSY = [{ startTime: at(14), endTime: at(15), title: '予約' }];

interface Ctx {
  win: any;
  doc: Document;
  posts: Array<{ url: string; body: any }>;
  urls: string[];
  alerts: string[];
  state: { events: unknown[]; entries: unknown[]; register: { status: number; body: unknown }; source: unknown };
}

async function loadDom(pageHtml: string, search = ''): Promise<Ctx> {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(pageHtml, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: `https://example.com/form${search}` });
  const win = dom.window as any;
  const ctx: Ctx = {
    win,
    doc: win.document,
    posts: [],
    urls: [],
    alerts: [],
    state: { events: BUSY, entries: [], register: { status: 201, body: {} }, source: null },
  };
  win.alert = (m: string) => { ctx.alerts.push(m); };
  win.confirm = () => true;
  win.scrollTo = () => {};
  win.Element.prototype.scrollIntoView = () => {};
  win.fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    ctx.urls.push(u);
    const body = init?.body ? JSON.parse(init.body) : null;
    if (init?.method === 'POST') ctx.posts.push({ url: u, body });
    const json = (status: number, data: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;
    if (u.includes('/api/waitlist/source')) return ctx.state.source ? json(200, { entry: ctx.state.source }) : json(404, { error: '空き待ちが見つかりませんでした。' });
    if (u.includes('/api/waitlist/cancel')) {
      ctx.state.entries = ctx.state.entries.filter((e: any) => e.id !== body.entry_id);
      return json(200, { cancelled: true, entries: ctx.state.entries });
    }
    if (u.includes('/api/waitlist')) {
      if (init?.method === 'POST') {
        if (ctx.state.register.status === 201) {
          ctx.state.entries = [...ctx.state.entries, { id: EID, form_id: 'form_test', date: body.date, time: body.time, date_text: `${body.date} ${body.time}`, menu_text: 'カット', staff_id: body.staff_id, staff_name: null, status: 'waiting' }];
          return json(201, { entry_id: EID, entries: ctx.state.entries });
        }
        return json(ctx.state.register.status, ctx.state.register.body);
      }
      return json(200, { entries: ctx.state.entries });
    }
    if (u.includes('/calendar/availability')) return json(200, ctx.state.events);
    return json(200, []);
  };
  await new Promise((r) => setTimeout(r, 80));
  expect(errors).toEqual([]);
  return ctx;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cell = (doc: Document, time: string) => doc.querySelector(`.calendar-cell[data-date="${DATE}"][data-time="${time}"]`) as HTMLElement;
const clickMenu = (doc: Document, menuId: string) => (doc.querySelector(`.menu-item[data-menu-id="${menuId}"]`) as HTMLElement).click();

/** LINE のユーザーが分かっている状態で、メニューを選び、対象の週のカレンダーを出す */
async function openCalendar(ctx: Ctx, opts: { user?: string | null; menu?: string | null } = {}) {
  const bf = ctx.win.bookingForm;
  bf.state.lineUserId = opts.user === undefined ? 'U123' : opts.user;
  await ctx.win.wlRefresh(bf);
  if (opts.menu !== null) clickMenu(ctx.doc, opts.menu || 'm1');
  await wait(30);
  bf.state.currentWeekStart = bf.getWeekStart(new Date(target));
  await bf.fetchAvailability(bf.state.currentWeekStart);
  return bf;
}

describe('機能が OFF のフォーム（既定）', () => {
  it('空き待ちの部品を出さず、満席の時間をタップしても何も起きない', async () => {
    const page = html(buildForm());
    expect(page).toContain('const WAITLIST = {"enabled":false');
    expect(page).not.toContain('id="waitlist-modal"');
    expect(page).not.toContain('id="waitlist-bar"');
    const ctx = await loadDom(page);
    await openCalendar(ctx);
    expect(cell(ctx.doc, '14:00').textContent).toBe('×');
    expect(cell(ctx.doc, '14:00').classList.contains('waitlist')).toBe(false);
    cell(ctx.doc, '14:00').click();
    expect(ctx.posts).toEqual([]);
    expect(ctx.urls.some((u) => u.includes('/api/waitlist'))).toBe(false);
    // 〇 の時間はこれまでどおり選べる
    cell(ctx.doc, '10:00').click();
    expect(ctx.win.bookingForm.state.selectedTime).toBe('10:00');
  });

  it('OFF のフォームを ?waitlist= で開いても通常の予約フォームのまま', async () => {
    const ctx = await loadDom(html(buildForm({ enabled: false })), `?waitlist=${EID}`);
    ctx.win.bookingForm.state.lineUserId = 'U123';
    await wait(50);
    expect(ctx.doc.getElementById('waitlist-banner')).toBeNull();
    expect(ctx.urls.some((u) => u.includes('/api/waitlist'))).toBe(false);
  });

  it('手動予約フォーム・プレビュー・Web フォーム・第三希望日時モードでは ON でも使わない', () => {
    const on = { enabled: true };
    expect(html(buildForm(on), 'manual')).toContain('const WAITLIST = {"enabled":false');
    expect(html(buildForm(on), 'preview')).toContain('const WAITLIST = {"enabled":false');
    expect(html(buildForm(on, { booking_mode: 'multiple_dates' }))).toContain('const WAITLIST = {"enabled":false');
    const web = buildForm(on);
    (web.config as { form_type?: string }).form_type = 'web';
    expect(html(web)).toContain('const WAITLIST = {"enabled":false');
  });
});

describe('機能が ON のフォーム', () => {
  const page = html(buildForm({ enabled: true, max_per_user: 2, deadline_hours: 1 }));

  it('設定を埋め込み、ダイアログと「あなたの空き待ち」の入れ物を出す', () => {
    expect(page).toContain('const WAITLIST = {"enabled":true,"deadlineHours":1,"maxPerUser":2}');
    expect(page).toContain('id="waitlist-modal"');
    expect(page).toContain('id="waitlist-bar"');
    expect(page).toContain('id="waitlist-hint"');
  });

  it('満席（✕）の時間だけタップで登録ダイアログが開く。〇 の時間はこれまでどおり選べる', async () => {
    const ctx = await loadDom(page);
    const bf = await openCalendar(ctx);
    expect(ctx.doc.getElementById('waitlist-hint')!.style.display).toBe('');
    expect(cell(ctx.doc, '14:00').classList.contains('waitlist')).toBe(true);
    expect(cell(ctx.doc, '10:00').classList.contains('waitlist')).toBe(false);
    // 13:30 から 60 分は 14:00 の予定に重なるので満席
    expect(cell(ctx.doc, '13:30').classList.contains('waitlist')).toBe(true);

    cell(ctx.doc, '10:00').click();
    expect(bf.state.selectedTime).toBe('10:00');
    expect(ctx.doc.getElementById('waitlist-modal')!.style.display).toBe('none');

    cell(ctx.doc, '14:00').click();
    const modal = ctx.doc.getElementById('waitlist-modal')!;
    expect(modal.style.display).toBe('flex');
    expect(modal.textContent).toContain('この時間は満席です');
    expect(modal.textContent).toContain('14:00');
    expect(modal.textContent).toContain('カット');
    expect(modal.textContent).toContain('お約束するものではありません');
    expect(modal.textContent).toContain('先着順');
    // 選んでいた日時はそのまま
    expect(bf.state.selectedTime).toBe('10:00');
  });

  it('登録すると API に日時・メニュー・所要時間を送り、その時間が「待」になって件数が出る', async () => {
    const ctx = await loadDom(page);
    await openCalendar(ctx);
    cell(ctx.doc, '14:00').click();
    await ctx.win.wlSubmit();
    expect(ctx.posts).toHaveLength(1);
    expect(ctx.posts[0].url).toContain('/api/waitlist');
    expect(ctx.posts[0].body).toMatchObject({ store_id: 'st0001', form_id: 'form_test', line_user_id: 'U123', date: DATE, time: '14:00', total_duration: 60, staff_id: null });
    expect(ctx.posts[0].body.selected_menus[0]).toMatchObject({ menu_id: 'm1', menu_name: 'カット' });
    expect(ctx.doc.getElementById('waitlist-modal')!.textContent).toContain('空き待ちを受け付けました');
    expect(cell(ctx.doc, '14:00').textContent).toBe('待');
    expect(ctx.doc.getElementById('waitlist-bar')!.style.display).toBe('');
    expect(ctx.doc.getElementById('waitlist-bar-count')!.textContent).toBe('1');

    // 登録済みの時間をもう一度タップ → 登録済みの案内（二重に登録しない）
    cell(ctx.doc, '14:00').click();
    expect(ctx.doc.getElementById('waitlist-modal')!.textContent).toContain('空き待ちに登録済みです');
    await ctx.win.wlSubmit();
    expect(ctx.posts).toHaveLength(1);
  });

  it('連打しても 1 回しか送らない', async () => {
    const ctx = await loadDom(page);
    await openCalendar(ctx);
    cell(ctx.doc, '14:00').click();
    await Promise.all([ctx.win.wlSubmit(), ctx.win.wlSubmit(), ctx.win.wlSubmit()]);
    expect(ctx.posts).toHaveLength(1);
  });

  it('サーバーに断られたら理由を出す。「いまは予約できる」ならカレンダーを取り直す', async () => {
    const ctx = await loadDom(page);
    await openCalendar(ctx);
    ctx.state.register = { status: 409, body: { error: 'この日時は現在ご予約いただけます。カレンダーを更新してご予約ください。', code: 'slot_open' } };
    ctx.state.events = [];
    cell(ctx.doc, '14:00').click();
    await ctx.win.wlSubmit();
    await wait(30);
    expect(ctx.doc.getElementById('waitlist-modal-error')!.textContent).toContain('現在ご予約いただけます');
    expect(cell(ctx.doc, '14:00').textContent).toBe('○');
    expect((ctx.doc.getElementById('waitlist-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('メニューを選んでいないときは、先にメニューを選ぶよう案内する', async () => {
    const ctx = await loadDom(page);
    await openCalendar(ctx, { menu: null });
    ctx.win.wlOpenDialog(ctx.win.bookingForm, DATE, '14:00');
    expect(ctx.alerts[0]).toContain('先にメニューを選択してください');
    expect(ctx.posts).toEqual([]);
  });

  it('LINE のユーザーが分からないときは登録できない（✕ のまま）', async () => {
    const ctx = await loadDom(page);
    await openCalendar(ctx, { user: null });
    expect(cell(ctx.doc, '14:00').classList.contains('waitlist')).toBe(false);
    cell(ctx.doc, '14:00').click();
    expect(ctx.doc.getElementById('waitlist-modal')!.style.display).toBe('none');
    expect(ctx.doc.getElementById('waitlist-hint')!.style.display).toBe('none');
  });

  it('上限まで登録していると、登録ではなく上限の案内を出す', async () => {
    const ctx = await loadDom(page);
    ctx.state.entries = [
      { id: 'a', form_id: 'form_test', date: '2099-01-01', time: '10:00', date_text: '1/1 10:00', menu_text: '', staff_id: null, staff_name: null, status: 'waiting' },
      { id: 'b', form_id: 'form_test', date: '2099-01-02', time: '10:00', date_text: '1/2 10:00', menu_text: '', staff_id: null, staff_name: null, status: 'waiting' },
    ];
    await openCalendar(ctx);
    cell(ctx.doc, '14:00').click();
    expect(ctx.doc.getElementById('waitlist-modal')!.textContent).toContain('空き待ちの上限です');
    expect(ctx.doc.getElementById('waitlist-submit')).toBeNull();
  });

  it('「あなたの空き待ち」から取り消せる', async () => {
    const ctx = await loadDom(page);
    ctx.state.entries = [{ id: EID, form_id: 'form_test', date: DATE, time: '14:00', date_text: 'テスト日時 14:00', menu_text: 'カット', staff_id: null, staff_name: null, status: 'notified' }];
    await openCalendar(ctx);
    expect(cell(ctx.doc, '14:00').textContent).toBe('待');
    ctx.win.wlOpenList();
    const modal = ctx.doc.getElementById('waitlist-modal')!;
    expect(modal.textContent).toContain('テスト日時 14:00');
    expect(modal.textContent).toContain('空きをお知らせ済み');
    await ctx.win.wlCancelEntry(EID, null);
    expect(ctx.posts[0]).toMatchObject({ url: expect.stringContaining('/api/waitlist/cancel'), body: { entry_id: EID, store_id: 'st0001', line_user_id: 'U123' } });
    expect(cell(ctx.doc, '14:00').textContent).toBe('×');
    expect(ctx.doc.getElementById('waitlist-bar')!.style.display).toBe('none');
  });

  it('埋め込み JS にバッククォート・テンプレートの穴が残っていない', async () => {
    const { WAITLIST_RUNTIME_JS } = await import('../waitlist-runtime-js');
    expect(WAITLIST_RUNTIME_JS).not.toContain('`');
    expect(WAITLIST_RUNTIME_JS).not.toContain('${');
    expect(WAITLIST_RUNTIME_JS).not.toContain('\\');
  });
});

describe('空きのお知らせから開いたとき（?waitlist=空き待ちID）', () => {
  const page = html(buildForm({ enabled: true }));
  const source = (over: Record<string, unknown> = {}) => ({
    id: EID,
    form_id: 'form_test',
    date: DATE,
    time: '14:00',
    date_text: 'お知らせの日時',
    menu_text: 'カラー',
    staff_id: null,
    staff_name: null,
    status: 'notified',
    selected_menus: [{ menu_id: 'm2', menu_name: 'カラー', category_name: 'カット', duration: 90 }],
    selected_options: [],
    open: true,
    active: true,
    ...over,
  });

  async function open(ctx: Ctx) {
    const bf = ctx.win.bookingForm;
    bf.state.lineUserId = 'U123';
    const src = await ctx.win.wlLoadSource(bf);
    ctx.win.wlApplySource(bf, src);
    await wait(1100);
    return bf;
  }

  it('空いていれば、メニューと日時を選んだ状態にして案内を出す', async () => {
    const ctx = await loadDom(page, `?waitlist=${EID}`);
    ctx.state.source = source();
    ctx.state.events = [];
    const bf = await open(ctx);
    expect(ctx.urls.some((u) => u.includes(`/api/waitlist/source?entry_id=${EID}`) && u.includes('line_user_id=U123'))).toBe(true);
    expect(bf.state.selectedMenu?.id).toBe('m2');
    expect(bf.state.selectedDate).toBe(DATE);
    expect(bf.state.selectedTime).toBe('14:00');
    expect(cell(ctx.doc, '14:00').classList.contains('selected')).toBe(true);
    const banner = ctx.doc.getElementById('waitlist-banner')!;
    expect(banner.textContent).toContain('空きが出た日時を選択しました');
    expect(banner.textContent).toContain('先着順');
  });

  it('すでに埋まっていれば「埋まりました」と案内し、日時は選ばない（空き待ちは継続）', async () => {
    const ctx = await loadDom(page, `?waitlist=${EID}`);
    ctx.state.source = source({ open: false });
    ctx.state.events = BUSY;
    const bf = await open(ctx);
    expect(bf.state.selectedDate).toBe('');
    expect(bf.state.selectedTime).toBe('');
    const banner = ctx.doc.getElementById('waitlist-banner')!;
    expect(banner.textContent).toContain('この枠はすでに埋まりました');
    expect(banner.textContent).toContain('空き待ちは継続しています');
    // 送信ボタンは使える（ほかの日時はそのまま予約できる）
    expect((ctx.doc.getElementById('submit-button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('終了した空き待ち（予約済み・取り消し済みなど）は案内だけ出す', async () => {
    const ctx = await loadDom(page, `?waitlist=${EID}`);
    ctx.state.source = source({ active: false, status: 'fulfilled' });
    const bf = await open(ctx);
    expect(ctx.doc.getElementById('waitlist-banner')!.textContent).toContain('この空き待ちは終了しています');
    expect(bf.state.selectedDate).toBe('');
  });

  it('空き待ちを確認できないときは案内を出すだけで、フォームは通常どおり使える', async () => {
    const ctx = await loadDom(page, `?waitlist=${EID}`);
    const bf = await open(ctx);
    expect(ctx.doc.getElementById('waitlist-banner')!.textContent).toContain('空き待ちを確認できませんでした');
    expect((ctx.doc.getElementById('submit-button') as HTMLButtonElement).disabled).toBe(false);
    expect(bf.state.menuChangeMode).toBeFalsy();
  });
});
