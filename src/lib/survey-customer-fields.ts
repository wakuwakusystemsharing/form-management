/**
 * アンケートの回答を、顧客情報の項目に入れるための純粋ロジック（クライアント / サーバー共用）
 *
 * - 質問ごとに「顧客情報のどこに入れるか」を選ぶ（`SurveyQuestion.customer_field`）
 * - 何も選んでいない質問でも、回答タイプが「誕生日選択」「住所入力」なら自動で 誕生日 / 住所 に入れる
 *   （止めたいときは「反映しない」= target: 'none' を選ぶ）
 * - 既定は「顧客の項目が空のときだけ入れる」。質問ごとに「毎回上書きする」も選べる
 * - メモだけは上書きせず、「質問名: 回答」の 1 行を足す（店舗が書いたメモを消さないため）
 * - 対象はいちばん上の質問だけ（選択肢の追加質問は対象外）
 */
import type { SurveyConfig, SurveyQuestion, SurveyQuestionType } from '@/types/survey';

export type SurveyCustomerFieldTarget =
  | 'name'
  | 'name_kana'
  | 'phone'
  | 'email'
  | 'birthday'
  | 'gender'
  | 'address'
  | 'allergies'
  | 'medical_history'
  | 'notes';

export interface SurveyCustomerFieldLink {
  /** 'none' = 反映しない（誕生日選択・住所入力の自動の反映を止める） */
  target: SurveyCustomerFieldTarget | 'none';
  /** true = すでに入っていても毎回上書きする（未設定 = 空のときだけ入れる）。メモでは使わない */
  overwrite?: boolean;
}

export interface SurveyCustomerFieldOption {
  value: SurveyCustomerFieldTarget;
  label: string;
  /** 要配慮個人情報（アレルギー・既往歴）。編集画面で同意の注意書きを出す */
  sensitive?: boolean;
}

export const SURVEY_CUSTOMER_FIELD_OPTIONS: SurveyCustomerFieldOption[] = [
  { value: 'name', label: 'お名前' },
  { value: 'name_kana', label: 'フリガナ' },
  { value: 'phone', label: '電話番号' },
  { value: 'email', label: 'メールアドレス' },
  { value: 'birthday', label: '誕生日' },
  { value: 'gender', label: '性別' },
  { value: 'address', label: '住所' },
  { value: 'allergies', label: 'アレルギー', sensitive: true },
  { value: 'medical_history', label: '既往歴・注意事項', sensitive: true },
  { value: 'notes', label: 'メモ（1 行ずつ足す）' },
];

const TARGETS = new Set<string>(SURVEY_CUSTOMER_FIELD_OPTIONS.map((o) => o.value));

const TARGETS_BY_TYPE: Record<SurveyQuestionType, SurveyCustomerFieldTarget[]> = {
  text: ['name', 'name_kana', 'phone', 'email', 'birthday', 'address', 'allergies', 'medical_history', 'notes'],
  textarea: ['address', 'allergies', 'medical_history', 'notes'],
  radio: ['gender', 'allergies', 'medical_history', 'notes'],
  select: ['gender', 'allergies', 'medical_history', 'notes'],
  checkbox: ['allergies', 'medical_history', 'notes'],
  date: ['birthday'],
  birthday: ['birthday'],
  address: ['address'],
  datetime: [],
  multiple_dates: [],
};

/** その回答タイプの質問で選べる入れ先 */
export function customerFieldTargetsFor(type: SurveyQuestionType | string | undefined): SurveyCustomerFieldTarget[] {
  return TARGETS_BY_TYPE[type as SurveyQuestionType] ?? [];
}

/** 何も選んでいないときに自動で入れる先（誕生日選択 → 誕生日 / 住所入力 → 住所） */
export function autoCustomerFieldTarget(type: SurveyQuestionType | string | undefined): SurveyCustomerFieldTarget | null {
  if (type === 'birthday') return 'birthday';
  if (type === 'address') return 'address';
  return null;
}

export function customerFieldLabel(target: SurveyCustomerFieldTarget): string {
  return SURVEY_CUSTOMER_FIELD_OPTIONS.find((o) => o.value === target)?.label ?? target;
}

export function isSensitiveCustomerField(target: string | null | undefined): boolean {
  return SURVEY_CUSTOMER_FIELD_OPTIONS.some((o) => o.value === target && o.sensitive === true);
}

