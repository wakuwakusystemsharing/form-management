/**
 * メニュー変更フォーム（LINE の「予約を変更」→「メニューを変更」。予約フォームを URL の ?change=予約ID で開いたとき）
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import type { Form } from '@/types/form';

const RID = '3f2b8c1e-1111-4222-8333-444455556666';

type BookingForm = {
  state: Record<string, any>;
  availabilityCache: Record<string, unknown>;
  loadChangeSource: () => Promise<void>;
  applyChangeSource: () => void;
  fetchAvailability: (d: Date) => Promise<void>;
  handleSubmit: () => Promise<void>;
  handleDateTimeSelect: (date: string, time: string, ok: boolean) => void;
  recheckSelectedSlot: () => Promise<boolean>;
};

const hours = { open: '09:00', close: '18:00', closed: false };

function buildForm(): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              { id: 'm1', name: 'カット', price: 4000, duration: 60 },
              { id: 'm2', name: 'カラー', price: 6000, duration: 90 },
              { id: 'm3', name: 'パーマ', price: 9000, duration: 180 },
            ],
          },
        ],
      },
      custom_fields: [{ id: 'cf1', type: 'text', title: 'ご要望', required: true }],
      calendar_settings: {
        booking_mode: 'calendar',
        business_hours: { monday: hours, tuesday: hours, wednesday: hours, thursday: hours, friday: hours, saturday: hours, sunday: hours },
        advance_booking_days: 60,
      },
    },
  } as never);
}

interface Posted {
  url: string;
  body: Record<string, any>;
}

async function loadDom(html: string, search: string, opts: { source?: unknown; fits?: boolean; submit?: { ok: boolean; status?: number; body?: unknown } } = {}) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: `https://example.com/form${search}` });
  const win = dom.window as unknown as { fetch: unknown; alert: unknown; bookingForm: BookingForm; urls: string[]; posts: Posted[]; alerts: string[]; document: Document };
  win.urls = [];
  win.posts = [];
  win.alerts = [];
  win.alert = (m: string) => { win.alerts.push(m); };
  win.fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url);
    win.urls.push(u);
    if (init?.method === 'POST') win.posts.push({ url: u, body: JSON.parse(init.body || '{}') });
    if (u.includes('/api/reservations/change-source')) {
      return opts.source
        ? ({ ok: true, json: async () => ({ reservation: opts.source }) } as Response)
        : ({ ok: false, json: async () => ({ error: '変更の期限を過ぎています。' }) } as Response);
    }
    if (u.includes('/api/reservations/change-menu')) {
      const body = JSON.parse(init?.body || '{}');
      if (body.check_only) return { ok: true, json: async () => ({ fits: opts.fits !== false }) } as Response;
      const s = opts.submit || { ok: true };
      return { ok: s.ok, status: s.status || (s.ok ? 200 : 409), json: async () => s.body || { success: true } } as Response;
    }
    return { ok: true, json: async () => [] } as Response;
  };
  await new Promise((r) => setTimeout(r, 80));
  return { win, doc: win.document };
}

/** 変更元の予約を読み込んだ状態（LIFF で開いたときと同じ流れを手で進める） */
async function openChangeForm(html: string, opts: Parameters<typeof loadDom>[2]) {
  const ctx = await loadDom(html, `?change=${RID}`, opts);
  const bf = ctx.win.bookingForm;
  bf.state.lineUserId = 'U123';
  await bf.loadChangeSource();
  bf.applyChangeSource();
  await new Promise((r) => setTimeout(r, 350));
  return { ...ctx, bf };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const visible = (doc: Document, win: unknown, id: string) => {
  const el = doc.getElementById(id);
  return !!el && (win as Window).getComputedStyle(el).display !== 'none';
};
const clickMenu = (doc: Document, menuId: string) => (doc.querySelector(`.menu-item[data-menu-id="${menuId}"]`) as HTMLElement).click();

const SOURCE = {
  id: RID,
  date: '2026-11-20',
  time: '14:00',
  date_text: '11/20（金） 14:00',
  menu_text: 'カラー',
  staff_id: null,
  staff_name: null,
  customer_name: '山田花子',
  customer_phone: '09011112222',
  selected_menus: [{ menu_id: 'm2', menu_name: 'カラー', category_name: 'カット', price: 6000, duration: 90 }],
  selected_options: [],
  gender: null,
  visit_count: null,
  coupon: null,
  duration: 90,
  calendar_mode: true,
};

describe('メニュー変更フォーム', () => {
  const form = buildForm();
  const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id);

  it('?change が無ければ通常の予約フォームのまま', async () => {
    const { win, doc } = await loadDom(html, '', { source: SOURCE });
    expect(doc.getElementById('change-mode-banner')).toBeNull();
    expect(doc.body.classList.contains('menu-change-mode')).toBe(false);
    expect(doc.querySelector('.form-header h1')?.textContent).toBe('テスト予約');
    expect(doc.querySelector('.summary-title')?.textContent).toBe('ご予約内容');
    expect(win.urls.some((u) => u.includes('change-source'))).toBe(false);
  });

  it('変更元の予約を確認できないときは、案内を出して送信できない（別の予約が増えない）', async () => {
    const { win, doc } = await loadDom(html, `?change=${RID}`, { source: SOURCE });
    expect(doc.getElementById('change-mode-banner')?.textContent).toContain('ご予約を変更できません');
    expect((doc.getElementById('submit-button') as HTMLButtonElement).disabled).toBe(true);
    await win.bookingForm.handleSubmit();
    expect(win.alerts[0]).toContain('ご予約を変更できません');
    expect(win.posts).toEqual([]);

    const expired = await loadDom(html, `?change=${RID}`, {});
    expired.win.bookingForm.state.lineUserId = 'U123';
    await expired.win.bookingForm.loadChangeSource();
    expect(expired.doc.getElementById('change-mode-banner')?.textContent).toContain('変更の期限を過ぎています。');
    expect((expired.doc.getElementById('submit-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('見出し・案内・ボタンがメニュー変更用になり、メニューとメッセージ以外の項目は出ない', async () => {
    const { win, doc, bf } = await openChangeForm(html, { source: SOURCE });
    expect(doc.querySelector('.form-header h1')?.textContent).toBe('メニュー変更フォーム');
    const banner = doc.getElementById('change-mode-banner')?.textContent || '';
    expect(banner).toContain('ご予約のメニューを変更します');
    expect(banner).toContain('日時：11/20（金） 14:00');
    expect(banner).toContain('メニュー：カラー');
    expect(banner).toContain('ご予約の日時はそのままです');
    expect(doc.querySelector('.summary-title')?.textContent).toBe('変更内容');
    expect(doc.getElementById('submit-button')?.textContent).toBe('メニューを変更する');

    const shown = (ids: string[]) => ids.filter((id) => visible(doc, win, id));
    expect(shown(['name-field', 'phone-field', 'custom-field-wrap-cf1', 'datetime-field'])).toEqual([]);
    expect(shown(['menu-field', 'message-field', 'submit-button'])).toEqual(['menu-field', 'message-field', 'submit-button']);

    // いまの予約のメニューが選ばれていて、日時はいまの予約のまま
    expect(bf.state.selectedMenu?.id).toBe('m2');
    expect(bf.state.selectedDate).toBe('2026-11-20');
    expect(bf.state.selectedTime).toBe('14:00');
    expect(win.alerts).toEqual([]);

    const summary = doc.getElementById('summary-content')?.textContent || '';
    expect(summary).toContain('変更前のメニュー');
    expect(summary).toContain('変更後のメニュー');
    expect(summary).toContain('11/20（金） 14:00（変更なし）');
    expect(summary).not.toContain('電話番号');
  });

  it('所要時間が延びないメニューは、確認なしでいまの日時のまま送信できる（必須のカスタム項目・お名前は聞かない）', async () => {
    const { win, doc, bf } = await openChangeForm(html, { source: SOURCE });
    clickMenu(doc, 'm1');
    await wait(350);
    expect(win.posts.filter((p) => p.body.check_only)).toEqual([]);
    expect(visible(doc, win, 'datetime-field')).toBe(false);

    await bf.handleSubmit();
    const sent = win.posts.filter((p) => p.url.endsWith('/api/reservations/change-menu') && !p.body.check_only);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      reservation_id: RID,
      store_id: 'st0001',
      line_user_id: 'U123',
      total_duration: 60,
      total_price: 4000,
      reservation_date: '2026-11-20',
      reservation_time: '14:00',
    });
    expect(sent[0].body.selected_menus[0]).toMatchObject({ menu_id: 'm1', menu_name: 'カット' });
    // 新しい予約は作らない
    expect(win.posts.some((p) => p.url.endsWith('/api/reservations'))).toBe(false);
    expect(doc.querySelector('.form-content')?.textContent).toContain('メニューを変更しました');
    expect(win.alerts).toEqual([]);
  });

  it('所要時間が延びるメニューは、いまの時間に入るかを確認する。入れば日時はそのまま', async () => {
    const { win, doc, bf } = await openChangeForm(html, { source: SOURCE, fits: true });
    clickMenu(doc, 'm3');
    await wait(450);
    const checks = win.posts.filter((p) => p.body.check_only);
    expect(checks).toHaveLength(1);
    expect(checks[0].body).toMatchObject({ reservation_id: RID, total_duration: 180 });
    expect(visible(doc, win, 'datetime-field')).toBe(false);
    expect(bf.state.selectedDate).toBe('2026-11-20');
  });

  it('いまの時間に入らないときだけ、日時の選び直しを出す', async () => {
    const { win, doc, bf } = await openChangeForm(html, { source: SOURCE, fits: false });
    clickMenu(doc, 'm3');
    await wait(450);
    expect(doc.body.classList.contains('menu-change-pick-datetime')).toBe(true);
    expect(visible(doc, win, 'datetime-field')).toBe(true);
    expect(doc.getElementById('menu-change-datetime-note')?.textContent).toContain('現在のお時間（11/20（金） 14:00）ではご予約いただけません');
    expect(bf.state.selectedDate).toBe('');
    expect(doc.getElementById('summary-content')?.textContent).toContain('日時を選んでください');
    // 空き状況は、いまの予約の予定を除いて取る
    expect(win.urls.filter((u) => u.includes('/calendar/availability')).pop()).toContain(`exclude_reservation=${RID}`);

    // 日時を選ばずに送信はできない
    await bf.handleSubmit();
    expect(win.alerts.pop()).toBe('日時を選択してください');
    expect(win.posts.filter((p) => !p.body.check_only)).toEqual([]);

    // 選び直した日時で送信する
    bf.recheckSelectedSlot = async () => true;
    bf.handleDateTimeSelect('2026-11-21', '10:00', true);
    expect(doc.getElementById('summary-content')?.textContent).toContain('変更前：11/20（金） 14:00');
    await bf.handleSubmit();
    const sent = win.posts.filter((p) => !p.body.check_only);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ reservation_date: '2026-11-21', reservation_time: '10:00', total_duration: 180 });

    // 短いメニューに戻すと、日時の欄は消えていまの日時に戻る
    const again = await openChangeForm(html, { source: SOURCE, fits: false });
    clickMenu(again.doc, 'm3');
    await wait(450);
    clickMenu(again.doc, 'm1');
    await wait(350);
    expect(visible(again.doc, again.win, 'datetime-field')).toBe(false);
    expect(again.bf.state.selectedDate).toBe('2026-11-20');
    expect(again.bf.state.selectedTime).toBe('14:00');
  });

  it('送信時にサーバーが「入らない」と返したら、案内して日時の選び直しを出す', async () => {
    const { win, doc, bf } = await openChangeForm(html, {
      source: SOURCE,
      submit: { ok: false, status: 409, body: { code: 'slot_taken', error: '選んだメニューは、現在のお時間ではご予約いただけません。日時をお選びください。' } },
    });
    clickMenu(doc, 'm1');
    await wait(350);
    await bf.handleSubmit();
    expect(win.alerts.pop()).toContain('現在のお時間ではご予約いただけません');
    expect(visible(doc, win, 'datetime-field')).toBe(true);
    const btn = doc.getElementById('submit-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('メニューを変更する');
  });

  it('メニューを外したまま送信はできない', async () => {
    const { win, doc, bf } = await openChangeForm(html, { source: { ...SOURCE, selected_menus: [] } });
    expect(doc.getElementById('summary-content')?.textContent).toContain('メニューを選んでください');
    await bf.handleSubmit();
    expect(win.alerts.pop()).toBe('メニューを選択してください');
    expect(win.posts.filter((p) => !p.body.check_only)).toEqual([]);
  });

  it('LINE に送る通知は「メニュー変更」', () => {
    expect(html).toContain("'【メニュー変更】'");
    expect(html).toContain("'《変更後のメニュー》'");
  });
});
