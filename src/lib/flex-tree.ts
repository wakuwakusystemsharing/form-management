/**
 * Flex Message の contents（bubble / carousel の木構造）を、プレビュー上の操作で編集するための純粋ロジック
 *
 * パーツの住所（パス）は、contents のオブジェクトをたどるキーを "/" でつないだ文字列:
 *   ""                         … ルート（bubble か carousel）
 *   "contents/1"               … カルーセルの 2 枚目のカード（bubble）
 *   "body"                     … カード（単体の bubble）の本文ブロック
 *   "contents/1/body/contents/0" … 2 枚目のカードの本文の 1 つ目のパーツ
 * すべての関数は元のオブジェクトを変えず、新しいオブジェクトを返す（元に戻す / やり直すのため）
 */
import type { FlexContainer } from '@/types/line-flex';

export type FlexNode = Record<string, unknown>;
export type FlexPath = string;

export const FLEX_BLOCK_KEYS = ['header', 'hero', 'body', 'footer'] as const;
export const FLEX_CAROUSEL_MAX = 12;

export function splitPath(path: FlexPath): string[] {
  return path ? path.split('/') : [];
}
export function joinPath(parts: Array<string | number>): FlexPath {
  return parts.join('/');
}
export function childPath(parent: FlexPath, ...keys: Array<string | number>): FlexPath {
  return joinPath([...splitPath(parent), ...keys]);
}

function isObj(v: unknown): v is FlexNode {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** パスのパーツを取り出す（無ければ undefined） */
export function getAt(root: unknown, path: FlexPath): FlexNode | undefined {
  let cur: unknown = root;
  for (const key of splitPath(path)) {
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (isObj(cur)) cur = cur[key];
    else return undefined;
  }
  return isObj(cur) ? cur : undefined;
}

/** パスの位置を value に置き換えた新しいルートを返す（value が undefined ならキーを消す / 配列なら要素を抜く） */
function setAtParts(cur: unknown, parts: string[], value: unknown): unknown {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts;
  if (Array.isArray(cur)) {
    const i = Number(head);
    const next = [...cur];
    if (rest.length === 0 && value === undefined) next.splice(i, 1);
    else next[i] = setAtParts(cur[i], rest, value);
    return next;
  }
  const obj = isObj(cur) ? { ...cur } : {};
  if (rest.length === 0 && value === undefined) delete obj[head];
  else obj[head] = setAtParts(obj[head], rest, value);
  return obj;
}
export function setAt(root: FlexContainer, path: FlexPath, value: unknown): FlexContainer {
  return setAtParts(root, splitPath(path), value) as FlexContainer;
}

/** パーツの項目を上書きする。patch の値が undefined / null / '' の項目は消す（LINE は空文字の項目を受け付けないため） */
export function patchNode(root: FlexContainer, path: FlexPath, patch: Record<string, unknown>): FlexContainer {
  const node = getAt(root, path);
  if (!node) return root;
  const next: FlexNode = { ...node };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') delete next[k];
    else next[k] = v;
  }
  return setAt(root, path, next);
}

export interface FlexParentInfo {
  /** 並びを持つ親（box か carousel）のパス */
  containerPath: FlexPath;
  /** 親の contents の中での位置 */
  index: number;
  /** 兄弟の数 */
  count: number;
  /** 並ぶ向き。カルーセル / horizontal / baseline の箱 = 横 */
  axis: 'vertical' | 'horizontal';
}

/**
 * 並びの中のパーツ（".../contents/N"）なら親の情報を返す。
 * ルートや、カードのブロック（header / hero / body / footer）は並びの中に無いので null
 */
