import { describe, expect, it } from 'vitest';
import {
  LIFF_MAX_MESSAGES,
  capLiffMessages,
  countReservationMaxLineMessages,
  countSurveyMaxLineMessages,
  resolveExtraMessage,
  validateLiffMessageLimit,
} from '@/lib/extra-messages';
import { collectReservationCustomFieldTags } from '@/lib/reservation-tags';
import type { FormConfig } from '@/types/form';
import type { SurveyConfig } from '@/types/survey';

const msg = (text = 'm') => ({ enabled: true, text });

describe('resolveExtraMessage', () => {
  it('ON かつ文言ありのときだけトリム済みの文言を返す', () => {
    expect(resolveExtraMessage({ enabled: true, text: ' こんにちは ' })).toBe('こんにちは');
    expect(resolveExtraMessage({ enabled: false, text: 'x' })).toBeNull();
    expect(resolveExtraMessage({ enabled: true, text: '   ' })).toBeNull();
    expect(resolveExtraMessage(undefined)).toBeNull();
    expect(resolveExtraMessage({ enabled: true } as never)).toBeNull();
  });
});

describe('capLiffMessages', () => {
  it('5 通以下はそのまま', () => {
    expect(capLiffMessages(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('6 通以上は 5 通目以降を改行で 1 通にまとめる（文言は欠けない）', () => {
    const out = capLiffMessages(['1', '2', '3', '4', '5', '6', '7']);
    expect(out).toHaveLength(LIFF_MAX_MESSAGES);
    expect(out[4]).toBe('5\n\n6\n\n7');
  });
  it('同じ文言は 1 回だけ送る', () => {
    expect(capLiffMessages(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });
});

describe('countSurveyMaxLineMessages', () => {
  const base = (questions: SurveyConfig['questions'], second?: { enabled: boolean; text: string }): SurveyConfig =>
    ({
      basic_info: { title: 'T', liff_id: '', theme_color: '#000', second_message: second },
      questions,
      ui_settings: { submit_button_text: '送信' },
    }) as unknown as SurveyConfig;

  it('本文の 1 通 + 2 通目 + 選択肢の追加メッセージ（単一選択は最大 1、複数選択は全部）', () => {
    const config = base(
      [
        { id: 'q1', type: 'radio', title: 'A', required: false, options: [{ label: 'a', value: 'a', extra_message: msg() }, { label: 'b', value: 'b', extra_message: msg() }] },
        { id: 'q2', type: 'checkbox', title: 'B', required: false, options: [{ label: 'a', value: 'a', extra_message: msg() }, { label: 'b', value: 'b', extra_message: msg() }, { label: 'c', value: 'c' }] },
        { id: 'q3', type: 'text', title: 'C', required: false },
      ],
      { enabled: true, text: '2通目' }
    );
    // 1 + 1 + 1(radio) + 2(checkbox)
    expect(countSurveyMaxLineMessages(config)).toBe(5);
    expect(validateLiffMessageLimit(countSurveyMaxLineMessages(config))).toBeNull();
  });

  it('OFF や空文言の追加メッセージ・2 通目は数えない', () => {
    const config = base(
      [{ id: 'q1', type: 'select', title: 'A', required: false, options: [{ label: 'a', value: 'a', extra_message: { enabled: false, text: 'x' } }, { label: 'b', value: 'b', extra_message: { enabled: true, text: ' ' } }] }],
      { enabled: false, text: 'x' }
    );
    expect(countSurveyMaxLineMessages(config)).toBe(1);
  });

  it('追加質問（入れ子）の選択肢も数える。親が単一選択なら最も多い枝を採用', () => {
    const config = base([
      {
        id: 'q1', type: 'radio', title: 'A', required: false,
        options: [
          {
            label: 'a', value: 'a', extra_message: msg(),
            follow_ups: [
              { enabled: true, title: 'f1', type: 'checkbox', options: [{ label: 'x', value: 'x', extra_message: msg() }, { label: 'y', value: 'y', extra_message: msg() }] },
              { enabled: false, title: 'f2', type: 'radio', options: [{ label: 'z', value: 'z', extra_message: msg() }] },
            ],
          },
          { label: 'b', value: 'b', follow_up: { enabled: true, title: 'legacy', type: 'radio', options: [{ label: 'p', value: 'p', extra_message: msg() }] } },
        ],
      },
    ]);
    // 1 + max(a: 1 + 2, b: 1) = 4
    expect(countSurveyMaxLineMessages(config)).toBe(4);
  });

  it('上限を超えると日本語のエラー文を返す', () => {
    const config = base([
      { id: 'q1', type: 'checkbox', title: 'A', required: false, options: [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: String(n), extra_message: msg() })) },
    ]);
    const count = countSurveyMaxLineMessages(config);
    expect(count).toBe(6);
    const err = validateLiffMessageLimit(count);
    expect(err).toContain('最大 5 通');
    expect(err).toContain('6 通');
  });
});

describe('countReservationMaxLineMessages', () => {
  const config = (overrides: Record<string, unknown>): FormConfig =>
    ({
      basic_info: { form_name: 'F', store_name: 'S', liff_id: '', theme_color: '#000' },
      menu_structure: { categories: [] },
      ...overrides,
    }) as unknown as FormConfig;

  it('単一選択: メニュー + サブメニュー + メニューのオプション全部 + カテゴリー共通オプション全部 のうち最大の組み合わせ', () => {
    const c = config({
      menu_structure: {
        categories: [
          {
            id: 'c1', name: 'c1', display_name: 'c1', selection_mode: 'single',
            menus: [
              { id: 'm1', name: 'm1', extra_message: msg(), options: [{ id: 'o1', name: 'o1', price: 0, duration: 0, extra_message: msg() }, { id: 'o2', name: 'o2', price: 0, duration: 0, extra_message: msg() }] },
              { id: 'm2', name: 'm2', has_submenu: true, sub_menu_items: [{ id: 's1', name: 's1', price: 0, duration: 0, extra_message: msg() }, { id: 's2', name: 's2', price: 0, duration: 0 }] },
            ],
            options: [{ id: 'co1', name: 'co1', price: 0, duration: 0, extra_message: msg() }],
          },
        ],
      },
    });
    // 1 + max(m1: 1 + 2, m2: 0 + 1) + 1(カテゴリー共通) = 5
    expect(countReservationMaxLineMessages(c)).toBe(5);
  });

  it('カテゴリーまたぎの複数選択: 上限数ぶんの最も多いメニューを足す', () => {
    const c = config({
      menu_structure: {
        allow_cross_category_selection: true,
        max_cross_category_selections: 2,
        categories: [
          { id: 'c1', name: 'c1', display_name: 'c1', selection_mode: 'single', options: [], menus: [{ id: 'm1', name: 'm1', extra_message: msg() }, { id: 'm2', name: 'm2', extra_message: msg() }] },
          { id: 'c2', name: 'c2', display_name: 'c2', selection_mode: 'single', options: [], menus: [{ id: 'm3', name: 'm3', extra_message: msg() }] },
        ],
      },
    });
    // 1 + 2（上限 2 なので 3 メニュー中 2 つ）
    expect(countReservationMaxLineMessages(c)).toBe(3);
  });

  it('カスタム項目とその選択肢の追加質問、メニューの追加質問も数える', () => {
    const c = config({
      basic_info: { form_name: 'F', store_name: 'S', liff_id: '', theme_color: '#000', second_message: { enabled: true, text: '2' } },
      menu_structure: {
        categories: [{
          id: 'c1', name: 'c1', display_name: 'c1', selection_mode: 'single', options: [],
          menus: [{ id: 'm1', name: 'm1', additional_questions: [{ id: 'aq1', type: 'radio', title: 'aq', required: false, options: [{ label: 'a', value: 'a', extra_message: msg() }] }] }],
        }],
      },
      custom_fields: [
        {
          id: 'cf1', type: 'checkbox', title: 'cf', required: false,
          options: [
            { label: 'a', value: 'a', extra_message: msg(), additional_questions: [{ id: 'aq2', type: 'select', title: 'x', required: false, options: [{ label: 'p', value: 'p', extra_message: msg() }, { label: 'q', value: 'q', extra_message: msg() }] }] },
            { label: 'b', value: 'b', extra_message: msg() },
          ],
        },
        { id: 'cf2', type: 'text', title: 't', required: false },
      ],
    });
    // 1 + 1(2通目) + 1(aq1) + (cf1: a 1 + aq2 1, b 1) = 6
    expect(countReservationMaxLineMessages(c)).toBe(6);
    expect(validateLiffMessageLimit(countReservationMaxLineMessages(c))).not.toBeNull();
  });

  it('何も設定が無ければ本文の 1 通だけ', () => {
    expect(countReservationMaxLineMessages(config({}))).toBe(1);
  });
});

describe('collectReservationCustomFieldTags', () => {
  const config = {
    custom_fields: [
      { id: 'cf1', type: 'radio', title: 'A', required: false, options: [{ label: 'はい', value: 'はい', tags: ['駐車場', ' VIP '] }, { label: 'いいえ', value: 'いいえ', tags: ['徒歩'] }] },
      { id: 'cf2', type: 'checkbox', title: 'B', required: false, options: [{ label: '肌', value: '肌', tags: ['肌'] }, { label: '髪', value: '髪', tags: ['髪'] }] },
      { id: 'cf3', type: 'text', title: 'C', required: false },
    ],
  } as unknown as FormConfig;

  it('選ばれた選択肢のタグだけを正規化して集める（配列 / 文字列 / ", " 区切りに対応）', () => {
    expect(collectReservationCustomFieldTags(config, { cf1: 'はい', cf2: ['肌'], cf3: '自由入力' })).toEqual(['駐車場', 'VIP', '肌']);
    expect(collectReservationCustomFieldTags(config, { cf2: '肌, 髪' })).toEqual(['肌', '髪']);
  });
  it('選択が無い・設定が無いときは空', () => {
    expect(collectReservationCustomFieldTags(config, {})).toEqual([]);
    expect(collectReservationCustomFieldTags(config, null)).toEqual([]);
    expect(collectReservationCustomFieldTags(null, { cf1: 'はい' })).toEqual([]);
  });
});
