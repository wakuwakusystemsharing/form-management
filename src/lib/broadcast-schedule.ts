/**
 * 配信の送信日時の入力（純粋ロジック）
 *
 * 予約配信は pg_cron が 5 分おき（毎時 0, 5, 10 … 分）に送るので、画面では 5 分刻みでだけ選べるようにする。
 * 値はブラウザのローカル時刻の "YYYY-MM-DDTHH:MM"（<input type="datetime-local"> と同じ形）で持つ
 */

export const SCHEDULE_STEP_MINUTES = 5;
export const SCHEDULE_MINUTE_OPTIONS = Array.from({ length: 60 / SCHEDULE_STEP_MINUTES }, (_, i) => i * SCHEDULE_STEP_MINUTES);
export const SCHEDULE_HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);

const pad = (n: number) => String(n).padStart(2, '0');

/** 次の 5 分刻みの時刻に切り上げる（ちょうど 5 分刻みならそのまま。秒・ミリ秒は捨てる） */
export function roundUpToScheduleStep(d: Date): Date {
  const stepMs = SCHEDULE_STEP_MINUTES * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / stepMs) * stepMs);
}

/** Date → ローカル時刻の "YYYY-MM-DDTHH:MM" */
export function toLocalScheduleValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:MM" → 日付 / 時 / 分。読めなければ null */
export function parseLocalScheduleValue(value: string): { date: string; hour: number; minute: number } | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { date: m[1], hour, minute };
}

/** 日付 / 時 / 分 → "YYYY-MM-DDTHH:MM"。分は 5 分刻みに切り捨てる */
export function composeLocalScheduleValue(date: string, hour: number, minute: number): string {
  const h = Math.min(23, Math.max(0, Math.floor(hour)));
  const mm = Math.min(59, Math.max(0, Math.floor(minute)));
  return `${date}T${pad(h)}:${pad(mm - (mm % SCHEDULE_STEP_MINUTES))}`;
}

/** 既定の送信日時: 1 時間後を 5 分刻みに切り上げたもの */
export function defaultScheduleValue(now: Date): string {
  return toLocalScheduleValue(roundUpToScheduleStep(new Date(now.getTime() + 60 * 60 * 1000)));
}
