'use client';

import React from 'react';
import type { CancelFeeTier } from '@/types/form';
import { buildCancelPolicyText, sanitizeFeeTiers, type CancelRules } from '@/lib/cancel-rules';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { InfoTooltip } from './MultipleDatesSettingsEditor';

interface Props {
  rules: CancelRules;
  onChange: (patch: Partial<CancelRules>) => void;
  theme: ThemeType;
}

/**
 * 段階式キャンセル料（キャンセルルール設定）
 * - 「○日前まで（○時まで）: ○%」の行を並べる。days_before の大きい順に判定される（純粋ロジック: src/lib/cancel-rules.ts）
 * - 基準（宿泊料金のみ / オプション込み合計）と、キャンセル料がかかる期間の LINE キャンセルの扱い
 * - 規定文が空のときフォームに出る自動生成文をプレビュー
 */
const CancelFeeTiersEditor: React.FC<Props> = ({ rules, onChange, theme }) => {
  const t = getThemeClasses(theme);
  // 編集中は並べ替えず入力順のまま持ち、保存値は sanitizeFeeTiers が整える
  const tiers = rules.fee_tiers || [];

  const update = (next: CancelFeeTier[]) => onChange({ fee_tiers: next });
  const setTier = (i: number, patch: Partial<CancelFeeTier>) => {
    update(tiers.map((tier, idx) => (idx === i ? { ...tier, ...patch } : tier)));
  };
  const addTier = () => {
    const last = tiers[tiers.length - 1];
    const days = last ? Math.max(0, last.days_before - 1) : 7;
    update([...tiers, { days_before: days, percent: last ? Math.min(100, last.percent + 50) : 0 }]);
  };
  const removeTier = (i: number) => update(tiers.filter((_, idx) => idx !== i));
  const applyExample = () => update([{ days_before: 7, percent: 0 }, { days_before: 2, percent: 50 }, { days_before: 0, percent: 100 }]);

  const preview = buildCancelPolicyText({ fee_tiers: sanitizeFeeTiers(tiers) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <label className={`block text-sm font-medium ${t.text.secondary}`}>キャンセル料の段階</label>
          <InfoTooltip
            theme={theme}
            text={'予約日（宿泊はチェックイン日）の何日前までならキャンセル料が何 % かを段階で設定します。\n日数は日付の差で数えます（当日 = 0、前日 = 1）。「何時まで」を入れると、その日のその時刻までが上の段階、以降は次の段階になります。\n例: 7日前まで 0% / 2日前まで 50% / 当日 100% = 7日前以前は無料、2〜6日前は50%、前日・当日は100%。\n金額の請求は行いません（LINE での案内と記録まで）。'}
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={applyExample} className={`text-xs px-2 py-1 rounded border ${t.button.secondary}`}>例を入れる</button>
          <button type="button" onClick={addTier} className={`text-xs px-2 py-1 rounded ${t.button.primary}`}>＋ 段階を追加</button>
        </div>
      </div>

      {tiers.length === 0 ? (
        <p className={`text-xs ${t.text.tertiary}`}>キャンセル料の段階はありません（キャンセル料なし）。</p>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap text-sm">
              <input
                type="number"
                min={0}
                max={365}
                value={tier.days_before}
                onChange={(e) => setTier(i, { days_before: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                className={`${t.input} w-20 rounded-md px-2 py-1`}
                aria-label="何日前まで"
              />
              <span className={t.text.secondary}>日前まで</span>
              <input
                type="time"
                step={60}
                value={tier.until_time || ''}
                onChange={(e) => setTier(i, { until_time: e.target.value || undefined })}
                className={`${t.timeInput} w-28 rounded-md px-2 py-1`}
                aria-label="何時まで（任意）"
              />
              <span className={t.text.tertiary}>まで（任意）</span>
              <input
                type="number"
                min={0}
                max={100}
                value={tier.percent}
                onChange={(e) => setTier(i, { percent: Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) })}
                className={`${t.input} w-20 rounded-md px-2 py-1`}
                aria-label="キャンセル料の割合"
              />
              <span className={t.text.secondary}>%</span>
              <button type="button" onClick={() => removeTier(i)} className={`text-xs px-2 py-1 rounded ${t.button.delete}`}>削除</button>
            </div>
          ))}
          <p className={`text-xs ${t.text.tertiary}`}>
            日数が同じ行は時刻付きが先に判定されます。いちばん小さい日数より直前（当日など）は、いちばん小さい段階の % になります。
          </p>
        </div>
      )}

      {tiers.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={`block text-xs font-medium ${t.text.secondary} mb-1`}>キャンセル料の基準</label>
              <select
                value={rules.fee_base}
                onChange={(e) => onChange({ fee_base: e.target.value === 'total' ? 'total' : 'stay' })}
                className={`${t.select} w-full rounded-md px-2 py-1 text-sm`}
              >
                <option value="stay">宿泊料金のみ（宿泊予約以外は 0 円）</option>
                <option value="total">メニュー・オプション込みの合計</option>
              </select>
            </div>
            <div>
              <label className={`block text-xs font-medium ${t.text.secondary} mb-1`}>キャンセル料がかかる期間の LINE キャンセル</label>
              <select
                value={rules.self_cancel_with_fee}
                onChange={(e) => onChange({ self_cancel_with_fee: e.target.value === 'deny' ? 'deny' : 'confirm' })}
                className={`${t.select} w-full rounded-md px-2 py-1 text-sm`}
              >
                <option value="confirm">金額を確認してもらってから LINE で取り消す</option>
                <option value="deny">LINE では受け付けず店舗へ連絡してもらう</option>
              </select>
            </div>
          </div>
          <div className={`${t.highlight} rounded-lg p-3`}>
            <p className="text-xs font-medium mb-1">フォームに表示される規定文（上の「キャンセル規定」が空のとき）</p>
            <pre className={`text-xs whitespace-pre-wrap font-sans ${t.text.primary}`}>{preview || '（段階が正しく入力されていません）'}</pre>
          </div>
        </>
      )}
    </div>
  );
};

export default CancelFeeTiersEditor;
