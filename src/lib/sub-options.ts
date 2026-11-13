/**
 * オプションのオプション（メニューオプション / カテゴリー共通オプションの中に作る「追加のオプション」）
 *
 * 設定（保存される形）: 親のオプションに `sub_options`（名前・料金・所要時間）と
 *   `sub_options_mode`（multiple = 複数選べる / single = 1 つだけ）、`sub_options_required`（必須）、`sub_options_label`（見出し）
 *
 * 予約フォーム（生成 HTML）では、追加のオプションを「親のすぐ後ろに並ぶ通常のオプション」として展開する（`flattenSubOptions`）。
 *   展開した行は `parent_option_id`（親の ID）と `sub_label`（ボタンに出す名前）を持ち、`name` は「親の名前（追加のオプションの名前）」。
 *   こうすると、選択の保存・合計金額・合計時間・カレンダーの空き判定・LINE メッセージ・予約データ（selected_options）が
 *   既存のオプションの処理のまま動く。フォーム側で足すのは 表示（親の下に入れ子で出す）と
 *   `soSync`（親を外したら子も外す / 1 つだけのときは他を外す）、`soMissingRequired`（必須の確認）だけ
 */
import type { FormConfig, MenuItem, MenuSubOption } from '@/types/form';

/** 追加のオプションを持てるもの（メニューオプション / カテゴリー共通オプション） */
export interface SubOptionHost {
  id: string;
  name: string;
  price?: number;
  duration?: number;
  sub_options?: MenuSubOption[];
  sub_options_mode?: 'multiple' | 'single';
  sub_options_required?: boolean;
  sub_options_label?: string;
}

export const SUB_OPTIONS_MAX = 20;
export const SUB_OPTION_NAME_MAX = 60;
export const SUB_OPTIONS_LABEL_MAX = 40;
export const DEFAULT_SUB_OPTIONS_LABEL = '追加オプション';

export type SubOptionsMode = 'multiple' | 'single';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** 追加のオプションの一覧を整える（名前の無い行・重複 ID を除く。最大 20 件） */
export function normalizeSubOptions(raw: unknown): MenuSubOption[] {
  if (!Array.isArray(raw)) return [];
  const out: MenuSubOption[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const name = str(o.name).trim().slice(0, SUB_OPTION_NAME_MAX);
    const id = str(o.id).trim();
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    const description = str(o.description).trim();
    out.push({
      id,
      name,
      price: num(o.price),
      duration: num(o.duration),
      ...(description ? { description } : {}),
      ...(o.hide_price === true ? { hide_price: true } : {}),
      ...(o.hide_duration === true ? { hide_duration: true } : {}),
    });
    if (out.length >= SUB_OPTIONS_MAX) break;
  }
  return out;
}

export function resolveSubOptionsMode(v: unknown): SubOptionsMode {
  return v === 'single' ? 'single' : 'multiple';
}

/** 追加のオプション欄の見出し（空なら既定） */
export function resolveSubOptionsLabel(v: unknown): string {
  return str(v).trim().slice(0, SUB_OPTIONS_LABEL_MAX) || DEFAULT_SUB_OPTIONS_LABEL;
}

/** ご予約内容・LINE メッセージ・予約データに出る名前 */
export function subOptionDisplayName(parentName: string, subName: string): string {
  return `${parentName}（${subName}）`;
}

