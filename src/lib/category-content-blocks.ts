// 予約フォーム: カテゴリーごとの「テキスト・画像」ブロック（純粋ロジック）
//
// メニュー構成 → 各カテゴリーの「メニュー」欄 / 「カテゴリー共通オプション」欄の下にある
// 「＋ テキスト・画像を追加」で置くブロック。詳細設定の「画像orテキスト設置」（config.content_blocks）と
// 同じ中身（テキストか画像のどちらか。テキストは [color=#rrggbb] の色タグ）で、
// 表示位置だけを「そのカテゴリーのメニュー一覧（またはオプション一覧）の一番上 / 一番下 / 特定の項目のすぐ下」から選ぶ。
// 保存先は MenuCategory.content_blocks（カテゴリー単位。「更新して他のフォームにも反映」のメニュー構成に含まれる）

import { renderColoredTextHtml, escapeHtmlText } from './colored-text';

export type CategoryBlockTarget = 'menus' | 'options';
export type CategoryBlockPosition = 'top' | 'bottom' | 'after';

export interface CategoryContentBlock {
  id: string;
  type: 'text' | 'image';
  text?: string;        // type=text の表示テキスト（[color=#rrggbb]〜[/color] 可）
  image_url?: string;   // type=image の画像 URL（https のみ描画）
  target: CategoryBlockTarget;     // メニュー欄か、カテゴリー共通オプション欄か
  position: CategoryBlockPosition; // 一覧の一番上 / 一番下 / 特定の項目のすぐ下
  after_id?: string;               // position = 'after' のとき、そのメニュー / オプションの ID
}

export const CATEGORY_BLOCK_TARGET_LABELS: Record<CategoryBlockTarget, string> = {
  menus: 'メニュー',
  options: 'カテゴリー共通オプション',
};

export const CATEGORY_BLOCK_TEXT_MAX = 1000;

interface CategoryLike {
  menus?: Array<{ id: string; name: string }>;
  options?: Array<{ id: string; name: string }>;
  content_blocks?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 保存値の正規化。壊れた行は捨て、target / position は既定値で補う */
export function sanitizeCategoryContentBlocks(raw: unknown): CategoryContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: CategoryContentBlock[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' && item.id ? item.id : '';
    if (!id) continue;
    const type = item.type === 'image' ? 'image' : 'text';
    const target: CategoryBlockTarget = item.target === 'options' ? 'options' : 'menus';
    const position: CategoryBlockPosition =
      item.position === 'bottom' ? 'bottom' : item.position === 'after' ? 'after' : 'top';
    const block: CategoryContentBlock = { id, type, target, position };
    if (typeof item.text === 'string') block.text = item.text.slice(0, CATEGORY_BLOCK_TEXT_MAX);
    if (typeof item.image_url === 'string') block.image_url = item.image_url.trim();
    if (position === 'after' && typeof item.after_id === 'string' && item.after_id) block.after_id = item.after_id;
    if (position === 'after' && !block.after_id) block.position = 'bottom';
    out.push(block);
  }
  return out;
}

/** フォームに描画できる中身を持っているか（空のテキスト・http(s) 以外の画像は描画しない） */
export function isRenderableCategoryBlock(block: CategoryContentBlock): boolean {
  if (block.type === 'image') return !!(block.image_url && /^https?:/i.test(block.image_url.trim()));
  return !!(block.text && block.text.trim());
}

/** position = 'after' の参照先が無くなっていたら 'bottom' として扱う（内容を失わないため） */
export function resolveCategoryBlockPosition(
  block: CategoryContentBlock,
  category: CategoryLike,
): { position: CategoryBlockPosition; after_id?: string } {
  if (block.position !== 'after') return { position: block.position };
  const list = block.target === 'options' ? category.options || [] : category.menus || [];
  if (block.after_id && list.some((m) => m.id === block.after_id)) {
    return { position: 'after', after_id: block.after_id };
  }
  return { position: 'bottom' };
}

/**
 * 指定した場所に描画するブロック（配列順 = 表示順）。
 * - top / bottom: その欄の一覧の上 / 下
 * - after + afterId: そのメニュー / オプションのすぐ下
 */
export function categoryBlocksAt(
  category: CategoryLike,
  target: CategoryBlockTarget,
  position: CategoryBlockPosition,
  afterId?: string,
): CategoryContentBlock[] {
  return sanitizeCategoryContentBlocks(category.content_blocks).filter((b) => {
    if (b.target !== target || !isRenderableCategoryBlock(b)) return false;
    const resolved = resolveCategoryBlockPosition(b, category);
    if (resolved.position !== position) return false;
    return position !== 'after' || resolved.after_id === afterId;
  });
}

/** 1 ブロックの HTML（「画像orテキスト設置」と同じ .content-block を使い、見た目を揃える） */
export function renderCategoryBlockHtml(block: CategoryContentBlock): string {
  if (!isRenderableCategoryBlock(block)) return '';
  if (block.type === 'image') {
    return `<div class="content-block content-block-image category-block" data-block-id="${escapeHtmlText(block.id)}"><img src="${escapeHtmlText((block.image_url || '').trim())}" alt="" loading="lazy"></div>`;
  }
  return `<div class="content-block content-block-text category-block" data-block-id="${escapeHtmlText(block.id)}">${renderColoredTextHtml(block.text || '')}</div>`;
}

/** 指定した場所のブロックをまとめて HTML にする */
export function renderCategoryBlocksAt(
  category: CategoryLike,
  target: CategoryBlockTarget,
  position: CategoryBlockPosition,
  afterId?: string,
): string {
  return categoryBlocksAt(category, target, position, afterId).map(renderCategoryBlockHtml).join('');
}

/** 編集画面の「表示位置」プルダウンの選択肢（一番上 / 一番下 / 各項目のすぐ下） */
export function categoryBlockPositionOptions(
  category: CategoryLike,
  target: CategoryBlockTarget,
): Array<{ value: string; label: string }> {
  const noun = target === 'options' ? 'オプション' : 'メニュー';
  const list = target === 'options' ? category.options || [] : category.menus || [];
  return [
    { value: 'top', label: `${noun}一覧の一番上` },
    { value: 'bottom', label: `${noun}一覧の一番下` },
    ...list.map((m) => ({ value: `after:${m.id}`, label: `「${(m.name || '').replace(/\s+/g, ' ').trim() || '（名称未設定）'}」のすぐ下` })),
  ];
}

/** プルダウンの値 ⇔ position / after_id */
export function categoryBlockPositionKey(block: Pick<CategoryContentBlock, 'position' | 'after_id'>): string {
  return block.position === 'after' && block.after_id ? `after:${block.after_id}` : block.position;
}
export function parseCategoryBlockPositionKey(key: string): { position: CategoryBlockPosition; after_id?: string } {
  if (key.startsWith('after:') && key.length > 6) return { position: 'after', after_id: key.slice(6) };
  return { position: key === 'bottom' ? 'bottom' : 'top' };
}

/** 新しいブロックの既定値（一番下に置く） */
export function createCategoryContentBlock(target: CategoryBlockTarget, id?: string): CategoryContentBlock {
  return {
    id: id || `ccb_${Math.random().toString(36).slice(2, 9)}`,
    type: 'text',
    text: '',
    image_url: '',
    target,
    position: 'bottom',
  };
}
