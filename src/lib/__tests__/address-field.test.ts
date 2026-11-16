import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { StaticLotteryGenerator } from '@/lib/static-generator-lottery';
import { normalizeForm } from '@/lib/form-normalizer';
import { normalizeLotteryForm } from '@/lib/lottery-normalizer';
import { ADDRESS_RUNTIME_JS, renderAddressFieldHtml } from '@/lib/address-field-runtime-js';
import { composeAddress, formatZip, parseAddress, townFromZipcloudResult, zipDigits, type AddressParts } from '@/lib/address-field';
import type { SurveyConfig } from '@/types/survey';

type AdWindow = Window & {
  adCompose: (p: Partial<AddressParts>) => string;
  adParse: (v: string) => AddressParts | null;
  adSyncFromHidden: (el: HTMLInputElement) => void;
  fetch: unknown;
};

type FetchMock = (url: string) => Promise<{ json: () => Promise<unknown> }>;

/** 生成した HTML を読み込む。fetchMock を渡すと郵便番号検索（zipcloud）の応答を差し替える */
async function loadDom(html: string, fetchMock?: FetchMock) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/',
    beforeParse(window) {
      if (fetchMock) (window as unknown as { fetch: FetchMock }).fetch = fetchMock;
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  return { w: dom.window as unknown as AdWindow, doc: dom.window.document };
}

function parts(doc: Document, hiddenId: string) {
  const container = doc.querySelector(`.address-field[data-address-for="${hiddenId}"]`) as HTMLElement;
  const get = (part: string) => container.querySelector(`[data-part="${part}"]`) as HTMLInputElement;
  return { container, zip: get('zip'), town: get('town'), street: get('street'), building: get('building'), status: get('status'), hidden: doc.getElementById(hiddenId) as HTMLInputElement };
}

function type(doc: Document, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));
}

const tick = () => new Promise((r) => setTimeout(r, 20));

const zipcloudOk: FetchMock = async () => ({
  json: async () => ({ status: 200, results: [{ address1: '東京都', address2: '渋谷区', address3: '神宮前', zipcode: '1500001' }] }),
});

describe('住所入力: 純粋ロジック', () => {
  it('郵便番号は全角数字・ハイフンありでも 7 桁の数字として扱う', () => {
    expect(zipDigits('１５０－０００１')).toBe('1500001');
    expect(zipDigits('150-0001')).toBe('1500001');
    expect(formatZip('1500001')).toBe('150-0001');
    expect(formatZip('150')).toBe('150');
  });

  it('4 欄を 1 つの文字列にまとめる（建物名は任意）', () => {
    expect(composeAddress({ zip: '1500001', town: '東京都渋谷区神宮前', street: '1-2-3', building: '○○マンション 101' }))
      .toBe('〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101');
    expect(composeAddress({ zip: '150-0001', town: ' 東京都渋谷区 神宮前 ', street: ' 1-2-3 ', building: '' }))
      .toBe('〒150-0001 東京都渋谷区神宮前1-2-3');
  });

  it('郵便番号（7 桁）・町名まで・番地のどれかが欠けていれば空（未入力扱い）', () => {
    expect(composeAddress({ zip: '150', town: '東京都渋谷区神宮前', street: '1-2-3' })).toBe('');
    expect(composeAddress({ zip: '1500001', town: '', street: '1-2-3' })).toBe('');
    expect(composeAddress({ zip: '1500001', town: '東京都渋谷区神宮前', street: '' })).toBe('');
  });

  it('まとめた文字列を 4 欄に分け直せる（復元用）', () => {
    expect(parseAddress('〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101'))
      .toEqual({ zip: '150-0001', town: '東京都渋谷区神宮前', street: '1-2-3', building: '○○マンション 101' });
    expect(parseAddress('〒060-0001 北海道札幌市中央区北1条西2丁目3-4'))
      .toEqual({ zip: '060-0001', town: '北海道札幌市中央区北1条西', street: '2丁目3-4', building: '' });
    expect(parseAddress('東京都渋谷区')).toBeNull();
    expect(parseAddress('')).toBeNull();
  });

  it('分け直してまとめ直すと元の文字列に戻る', () => {
    const samples = [
      '〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101',
      '〒060-0001 北海道札幌市中央区北1条西2丁目3-4',
      '〒600-8216 京都府京都市下京区東塩小路町721番地1 ビル 5F',
      '〒100-0001 東京都千代田区千代田１−１',
    ];
    for (const s of samples) expect(composeAddress(parseAddress(s)!)).toBe(s);
  });

  it('zipcloud の検索結果から町名までを作る', () => {
    expect(townFromZipcloudResult({ address1: '東京都', address2: '渋谷区', address3: '神宮前' })).toBe('東京都渋谷区神宮前');
    expect(townFromZipcloudResult({ address1: '東京都', address2: '渋谷区', address3: '' })).toBe('東京都渋谷区');
    expect(townFromZipcloudResult(null)).toBe('');
  });
});

