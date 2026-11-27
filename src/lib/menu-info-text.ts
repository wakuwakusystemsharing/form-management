/**
 * 予約フォームの「いまのメニュー設定」を、LINE のチャットにそのまま貼れる文章にする（純粋ロジック）
 *
 * メニュー構成タブの「現在のメニュー情報コピー」ボタンで使う。
 * カテゴリー → メニュー（サブメニュー）→ オプション（追加のオプション）の順に、名前・料金・所要時間を並べる。
 * - LINE では装飾が効かないので、記号と全角の字下げだけで見やすくする
 * - 料金 / 所要時間を「フォームで非表示」にしている項目は、値のあとに「※フォームでは非表示」と付ける
 *   （店舗に設定を伝える文なので、値そのものは載せる）
 */
import type { MenuCategory, MenuItem, MenuOption, MenuSubOption, SubMenuItem } from '@/types/form';

interface Priced {
  price?: number | null;
  duration?: number | null;
  hide_price?: boolean;
  hide_duration?: boolean;
  price_max?: number | null;
  price_label?: string | null;
}

const yen = (n: number) => `${Math.round(n).toLocaleString('ja-JP')}円`;

/** 所要時間（分）→ 「90分」。60 分以上で割り切れないときも分のまま（フォームの表示と同じ） */
const minutes = (n: number) => `${Math.round(n)}分`;

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 料金と所要時間の 1 行ぶん。
 * @param plus true = オプション（「+1,100円」「+10分」と、足されることが分かる形にする）
 */
export function formatPriceDuration(item: Priced, plus = false): string {
  const parts: string[] = [];
  const hidden: string[] = [];
  if (isNumber(item.price)) {
    // 幅のある料金は「5,000円〜7,000円」。自由に書いた表示があれば（表示: …）と添える
    const max = isNumber(item.price_max) && item.price_max > item.price ? item.price_max : 0;
    const label = typeof item.price_label === 'string' ? item.price_label.trim() : '';
    parts.push(`${plus && (item.price > 0 || max > 0) ? '+' : ''}${yen(item.price)}${max > 0 ? `〜${yen(max)}` : ''}${label ? `（表示: ${label}）` : ''}`);
    if (item.hide_price) hidden.push('料金');
  }
  if (isNumber(item.duration) && item.duration > 0) {
    parts.push(`${plus ? '+' : ''}${minutes(item.duration)}`);
    if (item.hide_duration) hidden.push('所要時間');
  }
  if (parts.length === 0) return '';
  return `${parts.join(' / ')}${hidden.length > 0 ? `（※${hidden.join('・')}はフォームでは非表示）` : ''}`;
}

function line(indent: string, mark: string, name: string, detail: string): string {
  const label = (name || '').trim() || '（名前なし）';
  return `${indent}${mark}${label}${detail ? `　${detail}` : ''}`;
}

function subOptionLines(indent: string, option: { sub_options?: MenuSubOption[]; sub_options_label?: string; sub_options_mode?: 'multiple' | 'single'; sub_options_required?: boolean }): string[] {
  const subs = Array.isArray(option.sub_options) ? option.sub_options.filter(Boolean) : [];
  if (subs.length === 0) return [];
  const notes = [option.sub_options_mode === 'single' ? '1 つだけ選べる' : '複数選べる', ...(option.sub_options_required ? ['必須'] : [])];
  return [`${indent}〔${(option.sub_options_label || '').trim() || '追加オプション'}：${notes.join('・')}〕`, ...subs.map((s) => line(indent, '└ ', s.name, formatPriceDuration(s, true)))];
}

function optionLines(indent: string, options: Array<MenuOption | MenuItem> | undefined): string[] {
  const list = Array.isArray(options) ? options.filter(Boolean) : [];
  const out: string[] = [];
  for (const o of list) {
    const required = (o as MenuOption).required === true ? '【このメニューを選んだら必須】' : '';
    out.push(line(indent, '＋ ', o.name, [formatPriceDuration(o, true), required].filter(Boolean).join(' ')));
    out.push(...subOptionLines(`${indent}　`, o));
  }
  return out;
}

function menuLines(menu: MenuItem): string[] {
  const subs: SubMenuItem[] = menu.has_submenu && Array.isArray(menu.sub_menu_items) ? menu.sub_menu_items.filter(Boolean) : [];
  const out: string[] = [];
  if (subs.length > 0) {
    out.push(line('', '・', menu.name, ''));
    for (const s of subs) out.push(line('　', '- ', s.name, formatPriceDuration(s)));
  } else {
    out.push(line('', '・', menu.name, formatPriceDuration(menu)));
  }
  const options = optionLines('　　', menu.options);
  if (options.length > 0) out.push(menu.options_required === true ? '　〔オプション：1 つ以上必須〕' : '　〔オプション〕', ...options);
  return out;
}

export interface MenuInfoTextInput {
  formName?: string | null;
  categories: MenuCategory[] | null | undefined;
}

/** メニューが 1 つも無いときは空文字（ボタン側で「メニューがありません」と知らせる） */
export function buildMenuInfoText(input: MenuInfoTextInput): string {
  const categories = (Array.isArray(input.categories) ? input.categories : []).filter((c) => c && ((c.menus?.length ?? 0) > 0 || (c.options?.length ?? 0) > 0));
  if (categories.length === 0) return '';

  const blocks: string[] = [];
  const name = (input.formName || '').trim();
  blocks.push(name ? `【${name}】\n現在のメニュー設定です。` : '現在のメニュー設定です。');

  for (const c of categories) {
    const lines: string[] = [`■ ${(c.display_name || c.name || '').trim() || 'メニュー'}`];
    for (const m of (c.menus ?? []).filter(Boolean)) lines.push(...menuLines(m));
    const common = optionLines('　', c.options);
    if (common.length > 0) lines.push('〔このカテゴリー共通のオプション〕', ...common);
    blocks.push(lines.join('\n'));
  }

  blocks.push('※料金は設定されている金額です。「+」はオプションで足される料金・時間です。');
  return blocks.join('\n\n');
}