export interface ResolvedCustomerFieldLink {
  target: SurveyCustomerFieldTarget;
  overwrite: boolean;
  /** 設定ではなく、回答タイプから自動で決まった */
  auto: boolean;
}

/** その質問の回答を入れる先（入れないときは null）。回答タイプに合わない入れ先は無視する */
export function resolveCustomerFieldLink(q: Pick<SurveyQuestion, 'type'> & { customer_field?: SurveyCustomerFieldLink | null }): ResolvedCustomerFieldLink | null {
  const link = q.customer_field;
  const allowed = customerFieldTargetsFor(q.type);
  if (link && typeof link === 'object') {
    if (link.target === 'none') return null;
    if (TARGETS.has(link.target) && allowed.includes(link.target as SurveyCustomerFieldTarget)) {
      const target = link.target as SurveyCustomerFieldTarget;
      return { target, overwrite: target !== 'notes' && link.overwrite === true, auto: false };
    }
  }
  const auto = autoCustomerFieldTarget(q.type);
  return auto ? { target: auto, overwrite: false, auto: true } : null;
}

/** 保存する形に整える（未設定・回答タイプに合わない入れ先は undefined = キーを持たない） */
export function sanitizeCustomerFieldLink(type: SurveyQuestionType | string | undefined, raw: unknown): SurveyCustomerFieldLink | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { target?: unknown; overwrite?: unknown };
  if (r.target === 'none') return autoCustomerFieldTarget(type) ? { target: 'none' } : undefined;
  if (typeof r.target !== 'string' || !TARGETS.has(r.target)) return undefined;
  const target = r.target as SurveyCustomerFieldTarget;
  if (!customerFieldTargetsFor(type).includes(target)) return undefined;
  return target !== 'notes' && r.overwrite === true ? { target, overwrite: true } : { target };
}

// ---- 回答 → 顧客の項目の値 ----

const LIMITS: Record<SurveyCustomerFieldTarget, number> = {
  name: 100,
  name_kana: 100,
  phone: 20,
  email: 254,
  birthday: 10,
  gender: 10,
  address: 300,
  allergies: 500,
  medical_history: 1000,
  notes: 1000,
};

export const CUSTOMER_NOTES_MAX = 5000;

/** 全角の英数字・記号を半角にする */
function toHalfWidth(text: string): string {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
}

function answerText(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
  if (typeof raw === 'object') return '';
  return String(raw).trim();
}

