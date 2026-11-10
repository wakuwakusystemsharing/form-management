/**
 * LINE メッセージの「分岐」（ボタンを押したら次のメッセージを返す）の純粋ロジック
 *
 * 作るとき（保存前の内容）: ボタンのリンク先に、URL の代わりに次の 2 つの書き方を使う
 *   - `next:{メッセージID}?tags=タグ1,タグ2` … 押したら保存済みの別の LINE メッセージを返す（くわしくモード）
 *   - `choice:{選択肢のキー}`             … 分岐アンケート（かんたんモード）の選択肢
 * 保存するとき: `instrumentFlexBranches` がこれらを LINE の postback ボタン（data = `lf:{メッセージID}:{キー}`）に置き換え、
 *   「キー → 何を選んだか・タグ・次に返すもの」の対応表（branches）を作る
 * 押されたとき: Webhook が postback の data から対応表を引く
 */
import type { FlexContainer, LineFlexBranch } from '@/types/line-flex';

export const NEXT_LINK_PREFIX = 'next:';
export const CHOICE_LINK_PREFIX = 'choice:';
export const POSTBACK_PREFIX = 'lf:';
/** ボタン 1 つに付けられるタグの数 */
export const BRANCH_TAGS_MAX = 5;
const TAG_MAX_LEN = 30;
const ID_PATTERN = /^[a-z0-9]{12}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function normalizeBranchTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,、，\n]/) : [];
  const out: string[] = [];
  for (const v of list) {
    const t = typeof v === 'string' ? v.trim().slice(0, TAG_MAX_LEN) : '';
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length >= BRANCH_TAGS_MAX) break;
  }
  return out;
}

/** 「次のメッセージを送る」ボタンのリンク先の書き方 */
export function nextLink(messageId: string, tags: string[] = []): string {
  const t = normalizeBranchTags(tags);
  return `${NEXT_LINK_PREFIX}${messageId}${t.length > 0 ? `?tags=${t.map(encodeURIComponent).join(',')}` : ''}`;
}

export function parseNextLink(uri: unknown): { messageId: string; tags: string[] } | null {
  if (typeof uri !== 'string' || !uri.startsWith(NEXT_LINK_PREFIX)) return null;
  const rest = uri.slice(NEXT_LINK_PREFIX.length).trim();
  const [id, query = ''] = rest.split('?');
  if (!ID_PATTERN.test(id)) return null;
  const m = /(?:^|&)tags=([^&]*)/.exec(query);
  const tags = m
    ? m[1].split(',').map((x) => {
        try {
          return decodeURIComponent(x);
        } catch {
          return x;
        }
      })
    : [];
  return { messageId: id, tags: normalizeBranchTags(tags) };
}

export function choiceLink(choiceKey: string): string {
  return `${CHOICE_LINK_PREFIX}${choiceKey}`;
}
export function parseChoiceLink(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith(CHOICE_LINK_PREFIX)) return null;
  const key = uri.slice(CHOICE_LINK_PREFIX.length).trim();
  return KEY_PATTERN.test(key) ? key : null;
}

/** ボタンのリンク先が分岐（URL ではない）か */
export function isBranchLink(uri: unknown): boolean {
  return parseNextLink(uri) !== null || parseChoiceLink(uri) !== null;
}

export function buildPostbackData(messageId: string, key: string): string {
  return `${POSTBACK_PREFIX}${messageId}:${key}`;
}
export function parsePostbackData(data: unknown): { messageId: string; key: string } | null {
  if (typeof data !== 'string' || !data.startsWith(POSTBACK_PREFIX)) return null;
  const [messageId, key, ...extra] = data.slice(POSTBACK_PREFIX.length).split(':');
  if (extra.length > 0 || !ID_PATTERN.test(messageId ?? '') || !KEY_PATTERN.test(key ?? '')) return null;
  return { messageId, key };
}

export interface InstrumentBranchOptions {
  /** 押したとき、お客様のトークにボタンの文言を表示する */
  showText: boolean;
  /** 分岐アンケートの選択肢（選択肢のキー → 対応）。`choice:{キー}` のボタンに使う */
  choices?: Record<string, LineFlexBranch>;
  /** `next:` のボタンに振る番号の開始（この次から。b1, b2, …） */
  startIndex?: number;
}

/**
 * contents の中の分岐ボタン（uri が `next:` / `choice:`）を postback ボタンに置き換える。
 * 戻り値の branches = この contents に含まれるボタンの対応表、nextIndex = 次に使う番号
 */
