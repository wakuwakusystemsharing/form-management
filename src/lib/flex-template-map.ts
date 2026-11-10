/**
 * テンプレートで作った Flex の「どのパーツが、どの入力項目から作られたか」を突き止め、
 * プレビュー上の操作（文字の書き換え・画像の差し替え・ボタンの文言と URL・カードや行の並び替え / 複製 / 削除）を
 * テンプレートの入力値（data）に書き戻すための純粋ロジック
 *
 * 仕組み: 入力値の文字列を 1 つずつ目印（私用領域の文字で挟んだ番号）に置き換えたデータでもう一度 Flex を組み立て、
 * 目印が現れた場所 = その入力項目から作られたパーツ、と対応付ける。組み立て処理（line-flex-templates.ts）には手を入れないので、
 * 送信する Flex に余計な項目が混ざることはない。本物と目印版で形が違ってしまった場合は対応付けをあきらめる（= 自由編集になる）
 *
 * 入力項目に書き戻せない操作（パーツの追加・見た目の変更・テンプレートに無い移動など）は、呼び出し側が自由編集（flex_override）にする
 */
import type { FlexContainer, LineFlexTemplate, LineFlexTemplateData } from '@/types/line-flex';
import { buildTemplateFlex } from '@/lib/line-flex-templates';
import { getAt, parentInfo, parentPathOf, walkFlex, type FlexNode, type FlexPath } from '@/lib/flex-tree';

/** 入力値の中の場所（例: ['items', 2, 'name']） */
export type DataPath = Array<string | number>;

export interface TemplateFieldMap {
  /** 文字パーツ → 入力項目 */
  text: Record<FlexPath, DataPath>;
  /** 画像パーツ → 画像 URL の入力項目 */
  image: Record<FlexPath, DataPath>;
  /** ボタン → 文言 / URL の入力項目 */
  buttonLabel: Record<FlexPath, DataPath>;
  buttonUrl: Record<FlexPath, DataPath>;
  /** 一覧の 1 件ぶん（カルーセルのカード・料金表の行・ステップ・ボタン）にあたるパーツ → 一覧名と位置 */
  itemRoots: Record<FlexPath, { list: string; index: number }>;
}

const MARK_OPEN = '';
const MARK_CLOSE = '';
const MARK_RE = /(\d+)/;
const PURE_MARK_RE = /^(\d+)$/;
/** 目印に置き換えない項目: 行の識別子・色・電話番号（電話ボタンの有無が電話番号の数字で決まるため、値を変えると形が変わる） */
const SKIP_KEYS = new Set(['key', 'color', 'phone']);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 入力値の中の、空でない文字列の場所を列挙する */
function collectStringFields(value: unknown, path: DataPath, out: DataPath[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectStringFields(v, [...path, i], out));
    return;
  }
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) continue;
      collectStringFields(v, [...path, k], out);
    }
    return;
  }
  if (typeof value === 'string' && value.trim()) out.push(path);
}

function getData(data: unknown, path: DataPath): unknown {
  let cur = data;
  for (const k of path) {
    if (Array.isArray(cur)) cur = cur[Number(k)];
    else if (isObj(cur)) cur = cur[String(k)];
    else return undefined;
  }
  return cur;
}

/** 入力値の path の位置を value にした新しい入力値を返す（元は変えない） */
export function setData<T>(data: T, path: DataPath, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  if (Array.isArray(data)) {
    const next = [...data];
    next[Number(head)] = setData(next[Number(head)], rest, value);
    return next as unknown as T;
  }
  const obj: Record<string, unknown> = isObj(data) ? { ...data } : {};
  obj[String(head)] = setData(obj[String(head)], rest, value);
  return obj as unknown as T;
}

/** 木の形（パスと種類の並び）が同じか */
function sameShape(a: FlexContainer, b: FlexContainer): boolean {
  const shape = (root: FlexContainer) => {
    const out: string[] = [];
    walkFlex(root, (n, p) => out.push(`${p}:${String(n.type)}`));
    return out.join('|');
  };
  return shape(a) === shape(b);
}

/** 一覧の中の項目なら「一覧名.位置」（例: items.2）。一覧の外の項目は null */
function listPrefix(path: DataPath): { list: string; index: number } | null {
  return typeof path[0] === 'string' && typeof path[1] === 'number' ? { list: path[0], index: path[1] } : null;
}

/**
 * テンプレートの入力値から、パーツと入力項目の対応表を作る。
 * テンプレートで作れない（必須項目が空など）・対応付けに失敗したときは null
 */