describe('住所入力: 埋め込み JS は TS 版と同じ結果になる', () => {
  it('adCompose / adParse', async () => {
    const { w } = await loadDom(`<html><body><script>${ADDRESS_RUNTIME_JS}</script></body></html>`);
    const inputs: Array<Partial<AddressParts>> = [
      { zip: '１５０－０００１', town: '東京都渋谷区 神宮前', street: '1-2-3', building: ' ○○マンション　101 ' },
      { zip: '1500001', town: '東京都渋谷区神宮前', street: '1-2-3', building: '' },
      { zip: '150', town: '東京都渋谷区神宮前', street: '1-2-3', building: '' },
      { zip: '1500001', town: '東京都渋谷区神宮前', street: '', building: 'ビル' },
    ];
    for (const p of inputs) expect(w.adCompose(p)).toBe(composeAddress(p));
    const values = [
      '〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101',
      '〒060-0001 北海道札幌市中央区北1条西2丁目3-4',
      '〒100-0001 東京都千代田区千代田１−１',
      '〒100-0001 東京都千代田区千代田',
      '住所ではない文字',
    ];
    for (const v of values) expect(w.adParse(v)).toEqual(parseAddress(v));
  });

  it('埋め込み JS はバッククォート・バックスラッシュを使わない（抽選フォームの制約）', () => {
    expect(ADDRESS_RUNTIME_JS).not.toContain('`');
    expect(ADDRESS_RUNTIME_JS).not.toContain('\\');
  });
});

describe('renderAddressFieldHtml', () => {
  it('hidden + 郵便番号 / 町名まで / 番地 / 建物名 の 4 欄を出力する', () => {
    const html = renderAddressFieldHtml('custom-field-ad1', 'data-field-id="ad1"');
    expect(html).toContain('<input type="hidden" id="custom-field-ad1" data-field-id="ad1">');
    for (const part of ['zip', 'town', 'street', 'building', 'status']) expect(html).toContain(`data-part="${part}"`);
    expect(html).toContain('郵便番号');
    expect(html).toContain('建物名・部屋番号（任意）');
  });
});

describe('アンケート: 回答タイプ「住所入力」', () => {
  const config: SurveyConfig = {
    basic_info: { title: 'お客様情報', liff_id: '', theme_color: '#3B82F6' },
    questions: [
      { id: 'q1', type: 'address', title: 'ご住所', required: true, restore_enabled: true },
      { id: 'q2', type: 'radio', title: '発送', required: false, options: [
        { label: '希望する', value: '希望する', follow_ups: [{ enabled: true, title: '送り先', type: 'address', required: true }] },
      ] },
    ],
    ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
  };
  const generate = () => new StaticSurveyGenerator().generateHTML(config, 'sv1', 'st1');

  it('郵便番号を 7 桁入れると町名までが自動で入り、番地を入れると hidden に 1 つの文字列が入る', async () => {
    const calls: string[] = [];
    const { doc } = await loadDom(generate(), async (url) => { calls.push(url); return zipcloudOk(url); });
    const p = parts(doc, 'q1');
    let inputEvents = 0;
    p.hidden.addEventListener('input', () => { inputEvents += 1; });

    type(doc, p.zip, '150');
    expect(calls.length).toBe(0); // 7 桁になるまで調べない
    type(doc, p.zip, '150-0001');
    await tick();
    expect(calls).toEqual(['https://zipcloud.ibsnet.co.jp/api/search?zipcode=1500001']);
    expect(p.town.value).toBe('東京都渋谷区神宮前');
    expect(p.hidden.value).toBe(''); // 番地がまだ

    type(doc, p.street, '1-2-3');
    expect(p.hidden.value).toBe('〒150-0001 東京都渋谷区神宮前1-2-3');
    type(doc, p.building, '○○マンション 101');
    expect(p.hidden.value).toBe('〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101');
    expect(inputEvents).toBe(2);

    // 同じ郵便番号は調べ直さない
    type(doc, p.zip, '1500001');
    await tick();
    expect(calls.length).toBe(1);
  });

  it('住所が見つからない / 通信できないときは案内を出し、手入力で続けられる', async () => {
    const notFound = await loadDom(generate(), async () => ({ json: async () => ({ status: 200, results: null }) }));
    const a = parts(notFound.doc, 'q1');
    type(notFound.doc, a.zip, '0000000');
    await tick();
    expect(a.status.textContent).toContain('見つかりませんでした');
    type(notFound.doc, a.town, '東京都渋谷区神宮前');
    type(notFound.doc, a.street, '1-2-3');
    expect(a.hidden.value).toBe('〒000-0000 東京都渋谷区神宮前1-2-3');

    const failed = await loadDom(generate(), async () => { throw new Error('offline'); });
    const b = parts(failed.doc, 'q1');
    type(failed.doc, b.zip, '1500001');
    await tick();
    expect(b.status.textContent).toContain('自動入力できませんでした');
    expect(b.town.value).toBe('');
  });

  it('復元: hidden の値を 4 欄に反映し、住所を調べ直さない。追加質問にも同じ部品が出る', async () => {
    const calls: string[] = [];
    const { w, doc } = await loadDom(generate(), async (url) => { calls.push(url); return zipcloudOk(url); });
    const p = parts(doc, 'q1');
    p.hidden.value = '〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101';
    w.adSyncFromHidden(p.hidden);
    expect([p.zip.value, p.town.value, p.street.value, p.building.value]).toEqual(['150-0001', '東京都渋谷区神宮前', '1-2-3', '○○マンション 101']);
    expect(p.hidden.value).toBe('〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101');
    type(doc, p.zip, '150-0001');
    await tick();
    expect(calls.length).toBe(0);

    // クリア
    p.hidden.value = '';
    w.adSyncFromHidden(p.hidden);
    expect([p.zip.value, p.town.value, p.street.value, p.building.value]).toEqual(['', '', '', '']);

    expect(doc.querySelector('.address-field[data-address-for="fu-q2-0-0"]')).not.toBeNull();
  });

  it('再訪時: 保存された住所が 4 欄に復元される', async () => {
    const first = await loadDom(generate(), zipcloudOk);
    const p = parts(first.doc, 'q1');
    type(first.doc, p.zip, '1500001');
    await tick();
    type(first.doc, p.street, '4-5-6');
    const saved = first.w.localStorage.getItem('survey_sv1');
    expect(saved).toContain('〒150-0001 東京都渋谷区神宮前4-5-6');

    const dom = new JSDOM(generate(), {
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/',
      beforeParse(window) { window.localStorage.setItem('survey_sv1', saved!); },
    });
    await new Promise((r) => setTimeout(r, 50));
    const again = parts(dom.window.document, 'q1');
    expect([again.zip.value, again.town.value, again.street.value]).toEqual(['150-0001', '東京都渋谷区神宮前', '4-5-6']);
    expect(again.hidden.value).toBe('〒150-0001 東京都渋谷区神宮前4-5-6');
  });
});

