/**
 * 「このメニューを選んだら、オプション必須」（メニュー編集 → メニューオプション）
 *
 * - `MenuItem.options_required` … このメニューを選んだら、メニューオプションを 1 つ以上選ぶ
 * - `MenuOption.required`       … このメニューを選んだら、このオプションを必ず選ぶ
 *
 * どちらも「そのメニューが選ばれているとき」だけ確かめる。スタッフ / ご来店回数の設定で隠れているオプションは対象外
 * （隠れているものは選べないため）。オプションのオプション（展開した行 = parent_option_id あり）は対象外。
 *
 * 生成 HTML には下の REQUIRED_OPTIONS_RUNTIME_JS に同じ実装を持つ。直すときは両方
 */
import type { FormConfig, MenuItem } from '@/types/form';

export interface RequiredOptionMissing {
  menuId: string;
  menuName: string;
  /** 選ばれていない必須のオプションの ID（null = 「1 つ以上」が満たされていない） */
  optionId: string | null;
  optionName: string | null;
}

interface OptionLike {
  id: string;
  name: string;
  required?: boolean;
  parent_option_id?: string;
}

const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

function allMenus(config: FormConfig | null | undefined): MenuItem[] {
  const out: MenuItem[] = [];
  for (const cat of config?.menu_structure?.categories ?? []) for (const m of cat?.menus ?? []) if (m) out.push(m);
  const flat = (config?.menu_structure as { menus?: MenuItem[] } | undefined)?.menus;
  if (Array.isArray(flat)) for (const m of flat) if (m) out.push(m);
  return out;
}

/**
 * 必須なのに選ばれていないもの（上から順）。
 * @param selectedMenuIds  選択中のメニューの ID
 * @param selectedOptions  メニュー ID → 選択中のオプションの ID
 * @param hiddenOptionIds  いま隠れているオプションの ID
 */
export function findMissingRequiredOptions(
  config: FormConfig | null | undefined,
  selectedMenuIds: ReadonlyArray<string>,
  selectedOptions: Record<string, string[]> | null | undefined,
  hiddenOptionIds: ReadonlyArray<string> = []
): RequiredOptionMissing[] {
  const missing: RequiredOptionMissing[] = [];
  const hidden = new Set(hiddenOptionIds);
  for (const menu of allMenus(config)) {
    if (!selectedMenuIds.includes(menu.id) || menu.has_submenu) continue;
    const options = ((menu.options ?? []) as OptionLike[]).filter((o) => o && !o.parent_option_id && !hidden.has(o.id));
    if (options.length === 0) continue;
    const selected = selectedOptions?.[menu.id] ?? [];
    const menuName = oneLine(menu.name);
    for (const o of options) {
      if (o.required === true && !selected.includes(o.id)) missing.push({ menuId: menu.id, menuName, optionId: o.id, optionName: oneLine(o.name) });
    }
    if (menu.options_required === true && !options.some((o) => selected.includes(o.id))) {
      missing.push({ menuId: menu.id, menuName, optionId: null, optionName: null });
    }
  }
  return missing;
}

/** お客様に出す案内 */
export function requiredOptionMessage(m: RequiredOptionMissing): string {
  return m.optionName
    ? `「${m.menuName}」を選んだ場合は、オプション「${m.optionName}」の選択が必要です`
    : `「${m.menuName}」のオプションを1つ以上選択してください`;
}

/**
 * 生成 HTML に埋め込む JS（バッククォート・テンプレート記法は使わない）
 * - roMissing(config, selectedMenuIds, selectedOptions, hiddenOptionIds) → [{ menuId, menuName, optionId, optionName }]
 * - roMessage(m)
 */
export const REQUIRED_OPTIONS_RUNTIME_JS = `
function roOneLine(s) { return String(s == null ? '' : s).replace(/[ \\t\\r\\n　]+/g, ' ').replace(/^ +| +$/g, ''); }
function roMissing(config, selectedMenuIds, selectedOptions, hiddenOptionIds) {
    var missing = [];
    var hidden = hiddenOptionIds || [];
    var menus = [];
    ((config && config.menu_structure && config.menu_structure.categories) || []).forEach(function (cat) {
        ((cat && cat.menus) || []).forEach(function (m) { if (m) menus.push(m); });
    });
    ((config && config.menu_structure && config.menu_structure.menus) || []).forEach(function (m) { if (m) menus.push(m); });
    menus.forEach(function (menu) {
        if ((selectedMenuIds || []).indexOf(menu.id) === -1 || menu.has_submenu) return;
        var options = (menu.options || []).filter(function (o) { return o && !o.parent_option_id && hidden.indexOf(o.id) === -1; });
        if (options.length === 0) return;
        var selected = (selectedOptions && selectedOptions[menu.id]) || [];
        var menuName = roOneLine(menu.name);
        options.forEach(function (o) {
            if (o.required === true && selected.indexOf(o.id) === -1) missing.push({ menuId: menu.id, menuName: menuName, optionId: o.id, optionName: roOneLine(o.name) });
        });
        if (menu.options_required === true && !options.some(function (o) { return selected.indexOf(o.id) !== -1; })) {
            missing.push({ menuId: menu.id, menuName: menuName, optionId: null, optionName: null });
        }
    });
    return missing;
}
function roMessage(m) {
    return m.optionName
        ? '「' + m.menuName + '」を選んだ場合は、オプション「' + m.optionName + '」の選択が必要です'
        : '「' + m.menuName + '」のオプションを1つ以上選択してください';
}
`;