export function parentInfo(root: unknown, path: FlexPath): FlexParentInfo | null {
  const parts = splitPath(path);
  if (parts.length < 2 || parts[parts.length - 2] !== 'contents') return null;
  const containerPath = joinPath(parts.slice(0, -2));
  const container = getAt(root, containerPath);
  if (!container || !Array.isArray(container.contents)) return null;
  const index = Number(parts[parts.length - 1]);
  if (!Number.isInteger(index) || index < 0 || index >= container.contents.length) return null;
  const horizontal = container.type === 'carousel' || container.layout === 'horizontal' || container.layout === 'baseline';
  return { containerPath, index, count: container.contents.length, axis: horizontal ? 'horizontal' : 'vertical' };
}

/** 1 つ上のパーツのパス（カードのブロックの親はカード、並びの中のパーツの親は箱）。ルートは null */
export function parentPathOf(path: FlexPath): FlexPath | null {
  const parts = splitPath(path);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  if (/^\d+$/.test(last) && parts[parts.length - 2] === 'contents') return joinPath(parts.slice(0, -2));
  return joinPath(parts.slice(0, -1));
}

/** ルートから選択中のパーツまでの道筋（ルート → … → 自分） */
export function ancestorPaths(path: FlexPath): FlexPath[] {
  const out: FlexPath[] = [path];
  let cur: FlexPath | null = path;
  while ((cur = parentPathOf(cur)) !== null) out.unshift(cur);
  return out;
}

/** 並びの中で位置を変える（to = 移動後の位置）。動かせなければ null */
export function moveNodeTo(root: FlexContainer, path: FlexPath, to: number): { root: FlexContainer; path: FlexPath } | null {
  const info = parentInfo(root, path);
  if (!info) return null;
  const target = Math.max(0, Math.min(info.count - 1, to));
  if (target === info.index) return null;
  const container = getAt(root, info.containerPath) as FlexNode;
  const list = [...(container.contents as unknown[])];
  const [item] = list.splice(info.index, 1);
  list.splice(target, 0, item);
  return { root: setAt(root, childPath(info.containerPath, 'contents'), list), path: childPath(info.containerPath, 'contents', target) };
}

/** 1 つ前（-1）/ 後ろ（+1）へ動かす */
export function moveNode(root: FlexContainer, path: FlexPath, dir: -1 | 1): { root: FlexContainer; path: FlexPath } | null {
  const info = parentInfo(root, path);
  return info ? moveNodeTo(root, path, info.index + dir) : null;
}

/**
 * パーツを消す。消せないもの: ルート、カルーセルの最後の 1 枚、カードの本文（body）が唯一のブロックのとき。
 * カードのブロック（header / hero / footer）は消せる
 */
export function removeNode(root: FlexContainer, path: FlexPath): FlexContainer | null {
  if (!path) return null;
  const info = parentInfo(root, path);
  if (info) {
    const container = getAt(root, info.containerPath) as FlexNode;
    if (container.type === 'carousel' && info.count <= 1) return null;
    return setAt(root, path, undefined);
  }
  const parts = splitPath(path);
  const key = parts[parts.length - 1];
  if (!(FLEX_BLOCK_KEYS as readonly string[]).includes(key)) return null;
  const bubble = getAt(root, joinPath(parts.slice(0, -1)));
  if (!bubble) return null;
  const remaining = FLEX_BLOCK_KEYS.filter((k) => k !== key && isObj(bubble[k]));
  if (remaining.length === 0) return null; // 中身が空のカードは送れない
  return setAt(root, path, undefined);
}

/** すぐ後ろに複製する（並びの中のパーツだけ）。カルーセルは 12 枚まで */
export function duplicateNode(root: FlexContainer, path: FlexPath): { root: FlexContainer; path: FlexPath } | null {
  const info = parentInfo(root, path);
  const node = getAt(root, path);
  if (!info || !node) return null;
  const container = getAt(root, info.containerPath) as FlexNode;
  if (container.type === 'carousel' && info.count >= FLEX_CAROUSEL_MAX) return null;
  const list = [...(container.contents as unknown[])];
  list.splice(info.index + 1, 0, JSON.parse(JSON.stringify(node)));
  return { root: setAt(root, childPath(info.containerPath, 'contents'), list), path: childPath(info.containerPath, 'contents', info.index + 1) };
}