export function buildTemplateFieldMap(template: LineFlexTemplate, data: LineFlexTemplateData): TemplateFieldMap | null {
  if (template === 'custom') return null;
  const real = buildTemplateFlex(template, data);
  if (!real) return null;

  const fields: DataPath[] = [];
  collectStringFields(data, [], fields);
  let probeData: LineFlexTemplateData = data;
  fields.forEach((path, i) => {
    const key = String(path[path.length - 1]);
    const mark = `${MARK_OPEN}${i}${MARK_CLOSE}`;
    // URL の項目は、https の URL として通る形の目印にする（ボタン・画像が作られる条件を変えないため）
    probeData = setData(probeData, path, /url$/i.test(key) ? `https://x.invalid/${mark}` : mark);
  });
  const probe = buildTemplateFlex(template, probeData);
  if (!probe || !sameShape(real, probe)) return null;

  const map: TemplateFieldMap = { text: {}, image: {}, buttonLabel: {}, buttonUrl: {}, itemRoots: {} };
  const fieldOf = (v: unknown, pure: boolean): DataPath | null => {
    if (typeof v !== 'string') return null;
    const m = (pure ? PURE_MARK_RE : MARK_RE).exec(v);
    return m ? fields[Number(m[1])] ?? null : null;
  };
  /** パーツ（とその中身）に含まれる、一覧の項目（items.2 など） */
  const prefixes = new Map<FlexPath, Set<string>>();
  const note = (path: FlexPath, field: DataPath) => {
    const p = listPrefix(field);
    if (!p) return;
    const key = `${p.list}.${p.index}`;
    for (let cur: FlexPath | null = path; cur !== null; cur = parentPathOf(cur)) {
      const set = prefixes.get(cur) ?? new Set<string>();
      set.add(key);
      prefixes.set(cur, set);
    }
  };

  walkFlex(probe, (node, path) => {
    if (node.type === 'text') {
      const f = fieldOf(node.text, true);
      if (f) {
        map.text[path] = f;
        note(path, f);
      }
    } else if (node.type === 'image') {
      const f = fieldOf(node.url, false);
      if (f) {
        map.image[path] = f;
        note(path, f);
      }
    } else if (node.type === 'button' && isObj(node.action)) {
      const label = fieldOf(node.action.label, true);
      const url = fieldOf(node.action.uri, false);
      if (label) {
        map.buttonLabel[path] = label;
        note(path, label);
      }
      if (url) {
        map.buttonUrl[path] = url;
        note(path, url);
      }
    }
  });

  // 電話番号（目印にしていない）は、値が一致する文字パーツに対応付ける
  const phone = getData(data, ['phone']);
  if (typeof phone === 'string' && phone.trim()) {
    walkFlex(real, (node, path) => {
      if (node.type === 'text' && !map.text[path] && node.text === phone.trim()) map.text[path] = ['phone'];
    });
  }

  // 一覧の 1 件ぶんにあたるパーツ: 中身がちょうど 1 件の項目だけを含み、親は 2 件以上を含む
  for (const [path, set] of prefixes) {
    if (set.size !== 1) continue;
    const parent = parentPathOf(path);
    if (parent === null || (prefixes.get(parent)?.size ?? 0) < 2) continue;
    if (!parentInfo(real, path)) continue; // 並びの中のパーツだけ
    const [list, index] = [...set][0].split('.');
    map.itemRoots[path] = { list, index: Number(index) };
  }
  return map;
}

/** パーツを含む「一覧の 1 件ぶん」のパーツ（自分がそうなら自分）。無ければ null */
export function itemRootOf(map: TemplateFieldMap | null, path: FlexPath): { path: FlexPath; list: string; index: number } | null {
  if (!map) return null;
  for (let cur: FlexPath | null = path; cur !== null; cur = parentPathOf(cur)) {
    const hit = map.itemRoots[cur];
    if (hit) return { path: cur, ...hit };
  }
  return null;
}

export type TemplateOp =
  | { type: 'text'; path: FlexPath; text: string }
  | { type: 'image'; path: FlexPath; url: string }
  | { type: 'buttonLabel'; path: FlexPath; label: string }
  | { type: 'buttonUrl'; path: FlexPath; url: string }
  | { type: 'move'; path: FlexPath; dir: -1 | 1 }
  | { type: 'moveTo'; path: FlexPath; index: number }
  | { type: 'remove'; path: FlexPath }
  | { type: 'duplicate'; path: FlexPath };

