/**
 * LINE メッセージのプレビューを直接さわって編集するときの「操作 → 新しい内容」（純粋ロジック）
 *
 * 1. テンプレートの入力項目に書き戻せる操作（文字・画像・ボタンの文言とリンク先、一覧の 1 件の並び替え・複製・削除）は
 *    入力値 `data` を書き換える
 * 2. それ以外は Flex そのものを書き換えて `flexOverride` にする（自由編集）
 *
 * 編集ダイアログ（LineFlexEditorDialog）と、一覧の「プレビュー編集」（LineFlexQuickEdit）が共通で使う
 */
import type { FlexContainer, LineFlexTemplate, LineFlexTemplateData } from '@/types/line-flex';
import { addBubble, addPart, duplicateNode, getAt, moveNode, moveNodeTo, newFlexPart, patchNode, removeNode, walkFlex, type FlexNode } from '@/lib/flex-tree';
import { applyTemplateOp, buildTemplateFieldMap, findItemRootPath, type TemplateOp } from '@/lib/flex-template-map';
import { resolveFlexContents, validateFlexContents } from '@/lib/line-flex-templates';

export type FlexEditOp =
  | { type: 'text'; path: string; text: string }
  | { type: 'image'; path: string; url: string }
  | { type: 'buttonLabel'; path: string; label: string }
  | { type: 'buttonUrl'; path: string; url: string }
  | { type: 'patch'; path: string; patch: Record<string, unknown> }
  | { type: 'move'; path: string; dir: -1 | 1 }
  | { type: 'moveTo'; path: string; index: number }
  | { type: 'remove'; path: string }
  | { type: 'duplicate'; path: string }
  | { type: 'add'; node: FlexNode }
  | { type: 'addBubble' };

export interface FlexEditState {
  template: LineFlexTemplate;
  data: LineFlexTemplateData;
  flexOverride: FlexContainer | null;
}

export interface FlexEditResult {
  /** 書き換えた入力値（テンプレート連動のまま） */
  data?: LineFlexTemplateData;
  /** 書き換えた Flex（自由編集） */
  flexOverride?: FlexContainer;
  /** 操作のあとに選ぶパーツ。undefined = いまの選択のまま、null = 選択なし */
  selected?: string | null;
  /** 操作できなかった理由（内容は変えない） */
  error?: string;
  /** 入力中の連続した変更（「元に戻す」で 1 回にまとめてよい） */
  typing: boolean;
  /** この操作でテンプレート連動から自由編集に切り替わった */
  becameFree?: boolean;
}

/** いま表示する Flex（組み立てられない・形式が違うときは null） */
export function currentFlexContents(state: FlexEditState): FlexContainer | null {
  const contents = resolveFlexContents({ template: state.template, data: state.data, flex_override: state.flexOverride });
  return contents && !validateFlexContents(contents) ? contents : null;
}

/** テンプレートの入力項目と連動中か（自由入力テンプレート・自由編集中は false） */
export function isTemplateLinked(state: FlexEditState): boolean {
  return state.template !== 'custom' && !state.flexOverride;
}

/** 選択中のパスが、いまの内容に無ければ null にする */
export function validSelection(state: FlexEditState, selected: string | null): string | null {
  const contents = currentFlexContents(state);
  return selected !== null && contents && getAt(contents, selected) ? selected : null;
}

