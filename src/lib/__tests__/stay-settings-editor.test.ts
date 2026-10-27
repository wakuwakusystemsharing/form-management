/**
 * 宿泊設定の編集画面（StaySettingsEditor）と段階式キャンセル料（CancelFeeTiersEditor）が
 * 既定の設定で描画でき、設定シートと同じ区画名・入力項目を含むことを確認する（サーバー側レンダリング）
 */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StaySettingsEditor from '@/components/FormEditor/Reservation/StaySettingsEditor';
import CancelFeeTiersEditor from '@/components/FormEditor/Reservation/CancelFeeTiersEditor';
import { normalizeForm } from '@/lib/form-normalizer';
import { resolveCancelRules } from '@/lib/cancel-rules';
import { createDefaultStaySettings } from '@/lib/stay-pricing';

describe('StaySettingsEditor', () => {
  it('宿泊モードのフォームで 8 つの区画と主要な入力を描画する', () => {
    const stay = createDefaultStaySettings();
    stay.pricing.rate_tables.push({ id: 'sat', name: '土曜', mode: 'by_count', prices: { '1': 18000, '2': 26000, '3': 32000 } });
    stay.pricing.weekday_rate_table_ids = { '6': 'sat' };
    stay.pricing.long_stay_discounts = [{ min_nights: 3, type: 'percent', value: 10 }];
    const form = normalizeForm({ id: 'f1', store_id: 'st0001', config: { calendar_settings: { booking_mode: 'stay', stay_settings: stay } } });
    const html = renderToStaticMarkup(React.createElement(StaySettingsEditor, { form, onUpdate: () => {}, theme: 'light' }));
    for (const title of ['① 基本', '② 人数の区分と定員', '③ 休業日', '④ 料金表', '⑤ 料金表の割り当て', '⑥ 連泊割引', '⑦ 空き判定に含める Google カレンダー', '⑧ 料金プレビュー']) {
      expect(html, title).toContain(title);
    }
    // 既定で開いている区画の内容
    expect(html).toContain('チェックイン時刻');
    expect(html).toContain('最大泊数');
    expect(html).toContain('6歳以上');
    expect(html).toContain('0〜5歳');
    expect(html).toContain('基本の料金表');
    expect(html).toContain('value="14000"');
    expect(html).toContain('祝前日の夜');
    expect(html).toContain('data-slot="stay-settings-editor"');
  });

  it('stay_settings が無くても既定値で描画できる', () => {
    const form = normalizeForm({ id: 'f2', store_id: 'st0001', config: { calendar_settings: { booking_mode: 'stay' } } });
    const html = renderToStaticMarkup(React.createElement(StaySettingsEditor, { form, onUpdate: () => {}, theme: 'dark' }));
    expect(html).toContain('① 基本');
    expect(html).toContain('value="15:00"');
  });
});

describe('CancelFeeTiersEditor', () => {
  it('段階が無いときの案内と、段階があるときの自動生成文のプレビュー', () => {
    const empty = renderToStaticMarkup(React.createElement(CancelFeeTiersEditor, { rules: resolveCancelRules(undefined), onChange: () => {}, theme: 'light' }));
    expect(empty).toContain('キャンセル料の段階はありません');
    const rules = resolveCancelRules({ cancel_rules: { fee_tiers: [{ days_before: 7, percent: 0 }, { days_before: 2, percent: 50 }, { days_before: 0, percent: 100 }] } });
    const html = renderToStaticMarkup(React.createElement(CancelFeeTiersEditor, { rules, onChange: () => {}, theme: 'light' }));
    expect(html).toContain('7日前まで: 無料');
    expect(html).toContain('2〜6日前: 50%');
    expect(html).toContain('前日・当日: 100%');
    expect(html).toContain('キャンセル料の基準');
    expect(html).toContain('LINE では受け付けず店舗へ連絡してもらう');
  });
});