export interface TemplateOpResult {
  data: LineFlexTemplateData;
  /** 操作のあとに選択するとよい「一覧の 1 件」（並び替え・複製のあと、動いた先を選び直す） */
  selectItem?: { list: string; index: number };
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * 操作をテンプレートの入力値に書き戻す。書き戻せない操作（対応する入力項目が無い）は null（呼び出し側が自由編集にする）
 * `contents` = いまの入力値から組み立てた Flex（並びの中の位置を知るのに使う）
 */
export function applyTemplateOp(
  data: LineFlexTemplateData,
  map: TemplateFieldMap | null,
  contents: FlexContainer,
  op: TemplateOp,
  keygen: () => string = newKey
): TemplateOpResult | null {
  if (!map) return null;
  switch (op.type) {
    case 'text': {
      const field = map.text[op.path];
      return field ? { data: setData(data, field, op.text) } : null;
    }
    case 'image': {
      const field = map.image[op.path];
      return field ? { data: setData(data, field, op.url) } : null;
    }
    case 'buttonLabel': {
      const field = map.buttonLabel[op.path];
      return field ? { data: setData(data, field, op.label) } : null;
    }
    case 'buttonUrl': {
      const field = map.buttonUrl[op.path];
      return field ? { data: setData(data, field, op.url) } : null;
    }
    default:
      break;
  }

  // 並び替え・複製・削除は「一覧の 1 件ぶん」のパーツにだけ使える
  const item = map.itemRoots[op.path];
  if (!item) return null;
  const list = getData(data, [item.list]);
  if (!Array.isArray(list)) return null;

  if (op.type === 'remove') {
    return { data: setData(data, [item.list], list.filter((_, i) => i !== item.index)) };
  }
  if (op.type === 'duplicate') {
    const copy = isObj(list[item.index]) ? { ...JSON.parse(JSON.stringify(list[item.index])), key: keygen() } : list[item.index];
    const next = [...list];
    next.splice(item.index + 1, 0, copy);
    return { data: setData(data, [item.list], next), selectItem: { list: item.list, index: item.index + 1 } };
  }

  // 並び替え: 同じ並びにある「1 件ぶん」のパーツの順番（区切り線などは数えない）
  const info = parentInfo(contents, op.path);
  if (!info) return null;
  const siblings = Object.entries(map.itemRoots)
    .map(([p, r]) => ({ info: parentInfo(contents, p), list: r.list, index: r.index }))
    .filter((s) => s.info && s.info.containerPath === info.containerPath && s.list === item.list)
    .sort((a, b) => a.info!.index - b.info!.index);
  const rank = siblings.findIndex((s) => s.index === item.index);
  if (rank < 0) return null;
  let target: number;
  if (op.type === 'move') {
    target = rank + op.dir;
  } else {
    // 並びの中の位置（区切り線を含む）→ 何件目か
    target = op.index > info.index ? siblings.filter((s) => s.info!.index <= op.index).length - 1 : siblings.filter((s) => s.info!.index < op.index).length;
  }
  target = Math.max(0, Math.min(siblings.length - 1, target));
  if (target === rank) return null;
  // 表示されている件（名前が空で表示されない件は動かさない）の位置に、新しい順番で入れ直す
  const slots = siblings.map((s) => s.index).sort((a, b) => a - b);
  const order = siblings.map((s) => s.index);
  const [moved] = order.splice(rank, 1);
  order.splice(target, 0, moved);
  const next = [...list];
  slots.forEach((slot, i) => {
    next[slot] = list[order[i]];
  });
  return { data: setData(data, [item.list], next), selectItem: { list: item.list, index: slots[target] } };
}

/** 対応表から「一覧の 1 件」にあたるパーツのパスを引く（並び替えのあと選び直すため） */
export function findItemRootPath(map: TemplateFieldMap | null, item: { list: string; index: number }): FlexPath | null {
  if (!map) return null;
  for (const [path, r] of Object.entries(map.itemRoots)) if (r.list === item.list && r.index === item.index) return path;
  return null;
}

/** 設定パネル用: 文字・画像・ボタンのパーツが入力項目と結び付いているか */
export function isTemplateBound(map: TemplateFieldMap | null, path: FlexPath, node: FlexNode | undefined): boolean {
  if (!map || !node) return false;
  if (node.type === 'text') return !!map.text[path];
  if (node.type === 'image') return !!map.image[path];
  if (node.type === 'button') return !!map.buttonLabel[path];
  return !!map.itemRoots[path];
}

export { getAt as getFlexNode };
