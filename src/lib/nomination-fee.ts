/**
 * スタッフの指名料（予約フォーム → メニュー構成 → スタッフ選択 → 各スタッフの「指名料設定」）
 *
 * - `staff_selection.staff[].nomination_fee`（円。0 / 未設定 = 指名料なし。設定があるときだけキーを持つ）
 * - お客様がそのスタッフを**指名したときだけ**、予約 1 件につき 1 回、合計金額に足す（「指名なし」で自動割当されたときは足さない）
 * - 予約には `customer_info.nomination_fee`（円）として残し、`customer_info.total_price` は指名料込みの金額にする
 * - 売上（予約分析・来店履歴の金額）にも含める
 *
 * 生成 HTML（static-generator-reservation.ts の buildSelectionPayload）にも同じ規則があるので、直すときは両方
 */

export const NOMINATION_FEE_MAX = 1_000_000;

/** 入力値を指名料（0 以上の整数・上限あり）にする。数字でなければ 0 */
export function sanitizeNominationFee(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(NOMINATION_FEE_MAX, Math.floor(n));
}

type StaffSelectionLike = {
  enabled?: boolean;
  staff?: Array<{ id?: string; nomination_fee?: unknown } | null> | null;
} | null | undefined;

/** そのスタッフを指名したときの指名料（スタッフ選択が OFF・「指名なし」・見つからないときは 0） */
export function staffNominationFee(staffSelection: StaffSelectionLike, staffId: string | null | undefined): number {
  if (!staffSelection || staffSelection.enabled !== true || !staffId || staffId === 'none') return 0;
  const member = (staffSelection.staff || []).find((m) => !!m && m.id === staffId);
  return member ? sanitizeNominationFee(member.nomination_fee) : 0;
}

/** スタッフのボタン・編集画面に出す表記（例: ＋500円）。0 なら空文字 */
export function formatNominationFee(fee: unknown): string {
  const n = sanitizeNominationFee(fee);
  return n > 0 ? `＋${n.toLocaleString('ja-JP')}円` : '';
}

/** 予約に記録されている指名料（無ければ 0） */
export function reservationNominationFee(reservation: { customer_info?: unknown } | null | undefined): number {
  const info = reservation?.customer_info;
  if (!info || typeof info !== 'object' || Array.isArray(info)) return 0;
  return sanitizeNominationFee((info as Record<string, unknown>).nomination_fee);
}

/**
 * 予約の受付時: フォームから送られてきた指名料をフォーム設定で確かめ直して `customer_info` に入れ直す。
 * - フォームが指名料を送ってきていない（お客様に見せていない = 保存＆デプロイ前の HTML）ときは足さない
 * - 指名していない / そのスタッフに指名料の設定が無いときは消す
 * - 金額は設定の値を正とし、送られてきた金額と違えば合計金額もその差だけ直す
 */
export function applyNominationFeeToCustomerInfo(
  customerInfo: Record<string, unknown>,
  staffSelection: StaffSelectionLike,
  staffId: string | null | undefined
): number {
  const claimed = sanitizeNominationFee(customerInfo.nomination_fee);
  const configured = staffNominationFee(staffSelection, staffId);
  const fee = claimed > 0 ? configured : 0;
  if (claimed !== fee) {
    const total = Number(customerInfo.total_price);
    if (Number.isFinite(total)) customerInfo.total_price = Math.max(0, total - claimed + fee);
  }
  if (fee > 0) customerInfo.nomination_fee = fee;
  else delete customerInfo.nomination_fee;
  return fee;
}
