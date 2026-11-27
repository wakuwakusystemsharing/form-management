/**
 * 「このメニューを選んだら、オプション必須」
 */
import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticReservationGenerator } from '../static-generator-reservation';
import { normalizeForm } from '../form-normalizer';
import { flattenConfigSubOptions } from '../sub-options';
import { REQUIRED_OPTIONS_RUNTIME_JS, findMissingRequiredOptions, requiredOptionMessage, type RequiredOptionMissing } from '../required-options';
import type { Form, FormConfig } from '@/types/form';

function buildForm(): Form {
  return normalizeForm({
    id: 'form_required',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      menu_structure: {
        structure_type: 'category_based',
        display_options: { show_price: true, show_duration: true, show_description: true, show_treatment_info: false },
        categories: [
          {
            id: 'cat1',
            name: 'カット',
            menus: [
              {
                // 1 つ以上必須
                id: 'menu_any', name: 'カット', price: 3000, duration: 60, options_required: true,
                options: [
                  { id: 'a1', name: 'ショート', price: 0, duration: 0, sub_options: [{ id: 'a1_s', name: '追加', price: 100, duration: 0 }] },
                  { id: 'a2', name: 'ロング', price: 500, duration: 10 },
                ],
              },
              {
                // 特定のオプションが必須
                id: 'menu_each', name: 'カラー', price: 5000, duration: 90,
                options: [
                  { id: 'b1', name: 'パッチテスト', price: 0, duration: 0, required: true },
                  { id: 'b2', name: 'トリートメント', price: 1000, duration: 10 },
                ],
              },
              { id: 'menu_free', name: 'シャンプー', price: 1000, duration: 10, options: [{ id: 'c1', name: '炭酸', price: 300, duration: 0 }] },
            ],
            options: [],
          },
        ],
      },
    },
  });
}
const flat = (): FormConfig => flattenConfigSubOptions(JSON.parse(JSON.stringify(buildForm().config)));

describe('required-options: 純粋ロジック（TS 版と埋め込み JS が同じ結果）', () => {
  const rt = new Function(`${REQUIRED_OPTIONS_RUNTIME_JS}; return { roMissing: roMissing, roMessage: roMessage };`)() as {
    roMissing: (c: unknown, m: string[], o: Record<string, string[]>, h: string[]) => RequiredOptionMissing[];
    roMessage: (m: RequiredOptionMissing) => string;
  };
  const cases: Array<{ name: string; menus: string[]; options: Record<string, string[]>; hidden?: string[]; missing: Array<[string, string | null]> }> = [
    { name: '選んでいないメニューの必須は見ない', menus: ['menu_free'], options: {}, missing: [] },
    { name: '1 つ以上必須: 何も選んでいないと挙がる', menus: ['menu_any'], options: {}, missing: [['menu_any', null]] },
    { name: '1 つ以上必須: 1 つ選べば通る', menus: ['menu_any'], options: { menu_any: ['a2'] }, missing: [] },
    { name: 'オプションごとの必須: そのオプションを選んでいないと挙がる', menus: ['menu_each'], options: { menu_each: ['b2'] }, missing: [['menu_each', 'b1']] },
    { name: 'オプションごとの必須: 選べば通る', menus: ['menu_each'], options: { menu_each: ['b1'] }, missing: [] },
    { name: '隠れているオプションは対象外', menus: ['menu_each'], options: {}, hidden: ['b1'], missing: [] },
    { name: '全部のオプションが隠れていれば「1 つ以上」も求めない', menus: ['menu_any'], options: {}, hidden: ['a1', 'a2'], missing: [] },
    { name: '複数のメニューを選んだときは、上から順に全部挙がる', menus: ['menu_each', 'menu_any'], options: {}, missing: [['menu_any', null], ['menu_each', 'b1']] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const config = flat();
      const ts = findMissingRequiredOptions(config, c.menus, c.options, c.hidden ?? []);
      expect(ts.map((m) => [m.menuId, m.optionId])).toEqual(c.missing);
      const js = rt.roMissing(config, c.menus, c.options, c.hidden ?? []);
      expect(js).toEqual(ts);
      for (const m of ts) expect(rt.roMessage(m)).toBe(requiredOptionMessage(m));
    });
  }

  it('オプションのオプション（追加のオプション）だけを選んでも「1 つ以上」には数えない', () => {
    expect(findMissingRequiredOptions(flat(), ['menu_any'], { menu_any: ['a1_s'] })).toHaveLength(1);
  });

  it('案内の文', () => {
    expect(requiredOptionMessage({ menuId: 'm', menuName: 'カラー', optionId: 'b1', optionName: 'パッチテスト' })).toBe('「カラー」を選んだ場合は、オプション「パッチテスト」の選択が必要です');
    expect(requiredOptionMessage({ menuId: 'm', menuName: 'カット', optionId: null, optionName: null })).toBe('「カット」のオプションを1つ以上選択してください');
  });
});

function render(form: Form) {
  return new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
}
async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { dom, errors };
}
type BookingForm = { state: { name: string; phone: string }; getMissingRequiredOptions: () => RequiredOptionMissing[]; handleSubmit: () => Promise<void> | void };

describe('予約フォーム: オプション必須', () => {
  it('必須の印を出す（1 つ以上必須 = 見出しの横 / オプションごと = ボタン）', () => {
    const html = render(buildForm());
    expect(html.match(/class="options-required-note"/g)).toHaveLength(1);
    expect(html.match(/class="option-required-badge"/g)).toHaveLength(1);
    expect(html).toContain('（1つ以上必須）');
  });

  it('メニューを選ぶと必須が効き、オプションを選ぶと解ける。別のメニューに変えると見ない', async () => {
    const { dom, errors } = await loadDom(render(buildForm()));
    expect(errors).toEqual([]);
    const doc = dom.window.document;
    const bf = (dom.window as unknown as { bookingForm: BookingForm }).bookingForm;
    const click = (sel: string) => (doc.querySelector(sel) as HTMLElement).click();
    expect(bf.getMissingRequiredOptions()).toEqual([]);

    click('.menu-item[data-menu-id="menu_each"]');
    expect(bf.getMissingRequiredOptions().map((m) => m.optionName)).toEqual(['パッチテスト']);
    click('.menu-option-item[data-option-id="b2"]');
    expect(bf.getMissingRequiredOptions()).toHaveLength(1);
    click('.menu-option-item[data-option-id="b1"]');
    expect(bf.getMissingRequiredOptions()).toEqual([]);

    click('.menu-item[data-menu-id="menu_any"]');
    expect(bf.getMissingRequiredOptions().map((m) => [m.menuId, m.optionId])).toEqual([['menu_any', null]]);
    click('.menu-option-item[data-option-id="a2"]');
    expect(bf.getMissingRequiredOptions()).toEqual([]);

    click('.menu-item[data-menu-id="menu_free"]');
    expect(bf.getMissingRequiredOptions()).toEqual([]);
  });

  it('必須のオプションを選ばずに送信すると、案内を出して止める', async () => {
    const { dom } = await loadDom(render(buildForm()));
    const doc = dom.window.document;
    const win = dom.window as unknown as { bookingForm: BookingForm; alert: (m: string) => void };
    const alerts: string[] = [];
    win.alert = (m: string) => alerts.push(m);
    (doc.querySelector('.menu-item[data-menu-id="menu_each"]') as HTMLElement).click();
    win.bookingForm.state.name = '山田';
    win.bookingForm.state.phone = '09000000000';
    await win.bookingForm.handleSubmit();
    expect(alerts).toContain('「カラー」を選んだ場合は、オプション「パッチテスト」の選択が必要です');
  });
});