function jstToday(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseBirthday(text: string, now: Date): string | null {
  const m = toHalfWidth(text).match(/^\s*(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return null;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > lastDay) return null;
  const value = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return value > jstToday(now) ? null : value;
}

function parseGender(text: string): string | null {
  const t = toHalfWidth(text).toLowerCase();
  if (/^(男|男性|male|man|メンズ)/.test(t)) return 'male';
  if (/^(女|女性|female|woman|レディース)/.test(t)) return 'female';
  if (/^(その他|other)/.test(t)) return 'other';
  return null;
}

function parsePhone(text: string): string | null {
  const t = toHalfWidth(text).replace(/[‐‑‒–—―ー−]/g, '-').replace(/\s+/g, '');
  if (!/^\+?[\d-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '').length;
  return digits >= 10 && digits <= 13 ? t : null;
}

function parseEmail(text: string): string | null {
  const t = toHalfWidth(text).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null;
}

/** 回答を、顧客のその項目に入れる値に直す。入れられない回答（空・形がおかしい）は null */
export function convertAnswerForCustomerField(target: SurveyCustomerFieldTarget, raw: unknown, now: Date = new Date()): string | null {
  const text = answerText(raw);
  if (!text || text === '未記入') return null;
  let value: string | null;
  switch (target) {
    case 'birthday':
      value = parseBirthday(text, now);
      break;
    case 'gender':
      value = parseGender(text);
      break;
    case 'phone':
      value = parsePhone(text);
      break;
    case 'email':
      value = parseEmail(text);
      break;
    default:
      value = text;
  }
  if (!value) return null;
  return value.length > LIMITS[target] ? (target === 'phone' || target === 'email' ? null : value.slice(0, LIMITS[target])) : value;
}

export interface SurveyCustomerFieldValue {
  target: SurveyCustomerFieldTarget;
  value: string;
  overwrite: boolean;
  /** 質問の文言（メモに足す行の見出しに使う） */
  title: string;
}

/**
 * アンケートの設定と回答から、顧客に入れる値を集める。
 * 同じ入れ先の質問が複数あるときは、上にある質問の（入れられる）回答を使う。メモだけは全部を足す
 */
export function collectSurveyCustomerFieldValues(config: Pick<SurveyConfig, 'questions'> | null | undefined, responses: Record<string, unknown> | null | undefined, now: Date = new Date()): SurveyCustomerFieldValue[] {
  const questions = Array.isArray(config?.questions) ? config!.questions : [];
  if (!responses || typeof responses !== 'object') return [];
  const out: SurveyCustomerFieldValue[] = [];
  const used = new Set<SurveyCustomerFieldTarget>();
  for (const q of questions) {
    if (!q || typeof q.title !== 'string') continue;
    const link = resolveCustomerFieldLink(q);
    if (!link) continue;
    if (link.target !== 'notes' && used.has(link.target)) continue;
    if (!Object.prototype.hasOwnProperty.call(responses, q.title)) continue;
    const value = convertAnswerForCustomerField(link.target, responses[q.title], now);
    if (!value) continue;
    used.add(link.target);
    out.push({ target: link.target, value, overwrite: link.overwrite, title: q.title.trim() });
  }
  return out;
}

// ---- 顧客に入れる内容 ----

export interface CustomerFieldSnapshot {
  name?: string | null;
  name_kana?: string | null;
  phone?: string | null;
  email?: string | null;
  birthday?: string | null;
  gender?: string | null;
  address?: string | null;
  allergies?: string | null;
  medical_history?: string | null;
  notes?: string | null;
  line_display_name?: string | null;
  line_friend_only?: boolean | null;
}

/** お名前が「まだ本当の名前ではない」（未記入・LINE の表示名のまま・友だちだけの顧客） */
export function isPlaceholderCustomerName(c: CustomerFieldSnapshot): boolean {
  const name = (c.name ?? '').trim();
  if (!name || name === '未記入' || name === 'LINE 友だち') return true;
  if (c.line_friend_only === true) return true;
  return !!c.line_display_name && name === c.line_display_name.trim();
}

function isEmptyField(c: CustomerFieldSnapshot, target: SurveyCustomerFieldTarget): boolean {
  if (target === 'name') return isPlaceholderCustomerName(c);
  const v = c[target];
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || (target === 'gender' && s === 'unknown') || (target === 'phone' && s === '未記入');
}

/**
 * いまの顧客に対して、書き換える項目だけを返す（変わらないときは {}）。
 * 空のときだけ入れる / 上書き / メモは 1 行足す。友だちだけの顧客は、何か入ったら通常の顧客にする
 */
export function buildCustomerFieldPatch(customer: CustomerFieldSnapshot, values: SurveyCustomerFieldValue[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  let notes = typeof customer.notes === 'string' ? customer.notes : '';
  let notesChanged = false;
  for (const v of values) {
    if (v.target === 'notes') {
      const line = v.title ? `${v.title}: ${v.value}` : v.value;
      if (notes.split('\n').some((l) => l.trim() === line)) continue;
      const next = notes.trim() ? `${notes.replace(/\s+$/, '')}\n${line}` : line;
      if (next.length > CUSTOMER_NOTES_MAX) continue;
      notes = next;
      notesChanged = true;
      continue;
    }
    if (v.target in patch) continue;
    if (!v.overwrite && !isEmptyField(customer, v.target)) continue;
    if (String(customer[v.target] ?? '') === v.value) continue;
    patch[v.target] = v.value;
  }
  if (notesChanged) patch.notes = notes;
  if (customer.line_friend_only === true && Object.keys(patch).length > 0) patch.line_friend_only = false;
  return patch;
}

/** 顧客がまだ居ない回答者を、顧客として登録する行 */
export function buildCustomerRowFromSurvey(params: { storeId: string; lineUserId: string; lineDisplayName?: string | null; lineFriend?: boolean; values: SurveyCustomerFieldValue[] }): Record<string, unknown> {
  const displayName = (params.lineDisplayName ?? '').trim() || null;
  const patch = buildCustomerFieldPatch({ line_display_name: displayName }, params.values);
  return {
    store_id: params.storeId,
    line_user_id: params.lineUserId,
    name: displayName || 'LINE 友だち',
    line_display_name: displayName,
    line_friend_flag: params.lineFriend === true,
    customer_type: 'new',
    tags: [],
    ...patch,
  };
}