/** 箱（box）の末尾にパーツを足す */
export function appendChild(root: FlexContainer, boxPath: FlexPath, node: FlexNode): { root: FlexContainer; path: FlexPath } | null {
  const box = getAt(root, boxPath);
  if (!box || box.type !== 'box') return null;
  const list = Array.isArray(box.contents) ? [...box.contents] : [];
  list.push(node);
  return { root: setAt(root, childPath(boxPath, 'contents'), list), path: childPath(boxPath, 'contents', list.length - 1) };
}

/** 指定したパーツのすぐ後ろに足す（並びの中のパーツだけ） */
export function insertAfter(root: FlexContainer, path: FlexPath, node: FlexNode): { root: FlexContainer; path: FlexPath } | null {
  const info = parentInfo(root, path);
  if (!info) return null;
  const container = getAt(root, info.containerPath) as FlexNode;
  if (container.type === 'carousel') return null;
  const list = [...(container.contents as unknown[])];
  list.splice(info.index + 1, 0, node);
  return { root: setAt(root, childPath(info.containerPath, 'contents'), list), path: childPath(info.containerPath, 'contents', info.index + 1) };
}

/** パスが指すパーツを含むカード（bubble）のパス。ルートがカード 1 枚なら "" */
export function bubblePathOf(root: unknown, path: FlexPath): FlexPath | null {
  for (const p of ancestorPaths(path).reverse()) {
    if (getAt(root, p)?.type === 'bubble') return p;
  }
  return null;
}

/**
 * パーツを足す場所を決めて足す。
 * - 箱を選んでいる → その箱の中の末尾
 * - 並びの中のパーツを選んでいる → そのすぐ後ろ
 * - それ以外（カード・ブロック・未選択）→ 選択中（無ければ 1 枚目）のカードの本文の末尾。本文が無ければ作る
 */
export function addPart(root: FlexContainer, selected: FlexPath | null, node: FlexNode): { root: FlexContainer; path: FlexPath } | null {
  const sel = selected !== null ? getAt(root, selected) : undefined;
  if (selected !== null && sel) {
    if (sel.type === 'box') return appendChild(root, selected, node);
    const after = insertAfter(root, selected, node);
    if (after) return after;
  }
  let bubblePath = selected !== null && sel ? bubblePathOf(root, selected) : null;
  if (bubblePath === null) bubblePath = (root as FlexNode).type === 'carousel' ? 'contents/0' : '';
  const bubble = getAt(root, bubblePath);
  if (!bubble || bubble.type !== 'bubble') return null;
  const bodyPath = childPath(bubblePath, 'body');
  const withBody = isObj(bubble.body) ? root : setAt(root, bodyPath, { type: 'box', layout: 'vertical', contents: [], paddingAll: '20px' });
  return appendChild(withBody, bodyPath, node);
}

/**
 * カードを 1 枚足す（選択中のカードの後ろ。未選択なら末尾）。カード 1 枚だけのときはカルーセルに変える。
 * 新しいカードの大きさは既存のカードに合わせる（カルーセルは全カード同じ大きさが必要）
 */
export function addBubble(root: FlexContainer, selected: FlexPath | null, bubble?: FlexNode): { root: FlexContainer; path: FlexPath } | null {
  const r = root as FlexNode;
  const bubbles: FlexNode[] = r.type === 'carousel' && Array.isArray(r.contents) ? (r.contents as FlexNode[]) : [r];
  if (bubbles.length >= FLEX_CAROUSEL_MAX) return null;
  const size = typeof bubbles[0]?.size === 'string' ? (bubbles[0].size as string) : undefined;
  const fresh: FlexNode = bubble ?? newFlexPart('bubble');
  const sized = size ? { ...fresh, size } : fresh;
  let at = bubbles.length;
  if (selected !== null && r.type === 'carousel') {
    const bp = bubblePathOf(root, selected);
    const info = bp !== null ? parentInfo(root, bp) : null;
    if (info) at = info.index + 1;
  }
  const next = [...bubbles];
  next.splice(at, 0, sized);
  return { root: { type: 'carousel', contents: next } as FlexContainer, path: childPath('', 'contents', at) };
}

