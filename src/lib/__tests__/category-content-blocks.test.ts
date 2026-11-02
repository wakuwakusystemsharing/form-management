import { describe, expect, it } from 'vitest';
import {
  categoryBlockPositionKey,
  categoryBlockPositionOptions,
  categoryBlocksAt,
  parseCategoryBlockPositionKey,
  renderCategoryBlocksAt,
  resolveCategoryBlockPosition,
  sanitizeCategoryContentBlocks,
} from '../category-content-blocks';

const category = {
  menus: [{ id: 'm1', name: 'カット' }, { id: 'm2', name: 'カラー' }],
  options: [{ id: 'o1', name: '眉カット' }],
  content_blocks: [
    { id: 'b1', type: 'text', text: 'メニュー上', target: 'menus', position: 'top' },
    { id: 'b2', type: 'text', text: '[color=#dc2626]カットの下[/color]', target: 'menus', position: 'after', after_id: 'm1' },
    { id: 'b3', type: 'image', image_url: 'https://example.com/a.png', target: 'menus', position: 'bottom' },
    { id: 'b4', type: 'text', text: '   ', target: 'menus', position: 'bottom' }, // 空は描画しない
    { id: 'b5', type: 'image', image_url: 'javascript:alert(1)', target: 'options', position: 'top' }, // https 以外は描画しない
    { id: 'b6', type: 'text', text: 'オプション下', target: 'options', position: 'bottom' },
    { id: 'b7', type: 'text', text: '消えたメニューの下', target: 'menus', position: 'after', after_id: 'gone' },
    { id: 'b8', type: 'text', text: '眉の下', target: 'options', position: 'after', after_id: 'o1' },
  ],
};

describe('category-content-blocks: 正規化', () => {
  it('配列以外・id 無し・不正な型は捨て、target / position は既定値で補う', () => {
    expect(sanitizeCategoryContentBlocks(null)).toEqual([]);
    expect(sanitizeCategoryContentBlocks([{ type: 'text' }, 'x', null])).toEqual([]);
    const [b] = sanitizeCategoryContentBlocks([{ id: 'a', type: 'weird', position: 'nowhere', target: 'nope', text: 'x' }]);
    expect(b).toEqual({ id: 'a', type: 'text', target: 'menus', position: 'top', text: 'x' });
  });
  it('after なのに after_id が無ければ bottom に落とす', () => {
    const [b] = sanitizeCategoryContentBlocks([{ id: 'a', type: 'text', text: 'x', target: 'menus', position: 'after' }]);
    expect(b.position).toBe('bottom');
  });
});

describe('category-content-blocks: 表示位置の解決と抽出', () => {
  it('一番上 / 一番下 / 特定メニューのすぐ下 をそれぞれ取り出す（配列順）', () => {
    expect(categoryBlocksAt(category, 'menus', 'top').map((b) => b.id)).toEqual(['b1']);
    expect(categoryBlocksAt(category, 'menus', 'after', 'm1').map((b) => b.id)).toEqual(['b2']);
    expect(categoryBlocksAt(category, 'menus', 'after', 'm2')).toEqual([]);
    // b4 は空テキストなので除外、b7 は参照先が消えたので bottom へ
    expect(categoryBlocksAt(category, 'menus', 'bottom').map((b) => b.id)).toEqual(['b3', 'b7']);
  });
  it('オプション欄も同じ（https 以外の画像は描画しない）', () => {
    expect(categoryBlocksAt(category, 'options', 'top')).toEqual([]);
    expect(categoryBlocksAt(category, 'options', 'bottom').map((b) => b.id)).toEqual(['b6']);
    expect(categoryBlocksAt(category, 'options', 'after', 'o1').map((b) => b.id)).toEqual(['b8']);
  });
  it('参照先が無くなった after は bottom として扱う', () => {
    expect(resolveCategoryBlockPosition({ id: 'x', type: 'text', target: 'menus', position: 'after', after_id: 'gone' }, category)).toEqual({ position: 'bottom' });
    expect(resolveCategoryBlockPosition({ id: 'x', type: 'text', target: 'menus', position: 'after', after_id: 'm2' }, category)).toEqual({ position: 'after', after_id: 'm2' });
  });
});

describe('category-content-blocks: HTML', () => {
  it('テキストは色タグを span に、画像は img に。エスケープされる', () => {
    const html = renderCategoryBlocksAt(category, 'menus', 'after', 'm1');
    expect(html).toContain('class="content-block content-block-text category-block"');
    expect(html).toContain('<span style="color:#dc2626">カットの下</span>');
    const img = renderCategoryBlocksAt(category, 'menus', 'bottom');
    expect(img).toContain('<img src="https://example.com/a.png"');
    const bad = renderCategoryBlocksAt({ content_blocks: [{ id: 'z', type: 'text', text: '<b>x</b>', target: 'menus', position: 'top' }] }, 'menus', 'top');
    expect(bad).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('category-content-blocks: 編集画面のプルダウン', () => {
  it('一番上 / 一番下 + 各項目のすぐ下', () => {
    const opts = categoryBlockPositionOptions(category, 'menus');
    expect(opts.map((o) => o.value)).toEqual(['top', 'bottom', 'after:m1', 'after:m2']);
    expect(opts[2].label).toBe('「カット」のすぐ下');
    expect(categoryBlockPositionOptions(category, 'options').map((o) => o.label)).toEqual(['オプション一覧の一番上', 'オプション一覧の一番下', '「眉カット」のすぐ下']);
  });
  it('キーの往復', () => {
    expect(categoryBlockPositionKey({ position: 'after', after_id: 'm1' })).toBe('after:m1');
    expect(parseCategoryBlockPositionKey('after:m1')).toEqual({ position: 'after', after_id: 'm1' });
    expect(parseCategoryBlockPositionKey('bottom')).toEqual({ position: 'bottom' });
    expect(parseCategoryBlockPositionKey('after:')).toEqual({ position: 'top' });
  });
});
