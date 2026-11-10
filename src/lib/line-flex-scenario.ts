/**
 * 分岐アンケート（かんたんモード。テンプレート `scenario`）の純粋ロジック
 *
 * 入力値は木の形: 質問 → 選択肢 → 選んだら（次の質問 / 結果 / 保存済みの LINE メッセージ / 何もしない）
 * - 最初の質問のカードが、このメッセージの Flex 本体になる
 * - 2 問目以降・結果のカードは「ノード」として保存時に送信用メッセージを作っておき、ボタンが押されたら Webhook が返す
 * - 選択肢のボタンのリンク先は `choice:{選択肢のキー}`（保存時に postback に置き換える。src/lib/line-flex-branch.ts）
 */
import type { FlexButtonInput, FlexContainer, LineFlexBranch, ScenarioChoice, ScenarioData, ScenarioNext, ScenarioQuestion, ScenarioResult } from '@/types/line-flex';
import { choiceLink, isBranchLink, normalizeBranchTags } from '@/lib/line-flex-branch';

export const SCENARIO_CHOICES_MAX = 6;
/** 質問を重ねられる深さ（最初の質問を 1 と数える） */
export const SCENARIO_DEPTH_MAX = 5;
/** 質問 + 結果の合計 */
export const SCENARIO_NODES_MAX = 40;
const DEFAULT_COLOR = '#06C755';
const TEXT_DARK = '#222222';
const TEXT_MUTED = '#666666';

const trim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const accentOf = (v: unknown): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : DEFAULT_COLOR);
const isHttps = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/\S+$/i.test(v.trim());
const isButtonLink = (v: string): boolean => /^https:\/\/\S+$/i.test(v) || /^tel:[0-9+\-()]+$/i.test(v) || isBranchLink(v);

function newKey(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function newScenarioChoice(label = ''): ScenarioChoice {
  return { key: `c${newKey()}`, label, tags: [], then: { type: 'none' } };
}
export function newScenarioQuestion(): ScenarioQuestion {
  return { key: `q${newKey()}`, title: '', text: '', image_url: '', choices: [newScenarioChoice(), newScenarioChoice()] };
}
export function newScenarioResult(): ScenarioResult {
  return { key: `r${newKey()}`, title: '', text: '', image_url: '', button: null };
}

export function defaultScenarioData(accent?: string): ScenarioData {
  return {
    color: accentOf(accent),
    root: {
      key: 'q0',
      title: 'どのメニューに興味がありますか？',
      text: '当てはまるものを選んでください。',
      image_url: '',
      choices: [
        { key: 'c1', label: 'カット', tags: [], then: { type: 'result', result: { key: 'r1', title: 'カットのご案内', text: 'ご希望に合わせてご提案します。ご予約は下のボタンからどうぞ。', image_url: '', button: { key: 'b1', label: '予約する', url: '' } } } },
        { key: 'c2', label: 'カラー', tags: [], then: { type: 'result', result: { key: 'r2', title: 'カラーのご案内', text: '髪の状態に合わせた薬剤をお選びします。ご予約は下のボタンからどうぞ。', image_url: '', button: { key: 'b1', label: '予約する', url: '' } } } },
      ],
    },
  };
}

function hero(url: unknown): Record<string, unknown> | null {
  return isHttps(url) ? { type: 'image', url: url.trim(), size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } : null;
}

function bodyOf(title: string, text: string): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [];
  if (title) contents.push({ type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true, color: TEXT_DARK });
  if (text) contents.push({ type: 'text', text, size: 'sm', wrap: true, color: TEXT_MUTED, ...(title ? { margin: 'md' } : {}) });
  if (contents.length === 0) contents.push({ type: 'text', text: ' ', size: 'sm' });
  return { type: 'box', layout: 'vertical', paddingAll: '20px', contents };
}

/** 質問のカード（選択肢 = ボタン）。文言のある選択肢が無ければ null */
export function buildScenarioQuestionFlex(question: ScenarioQuestion | null | undefined, accent?: string): FlexContainer | null {
  if (!question) return null;
  const title = trim(question.title);
  const text = trim(question.text);
  const color = accentOf(accent);
  const buttons = (question.choices ?? [])
    .slice(0, SCENARIO_CHOICES_MAX)
    .filter((c) => trim(c.label))
    .map((c) => ({ type: 'button', style: 'primary', height: 'sm', color, action: { type: 'uri', label: trim(c.label).slice(0, 40), uri: choiceLink(c.key) } }));
  if (!title && !text && buttons.length === 0) return null;
  const image = hero(question.image_url);
  return {
    type: 'bubble',
    ...(image ? { hero: image } : {}),
    body: bodyOf(title, text),
    ...(buttons.length > 0 ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: buttons } } : {}),
  };
}

