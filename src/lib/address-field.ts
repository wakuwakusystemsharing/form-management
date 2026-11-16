/**
 * 回答タイプ「住所入力」の純粋ロジック。
 *
 * フォーム上は 4 欄（郵便番号 / 都道府県・市区町村・町名（自動入力）/ 番地・号 / 建物名・部屋番号（任意））で入力し、
 * 回答は 1 つの文字列「〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101」にまとめて保存する。
 *
 * 静的 HTML に埋め込む JS（`address-field-runtime-js.ts` の `adCompose` / `adParse` など）と同じ実装を持つ。
 * **直すときは両方**（Vitest で一致を検証）。
 */

export interface AddressParts {
  /** 郵便番号（入力されたまま。ハイフン・全角数字を含んでよい） */
  zip: string;
  /** 都道府県・市区町村・町名 */
  town: string;
  /** 番地・号 */
  street: string;
  /** 建物名・部屋番号（任意） */
  building: string;
}

/** 全角数字 → 半角数字 */
export function toHalfWidthDigits(text: string): string {
  return String(text || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 郵便番号から数字だけを取り出す（全角数字・ハイフン・空白を許容） */
export function zipDigits(text: string): string {
  return toHalfWidthDigits(text).replace(/[^0-9]/g, '');
}

/** 7 桁の数字 → "150-0001"（7 桁でなければそのまま返す） */
export function formatZip(digits: string): string {
  return digits.length === 7 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
}

/** 空白（半角 / 全角）をすべて取り除く */
function stripSpaces(text: string): string {
  return String(text || '').replace(/[ 　]+/g, '').trim();
}

/** 連続する空白（半角 / 全角）を半角 1 つにまとめ、前後を削る */
function collapseSpaces(text: string): string {
  return String(text || '').replace(/[ 　]+/g, ' ').trim();
}

/**
 * 4 欄の入力から回答の文字列を作る。
 * 郵便番号（7 桁）・町名まで・番地 の 3 つが揃っていなければ空文字（= 未入力扱い。必須チェックに掛かる）
 */
export function composeAddress(parts: Partial<AddressParts>): string {
  const digits = zipDigits(parts.zip || '');
  const town = stripSpaces(parts.town || '');
  const street = stripSpaces(parts.street || '');
  const building = collapseSpaces(parts.building || '');
  if (digits.length !== 7 || !town || !street) return '';
  return `〒${formatZip(digits)} ${town}${street}${building ? ` ${building}` : ''}`;
}

/** 番地・号の部分（末尾の「数字で始まり、数字・英字・ハイフン類・丁目 / 番地 / 号 だけが続く」並び） */
const STREET_SUFFIX = /[0-9０-９][0-9０-９A-Za-z丁目番地号のノ‐－−ー-]*$/;

/**
 * 回答の文字列を 4 欄に分け直す（復元用）。`composeAddress` の結果でなければ null。
 * 町名と番地の境目は保存していないので、末尾の番地らしい並びで分ける
 * （分け方が元の入力と違っても、まとめ直した文字列は同じになる）。番地が見つからないときは street が空になる
 */
export function parseAddress(value: string): AddressParts | null {
  const m = /^〒([0-9]{3})-([0-9]{4}) (.+)$/.exec(String(value || '').trim());
  if (!m) return null;
  const rest = m[3];
  const sp = rest.indexOf(' ');
  const head = sp === -1 ? rest : rest.slice(0, sp);
  const building = sp === -1 ? '' : rest.slice(sp + 1).trim();
  const s = STREET_SUFFIX.exec(head);
  const street = s && s.index > 0 ? s[0] : '';
  const town = street ? head.slice(0, head.length - street.length) : head;
  return { zip: `${m[1]}-${m[2]}`, town, street, building };
}

/** zipcloud（https://zipcloud.ibsnet.co.jp/doc/api）の検索結果 1 件 → 「都道府県 + 市区町村 + 町名」 */
export function townFromZipcloudResult(result: { address1?: string | null; address2?: string | null; address3?: string | null } | null | undefined): string {
  if (!result) return '';
  return `${result.address1 || ''}${result.address2 || ''}${result.address3 || ''}`;
}
