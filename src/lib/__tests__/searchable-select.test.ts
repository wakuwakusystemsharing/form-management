import { describe, expect, it } from 'vitest';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  kanaHeadChar,
  kanaRowOf,
  matchesSelectSearch,
  normalizeSearchText,
  resolveSelectSearchSettings,
  SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL,
  type SelectSearchSettings,
} from '@/lib/searchable-select';
import { renderSearchableSelectHtml, SEARCHABLE_SELECT_RUNTIME_JS } from '@/lib/searchable-select-runtime-js';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';
import { normalizeForm } from '@/lib/form-normalizer';
import type { Form } from '@/types/form';
import type { SurveyConfig } from '@/types/survey';

type SsWindow = Window & {
  Event: typeof Event;
  ssInitAll: () => void;
  ssSyncFromSelect: (el: HTMLSelectElement) => void;
  ssRowOf: (label: string, kana?: string) => string;
  ssNormalize: (s: string) => string;
};

async function loadDom(html: string) {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(String(e)));
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole, url: 'https://example.com/' });
  await new Promise((r) => setTimeout(r, 50));
  return { w: dom.window as unknown as SsWindow, doc: dom.window.document, errors };
}

const STORES = [
  { label: 'あおば店', value: 'あおば店' },
  { label: 'カナガワ店', value: 'カナガワ店' },
  { label: '銀座店', value: '銀座店', kana: 'ぎんざ' },
  { label: '東京店', value: '東京店' },
  { label: 'ぱんだ店', value: 'ぱんだ店' },
];

describe('searchable-select: 純粋ロジック', () => {
  it('normalizeSearchText: カタカナ → ひらがな、全角英数 → 半角、小文字、前後空白除去', () => {
    expect(normalizeSearchText(' カナガワ ')).toBe('かながわ');
    expect(normalizeSearchText('ＡＢＣ１２')).toBe('abc12');
    expect(normalizeSearchText(undefined)).toBe('');
  });

  it('kanaHeadChar: 濁音・半濁音・小書きを清音の大きいかなへ寄せる', () => {
    expect(kanaHeadChar('ぎんざ')).toBe('き');
    expect(kanaHeadChar('ぱんだ')).toBe('は');
    expect(kanaHeadChar('ゃまだ')).toBe('や');
    expect(kanaHeadChar('ヴぃ')).toBe('う');
    expect(kanaHeadChar('')).toBe('');
  });

  it('kanaRowOf: ふりがな優先。かな以外で始まるときは空', () => {
    expect(kanaRowOf('あおば店')).toBe('あ');
    expect(kanaRowOf('カナガワ店')).toBe('か');
    expect(kanaRowOf('銀座店', 'ぎんざ')).toBe('か');
    expect(kanaRowOf('東京店')).toBe('');
    expect(kanaRowOf('ぱんだ店')).toBe('は');
    expect(kanaRowOf('わかば')).toBe('わ');
    expect(kanaRowOf('んー')).toBe('わ');
  });

  it('matchesSelectSearch: 検索語（表示名 / ふりがな）と五十音の行の両方で絞り込む', () => {
    expect(matchesSelectSearch(STORES[2], 'ぎん', '')).toBe(true);
    expect(matchesSelectSearch(STORES[2], 'ギン', 'か')).toBe(true);
    expect(matchesSelectSearch(STORES[2], '', 'さ')).toBe(false);
    expect(matchesSelectSearch(STORES[3], '東京', '')).toBe(true);
    expect(matchesSelectSearch(STORES[3], '', 'た')).toBe(false);
    expect(matchesSelectSearch(STORES[0], 'おば', 'あ')).toBe(true);
  });

  it('resolveSelectSearchSettings: 既定値の補完と不正値の扱い', () => {
    expect(resolveSelectSearchSettings(undefined)).toEqual({ enabled: false, unknown_enabled: true, unknown_label: SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL });
    expect(resolveSelectSearchSettings({ enabled: true })).toEqual({ enabled: true, unknown_enabled: true, unknown_label: '不明' });
    expect(resolveSelectSearchSettings({ enabled: true, unknown_enabled: false, unknown_label: '  わからない ' })).toEqual({ enabled: true, unknown_enabled: false, unknown_label: 'わからない' });
    expect(resolveSelectSearchSettings({ enabled: 'yes' }).enabled).toBe(false);
  });
});

describe('searchable-select: 埋め込み JS が TypeScript 側と同じ判定をする', () => {
  it('ssRowOf / ssNormalize', async () => {
    const { w } = await loadDom(`<!doctype html><html><body><script>${SEARCHABLE_SELECT_RUNTIME_JS}</script></body></html>`);
    for (const s of STORES) {
      expect(w.ssRowOf(s.label, s.kana)).toBe(kanaRowOf(s.label, s.kana));
    }
    expect(w.ssNormalize(' カナガワ ＡＢ')).toBe(normalizeSearchText(' カナガワ ＡＢ'));
  });
});