export function instrumentFlexBranches(
  contents: FlexContainer,
  messageId: string,
  options: InstrumentBranchOptions
): { contents: FlexContainer; branches: Record<string, LineFlexBranch>; nextIndex: number } {
  const cloned = JSON.parse(JSON.stringify(contents)) as FlexContainer;
  const branches: Record<string, LineFlexBranch> = {};
  let n = options.startIndex ?? 0;
  const toPostback = (obj: Record<string, unknown>, key: string, label: string) => {
    delete obj.uri;
    delete obj.altUri;
    obj.type = 'postback';
    obj.data = buildPostbackData(messageId, key);
    if (options.showText && label) obj.displayText = label.slice(0, 300);
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.type === 'uri' && typeof obj.uri === 'string') {
      const label = typeof obj.label === 'string' ? obj.label.trim() : '';
      const next = parseNextLink(obj.uri);
      const choiceKey = next ? null : parseChoiceLink(obj.uri);
      if (next) {
        n += 1;
        const key = `b${n}`;
        branches[key] = { label, question: '', tags: next.tags, next: { type: 'message', id: next.messageId } };
        toPostback(obj, key, label);
      } else if (choiceKey) {
        const def = options.choices?.[choiceKey];
        // 見た目を自由編集で変えていても、押したボタンの文言を記録に使う
        if (def) branches[choiceKey] = { ...def, label: label || def.label };
        toPostback(obj, choiceKey, label || def?.label || '');
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(cloned);
  return { contents: cloned, branches, nextIndex: n };
}

/** contents に分岐ボタン（保存前の書き方）が含まれるか */
export function hasBranchLinks(contents: unknown): boolean {
  let found = false;
  const walk = (node: unknown) => {
    if (found) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.type === 'uri' && isBranchLink(obj.uri)) {
      found = true;
      return;
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(contents);
  return found;
}

// ---------------------------------------------------------------------------
// 回答の集計
// ---------------------------------------------------------------------------

export interface LineFlexAnswerRow {
  id: string;
  store_id: string;
  message_id: string;
  button_key: string;
  question: string;
  label: string;
  line_user_id: string;
  created_at: string;
}

export interface BranchAnswerChoice {
  key: string;
  label: string;
  /** 押された回数 */
  taps: number;
  /** 押した人数（同じ人が何度押しても 1 人） */
  users: number;
  /** いまの設定には無い選択肢（過去の回答だけが残っている） */
  removed?: boolean;
}
export interface BranchAnswerSummary {
  /** 1 つでもボタンを押した人数 */
  respondents: number;
  /** 押された回数の合計 */
  taps: number;
  groups: Array<{ question: string; choices: BranchAnswerChoice[] }>;
}

/** 質問ごと（質問の無いボタンは 1 つのグループ）に、選択肢の回数・人数をまとめる。並びは対応表の順 */
export function summarizeBranchAnswers(branches: Record<string, LineFlexBranch>, rows: ReadonlyArray<Pick<LineFlexAnswerRow, 'button_key' | 'question' | 'label' | 'line_user_id'>>): BranchAnswerSummary {
  const stat = new Map<string, { taps: number; users: Set<string>; question: string; label: string }>();
  const everyone = new Set<string>();
  for (const r of rows) {
    const s = stat.get(r.button_key) ?? { taps: 0, users: new Set<string>(), question: r.question ?? '', label: r.label ?? '' };
    s.taps += 1;
    if (r.line_user_id) {
      s.users.add(r.line_user_id);
      everyone.add(r.line_user_id);
    }
    stat.set(r.button_key, s);
  }
  const groups: BranchAnswerSummary['groups'] = [];
  const groupOf = (question: string) => {
    let g = groups.find((x) => x.question === question);
    if (!g) {
      g = { question, choices: [] };
      groups.push(g);
    }
    return g;
  };
  for (const [key, b] of Object.entries(branches)) {
    const s = stat.get(key);
    groupOf(b.question ?? '').choices.push({ key, label: b.label, taps: s?.taps ?? 0, users: s?.users.size ?? 0 });
  }
  for (const [key, s] of stat) {
    if (branches[key]) continue;
    groupOf(s.question).choices.push({ key, label: s.label || '（削除された選択肢）', taps: s.taps, users: s.users.size, removed: true });
  }
  return { respondents: everyone.size, taps: rows.length, groups };
}
