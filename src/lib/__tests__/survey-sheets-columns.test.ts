import { describe, expect, it } from 'vitest';
import {
  buildSurveySheetColumnPlan,
  buildSurveySheetRow,
  defaultSurveySheetColumns,
  mergeSurveySheetHeader,
  normalizeSurveySheetColumns,
  resolveSurveySheetsSettings,
} from '@/lib/survey-sheets';
import type { SurveyConfig } from '@/types/survey';

const questions = [{ title: 'お名前' }, { title: '満足度' }, { title: 'ご意見' }];
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';

describe('列のカスタマイズ: 既定と正規化', () => {
  it('おすすめ = 固定 4 列 + 質問の順（空の文言・重複は除く）', () => {
    expect(defaultSurveySheetColumns([...questions, { title: ' ' }, { title: '満足度' }]).map((c) => c.key)).toEqual([
      'submitted_at', 'line_display_name', 'line_user_id', 'response_id', 'q:お名前', 'q:満足度', 'q:ご意見',
    ]);
  });
  it('保存値の順を保ち、新しい質問は末尾に ON で足す。不正な行は捨て、消えた質問の列は残す', () => {
    const cols = normalizeSurveySheetColumns(
      [
        { key: 'q:満足度', label: ' 評価 ' },
        { key: 'submitted_at', enabled: false },
        { key: 'q:旧質問' },
        { key: 'bogus' } as never,
        { key: 'q:満足度' }, // 重複
      ],
      questions
    );
    expect(cols).toEqual([
      { key: 'q:満足度', enabled: true, label: '評価' },
      { key: 'submitted_at', enabled: false },
      { key: 'q:旧質問', enabled: true },
      { key: 'line_display_name', enabled: true },
      { key: 'line_user_id', enabled: true },
      { key: 'response_id', enabled: true },
      { key: 'q:お名前', enabled: true },
      { key: 'q:ご意見', enabled: true },
    ]);
  });
});

describe('列のカスタマイズ: プランと見出し行', () => {
  const settings = {
    columns: [
      { key: 'submitted_at', label: '回答日' },
      { key: 'q:満足度', label: '評価' },
      { key: 'line_user_id', enabled: false },
      { key: 'response_id', enabled: false },
      { key: 'q:ご意見', enabled: false },
    ],
    include_unlisted: true,
  };

  it('OFF の列は入れず、見出しはラベル優先。同名の見出しは番号を付ける', () => {
    const plan = buildSurveySheetColumnPlan(settings, questions);
    expect(plan.columns).toEqual([
      { key: 'submitted_at', header: '回答日' },
      { key: 'q:満足度', header: '評価' },
      { key: 'line_display_name', header: 'LINE表示名' },
      { key: 'q:お名前', header: 'お名前' },
    ]);
    expect(plan.excludedKeys).toEqual(['line_user_id', 'response_id', 'q:ご意見']);
    const dup = buildSurveySheetColumnPlan({ columns: [{ key: 'submitted_at', label: '評価' }, { key: 'q:満足度', label: '評価' }] }, questions);
    expect(dup.columns.slice(0, 2).map((c) => c.header)).toEqual(['評価', '評価 2']);
  });

  it('空のシートにはプランの見出しを書き、OFF にした質問は回答にあっても足さない。一覧に無いキーは右端に足す', () => {
    const plan = buildSurveySheetColumnPlan(settings, questions);
    const { header, added } = mergeSurveySheetHeader([], [{ 'お名前': 'a', '満足度': '5', 'ご意見': 'x', '追加質問（はい）': 'y' }], plan);
    expect(header).toEqual(['回答日', '評価', 'LINE表示名', 'お名前', '追加質問（はい）']);
    expect(added).toEqual(header);
  });

  it('include_unlisted: false なら一覧に無いキーを足さない', () => {
    const plan = buildSurveySheetColumnPlan({ ...settings, include_unlisted: false }, questions);
    const { header } = mergeSurveySheetHeader([], [{ '追加質問（はい）': 'y' }], plan);
    expect(header).toEqual(['回答日', '評価', 'LINE表示名', 'お名前']);
  });

  it('行は見出し → キーの対応で埋める（ラベルを変えた列・店舗が並べ替えた列・一覧に無い列）', () => {
    const plan = buildSurveySheetColumnPlan(settings, questions);
    const row = buildSurveySheetRow(
      { id: 'sr_1', submitted_at: '2026-11-09T05:04:03.000Z', line_user_id: 'U1', line_display_name: '太郎', responses: { 'お名前': '山田', '満足度': '5', '追加質問（はい）': 'y' } },
      ['評価', 'LINE表示名', '回答日', '追加質問（はい）', 'お名前', 'LINEユーザーID'],
      plan
    );
    expect(row).toEqual(['5', '太郎', '2026/11/09 14:04:03', 'y', '山田', 'U1']);
  });

  it('resolveSurveySheetsSettings は質問一覧からプランを付ける（未カスタマイズ = おすすめ）', () => {
    const config = {
      basic_info: { title: 't', liff_id: '', theme_color: '#000', google_sheets: { enabled: true, spreadsheet_id: ID } },
      questions,
      ui_settings: { submit_button_text: '送信', theme_color: '#000' },
    } as unknown as SurveyConfig;
    const r = resolveSurveySheetsSettings(config);
    expect(r?.plan?.columns.map((c) => c.header)).toEqual(['回答日時', 'LINE表示名', 'LINEユーザーID', '回答ID', 'お名前', '満足度', 'ご意見']);
    expect(r?.plan?.includeUnlisted).toBe(true);
  });
});