describe('renderSearchableSelectHtml', () => {
  it('OFF のときは通常の <select> だけを返す', () => {
    const html = renderSearchableSelectHtml({ selectId: 'custom-field-cf1', options: STORES, settings: undefined, selectAttrs: 'data-field-id="cf1"' });
    expect(html).toBe('<select id="custom-field-cf1" class="input" data-field-id="cf1"><option value="">選択してください</option>'
      + STORES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('') + '</select>');
    expect(html).not.toContain('data-ss-for=');
  });

  it('ON のときは非表示の <select> + 検索欄 + 五十音ボタン + 不明ボタンを出力する', () => {
    const html = renderSearchableSelectHtml({ selectId: 'q1', options: STORES, settings: { enabled: true }, selectAttrs: 'onchange="onSelectChange(\'q1\')"' });
    expect(html).toContain('<div class="ss-field" data-ss-for="q1">');
    expect(html).toContain('<select id="q1" class="input ss-native" onchange="onSelectChange(\'q1\')">');
    expect(html).toContain('<option value="銀座店" data-kana="ぎんざ">銀座店</option>');
    expect(html).toContain('<option value="不明" data-ss-unknown="1">不明</option>');
    expect(html).toContain('class="input ss-search"');
    expect(html).toContain('data-row="あ"');
    expect(html).toContain('<button type="button" class="ss-unknown" data-value="不明">不明</button>');
  });

  it('不明 OFF / 表示名の変更', () => {
    const off = renderSearchableSelectHtml({ selectId: 'q1', options: STORES, settings: { enabled: true, unknown_enabled: false } });
    expect(off).not.toContain('ss-unknown');
    expect(off).not.toContain('data-ss-unknown');
    const named = renderSearchableSelectHtml({ selectId: 'q1', options: STORES, settings: { enabled: true, unknown_label: 'わからない' } });
    expect(named).toContain('<option value="わからない" data-ss-unknown="1">わからない</option>');
    expect(named).toContain('data-value="わからない">わからない</button>');
  });
});

function buildReservationForm(selectSearch: SelectSearchSettings | undefined): Form {
  return normalizeForm({
    id: 'form_test',
    store_id: 'st0001',
    form_type: 'line',
    config: {
      basic_info: { form_name: 'テスト予約', store_name: 'テスト店', liff_id: '', theme_color: '#3B82F6' },
      custom_fields: [
        { id: 'cf1', type: 'select', title: 'ご利用店舗', required: true, restore_enabled: true, options: STORES, select_search: selectSearch },
      ],
    },
  });
}

describe('予約フォーム: カスタムフィールドのドロップダウン選択に検索・絞り込み機能', () => {
  it('OFF のときは従来どおりの <select>', () => {
    const html = new StaticReservationGenerator().generateHTML(buildReservationForm(undefined).config, 'form_test', 'st0001');
    expect(html).toContain('<select id="custom-field-cf1" class="input" data-field-id="cf1"><option value="">選択してください</option>');
    expect(html).not.toContain('data-ss-for=');
  });

  it('ON: 五十音ボタン・名前検索で絞り込み、タップで <select> に値が入り state に反映される', async () => {
    const html = new StaticReservationGenerator().generateHTML(buildReservationForm({ enabled: true }).config, 'form_test', 'st0001');
    const { w, doc, errors } = await loadDom(html);
    expect(errors).toEqual([]);
    const wrap = doc.querySelector('.ss-field[data-ss-for="custom-field-cf1"]') as HTMLElement;
    expect(wrap).toBeTruthy();
    const select = doc.getElementById('custom-field-cf1') as HTMLSelectElement;
    const items = () => Array.from(wrap.querySelectorAll('.ss-item')).map((b) => b.textContent);
    expect(items()).toEqual(STORES.map((s) => s.label));

    // 五十音「か」: カナガワ店 + 銀座店（ふりがな）
    (wrap.querySelector('.ss-row-btn[data-row="か"]') as HTMLButtonElement).click();
    expect(items()).toEqual(['カナガワ店', '銀座店']);

    // 名前検索（「すべて」に戻してから）
    (wrap.querySelector('.ss-row-btn[data-row=""]') as HTMLButtonElement).click();
    const search = wrap.querySelector('.ss-search') as HTMLInputElement;
    search.value = '東京';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(items()).toEqual(['東京店']);
    search.value = 'ないお店';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(items()).toEqual([]);
    expect(wrap.classList.contains('ss-no-match')).toBe(true);

    // タップで選択 → <select> の値 + 選択中の表示 + 折りたたみ
    search.value = '';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    (wrap.querySelector('.ss-item[data-value="銀座店"]') as HTMLButtonElement).click();
    expect(select.value).toBe('銀座店');
    expect(wrap.classList.contains('ss-collapsed')).toBe(true);
    expect((wrap.querySelector('.ss-current-label') as HTMLElement).textContent).toBe('銀座店');
    // 復元機能 ON なので localStorage に保存される（change イベントが既存リスナーに届いている）
    const saved = JSON.parse(w.localStorage.getItem('booking_テスト予約') || '{}');
    expect(saved.customFields?.cf1).toBe('銀座店');

    // 「変更する」で選び直し → 「不明」ボタンは絞り込みに関係なく独立して押せる
    (wrap.querySelector('.ss-change') as HTMLButtonElement).click();
    expect(wrap.classList.contains('ss-collapsed')).toBe(false);
    (wrap.querySelector('.ss-unknown') as HTMLButtonElement).click();
    expect(select.value).toBe('不明');
    expect((wrap.querySelector('.ss-unknown') as HTMLElement).classList.contains('selected')).toBe(true);
  });

  it('ON: 復元した値が選択中の表示に反映される', async () => {
    const html = new StaticReservationGenerator().generateHTML(buildReservationForm({ enabled: true }).config, 'form_test', 'st0001');
    const first = await loadDom(html);
    (first.doc.querySelector('.ss-item[data-value="東京店"]') as HTMLButtonElement).click();
    const stored = first.w.localStorage.getItem('booking_テスト予約');
    expect(stored).toBeTruthy();

    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), url: 'https://example.com/', beforeParse(window) {
      window.localStorage.setItem('booking_テスト予約', stored as string);
    } });
    await new Promise((r) => setTimeout(r, 50));
    const doc = dom.window.document;
    const select = doc.getElementById('custom-field-cf1') as HTMLSelectElement;
    expect(select.value).toBe('東京店');
    const wrap = doc.querySelector('.ss-field[data-ss-for="custom-field-cf1"]') as HTMLElement;
    expect(wrap.classList.contains('ss-collapsed')).toBe(true);
    expect((wrap.querySelector('.ss-current-label') as HTMLElement).textContent).toBe('東京店');
  });
});