/** 結果のカード（見出し・説明・画像・ボタン 1 つ）。見出しも説明も無ければ null */
export function buildScenarioResultFlex(result: ScenarioResult | null | undefined, accent?: string): FlexContainer | null {
  if (!result) return null;
  const title = trim(result.title);
  const text = trim(result.text);
  if (!title && !text) return null;
  const color = accentOf(accent);
  const btn: FlexButtonInput | null | undefined = result.button;
  const label = trim(btn?.label).slice(0, 40);
  const url = trim(btn?.url);
  const button = label && isButtonLink(url) ? { type: 'button', style: 'primary', height: 'sm', color, action: { type: 'uri', label, uri: url } } : null;
  const image = hero(result.image_url);
  return {
    type: 'bubble',
    ...(image ? { hero: image } : {}),
    body: bodyOf(title, text),
    ...(button ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [button] } } : {}),
  };
}

/** Flex 本体 = 最初の質問のカード */
export function buildScenarioFlex(data: ScenarioData | null | undefined): FlexContainer | null {
  return buildScenarioQuestionFlex(data?.root, data?.color);
}

export type ScenarioNode =
  | { kind: 'question'; key: string; depth: number; question: ScenarioQuestion; via: ScenarioChoice | null }
  | { kind: 'result'; key: string; depth: number; result: ScenarioResult; via: ScenarioChoice };

/** 木のすべての質問・結果を、上から順（深さ優先）に並べる。最初の質問が先頭 */
export function listScenarioNodes(data: ScenarioData | null | undefined): ScenarioNode[] {
  const out: ScenarioNode[] = [];
  const walk = (q: ScenarioQuestion | null | undefined, depth: number, via: ScenarioChoice | null) => {
    if (!q || typeof q !== 'object') return;
    out.push({ kind: 'question', key: q.key, depth, question: q, via });
    for (const c of q.choices ?? []) {
      const then = c.then as ScenarioNext | undefined;
      if (then?.type === 'question') walk(then.question, depth + 1, c);
      else if (then?.type === 'result' && then.result) out.push({ kind: 'result', key: then.result.key, depth: depth + 1, result: then.result, via: c });
    }
  };
  walk(data?.root, 1, null);
  return out;
}

export function findScenarioNode(data: ScenarioData | null | undefined, key: string): ScenarioNode | null {
  return listScenarioNodes(data).find((n) => n.key === key) ?? null;
}

/** ノードのカード（質問 / 結果） */
export function buildScenarioNodeFlex(data: ScenarioData | null | undefined, key: string): FlexContainer | null {
  const node = findScenarioNode(data, key);
  if (!node) return null;
  return node.kind === 'question' ? buildScenarioQuestionFlex(node.question, data?.color) : buildScenarioResultFlex(node.result, data?.color);
}

/** 選択肢のキー → 対応（何を選んだか・タグ・次に返すもの） */
export function collectScenarioChoices(data: ScenarioData | null | undefined): Record<string, LineFlexBranch> {
  const out: Record<string, LineFlexBranch> = {};
  for (const node of listScenarioNodes(data)) {
    if (node.kind !== 'question') continue;
    for (const c of (node.question.choices ?? []).slice(0, SCENARIO_CHOICES_MAX)) {
      const label = trim(c.label);
      if (!label) continue;
      const then = c.then as ScenarioNext | undefined;
      let next: LineFlexBranch['next'] = { type: 'none' };
      if (then?.type === 'question' && then.question) next = { type: 'node', key: then.question.key };
      else if (then?.type === 'result' && then.result) next = { type: 'node', key: then.result.key };
      else if (then?.type === 'message' && then.message_id) next = { type: 'message', id: then.message_id };
      out[c.key] = { label, question: trim(node.question.title), tags: normalizeBranchTags(c.tags), next };
    }
  }
  return out;
}

