import { describe, expect, it } from 'vitest';
import { applyFlexEdit, currentFlexContents, isTemplateLinked, validSelection, type FlexEditState } from '@/lib/flex-edit';
import { getAt, newFlexPart } from '@/lib/flex-tree';
import { defaultTemplateData } from '@/lib/line-flex-templates';
import type { BookingCardData, FlexContainer, MenuCarouselData } from '@/types/line-flex';

const booking = (): FlexEditState => ({
  template: 'booking_card',
  data: { ...(defaultTemplateData('booking_card') as BookingCardData), title: '見出し', text: '説明', buttons: [] },
  flexOverride: null,
});
const carousel = (): FlexEditState => ({
  template: 'menu_carousel',
  data: {
    ...(defaultTemplateData('menu_carousel') as MenuCarouselData),
    items: [
      { key: 'a', name: 'カット', price: '', duration: '', description: '', image_url: '', button: null },
      { key: 'b', name: 'カラー', price: '', duration: '', description: '', image_url: '', button: null },
    ],
  },
  flexOverride: null,
});
const findText = (c: FlexContainer, text: string): string | null => {
  let hit: string | null = null;
  const walk = (n: unknown, p: string) => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.type === 'text' && o.text === text) hit = p;
    for (const k of ['header', 'hero', 'body', 'footer']) if (o[k]) walk(o[k], p ? `${p}/${k}` : k);
    if (Array.isArray(o.contents)) o.contents.forEach((x, i) => walk(x, p ? `${p}/contents/${i}` : `contents/${i}`));
  };
  walk(c, '');
  return hit;
};

describe('applyFlexEdit: テンプレート連動', () => {
  it('文字の書き換えは入力値に書き戻す（自由編集にならない）', () => {
    const s = booking();
    const path = findText(currentFlexContents(s)!, '見出し')!;
    const r = applyFlexEdit(s, { type: 'text', path, text: '新しい見出し' }, path)!;
    expect((r.data as BookingCardData).title).toBe('新しい見出し');
    expect(r.flexOverride).toBeUndefined();
    expect(r.becameFree).toBeUndefined();
    expect(r.typing).toBe(true);
  });
  it('カードの並び替えは一覧の順番を入れ替え、動いた先を選び直す', () => {
    const s = carousel();
    const r = applyFlexEdit(s, { type: 'move', path: 'contents/0', dir: 1 }, 'contents/0')!;
    expect((r.data as MenuCarouselData).items.map((x) => x.name)).toEqual(['カラー', 'カット']);
    expect(r.selected).toBe('contents/1');
    expect(r.typing).toBe(false);
    // 端より先へは何もしない（自由編集にもならない）
    expect(applyFlexEdit(s, { type: 'move', path: 'contents/0', dir: -1 }, 'contents/0')).toBeNull();
  });
  it('一覧の 1 件の削除は入力値から消し、選択を外す', () => {
    const r = applyFlexEdit(carousel(), { type: 'remove', path: 'contents/1' }, 'contents/1')!;
    expect((r.data as MenuCarouselData).items.map((x) => x.name)).toEqual(['カット']);
    expect(r.selected).toBeNull();
  });
});

describe('applyFlexEdit: 自由編集', () => {
  it('見た目の変更・パーツの追加は Flex を書き換え、自由編集に切り替わる', () => {
    const s = booking();
    const path = findText(currentFlexContents(s)!, '見出し')!;
    const r = applyFlexEdit(s, { type: 'patch', path, patch: { color: '#ff0000' } }, path)!;
    expect(r.data).toBeUndefined();
    expect(getAt(r.flexOverride!, path)?.color).toBe('#ff0000');
    expect(r.becameFree).toBe(true);

    const added = applyFlexEdit(s, { type: 'add', node: newFlexPart('button') }, path)!;
    expect(getAt(added.flexOverride!, added.selected as string)?.type).toBe('button');
  });
  it('すでに自由編集中なら becameFree は立たない。文字を空にするとそのパーツを消す', () => {
    const s = booking();
    const free: FlexEditState = { ...s, flexOverride: currentFlexContents(s) };
    expect(isTemplateLinked(free)).toBe(false);
    const path = findText(free.flexOverride!, '説明')!;
    const r = applyFlexEdit(free, { type: 'text', path, text: ' ' }, path)!;
    expect(r.becameFree).toBe(false);
    expect(findText(r.flexOverride!, '説明')).toBeNull();
    expect(r.selected).toBeNull();
  });
  it('カルーセルのカードの大きさは全カードに適用する', () => {
    const s = carousel();
    const r = applyFlexEdit(s, { type: 'patch', path: 'contents/0', patch: { size: 'giga' } }, 'contents/0')!;
    expect((r.flexOverride!.contents as Array<{ size?: string }>).map((b) => b.size)).toEqual(['giga', 'giga']);
  });
  it('できない操作は理由を返し、内容は変えない', () => {
    const one: FlexEditState = { template: 'custom', data: {} as never, flexOverride: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: 'a' }] } } };
    const r = applyFlexEdit(one, { type: 'remove', path: 'body' }, 'body')!;
    expect(r.error).toBeTruthy();
    expect(r.flexOverride).toBeUndefined();
  });
  it('内容が空（自由入力）のときは、追加でカードを作る', () => {
    const empty: FlexEditState = { template: 'custom', data: {} as never, flexOverride: null };
    expect(currentFlexContents(empty)).toBeNull();
    expect(applyFlexEdit(empty, { type: 'remove', path: 'body' }, null)).toBeNull();
    const r = applyFlexEdit(empty, { type: 'addBubble' }, null)!;
    expect(r.flexOverride?.type).toBe('bubble');
  });
});

describe('validSelection', () => {
  it('いまの内容に無いパスは null', () => {
    const s = booking();
    expect(validSelection(s, 'body')).toBe('body');
    expect(validSelection(s, 'body/contents/99')).toBeNull();
    expect(validSelection(s, null)).toBeNull();
  });
});