export type FlexPartKind = 'text' | 'image' | 'button' | 'separator' | 'box' | 'bubble';

/** 新しく足すパーツの初期値 */
export function newFlexPart(kind: FlexPartKind, opts: { url?: string; linkUrl?: string } = {}): FlexNode {
  switch (kind) {
    case 'text':
      return { type: 'text', text: 'テキスト', size: 'md', wrap: true, color: '#222222', margin: 'md' };
    case 'image':
      return { type: 'image', url: opts.url ?? '', size: 'full', aspectRatio: '20:13', aspectMode: 'cover' };
    case 'button':
      return { type: 'button', style: 'primary', height: 'sm', margin: 'md', action: { type: 'uri', label: 'ボタン', uri: opts.linkUrl || 'https://line.me' } };
    case 'separator':
      return { type: 'separator', margin: 'md', color: '#eeeeee' };
    case 'box':
      return {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        margin: 'md',
        contents: [
          { type: 'text', text: '左', size: 'sm', color: '#222222', flex: 1, wrap: true },
          { type: 'text', text: '右', size: 'sm', color: '#222222', flex: 0, align: 'end' },
        ],
      };
    default:
      return {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '20px',
          contents: [
            { type: 'text', text: 'タイトル', weight: 'bold', size: 'lg', wrap: true, color: '#222222' },
            { type: 'text', text: '説明文', size: 'sm', wrap: true, color: '#555555', margin: 'md' },
          ],
        },
      };
  }
}

/** パーツの種類の表示名（設定パネルの見出し・道筋に使う） */
export function describeFlexNode(node: FlexNode | undefined, path: FlexPath): string {
  if (!node) return '';
  const parts = splitPath(path);
  const last = parts[parts.length - 1];
  switch (node.type) {
    case 'carousel':
      return 'カルーセル';
    case 'bubble':
      return /^\d+$/.test(last ?? '') ? `カード ${Number(last) + 1}` : 'カード';
    case 'text':
      return '文字';
    case 'image':
      return '画像';
    case 'button':
      return 'ボタン';
    case 'separator':
      return '区切り線';
    case 'spacer':
    case 'filler':
      return '余白';
    case 'icon':
      return 'アイコン';
    case 'video':
      return '動画';
    case 'box': {
      const block = last === 'header' ? 'ヘッダー' : last === 'hero' ? '上部の画像欄' : last === 'body' ? '本文' : last === 'footer' ? 'フッター' : '';
      if (block) return block;
      return node.layout === 'horizontal' || node.layout === 'baseline' ? '箱（横並び）' : '箱（縦並び）';
    }
    default:
      return 'パーツ';
  }
}

/** 文字をその場で編集できるか（色分けした span を持つ文字は、まとめて書き換えると色分けが消えるので不可） */
export function isInlineEditableText(node: FlexNode | undefined): boolean {
  return !!node && node.type === 'text' && !(Array.isArray(node.contents) && node.contents.length > 0);
}

/** 木の中のすべてのパーツ（パス付き）を、上から順に列挙する */
export function walkFlex(root: unknown, visit: (node: FlexNode, path: FlexPath) => void, path: FlexPath = ''): void {
  if (!isObj(root)) return;
  visit(root, path);
  if (root.type === 'bubble') {
    for (const k of FLEX_BLOCK_KEYS) if (isObj(root[k])) walkFlex(root[k], visit, childPath(path, k));
    return;
  }
  if (Array.isArray(root.contents) && (root.type === 'carousel' || root.type === 'box')) {
    root.contents.forEach((c, i) => walkFlex(c, visit, childPath(path, 'contents', i)));
  }
}