/** 保存前の検証。問題が無ければ null。`existingIds` = 同じ店舗の保存済みメッセージの ID（省略時は存在を確かめない） */
export function validateScenario(data: ScenarioData | null | undefined, existingIds?: ReadonlySet<string>): string | null {
  if (!data || typeof data !== 'object' || !data.root) return '最初の質問を入力してください';
  const nodes = listScenarioNodes(data);
  if (nodes.length > SCENARIO_NODES_MAX) return `質問と結果は合わせて ${SCENARIO_NODES_MAX} 個までです`;
  const keys = new Set<string>();
  for (const node of nodes) {
    if (!node.key || keys.has(node.key)) return '質問・結果の識別子が重複しています。作り直してください';
    keys.add(node.key);
    if (node.kind === 'question') {
      const q = node.question;
      const name = trim(q.title) || '（無題の質問）';
      if (!trim(q.title)) return node.depth === 1 ? '最初の質問文を入力してください' : `「${trim(node.via?.label) || '選択肢'}」の次の質問文を入力してください`;
      if (node.depth > SCENARIO_DEPTH_MAX) return `質問を重ねられるのは ${SCENARIO_DEPTH_MAX} 段までです`;
      const choices = q.choices ?? [];
      if (choices.length === 0) return `「${name}」に選択肢を 1 つ以上入れてください`;
      if (choices.length > SCENARIO_CHOICES_MAX) return `「${name}」の選択肢は ${SCENARIO_CHOICES_MAX} 個までです`;
      const choiceKeys = new Set<string>();
      for (const c of choices) {
        if (!trim(c.label)) return `「${name}」の選択肢の文言を入力してください`;
        if (!c.key || choiceKeys.has(c.key) || keys.has(`choice:${c.key}`)) return '選択肢の識別子が重複しています。作り直してください';
        choiceKeys.add(c.key);
        keys.add(`choice:${c.key}`);
        const then = c.then as ScenarioNext | undefined;
        if (then?.type === 'message') {
          if (!then.message_id) return `「${trim(c.label)}」を選んだあとに送る LINE メッセージを選んでください`;
          if (existingIds && !existingIds.has(then.message_id)) return `「${trim(c.label)}」を選んだあとに送る LINE メッセージが見つかりません`;
        }
      }
    } else if (!trim(node.result.title) && !trim(node.result.text)) {
      return `「${trim(node.via.label) || '選択肢'}」を選んだあとの結果に、見出しか説明を入力してください`;
    }
  }
  return null;
}

/** 質問・結果・選択肢の数（一覧の表示用） */
export function describeScenario(data: ScenarioData | null | undefined): string {
  const nodes = listScenarioNodes(data);
  const questions = nodes.filter((n) => n.kind === 'question').length;
  const results = nodes.filter((n) => n.kind === 'result').length;
  return `質問 ${questions} ・ 結果 ${results}`;
}

// ---------------------------------------------------------------------------
// 編集（元の値は変えない）
// ---------------------------------------------------------------------------

/** 木の中の質問（キーで指定）を書き換える */
export function updateScenarioQuestion(data: ScenarioData, key: string, fn: (q: ScenarioQuestion) => ScenarioQuestion): ScenarioData {
  const walk = (q: ScenarioQuestion): ScenarioQuestion => {
    if (q.key === key) return fn(q);
    return {
      ...q,
      choices: (q.choices ?? []).map((c) => (c.then?.type === 'question' && c.then.question ? { ...c, then: { type: 'question' as const, question: walk(c.then.question) } } : c)),
    };
  };
  return { ...data, root: walk(data.root) };
}

/** 木の中の結果（キーで指定）を書き換える */
export function updateScenarioResult(data: ScenarioData, key: string, fn: (r: ScenarioResult) => ScenarioResult): ScenarioData {
  const walk = (q: ScenarioQuestion): ScenarioQuestion => ({
    ...q,
    choices: (q.choices ?? []).map((c) => {
      if (c.then?.type === 'result' && c.then.result?.key === key) return { ...c, then: { type: 'result' as const, result: fn(c.then.result) } };
      if (c.then?.type === 'question' && c.then.question) return { ...c, then: { type: 'question' as const, question: walk(c.then.question) } };
      return c;
    }),
  });
  return { ...data, root: walk(data.root) };
}
