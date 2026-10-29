import { describe, expect, it } from 'vitest';
import {
  CHOICE_CHECK_CSS,
  CHOICE_TYPE_SELECT_OPTIONS,
  choiceGroupClass,
  choiceTypeKey,
  isCheckboxStyle,
  parseChoiceTypeKey,
  resolveChoiceSize,
  resolveChoiceStyle,
} from '../choice-style';

describe('choice-style: 表示形式と大きさの解決', () => {
  it('未設定はボタン式・中', () => {
    expect(resolveChoiceStyle({ type: 'radio' })).toBe('button');
    expect(resolveChoiceSize({ type: 'radio' })).toBe('medium');
    expect(isCheckboxStyle({ type: 'radio' })).toBe(false);
  });
  it('choice_style = checkbox で radio / checkbox だけがチェックボックス式', () => {
    expect(isCheckboxStyle({ type: 'radio', choice_style: 'checkbox' })).toBe(true);
    expect(isCheckboxStyle({ type: 'checkbox', choice_style: 'checkbox' })).toBe(true);
    expect(isCheckboxStyle({ type: 'select', choice_style: 'checkbox' })).toBe(false);
    expect(isCheckboxStyle({ type: 'radio', choice_style: 'weird' })).toBe(false);
  });
  it('大きさは small / large だけ有効、それ以外は medium', () => {
    expect(resolveChoiceSize({ choice_size: 'small' })).toBe('small');
    expect(resolveChoiceSize({ choice_size: 'large' })).toBe('large');
    expect(resolveChoiceSize({ choice_size: 'huge' })).toBe('medium');
  });
});

describe('choice-style: 編集画面のプルダウンのキー', () => {
  it('type + choice_style と キー の相互変換', () => {
    expect(choiceTypeKey('radio', undefined)).toBe('radio');
    expect(choiceTypeKey('checkbox', 'button')).toBe('checkbox');
    expect(choiceTypeKey('radio', 'checkbox')).toBe('radio_check');
    expect(choiceTypeKey('checkbox', 'checkbox')).toBe('checkbox_check');
    expect(choiceTypeKey('select', 'checkbox')).toBe('select');
    expect(parseChoiceTypeKey('radio_check')).toEqual({ type: 'radio', choice_style: 'checkbox' });
    expect(parseChoiceTypeKey('checkbox')).toEqual({ type: 'checkbox', choice_style: undefined });
    expect(parseChoiceTypeKey('text')).toEqual({ type: 'text', choice_style: undefined });
  });
  it('4 つのキーは一意で、往復しても同じ', () => {
    const keys = CHOICE_TYPE_SELECT_OPTIONS.map((o) => o.key);
    expect(new Set(keys).size).toBe(4);
    for (const o of CHOICE_TYPE_SELECT_OPTIONS) {
      const parsed = parseChoiceTypeKey(o.key);
      expect(choiceTypeKey(parsed.type, parsed.choice_style)).toBe(o.key);
    }
  });
});

describe('choice-style: 生成 HTML のクラスと CSS', () => {
  it('ボタン式は空、チェックボックス式は単一 / 複数と大きさのクラス', () => {
    expect(choiceGroupClass({ type: 'radio' })).toBe('');
    expect(choiceGroupClass({ type: 'radio', choice_style: 'checkbox' })).toBe(' choice-check choice-check--single choice-check--medium');
    expect(choiceGroupClass({ type: 'checkbox', choice_style: 'checkbox', choice_size: 'large' })).toBe(' choice-check choice-check--multi choice-check--large');
  });
  it('CSS は 1 列・丸 / 四角・大きさ・バッジ打ち消しを含む', () => {
    expect(CHOICE_CHECK_CSS).toContain('flex-direction: column');
    expect(CHOICE_CHECK_CSS).toContain('.choice-check--single > .choice-button::before');
    expect(CHOICE_CHECK_CSS).toContain('border-radius: 50%');
    expect(CHOICE_CHECK_CSS).toContain('.choice-check--small { --chk-size: 18px');
    expect(CHOICE_CHECK_CSS).toContain('.choice-check--large { --chk-size: 32px');
    expect(CHOICE_CHECK_CSS).toContain('content: none !important');
  });
});