describe('予約フォーム / 抽選フォーム: 住所入力', () => {
  it('予約フォームのカスタムフィールドに住所入力が出て、入力すると state に入る', async () => {
    const form = normalizeForm({
      id: 'f1', store_id: 'st1', form_type: 'line',
      config: {
        basic_info: { form_name: '予約', store_name: '店', liff_id: '', theme_color: '#3B82F6' },
        custom_fields: [{ id: 'ad', type: 'address', title: 'ご住所', required: true, restore_enabled: true }],
      },
    });
    const html = new StaticReservationGenerator().generateHTML(form.config, form.id, form.store_id, 'preview');
    const { doc } = await loadDom(html, zipcloudOk);
    const p = parts(doc, 'custom-field-ad');
    expect(p.hidden.getAttribute('data-field-id')).toBe('ad');
    type(doc, p.zip, '1500001');
    await tick();
    type(doc, p.street, '1-2-3');
    const bf = (doc.defaultView as unknown as { bookingForm: { state: { customFields: Record<string, unknown> } } }).bookingForm;
    expect(bf.state.customFields.ad).toBe('〒150-0001 東京都渋谷区神宮前1-2-3');
  });

  it('抽選フォームの事前質問に住所入力が出て、回答に 1 つの文字列が入る', async () => {
    const form = normalizeLotteryForm({
      id: 'l1', store_id: 'st1', status: 'active',
      config: {
        basic_info: { title: 'くじ', liff_id: '1234567890-abcdefgh', theme_color: '#1b2a4e' },
        prizes: [{ id: 'a', name: 'A賞', probability: 10, stock: null }],
        entry_rules: { limit: 'once', require_friend: false, when_sold_out: 'lose', pre_questions: [
          { id: 'q1', type: 'address', title: '賞品の送り先', required: true },
        ] },
      },
    });
    const html = new StaticLotteryGenerator().generateHTML(form, 'preview');
    const { doc } = await loadDom(html, zipcloudOk);
    const p = parts(doc, 'q-q1');
    const collect = (doc.defaultView as unknown as { collectAnswers: () => { error?: string; answers?: Record<string, string> } }).collectAnswers;
    expect(collect().error).toContain('賞品の送り先');
    type(doc, p.zip, '1500001');
    await tick();
    type(doc, p.street, '1-2-3');
    expect(collect().answers).toEqual({ '賞品の送り先': '〒150-0001 東京都渋谷区神宮前1-2-3' });
  });
});

describe('住所検索の通信先が CSP で許可されている', () => {
  it('公開プロキシとプレビューの connect-src に zipcloud がある', async () => {
    const fs = await import('fs');
    for (const file of ['src/app/api/public-form/[...path]/route.ts', 'src/app/preview/[storeId]/forms/[formId]/route.ts']) {
      expect(fs.readFileSync(file, 'utf8')).toMatch(/connect-src[^;]*https:\/\/zipcloud\.ibsnet\.co\.jp/);
    }
  });
});
