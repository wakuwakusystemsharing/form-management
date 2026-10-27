'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Form, StayGuestCategory, StayRateTable, StaySeason, StaySettings } from '@/types/form';
import { createDefaultStaySettings, resolveNightPrice, sanitizeStaySettings } from '@/lib/stay-pricing';
import { isJapaneseHoliday } from '@/lib/japanese-holidays';
import { getThemeClasses, ThemeType, type ThemeClasses } from '../FormEditorTheme';
import { InfoTooltip } from './MultipleDatesSettingsEditor';

interface Props {
  form: Form;
  onUpdate: (form: Form) => void;
  theme: ThemeType;
}

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
const TIME_OPTIONS = Array.from({ length: 24 * 2 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`);


/** 折りたたみの区画（render 内で部品を作らないよう、コンポーネントの外に置く） */
const Section: React.FC<{ open: boolean; onToggle: () => void; t: ThemeClasses; title: string; hint?: string; children: React.ReactNode }> = ({ open, onToggle, t, title, hint, children }) => (
  <div className={`${t.card} rounded-lg`}>
    <button type="button" onClick={onToggle} className="w-full flex items-center justify-between px-3 py-2 text-left">
      <span className={`text-sm font-semibold ${t.text.primary}`}>{title}</span>
      <span className={`text-xs ${t.text.tertiary}`}>{open ? '閉じる' : '開く'}</span>
    </button>
    {open && (
      <div className={`px-3 pb-3 border-t ${t.divider} pt-3 space-y-3`}>
        {hint && <p className={`text-xs ${t.text.tertiary}`}>{hint}</p>}
        {children}
      </div>
    )}
  </div>
);

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 宿泊モード（booking_mode = 'stay'）の設定（営業時間・ルール → 日時選択モード → 宿泊）
 * ヒアリング当日に担当者が入力する画面。並びは担当者用の設定シートと同じ:
 * ① 基本 ② 人数の区分 ③ 休業日 ④ 料金表 ⑤ 料金表の割り当て ⑥ 連泊割引 ⑦ 空き判定に含めるカレンダー ⑧ 料金プレビュー
 * 保存値は normalizeForm の sanitizeStaySettings が整える（ここでは入力途中の値をそのまま持つ）
 */
const StaySettingsEditor: React.FC<Props> = ({ form, onUpdate, theme }) => {
  const t = getThemeClasses(theme);
  const settings: StaySettings = useMemo(
    () => (form.config?.calendar_settings?.stay_settings ? { ...createDefaultStaySettings(), ...form.config.calendar_settings.stay_settings } : createDefaultStaySettings()),
    [form.config?.calendar_settings?.stay_settings]
  );
  const update = (patch: Partial<StaySettings>) => {
    onUpdate({
      ...form,
      config: {
        ...form.config,
        calendar_settings: { ...form.config?.calendar_settings, stay_settings: { ...settings, ...patch } },
      },
    });
  };
  const updatePricing = (patch: Partial<StaySettings['pricing']>) => update({ pricing: { ...settings.pricing, ...patch } });

  const [open, setOpen] = useState<Record<string, boolean>>({ basic: true, guests: true, closed: false, tables: true, assign: true, discount: false, calendars: false, preview: false });
  const toggle = (k: string) => setOpen((p) => ({ ...p, [k]: !p[k] }));

  const inputCls = `${t.input} rounded-md px-2 py-1 text-sm`;
  const selectCls = `${t.select} rounded-md px-2 py-1 text-sm`;
  const smallBtn = `text-xs px-2 py-1 rounded ${t.button.secondary}`;
  const primaryBtn = `text-xs px-2 py-1 rounded ${t.button.primary}`;
  const delBtn = `text-xs px-2 py-1 rounded ${t.button.delete}`;

  const adultCategories = settings.guest_categories.filter((c) => c.charge === 'adult');
  const maxPaidGuests = Math.max(1, adultCategories.reduce((s, c) => s + c.max, 0));
  const tableIds = settings.pricing.rate_tables.map((r) => r.id);
  const tableName = (id: string | undefined) => settings.pricing.rate_tables.find((r) => r.id === id)?.name || '';

  // ---- ② 人数の区分 ----
  const setCategory = (i: number, patch: Partial<StayGuestCategory>) =>
    update({ guest_categories: settings.guest_categories.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const addCategory = () =>
    update({ guest_categories: [...settings.guest_categories, { id: newId('cat'), label: '', charge: 'free', min: 0, max: 2, counts_toward_capacity: true }] });
  const removeCategory = (i: number) => update({ guest_categories: settings.guest_categories.filter((_, idx) => idx !== i) });

  // ---- ③ 休業日 ----
  const toggleClosedWeekday = (d: number) => {
    const cur = settings.closed_weekdays || [];
    update({ closed_weekdays: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() });
  };
  const [newClosedDate, setNewClosedDate] = useState('');
  const [newRange, setNewRange] = useState<{ start: string; end: string; label: string }>({ start: '', end: '', label: '' });

  // ---- ④ 料金表 ----
  const setTable = (i: number, patch: Partial<StayRateTable>) =>
    updatePricing({ rate_tables: settings.pricing.rate_tables.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });
  const addTable = () => {
    const base = settings.pricing.rate_tables[0];
    updatePricing({ rate_tables: [...settings.pricing.rate_tables, { id: newId('rate'), name: `料金表${settings.pricing.rate_tables.length + 1}`, mode: 'by_count', prices: { ...(base?.prices || {}) } }] });
  };
  const removeTable = (i: number) => {
    const target = settings.pricing.rate_tables[i];
    if (!target || settings.pricing.rate_tables.length <= 1) return;
    const rest = settings.pricing.rate_tables.filter((_, idx) => idx !== i);
    const fallback = rest[0].id;
    const fix = (id?: string) => (id === target.id ? fallback : id);
    const weekday: Record<string, string> = {};
    Object.entries(settings.pricing.weekday_rate_table_ids || {}).forEach(([k, v]) => { if (v !== target.id) weekday[k] = v; });
    updatePricing({
      rate_tables: rest,
      default_rate_table_id: settings.pricing.default_rate_table_id === target.id ? fallback : settings.pricing.default_rate_table_id,
      weekday_rate_table_ids: weekday,
      holiday_eve_rate_table_id: fix(settings.pricing.holiday_eve_rate_table_id),
      holiday_rate_table_id: fix(settings.pricing.holiday_rate_table_id),
      seasons: (settings.pricing.seasons || []).map((s) => ({ ...s, rate_table_id: fix(s.rate_table_id) || fallback })),
      date_rate_table_ids: (settings.pricing.date_rate_table_ids || []).map((d) => ({ ...d, rate_table_id: fix(d.rate_table_id) || fallback })),
    });
  };

  // ---- ⑤ 割り当て ----
  const setSeason = (i: number, patch: Partial<StaySeason>) =>
    updatePricing({ seasons: (settings.pricing.seasons || []).map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const addSeason = () => updatePricing({ seasons: [...(settings.pricing.seasons || []), { id: newId('season'), name: '', start: '', end: '', rate_table_id: settings.pricing.default_rate_table_id }] });
  const removeSeason = (i: number) => updatePricing({ seasons: (settings.pricing.seasons || []).filter((_, idx) => idx !== i) });
  const seasonOverlap = (i: number): boolean => {
    const s = (settings.pricing.seasons || [])[i];
    if (!s?.start || !s?.end) return false;
    return (settings.pricing.seasons || []).some((o, idx) => idx !== i && o.start && o.end && !(s.end < o.start || s.start > o.end));
  };
  const addDateRate = () => updatePricing({ date_rate_table_ids: [...(settings.pricing.date_rate_table_ids || []), { date: '', rate_table_id: settings.pricing.default_rate_table_id }] });
  const setDateRate = (i: number, patch: Partial<{ date: string; rate_table_id: string }>) =>
    updatePricing({ date_rate_table_ids: (settings.pricing.date_rate_table_ids || []).map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });
  const removeDateRate = (i: number) => updatePricing({ date_rate_table_ids: (settings.pricing.date_rate_table_ids || []).filter((_, idx) => idx !== i) });

  // ---- ⑥ 連泊割引 ----
  const discounts = settings.pricing.long_stay_discounts || [];
  const setDiscount = (i: number, patch: Partial<(typeof discounts)[number]>) =>
    updatePricing({ long_stay_discounts: discounts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });
  const addDiscount = () => updatePricing({ long_stay_discounts: [...discounts, { min_nights: 3, type: 'percent', value: 10 }] });
  const removeDiscount = (i: number) => updatePricing({ long_stay_discounts: discounts.filter((_, idx) => idx !== i) });

  // ---- ⑦ 空き判定に含めるカレンダー（連携アカウントの一覧から選ぶ）----
  const [calendars, setCalendars] = useState<Array<{ id: string; summary: string; primary: boolean }> | null>(null);
  const [calendarsError, setCalendarsError] = useState('');
  useEffect(() => {
    if (!open.calendars || calendars !== null) return;
    let cancelled = false;
    fetch(`/api/stores/${form.store_id}/calendar/list`, { credentials: 'include' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setCalendarsError(json.error || 'カレンダー一覧を取得できませんでした'); setCalendars([]); return; }
        setCalendars(Array.isArray(json.calendars) ? json.calendars : []);
      })
      .catch(() => { if (!cancelled) { setCalendarsError('カレンダー一覧を取得できませんでした'); setCalendars([]); } });
    return () => { cancelled = true; };
  }, [open.calendars, calendars, form.store_id]);
  const toggleBlockCalendar = (id: string) => {
    const cur = settings.block_calendar_ids || [];
    update({ block_calendar_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  // ---- ⑧ 料金プレビュー ----
  const [previewMonth, setPreviewMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [previewCounts, setPreviewCounts] = useState<Record<string, number>>({});
  const previewGuestCounts = useMemo(() => {
    const out: Record<string, number> = {};
    settings.guest_categories.forEach((c) => { out[c.id] = previewCounts[c.id] ?? c.min; });
    return out;
  }, [settings.guest_categories, previewCounts]);
  const previewCells = useMemo(() => {
    const clean = sanitizeStaySettings(settings);
    const [y, m] = previewMonth.split('-').map(Number);
    if (!y || !m) return [];
    const first = new Date(Date.UTC(y, m - 1, 1));
    const cells: Array<{ date: string; day: number; price: number | null; table: string; closed: boolean } | null> = [];
    for (let i = 0; i < first.getUTCDay(); i++) cells.push(null);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const closed = (clean.closed_weekdays || []).includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())
        || (clean.closed_dates || []).includes(date)
        || (clean.closed_ranges || []).some((r) => r.start <= date && date <= r.end);
      const price = resolveNightPrice(clean, date, previewGuestCounts, isJapaneseHoliday);
      // 使った料金表名（表示用）
      const table = (() => {
        const p = clean.pricing;
        const specific = p.date_rate_table_ids?.find((x) => x.date === date);
        if (specific) return tableName(specific.rate_table_id);
        const season = p.seasons?.find((s) => s.start <= date && date <= s.end);
        if (season) return tableName(season.rate_table_id);
        if (isJapaneseHoliday(date) && p.holiday_rate_table_id) return tableName(p.holiday_rate_table_id);
        const next = new Date(Date.UTC(y, m - 1, d + 1));
        const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
        if (isJapaneseHoliday(nextStr) && p.holiday_eve_rate_table_id) return tableName(p.holiday_eve_rate_table_id);
        const w = p.weekday_rate_table_ids?.[String(new Date(Date.UTC(y, m - 1, d)).getUTCDay())];
        return tableName(w || p.default_rate_table_id);
      })();
      cells.push({ date, day: d, price, table, closed });
    }
    return cells;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, previewMonth, previewGuestCounts]);

  return (
    <div className="space-y-3" data-slot="stay-settings-editor">
      <p className={`text-xs ${t.text.secondary}`}>
        宿泊モードでは、お客様がチェックイン日とチェックアウト日をカレンダーで選びます。空きは「泊（夜）」単位で判定し、料金は人数別の料金表から 1 泊ずつ計算します。
        営業時間・時間間隔・✕にする時間帯は使いません。予約可能日数・予約受付開始日・条件付き受付開始・祝日を予約不可にする・キャンセルルールは「予約ルール設定」「キャンセルルール設定」で設定します。
      </p>

      {/* ① 基本 */}
      <Section open={!!open.basic} onToggle={() => toggle('basic')} t={t} title="① 基本（チェックイン / アウト・泊数・部屋数・表示）">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={`text-sm ${t.text.secondary}`}>チェックイン時刻
            <select value={settings.check_in_time} onChange={(e) => update({ check_in_time: e.target.value })} className={`${selectCls} ml-2`}>
              {TIME_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <span className={`ml-1 text-xs ${t.text.tertiary}`}>以降</span>
          </label>
          <label className={`text-sm ${t.text.secondary}`}>チェックアウト時刻
            <select value={settings.check_out_time} onChange={(e) => update({ check_out_time: e.target.value })} className={`${selectCls} ml-2`}>
              {TIME_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
            <span className={`ml-1 text-xs ${t.text.tertiary}`}>まで</span>
          </label>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-sm ${t.text.secondary}`}>お客様がチェックイン時刻を選ぶ</span>
            <InfoTooltip theme={theme} text={'候補を選ぶと、お客様はフォームでチェックイン時刻を選べます。空のままなら上のチェックイン時刻を固定で表示します。'} />
          </div>
          <div className="flex flex-wrap gap-1">
            {TIME_OPTIONS.filter((x) => x >= '10:00' && x <= '22:00').map((x) => {
              const on = (settings.check_in_time_options || []).includes(x);
              return (
                <button key={x} type="button" onClick={() => {
                  const cur = settings.check_in_time_options || [];
                  update({ check_in_time_options: on ? cur.filter((v) => v !== x) : [...cur, x].sort() });
                }} className={`text-xs px-2 py-0.5 rounded border ${on ? t.button.primary : t.button.secondary}`}>{x}</button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className={`text-sm ${t.text.secondary}`}>最低泊数
            <input type="number" min={1} max={365} value={settings.min_nights} onChange={(e) => update({ min_nights: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={`${inputCls} w-20 ml-2`} /> 泊
          </label>
          <label className={`text-sm ${t.text.secondary}`}>最大泊数
            <input type="number" min={0} max={365} value={settings.max_nights} onChange={(e) => update({ max_nights: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-20 ml-2`} /> 泊
            <span className={`ml-1 text-xs ${t.text.tertiary}`}>（0 = 制限なし）</span>
          </label>
          <label className={`text-sm ${t.text.secondary}`}>部屋数
            <input type="number" min={1} max={99} value={settings.room_count} onChange={(e) => update({ room_count: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={`${inputCls} w-20 ml-2`} />
            <InfoTooltip theme={theme} text={'同じ夜に受けられる予約の数。1 部屋貸しなら 1。'} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className={`text-sm ${t.text.secondary}`}>カレンダーに 1 泊の料金を表示する（OFF = ◯ / 空室なし だけ）</span>
          <input type="checkbox" checked={settings.show_price_on_calendar} onChange={(e) => update({ show_price_on_calendar: e.target.checked })} className="h-4 w-4" />
        </div>
        <label className={`block text-sm ${t.text.secondary}`}>料金の注記
          <input type="text" value={settings.price_note || ''} onChange={(e) => update({ price_note: e.target.value })} placeholder="例: 税込・1室あたりの目安" className={`${inputCls} w-full mt-1`} />
        </label>
      </Section>

      {/* ② 人数の区分 */}
      <Section open={!!open.guests} onToggle={() => toggle('guests')} t={t} title="② 人数の区分と定員" hint="区分ごとに「有料の人数に数える / 無料 / 1 人 1 泊 ○円加算」を選びます。有料に数える区分は 1 つ以上必要です。">
        <div className="space-y-2">
          {settings.guest_categories.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 flex-wrap text-sm">
              <input type="text" value={c.label} onChange={(e) => setCategory(i, { label: e.target.value })} placeholder="見出し（例: 6歳以上）" className={`${inputCls} w-36`} />
              <select value={c.charge} onChange={(e) => setCategory(i, { charge: e.target.value as StayGuestCategory['charge'] })} className={selectCls}>
                <option value="adult">有料の人数に数える</option>
                <option value="free">無料</option>
                <option value="fixed_per_night">1 人 1 泊 ○円加算</option>
              </select>
              {c.charge === 'fixed_per_night' && (
                <label className={t.text.secondary}>+<input type="number" min={0} value={c.price ?? 0} onChange={(e) => setCategory(i, { price: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-24 mx-1`} />円</label>
              )}
              <label className={t.text.secondary}>最小<input type="number" min={0} max={99} value={c.min} onChange={(e) => setCategory(i, { min: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-16 mx-1`} /></label>
              <label className={t.text.secondary}>最大<input type="number" min={0} max={99} value={c.max} onChange={(e) => setCategory(i, { max: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-16 mx-1`} /></label>
              <label className={`${t.text.secondary} flex items-center gap-1`}><input type="checkbox" checked={c.counts_toward_capacity !== false} onChange={(e) => setCategory(i, { counts_toward_capacity: e.target.checked })} className="h-4 w-4" />定員に数える</label>
              <button type="button" onClick={() => removeCategory(i)} className={delBtn} disabled={settings.guest_categories.length <= 1}>削除</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addCategory} className={primaryBtn}>＋ 区分を追加</button>
          <label className={`text-sm ${t.text.secondary}`}>定員（合計）
            <input type="number" min={0} max={999} value={settings.total_capacity ?? ''} placeholder="自動" onChange={(e) => update({ total_capacity: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-20 ml-2`} /> 名
            <InfoTooltip theme={theme} text={'「定員に数える」区分の合計の上限。空のときは各区分の最大の合計。'} />
          </label>
        </div>
      </Section>

      {/* ③ 休業日 */}
      <Section open={!!open.closed} onToggle={() => toggle('closed')} t={t} title="③ 休業日（その夜は泊まれない）">
        <div className="flex flex-wrap gap-2">
          {DOW_JA.map((w, d) => (
            <label key={d} className={`text-sm ${t.text.secondary} flex items-center gap-1`}>
              <input type="checkbox" checked={(settings.closed_weekdays || []).includes(d)} onChange={() => toggleClosedWeekday(d)} className="h-4 w-4" />{w}曜
            </label>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm ${t.text.secondary}`}>特定日</span>
          <input type="date" value={newClosedDate} onChange={(e) => setNewClosedDate(e.target.value)} className={inputCls} />
          <button type="button" className={smallBtn} onClick={() => { if (newClosedDate && !(settings.closed_dates || []).includes(newClosedDate)) { update({ closed_dates: [...(settings.closed_dates || []), newClosedDate].sort() }); setNewClosedDate(''); } }}>追加</button>
          {(settings.closed_dates || []).map((d) => (
            <span key={d} className={`text-xs px-2 py-0.5 rounded ${t.badge.secondary}`}>{d} <button type="button" onClick={() => update({ closed_dates: (settings.closed_dates || []).filter((x) => x !== d) })} aria-label="削除">×</button></span>
          ))}
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm ${t.text.secondary}`}>期間</span>
            <input type="date" value={newRange.start} onChange={(e) => setNewRange({ ...newRange, start: e.target.value })} className={inputCls} />
            <span className={t.text.tertiary}>〜</span>
            <input type="date" value={newRange.end} onChange={(e) => setNewRange({ ...newRange, end: e.target.value })} className={inputCls} />
            <input type="text" value={newRange.label} onChange={(e) => setNewRange({ ...newRange, label: e.target.value })} placeholder="メモ（例: 年末年始）" className={`${inputCls} w-36`} />
            <button type="button" className={smallBtn} onClick={() => {
              if (!newRange.start || !newRange.end || newRange.end < newRange.start) return;
              update({ closed_ranges: [...(settings.closed_ranges || []), { start: newRange.start, end: newRange.end, ...(newRange.label ? { label: newRange.label } : {}) }] });
              setNewRange({ start: '', end: '', label: '' });
            }}>追加</button>
          </div>
          {(settings.closed_ranges || []).map((r, i) => (
            <div key={`${r.start}-${i}`} className={`text-xs ${t.text.secondary} flex items-center gap-2`}>
              <span>{r.start} 〜 {r.end}{r.label ? `（${r.label}）` : ''}</span>
              <button type="button" onClick={() => update({ closed_ranges: (settings.closed_ranges || []).filter((_, idx) => idx !== i) })} className={delBtn}>削除</button>
            </div>
          ))}
        </div>
      </Section>

      {/* ④ 料金表 */}
      <Section open={!!open.tables} onToggle={() => toggle('tables')} t={t} title="④ 料金表（有料人数ごとの 1 泊料金）" hint="「基本」の表はどの条件にも当たらない夜に使います。土曜用・繁忙期用などは表を追加して ⑤ で割り当てます。">
        <div className="space-y-3">
          {settings.pricing.rate_tables.map((r, i) => (
            <div key={r.id} className={`${t.highlight} rounded-lg p-3 space-y-2`}>
              <div className="flex items-center gap-2 flex-wrap">
                <input type="text" value={r.name} onChange={(e) => setTable(i, { name: e.target.value })} className={`${inputCls} w-40`} placeholder="料金表の名前" />
                <select value={r.mode} onChange={(e) => setTable(i, { mode: e.target.value as StayRateTable['mode'] })} className={selectCls}>
                  <option value="by_count">人数ごとの金額</option>
                  <option value="per_person">1 人あたり単価 × 人数</option>
                </select>
                <label className={`text-xs ${t.text.secondary} flex items-center gap-1`}>
                  <input type="radio" name="stay-default-table" checked={settings.pricing.default_rate_table_id === r.id} onChange={() => updatePricing({ default_rate_table_id: r.id })} />基本の料金表
                </label>
                <button type="button" onClick={() => removeTable(i)} className={delBtn} disabled={settings.pricing.rate_tables.length <= 1}>削除</button>
              </div>
              {r.mode === 'per_person' ? (
                <label className={`text-sm ${t.text.secondary}`}>1 人あたり
                  <input type="number" min={0} value={r.per_person_price ?? ''} onChange={(e) => setTable(i, { per_person_price: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-28 mx-1`} />円 / 泊
                </label>
              ) : (
                <div className="flex flex-wrap gap-2 items-end">
                  {Array.from({ length: maxPaidGuests }, (_, k) => k + 1).map((n) => (
                    <label key={n} className={`text-xs ${t.text.secondary}`}>{n}名
                      <input type="number" min={0} value={r.prices[String(n)] ?? ''} placeholder="受けない" onChange={(e) => {
                        const prices = { ...r.prices };
                        if (e.target.value === '') delete prices[String(n)]; else prices[String(n)] = Math.max(0, parseInt(e.target.value, 10) || 0);
                        setTable(i, { prices });
                      }} className={`${inputCls} w-24 block mt-0.5`} />
                    </label>
                  ))}
                  <label className={`text-xs ${t.text.secondary}`}>表の最大人数を超えた 1 人あたり
                    <input type="number" min={0} value={r.extra_person_price ?? ''} placeholder="受けない" onChange={(e) => setTable(i, { extra_person_price: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-24 block mt-0.5`} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addTable} className={primaryBtn}>＋ 料金表を追加</button>
      </Section>

      {/* ⑤ 割り当て */}
      <Section open={!!open.assign} onToggle={() => toggle('assign')} t={t} title="⑤ 料金表の割り当て（曜日・祝前日・祝日・季節・特定日）" hint="優先順位: 特定日 ＞ 季節 ＞ 祝日 ＞ 祝前日 ＞ 曜日 ＞ 基本。空欄 = 次の優先順位に従う。">
        <div className="flex flex-wrap gap-2">
          {DOW_JA.map((w, d) => (
            <label key={d} className={`text-xs ${t.text.secondary}`}>{w}曜
              <select value={settings.pricing.weekday_rate_table_ids?.[String(d)] || ''} onChange={(e) => {
                const next = { ...(settings.pricing.weekday_rate_table_ids || {}) };
                if (e.target.value) next[String(d)] = e.target.value; else delete next[String(d)];
                updatePricing({ weekday_rate_table_ids: next });
              }} className={`${selectCls} block mt-0.5`}>
                <option value="">基本</option>
                {settings.pricing.rate_tables.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className={`text-xs ${t.text.secondary}`}>祝前日の夜（翌日が祝日）
            <select value={settings.pricing.holiday_eve_rate_table_id || ''} onChange={(e) => updatePricing({ holiday_eve_rate_table_id: e.target.value || undefined })} className={`${selectCls} block mt-0.5`}>
              <option value="">曜日どおり</option>
              {settings.pricing.rate_tables.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className={`text-xs ${t.text.secondary}`}>祝日の夜
            <select value={settings.pricing.holiday_rate_table_id || ''} onChange={(e) => updatePricing({ holiday_rate_table_id: e.target.value || undefined })} className={`${selectCls} block mt-0.5`}>
              <option value="">曜日どおり</option>
              {settings.pricing.rate_tables.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className={`text-sm ${t.text.secondary}`}>季節（期間）</span>
            <button type="button" onClick={addSeason} className={smallBtn}>＋ 期間を追加</button>
          </div>
          {(settings.pricing.seasons || []).map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-wrap text-sm">
              <input type="text" value={s.name} onChange={(e) => setSeason(i, { name: e.target.value })} placeholder="名前（例: お盆）" className={`${inputCls} w-28`} />
              <input type="date" value={s.start} onChange={(e) => setSeason(i, { start: e.target.value })} className={inputCls} />
              <span className={t.text.tertiary}>〜</span>
              <input type="date" value={s.end} onChange={(e) => setSeason(i, { end: e.target.value })} className={inputCls} />
              <select value={tableIds.includes(s.rate_table_id) ? s.rate_table_id : ''} onChange={(e) => setSeason(i, { rate_table_id: e.target.value })} className={selectCls}>
                {settings.pricing.rate_tables.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="button" onClick={() => removeSeason(i)} className={delBtn}>削除</button>
              {seasonOverlap(i) && <span className="text-xs text-red-600">他の期間と重なっています（保存時に後の行が無視されます）</span>}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className={`text-sm ${t.text.secondary}`}>特定日</span>
            <button type="button" onClick={addDateRate} className={smallBtn}>＋ 日付を追加</button>
          </div>
          {(settings.pricing.date_rate_table_ids || []).map((d, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap text-sm">
              <input type="date" value={d.date} onChange={(e) => setDateRate(i, { date: e.target.value })} className={inputCls} />
              <select value={tableIds.includes(d.rate_table_id) ? d.rate_table_id : ''} onChange={(e) => setDateRate(i, { rate_table_id: e.target.value })} className={selectCls}>
                {settings.pricing.rate_tables.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="button" onClick={() => removeDateRate(i)} className={delBtn}>削除</button>
            </div>
          ))}
        </div>
      </Section>

      {/* ⑥ 連泊割引 */}
      <Section open={!!open.discount} onToggle={() => toggle('discount')} t={t} title="⑥ 連泊割引" hint="泊数を満たす段階のうち、いちばん大きい泊数の段階を 1 つだけ適用します。">
        {discounts.map((d, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap text-sm">
            <input type="number" min={1} max={365} value={d.min_nights} onChange={(e) => setDiscount(i, { min_nights: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={`${inputCls} w-16`} />
            <span className={t.text.secondary}>泊以上で</span>
            <select value={d.type} onChange={(e) => setDiscount(i, { type: e.target.value as typeof d.type })} className={selectCls}>
              <option value="percent">合計の ○% 引き</option>
              <option value="per_night">1 泊あたり ○円引き</option>
              <option value="total">合計から ○円引き</option>
            </select>
            <input type="number" min={0} value={d.value} onChange={(e) => setDiscount(i, { value: Math.max(0, parseInt(e.target.value, 10) || 0) })} className={`${inputCls} w-24`} />
            <span className={t.text.secondary}>{d.type === 'percent' ? '%' : '円'}</span>
            <button type="button" onClick={() => removeDiscount(i)} className={delBtn}>削除</button>
          </div>
        ))}
        <button type="button" onClick={addDiscount} className={primaryBtn}>＋ 段階を追加</button>
      </Section>

      {/* ⑦ 空き判定に含めるカレンダー */}
      <Section open={!!open.calendars} onToggle={() => toggle('calendars')} t={t} title="⑦ 空き判定に含める Google カレンダー" hint="店舗カレンダーの予定は常に見ます。他のサイト（Airbnb 等）の iCal を購読したカレンダーなどを追加すると、その予定の夜も「空室なし」になります。">
        {calendars === null && <p className={`text-xs ${t.text.tertiary}`}>読み込み中…</p>}
        {calendarsError && <p className="text-xs text-red-600">{calendarsError}（店舗の Google カレンダー連携が「店舗連携」のときに一覧を選べます）</p>}
        {calendars && calendars.length > 0 && (
          <div className="space-y-1">
            {calendars.map((c) => (
              <label key={c.id} className={`flex items-center gap-2 text-sm ${t.text.secondary}`}>
                <input type="checkbox" checked={(settings.block_calendar_ids || []).includes(c.id)} onChange={() => toggleBlockCalendar(c.id)} className="h-4 w-4" />
                {c.summary || c.id}{c.primary ? '（メイン）' : ''}
              </label>
            ))}
          </div>
        )}
        {(settings.block_calendar_ids || []).filter((id) => !(calendars || []).some((c) => c.id === id)).map((id) => (
          <div key={id} className={`text-xs ${t.text.secondary} flex items-center gap-2`}>
            <span>{id}</span>
            <button type="button" onClick={() => toggleBlockCalendar(id)} className={delBtn}>外す</button>
          </div>
        ))}
      </Section>

      {/* ⑧ 料金プレビュー */}
      <Section open={!!open.preview} onToggle={() => toggle('preview')} t={t} title="⑧ 料金プレビュー（月と人数を選ぶと各日の 1 泊料金）">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <input type="month" value={previewMonth} onChange={(e) => setPreviewMonth(e.target.value)} className={inputCls} />
          {settings.guest_categories.map((c) => (
            <label key={c.id} className={t.text.secondary}>{c.label || '区分'}
              <select value={previewGuestCounts[c.id]} onChange={(e) => setPreviewCounts((p) => ({ ...p, [c.id]: Number(e.target.value) }))} className={`${selectCls} ml-1`}>
                {Array.from({ length: Math.max(0, c.max - c.min) + 1 }, (_, k) => c.min + k).map((n) => <option key={n} value={n}>{n}名</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {DOW_JA.map((w) => <div key={w} className={t.text.tertiary}>{w}</div>)}
          {previewCells.map((cell, i) => cell ? (
            <div key={cell.date} className={`rounded border ${t.divider} p-1 ${cell.closed ? 'opacity-40' : ''}`} title={cell.table}>
              <div className={`font-semibold ${t.text.primary}`}>{cell.day}</div>
              <div className={cell.closed ? t.text.tertiary : cell.price === null ? 'text-red-600' : 'text-blue-700'}>
                {cell.closed ? '休' : cell.price === null ? '料金なし' : `¥${cell.price.toLocaleString()}`}
              </div>
              <div className={`${t.text.tertiary} truncate`}>{cell.table}</div>
            </div>
          ) : <div key={`blank-${i}`} />)}
        </div>
      </Section>
    </div>
  );
};

export default StaySettingsEditor;