function buildSurveyConfig(selectSearch: SurveyConfig['questions'][number]['select_search'], allowOther = false): SurveyConfig {
  return {
    basic_info: { title: 'テストアンケート', liff_id: '', theme_color: '#3B82F6' },
    questions: [
      { id: 'q1', type: 'select', title: 'ご利用店舗', required: true, options: STORES, allow_other: allowOther, select_search: selectSearch },
    ],
    ui_settings: { submit_button_text: '送信', theme_color: '#3B82F6' },
  };
}

describe('アンケート: ドロップダウン選択に検索・絞り込み機能', () => {
  it('OFF のときは従来どおりの <select>', () => {
    const html = new StaticSurveyGenerator().generateHTML(buildSurveyConfig(undefined), 'sv_test', 'st0001');
    expect(html).toContain(`<select id="q1" class="input" onchange="onSelectChange('q1')"><option value="">選択してください</option>`);
    expect(html).not.toContain('data-ss-for=');
  });

  it('ON: 絞り込み → タップで値が入り onSelectChange（保存・追加質問）が動く。「その他」は常にリストの末尾', async () => {
    const config = buildSurveyConfig({ enabled: true, unknown_label: 'わからない' }, true);
    config.questions[0].restore_enabled = true;
    const html = new StaticSurveyGenerator().generateHTML(config, 'sv_test', 'st0001');
    const { w, doc, errors } = await loadDom(html);
    expect(errors).toEqual([]);
    const wrap = doc.querySelector('.ss-field[data-ss-for="q1"]') as HTMLElement;
    const select = doc.getElementById('q1') as HTMLSelectElement;
    const items = () => Array.from(wrap.querySelectorAll('.ss-item')).map((b) => b.textContent);
    expect(items()).toEqual([...STORES.map((s) => s.label), 'その他']);
    expect(select.querySelector('option[data-opt-index="2"]')?.getAttribute('data-kana')).toBe('ぎんざ');

    (wrap.querySelector('.ss-row-btn[data-row="あ"]') as HTMLButtonElement).click();
    expect(items()).toEqual(['あおば店', 'その他']);

    (wrap.querySelector('.ss-item[data-value="あおば店"]') as HTMLButtonElement).click();
    expect(select.value).toBe('あおば店');
    const saved = JSON.parse(w.localStorage.getItem('survey_sv_test') || '{}');
    expect(saved.q1?.v).toBe('あおば店');

    (wrap.querySelector('.ss-change') as HTMLButtonElement).click();
    (wrap.querySelector('.ss-unknown') as HTMLButtonElement).click();
    expect(select.value).toBe('わからない');
    expect((wrap.querySelector('.ss-current-label') as HTMLElement).textContent).toBe('わからない');
  });
});
