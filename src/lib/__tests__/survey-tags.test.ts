import { describe, expect, it } from 'vitest';
import { collectSurveyOptionTags, countTaggedOptions, mergeCustomerTags } from '../survey-tags';
import type { SurveyConfig } from '@/types/survey';

const config = {
  questions: [
    {
      id: 'q1', type: 'radio', title: '来店のきっかけ', required: false,
      options: [
        { label: '紹介', value: '紹介', tags: ['紹介', ' 口コミ '] },
        { label: 'Instagram', value: 'Instagram', tags: ['SNS'] },
        { label: 'その他', value: 'その他' },
      ],
    },
    {
      id: 'q2', type: 'checkbox', title: '興味のあるメニュー', required: false,
      options: [
        { label: 'カラー', value: 'カラー', tags: ['カラー希望'] },
        { label: 'パーマ', value: 'パーマ', tags: ['パーマ希望'] },
        { label: 'ヘッドスパ', value: 'ヘッドスパ', tags: [] },
      ],
    },
    {
      id: 'q3', type: 'select', title: '年代', required: false,
      options: [{ label: '20代', value: '20代', tags: ['20代'] }, { label: '30代', value: '30代', tags: ['30代'] }],
    },
    { id: 'q4', type: 'text', title: 'ご要望', required: false },
  ],
} as unknown as SurveyConfig;

describe('collectSurveyOptionTags', () => {
  it('radio / select は一致した選択肢のタグ、checkbox は ", " 区切りの各選択肢', () => {
    const tags = collectSurveyOptionTags(config, {
      '来店のきっかけ': '紹介',
      '興味のあるメニュー': 'カラー, ヘッドスパ',
      '年代': '30代',
      'ご要望': '紹介',
    });
    expect(tags).toEqual(['紹介', '口コミ', 'カラー希望', '30代']);
  });

  it('選ばれていない・その他・空は対象外', () => {
    expect(collectSurveyOptionTags(config, { '来店のきっかけ': 'その他の理由', '興味のあるメニュー': '' })).toEqual([]);
    expect(collectSurveyOptionTags(config, null)).toEqual([]);
    expect(collectSurveyOptionTags(null, { '来店のきっかけ': '紹介' })).toEqual([]);
  });

  it('重複は 1 つにまとまる', () => {
    const c = {
      questions: [
        { id: 'a', type: 'radio', title: 'A', required: false, options: [{ label: 'x', value: 'x', tags: ['VIP候補'] }] },
        { id: 'b', type: 'radio', title: 'B', required: false, options: [{ label: 'y', value: 'y', tags: ['VIP候補'] }] },
      ],
    } as unknown as SurveyConfig;
    expect(collectSurveyOptionTags(c, { A: 'x', B: 'y' })).toEqual(['VIP候補']);
  });
});

describe('mergeCustomerTags / countTaggedOptions', () => {
  it('既存タグの後ろに追加し、重複しない', () => {
    expect(mergeCustomerTags(['指名:田中', '紹介'], ['紹介', 'SNS'])).toEqual(['指名:田中', '紹介', 'SNS']);
    expect(mergeCustomerTags(null, ['a'])).toEqual(['a']);
  });

  it('タグ付きの選択肢数', () => {
    expect(countTaggedOptions(config)).toBe(6);
    expect(countTaggedOptions(null)).toBe(0);
  });
});
