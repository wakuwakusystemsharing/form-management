/**
 * 予約フォーム（カレンダー表示モード）の「予約が一定数で△で表示する」の純粋ロジック。
 *
 * 設定: `calendar_settings.few_left_mark = { enabled, count, label? }`
 *   - 「同時刻に埋まるイベント数」（`max_concurrent_events`）が 2 以上のときだけ使える
 *   - その時間に重なる予定（予約 + Google カレンダーのイベント。営業日イベントは除く）が
 *     `count` 件以上・`max_concurrent_events` 件未満なら △（予約はできる）。`max_concurrent_events` 件以上は従来どおり ✕
 *   - 例: 同時刻に埋まるイベント数 2 / △ 1 → 予定 0 件 = 〇、1 件 = △、2 件 = ✕
 *   - `label` = 凡例に出す△の説明（空 = 「残りわずか」）
 * - スタッフ選択（スタッフごとのカレンダー連携）を使うフォームでは「同時刻に埋まるイベント数」自体を使わないので △ は出さない
 * - 表示だけの機能。サーバー側の空き再確認（`POST /api/reservations`）は変わらない
 *
 * 静的 HTML には `SLOT_MARK_RUNTIME_JS`（同じ実装の `resolveFewLeftMark` / `slotMarkOf`）を埋め込む。**直すときは両方**
 */
import { resolveMaxConcurrentEvents } from './staff-availability';

export const DEFAULT_FEW_LEFT_LABEL = '残りわずか';
export const FEW_LEFT_LABEL_MAX = 20;

/** 保存する形（`calendar_settings.few_left_mark`） */
export interface FewLeftMarkSettings {
  enabled: boolean;
  /** この件数以上の予定が重なる時間帯を △ にする（1 〜 同時刻に埋まるイベント数 − 1） */
  count: number;
  /** 凡例に出す△の説明（空 / 未設定 = 「残りわずか」） */
  label?: string;
}

/** 正規化済み（フォームの描画に使う形） */
export interface ResolvedFewLeftMark {
  enabled: boolean;
  count: number;
  label: string;
}

export type SlotMark = 'ok' | 'few' | 'ng';

type CalendarSettingsLike = { max_concurrent_events?: unknown; few_left_mark?: unknown } | null | undefined;

function toCount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** △ の件数に設定できる最大値（同時刻に埋まるイベント数 − 1。最低 1） */
export function maxFewLeftCount(maxConcurrentEvents: number): number {
  return Math.max(1, Math.floor(maxConcurrentEvents) - 1);
}

/** 描画用に正規化する。同時刻に埋まるイベント数が 1 のときは常に無効 */
export function resolveFewLeftMark(calendarSettings: CalendarSettingsLike): ResolvedFewLeftMark {
  const max = resolveMaxConcurrentEvents(calendarSettings);
  const raw = calendarSettings && typeof calendarSettings.few_left_mark === 'object' && calendarSettings.few_left_mark
    ? (calendarSettings.few_left_mark as Record<string, unknown>)
    : {};
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, FEW_LEFT_LABEL_MAX) : '';
  return {
    enabled: raw.enabled === true && max >= 2,
    count: Math.min(toCount(raw.count), maxFewLeftCount(max)),
    label: label || DEFAULT_FEW_LEFT_LABEL,
  };
}

/**
 * 保存用に整える（normalizeForm が使う）。未設定なら undefined（キーを持たない）。
 * ON / OFF は入力どおり残し（同時刻に埋まるイベント数を 1 に戻しても設定は消さない）、件数だけ範囲に収める
 */
export function sanitizeFewLeftMark(raw: unknown, maxConcurrentEvents: number): FewLeftMarkSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: FewLeftMarkSettings = {
    enabled: o.enabled === true,
    count: Math.min(toCount(o.count), maxFewLeftCount(maxConcurrentEvents)),
  };
  const label = typeof o.label === 'string' ? o.label.trim().slice(0, FEW_LEFT_LABEL_MAX) : '';
  if (label) out.label = label;
  return out;
}

/**
 * セルの記号を決める。
 * @param isAvailable 既存の判定で予約できる時間帯か（〇 の条件）
 * @param eventCount その時間に重なる予定の数（営業日イベントを除く）
 * @param mark `resolveFewLeftMark` の結果（スタッフ選択を使うフォームでは null を渡す）
 */
export function slotMarkOf(isAvailable: boolean, eventCount: number, mark: ResolvedFewLeftMark | null): SlotMark {
  if (!isAvailable) return 'ng';
  if (mark && mark.enabled && eventCount >= mark.count) return 'few';
  return 'ok';
}

/** スタッフごとのカレンダーで空きを見るフォームか（有効 + カレンダー表示モード + カレンダー ID を持つスタッフあり） */
export function usesStaffCalendars(config: {
  staff_selection?: { enabled?: boolean; staff?: Array<{ name?: string; calendar_id?: string } | null> } | null;
  calendar_settings?: { booking_mode?: string } | null;
} | null | undefined): boolean {
  const ss = config?.staff_selection;
  if (!ss || ss.enabled !== true) return false;
  if ((config?.calendar_settings?.booking_mode || 'calendar') !== 'calendar') return false;
  return Array.isArray(ss.staff) && ss.staff.some((m) => !!m && !!m.name && !!m.calendar_id);
}

/** 静的 HTML に埋め込む JS（TS 版と同じ実装。バッククォート・バックスラッシュ不使用） */
export const SLOT_MARK_RUNTIME_JS = `
// ========== 予約が一定数で△で表示する ==========
function resolveFewLeftMark(cs) {
    var rawMax = cs ? cs.max_concurrent_events : null;
    var max = (typeof rawMax === 'number' && isFinite(rawMax) && rawMax >= 1) ? Math.floor(rawMax) : 1;
    var raw = (cs && cs.few_left_mark && typeof cs.few_left_mark === 'object') ? cs.few_left_mark : {};
    var n = typeof raw.count === 'number' ? raw.count : (typeof raw.count === 'string' ? Number(raw.count) : NaN);
    var count = (isFinite(n) && n >= 1) ? Math.floor(n) : 1;
    var label = typeof raw.label === 'string' ? raw.label.trim().slice(0, ${FEW_LEFT_LABEL_MAX}) : '';
    return {
        enabled: raw.enabled === true && max >= 2,
        count: Math.min(count, Math.max(1, max - 1)),
        label: label || '${DEFAULT_FEW_LEFT_LABEL}'
    };
}
function slotMarkOf(isAvailable, eventCount, mark) {
    if (!isAvailable) return 'ng';
    if (mark && mark.enabled && eventCount >= mark.count) return 'few';
    return 'ok';
}
// ========== △表示ここまで ==========
`;
