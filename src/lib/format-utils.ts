/**
 * フォーマット用ユーティリティ
 */

/**
 * カスタムフィールドの値を日本語表示用に整形する。
 * - "2026-04-30T15:08" / "2026-04-30T15:08:00" → "2026年04月30日 15:08"
 * - "2026-04-30"                               → "2026年04月30日"
 * - その他                                     → そのまま返す
 */
export function formatDateTimeForDisplay(value: string): string {
  if (!value || typeof value !== 'string') return value;
  const dt = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (dt) {
    const [, y, m, d, h, mm] = dt;
    return `${y}年${m}月${d}日 ${h}:${mm}`;
  }
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (date) {
    const [, y, m, d] = date;
    return `${y}年${m}月${d}日`;
  }
  return value;
}