/** 新しい追加のオプション（編集画面用） */
export function newSubOption(): MenuSubOption {
  return { id: `subopt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: '', price: 0, duration: 0 };
}

/** 展開後の行（フォームの中だけで使う。保存はしない） */
export type FlatMenuOption = SubOptionHost & { parent_option_id?: string; sub_label?: string };

/**
 * 追加のオプションを、親のすぐ後ろに並ぶ通常のオプションとして展開する。
 * すでに展開済みの一覧を渡しても同じ結果になる（展開した行は捨てて作り直す）
 */
export function flattenSubOptions<T extends SubOptionHost>(options: ReadonlyArray<T> | null | undefined): Array<T & FlatMenuOption> {
  const out: Array<T & FlatMenuOption> = [];
  for (const opt of options ?? []) {
    if (!opt || typeof opt !== 'object') continue;
    if ((opt as FlatMenuOption).parent_option_id) continue;
    const subs = normalizeSubOptions(opt.sub_options);
    out.push(opt as T & FlatMenuOption);
    for (const sub of subs) {
      out.push({
        id: sub.id,
        name: subOptionDisplayName(opt.name, sub.name),
        sub_label: sub.name,
        parent_option_id: opt.id,
        price: sub.price,
        duration: sub.duration,
        ...(sub.description ? { description: sub.description } : {}),
        ...(sub.hide_price ? { hide_price: true } : {}),
        ...(sub.hide_duration ? { hide_duration: true } : {}),
      } as unknown as T & FlatMenuOption);
    }
  }
  return out;
}

/** カテゴリーに属さないメニュー（旧形式の menu_structure.menus） */
function flatMenusOf(config: FormConfig | null | undefined): MenuItem[] {
  const menus = (config?.menu_structure as { menus?: MenuItem[] } | undefined)?.menus;
  return Array.isArray(menus) ? menus : [];
}

/** フォーム設定の全メニュー・全カテゴリー共通オプションを展開する（渡した config を書き換える。生成 HTML 用のコピーに使う） */
export function flattenConfigSubOptions(config: FormConfig): FormConfig {
  for (const cat of config?.menu_structure?.categories ?? []) {
    if (!cat || typeof cat !== 'object') continue;
    if (Array.isArray(cat.options)) cat.options = flattenSubOptions(cat.options);
    for (const menu of cat.menus ?? []) {
      if (menu && Array.isArray(menu.options)) menu.options = flattenSubOptions(menu.options);
    }
  }
  // カテゴリーに属さないメニュー（旧形式の menu_structure.menus）
  for (const menu of flatMenusOf(config)) {
    if (menu && Array.isArray(menu.options)) menu.options = flattenSubOptions(menu.options);
  }
  return config;
}

/** 設定に追加のオプションが 1 つでもあるか */
export function hasSubOptions(config: FormConfig | null | undefined): boolean {
  for (const cat of config?.menu_structure?.categories ?? []) {
    if ((cat?.options ?? []).some((o) => normalizeSubOptions(o?.sub_options).length > 0)) return true;
    for (const menu of cat?.menus ?? []) if ((menu?.options ?? []).some((o) => normalizeSubOptions(o?.sub_options).length > 0)) return true;
  }
  for (const menu of flatMenusOf(config)) if ((menu?.options ?? []).some((o) => normalizeSubOptions(o?.sub_options).length > 0)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 選択の整合（TS 版。生成 HTML には下の SUB_OPTIONS_RUNTIME_JS に同じ実装を持つ。直すときは両方）
// ---------------------------------------------------------------------------

export interface SubOptionSelectionState {
  /** メニュー ID → 選択中のオプション ID（展開後の ID を含む） */
  selectedOptions?: Record<string, string[]>;
  /** カテゴリー ID → 選択中のカテゴリー共通オプション ID */
  selectedCategoryOptions?: Record<string, string[]>;
}
export interface SubOptionRemoval {
  scope: 'menu' | 'category';
  owner: string;
  id: string;
}

function syncList(options: ReadonlyArray<FlatMenuOption> | undefined, selected: string[], clickedId: string | null | undefined, onRemove: (id: string) => void): string[] {
  const byId = new Map<string, FlatMenuOption>();
  for (const o of options ?? []) if (o) byId.set(o.id, o);
  let next = selected.slice();
  const clicked = clickedId ? byId.get(clickedId) : undefined;
  // 1 つだけ選べる親: いま選んだもの以外の兄弟を外す
  if (clicked?.parent_option_id && next.includes(clicked.id)) {
    const parent = byId.get(clicked.parent_option_id);
    if (parent && resolveSubOptionsMode(parent.sub_options_mode) === 'single') {
      next = next.filter((id) => {
        const keep = id === clicked.id || byId.get(id)?.parent_option_id !== parent.id;
        if (!keep) onRemove(id);
        return keep;
      });
    }
  }
  // 親が選ばれていない追加のオプションを外す
  const current = next;
  return current.filter((id) => {
    const o = byId.get(id);
    const keep = !o?.parent_option_id || current.includes(o.parent_option_id);
    if (!keep) onRemove(id);
    return keep;
  });
}

/**
 * 選択を整える（state を書き換える）。戻り値 = 外した追加のオプション。
 * `config` は展開済み（flattenConfigSubOptions）のもの。`clickedId` = いま押したオプション（1 つだけのときの切り替えに使う）
 */
export function syncSubOptionSelection(config: FormConfig, state: SubOptionSelectionState, clickedId?: string | null): SubOptionRemoval[] {
  const removed: SubOptionRemoval[] = [];
  for (const cat of config?.menu_structure?.categories ?? []) {
    for (const menu of cat?.menus ?? []) {
      const sel = state.selectedOptions?.[menu.id];
      if (sel && sel.length > 0) state.selectedOptions![menu.id] = syncList(menu.options as FlatMenuOption[], sel, clickedId, (id) => removed.push({ scope: 'menu', owner: menu.id, id }));
    }
    const catSel = state.selectedCategoryOptions?.[cat.id];
    if (catSel && catSel.length > 0) state.selectedCategoryOptions![cat.id] = syncList(cat.options as FlatMenuOption[] | undefined, catSel, clickedId, (id) => removed.push({ scope: 'category', owner: cat.id, id }));
  }
  for (const menu of flatMenusOf(config)) {
    const sel = state.selectedOptions?.[menu.id];
    if (sel && sel.length > 0) state.selectedOptions![menu.id] = syncList(menu.options as FlatMenuOption[], sel, clickedId, (id) => removed.push({ scope: 'menu', owner: menu.id, id }));
  }
  return removed;
}

/** 必須なのに追加のオプションが選ばれていない親オプションの名前（選択中の親だけ。上から順） */
export function findMissingRequiredSubOptions(config: FormConfig, state: SubOptionSelectionState): string[] {
  const missing: string[] = [];
  const check = (options: ReadonlyArray<FlatMenuOption> | undefined, selected: string[] | undefined) => {
    if (!selected || selected.length === 0) return;
    for (const o of options ?? []) {
      if (!o || o.parent_option_id || o.sub_options_required !== true || !selected.includes(o.id)) continue;
      const children = (options ?? []).filter((c) => c?.parent_option_id === o.id);
      if (children.length > 0 && !children.some((c) => selected.includes(c.id))) missing.push(o.name);
    }
  };
  for (const cat of config?.menu_structure?.categories ?? []) {
    for (const menu of cat?.menus ?? []) check(menu.options as FlatMenuOption[], state.selectedOptions?.[menu.id]);
    check(cat.options as FlatMenuOption[] | undefined, state.selectedCategoryOptions?.[cat.id]);
  }
  for (const menu of flatMenusOf(config)) check(menu.options as FlatMenuOption[], state.selectedOptions?.[menu.id]);
  return missing;
}

/**
 * 生成 HTML に埋め込む JS（バッククォート・テンプレート記法は使わない）
 * - soSync(config, state, clickedId) → 外した追加のオプション [{ scope, owner, id }]
 * - soMissingRequired(config, state) → 必須なのに未選択の親オプションの名前
 */
export const SUB_OPTIONS_RUNTIME_JS = `
function soSyncList(options, selected, clickedId, onRemove) {
    var byId = {};
    (options || []).forEach(function (o) { if (o) byId[o.id] = o; });
    var next = selected.slice();
    var clicked = clickedId ? byId[clickedId] : null;
    if (clicked && clicked.parent_option_id && next.indexOf(clicked.id) !== -1) {
        var parent = byId[clicked.parent_option_id];
        if (parent && parent.sub_options_mode === 'single') {
            next = next.filter(function (id) {
                var keep = id === clicked.id || !byId[id] || byId[id].parent_option_id !== parent.id;
                if (!keep) onRemove(id);
                return keep;
            });
        }
    }
    var current = next;
    return current.filter(function (id) {
        var o = byId[id];
        var keep = !o || !o.parent_option_id || current.indexOf(o.parent_option_id) !== -1;
        if (!keep) onRemove(id);
        return keep;
    });
}
function soSync(config, state, clickedId) {
    var removed = [];
    var cats = (config && config.menu_structure && config.menu_structure.categories) || [];
    cats.forEach(function (cat) {
        if (!cat) return;
        (cat.menus || []).forEach(function (menu) {
            var sel = state.selectedOptions && state.selectedOptions[menu.id];
            if (sel && sel.length > 0) {
                state.selectedOptions[menu.id] = soSyncList(menu.options, sel, clickedId, function (id) { removed.push({ scope: 'menu', owner: menu.id, id: id }); });
            }
        });
        var catSel = state.selectedCategoryOptions && state.selectedCategoryOptions[cat.id];
        if (catSel && catSel.length > 0) {
            state.selectedCategoryOptions[cat.id] = soSyncList(cat.options, catSel, clickedId, function (id) { removed.push({ scope: 'category', owner: cat.id, id: id }); });
        }
    });
    ((config && config.menu_structure && config.menu_structure.menus) || []).forEach(function (menu) {
        var sel = menu && state.selectedOptions && state.selectedOptions[menu.id];
        if (sel && sel.length > 0) {
            state.selectedOptions[menu.id] = soSyncList(menu.options, sel, clickedId, function (id) { removed.push({ scope: 'menu', owner: menu.id, id: id }); });
        }
    });
    return removed;
}
function soMissingRequired(config, state) {
    var missing = [];
    function check(options, selected) {
        if (!selected || selected.length === 0) return;
        (options || []).forEach(function (o) {
            if (!o || o.parent_option_id || o.sub_options_required !== true || selected.indexOf(o.id) === -1) return;
            var children = (options || []).filter(function (c) { return c && c.parent_option_id === o.id; });
            if (children.length > 0 && !children.some(function (c) { return selected.indexOf(c.id) !== -1; })) missing.push(o.name);
        });
    }
    var cats = (config && config.menu_structure && config.menu_structure.categories) || [];
    cats.forEach(function (cat) {
        if (!cat) return;
        (cat.menus || []).forEach(function (menu) { check(menu.options, state.selectedOptions && state.selectedOptions[menu.id]); });
        check(cat.options, state.selectedCategoryOptions && state.selectedCategoryOptions[cat.id]);
    });
    ((config && config.menu_structure && config.menu_structure.menus) || []).forEach(function (menu) {
        if (menu) check(menu.options, state.selectedOptions && state.selectedOptions[menu.id]);
    });
    return missing;
}
`;

// ---------------------------------------------------------------------------
// 編集画面用
// ---------------------------------------------------------------------------

export interface SubOptionsEditorValue {
  sub_options: MenuSubOption[];
  sub_options_mode: SubOptionsMode;
  sub_options_required: boolean;
  sub_options_label: string;
}

/** 保存済みのオプションから、編集欄の値を作る */
export function toSubOptionsEditorValue(host: SubOptionHost | null | undefined): SubOptionsEditorValue {
  return {
    sub_options: Array.isArray(host?.sub_options) ? host.sub_options : [],
    sub_options_mode: resolveSubOptionsMode(host?.sub_options_mode),
    sub_options_required: host?.sub_options_required === true,
    sub_options_label: typeof host?.sub_options_label === 'string' ? host.sub_options_label : '',
  };
}

/** 編集欄の値から、オプションに保存する項目を作る（追加のオプションが無ければすべて undefined = 項目を持たない） */
export function subOptionsFieldsToSave(value: SubOptionsEditorValue): Pick<SubOptionHost, 'sub_options' | 'sub_options_mode' | 'sub_options_required' | 'sub_options_label'> {
  const list = normalizeSubOptions(value.sub_options);
  if (list.length === 0) return { sub_options: undefined, sub_options_mode: undefined, sub_options_required: undefined, sub_options_label: undefined };
  const label = value.sub_options_label.trim().slice(0, SUB_OPTIONS_LABEL_MAX);
  return {
    sub_options: list,
    sub_options_mode: value.sub_options_mode === 'single' ? 'single' : undefined,
    sub_options_required: value.sub_options_required ? true : undefined,
    sub_options_label: label || undefined,
  };
}