/** 操作を当てる。何も変わらないときは null */
export function applyFlexEdit(state: FlexEditState, op: FlexEditOp, selected: string | null): FlexEditResult | null {
  const typing = op.type === 'text' || op.type === 'buttonLabel' || op.type === 'buttonUrl' || op.type === 'patch' || op.type === 'image';
  const contents = currentFlexContents(state);
  const fieldMap = isTemplateLinked(state) ? buildTemplateFieldMap(state.template, state.data) : null;

  // 1) テンプレートの入力項目に書き戻せる操作は、入力項目を書き換える
  if (fieldMap && contents && op.type !== 'patch' && op.type !== 'add' && op.type !== 'addBubble') {
    const r = applyTemplateOp(state.data, fieldMap, contents, op as TemplateOp);
    if (r) {
      let nextSelected: string | null | undefined;
      if (op.type === 'remove') nextSelected = null;
      else if (r.selectItem) nextSelected = findItemRootPath(buildTemplateFieldMap(state.template, r.data), r.selectItem) ?? null;
      return { data: r.data, selected: nextSelected, typing };
    }
    // 一覧の 1 件（メニューのカードなど）を端より先へ動かそうとした → 何もしない（自由編集にはしない）
    if ((op.type === 'move' || op.type === 'moveTo') && fieldMap.itemRoots[op.path]) return null;
  }

  // 2) それ以外は Flex そのものを書き換える（自由編集）
  let next: FlexContainer | null = null;
  let nextSelected: string | null | undefined;
  let failure: string | undefined;
  if (!contents) {
    // まだ何も無いときは、追加でカードを 1 枚作るところから
    if (op.type !== 'add' && op.type !== 'addBubble') return null;
    const fresh = newFlexPart('bubble') as FlexContainer;
    const r = op.type === 'add' ? addPart(fresh, null, op.node) : { root: fresh, path: '' };
    next = r?.root ?? null;
    nextSelected = r?.path;
  } else {
    const node = 'path' in op ? getAt(contents, op.path) : undefined;
    const action = node && typeof node.action === 'object' && node.action ? (node.action as Record<string, unknown>) : {};
    switch (op.type) {
      case 'text':
        // 文字を空にした = そのパーツを消す（LINE は空の文字を受け付けない）
        if (op.text.trim() === '') {
          next = removeNode(contents, op.path);
          nextSelected = null;
        } else next = patchNode(contents, op.path, { text: op.text });
        break;
      case 'image':
        next = patchNode(contents, op.path, { url: op.url });
        break;
      case 'buttonLabel':
        next = patchNode(contents, op.path, { action: { ...action, type: action.type ?? 'uri', label: op.label } });
        break;
      case 'buttonUrl':
        next = patchNode(contents, op.path, { action: { ...action, type: 'uri', uri: op.url } });
        break;
      case 'patch':
        // カルーセルのカードは全部同じ大きさにする（LINE の仕様）
        if (node?.type === 'bubble' && 'size' in op.patch && contents.type === 'carousel') {
          let r: FlexContainer = contents;
          walkFlex(contents, (n, p) => {
            if (n.type === 'bubble') r = patchNode(r, p, { size: op.patch.size });
          });
          next = r;
        } else next = patchNode(contents, op.path, op.patch);
        break;
      case 'move': {
        const r = moveNode(contents, op.path, op.dir);
        next = r?.root ?? null;
        nextSelected = r?.path;
        break;
      }
      case 'moveTo': {
        const r = moveNodeTo(contents, op.path, op.index);
        next = r?.root ?? null;
        nextSelected = r?.path;
        break;
      }
      case 'duplicate': {
        const r = duplicateNode(contents, op.path);
        if (!r) failure = 'これ以上は増やせません（カードは 12 枚まで）';
        next = r?.root ?? null;
        nextSelected = r?.path;
        break;
      }
      case 'remove':
        next = removeNode(contents, op.path);
        if (!next) failure = 'このパーツは削除できません（カードには最低 1 つの中身が必要です）';
        nextSelected = null;
        break;
      case 'add': {
        const r = addPart(contents, selected, op.node);
        next = r?.root ?? null;
        nextSelected = r?.path;
        break;
      }
      default: {
        const r = addBubble(contents, selected);
        if (!r) failure = 'カードは 12 枚までです';
        next = r?.root ?? null;
        nextSelected = r?.path;
      }
    }
  }
  if (failure) return { error: failure, typing };
  if (!next || next === contents) return null;
  const err = validateFlexContents(next);
  if (err) return { error: err, typing };
  return { flexOverride: next, selected: nextSelected, typing, becameFree: isTemplateLinked(state) };
}
