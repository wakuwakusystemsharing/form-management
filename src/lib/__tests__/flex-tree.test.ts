import { describe, expect, it } from 'vitest';
import {
  addBubble,
  addPart,
  ancestorPaths,
  bubblePathOf,
  describeFlexNode,
  duplicateNode,
  getAt,
  isInlineEditableText,
  moveNode,
  moveNodeTo,
  newFlexPart,
  parentInfo,
  parentPathOf,
  patchNode,
  removeNode,
  walkFlex,
} from '@/lib/flex-tree';
import { validateFlexContents } from '@/lib/line-flex-templates';
import type { FlexContainer } from '@/types/line-flex';

const t = (text: string) => ({ type: 'text', text });
const bubble = (): FlexContainer => ({
  type: 'bubble',
  hero: { type: 'image', url: 'https://a/h.jpg', size: 'full' },
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [t('A'), { type: 'box', layout: 'horizontal', contents: [t('B1'), t('B2')] }, { type: 'separator' }, t('C')],
  },
  footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'go', uri: 'https://x' } }] },
});
const carousel = (): FlexContainer => ({ type: 'carousel', contents: [bubble(), { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [t('X')] } }] });
const texts = (root: FlexContainer, path: string) => ((getAt(root, path)?.contents as Array<{ text?: string; type: string }>) ?? []).map((c) => c.text ?? c.type);

describe('パスでパーツを取り出す・親をたどる', () => {
  it('getAt', () => {
    const b = bubble();
    expect(getAt(b, '')?.type).toBe('bubble');
    expect(getAt(b, 'body/contents/0')?.text).toBe('A');
    expect(getAt(b, 'body/contents/1/contents/1')?.text).toBe('B2');
    expect(getAt(b, 'hero')?.type).toBe('image');
    expect(getAt(b, 'body/contents/9')).toBeUndefined();
    expect(getAt(carousel(), 'contents/1/body/contents/0')?.text).toBe('X');
  });
  it('parentInfo / parentPathOf / ancestorPaths / bubblePathOf', () => {
    const c = carousel();
    expect(parentInfo(c, 'contents/0/body/contents/1/contents/0')).toEqual({ containerPath: 'contents/0/body/contents/1', index: 0, count: 2, axis: 'horizontal' });
    expect(parentInfo(c, 'contents/0/body/contents/2')).toMatchObject({ containerPath: 'contents/0/body', index: 2, count: 4, axis: 'vertical' });
    expect(parentInfo(c, 'contents/1')).toMatchObject({ containerPath: '', index: 1, count: 2, axis: 'horizontal' });
    expect(parentInfo(c, 'contents/0/body')).toBeNull();
    expect(parentInfo(c, '')).toBeNull();
    expect(parentPathOf('contents/0/body/contents/1')).toBe('contents/0/body');
    expect(parentPathOf('contents/0/body')).toBe('contents/0');
    expect(parentPathOf('contents/0')).toBe('');
    expect(parentPathOf('')).toBeNull();
    expect(ancestorPaths('contents/0/body/contents/1')).toEqual(['', 'contents/0', 'contents/0/body', 'contents/0/body/contents/1']);
    expect(bubblePathOf(c, 'contents/1/body/contents/0')).toBe('contents/1');
    expect(bubblePathOf(bubble(), 'body/contents/0')).toBe('');
  });
});

describe('書き換え（元のオブジェクトは変えない）', () => {
  it('patchNode: 上書きし、空の値の項目は消す', () => {
    const b = bubble();
    const next = patchNode(b, 'body/contents/0', { text: 'Z', color: '#ff0000', weight: 'bold' });
    expect(getAt(next, 'body/contents/0')).toEqual({ type: 'text', text: 'Z', color: '#ff0000', weight: 'bold' });
    expect(getAt(b, 'body/contents/0')).toEqual({ type: 'text', text: 'A' });
    expect(getAt(patchNode(next, 'body/contents/0', { color: '', weight: undefined }), 'body/contents/0')).toEqual({ type: 'text', text: 'Z' });
    expect(patchNode(b, 'nope', { text: 'x' })).toBe(b);
  });

  it('moveNode / moveNodeTo: 並びの中で動かし、動いた先のパスを返す', () => {
    const b = bubble();
    const down = moveNode(b, 'body/contents/0', 1)!;
    expect(texts(down.root, 'body')).toEqual(['box', 'A', 'separator', 'C']);
    expect(down.path).toBe('body/contents/1');
    const to = moveNodeTo(b, 'body/contents/0', 3)!;
    expect(texts(to.root, 'body')).toEqual(['box', 'separator', 'C', 'A']);
    expect(to.path).toBe('body/contents/3');
    expect(moveNode(b, 'body/contents/0', -1)).toBeNull(); // 先頭は上に動かない
    expect(moveNode(b, 'body', 1)).toBeNull(); // ブロックは並びの中に無い
    const c = moveNode(carousel(), 'contents/1', -1)!;
    expect(getAt(c.root, 'contents/0/body/contents/0')?.text).toBe('X');
    expect(texts(b, 'body')).toEqual(['A', 'box', 'separator', 'C']);
  });

  it('removeNode: 並びのパーツ・ブロックを消す。最後のカード・唯一のブロックは消せない', () => {
    const b = bubble();
    expect(texts(removeNode(b, 'body/contents/1')!, 'body')).toEqual(['A', 'separator', 'C']);
    const noFooter = removeNode(b, 'footer')!;
    expect(noFooter.footer).toBeUndefined();
    expect(noFooter.body).toBeDefined();
    expect(removeNode(b, '')).toBeNull();
    const onlyBody: FlexContainer = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [t('A')] } };
    expect(removeNode(onlyBody, 'body')).toBeNull();
    const c = carousel();
    const one = removeNode(c, 'contents/0')!;
    expect((one.contents as unknown[]).length).toBe(1);
    expect(removeNode(one, 'contents/0')).toBeNull();
  });

  it('duplicateNode: すぐ後ろに複製する（別のオブジェクト）', () => {
    const b = bubble();
    const d = duplicateNode(b, 'body/contents/1')!;
    expect(texts(d.root, 'body')).toEqual(['A', 'box', 'box', 'separator', 'C']);
    expect(d.path).toBe('body/contents/2');
    expect(getAt(d.root, 'body/contents/2')).not.toBe(getAt(d.root, 'body/contents/1'));
    expect(duplicateNode(b, 'body')).toBeNull();
    const full: FlexContainer = { type: 'carousel', contents: Array.from({ length: 12 }, () => ({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [t('x')] } })) };
    expect(duplicateNode(full, 'contents/0')).toBeNull();
  });
});

describe('パーツを足す', () => {
  it('addPart: 箱を選んでいれば中の末尾、並びのパーツならすぐ後ろ、それ以外はカードの本文の末尾', () => {
    const b = bubble();
    const inBox = addPart(b, 'body/contents/1', t('N'))!;
    expect(texts(inBox.root, 'body/contents/1')).toEqual(['B1', 'B2', 'N']);
    expect(inBox.path).toBe('body/contents/1/contents/2');
    const after = addPart(b, 'body/contents/0', t('N'))!;
    expect(texts(after.root, 'body')).toEqual(['A', 'N', 'box', 'separator', 'C']);
    const none = addPart(b, null, t('N'))!;
    expect(texts(none.root, 'body')).toEqual(['A', 'box', 'separator', 'C', 'N']);
    const onHero = addPart(b, 'hero', t('N'))!;
    expect(onHero.path).toBe('body/contents/4');
    const second = addPart(carousel(), 'contents/1', t('N'))!;
    expect(texts(second.root, 'contents/1/body')).toEqual(['X', 'N']);
  });
  it('addPart: 本文の無いカードには本文を作る', () => {
    const heroOnly: FlexContainer = { type: 'bubble', hero: { type: 'image', url: 'https://a/h.jpg' } };
    const r = addPart(heroOnly, null, t('N'))!;
    expect(texts(r.root, 'body')).toEqual(['N']);
    expect(validateFlexContents(r.root)).toBeNull();
  });
  it('addBubble: カード 1 枚ならカルーセルにする。大きさは既存のカードに合わせ、12 枚まで', () => {
    const single: FlexContainer = { ...bubble(), size: 'kilo' };
    const r = addBubble(single, null)!;
    expect(r.root.type).toBe('carousel');
    expect((r.root.contents as Array<{ size?: string }>).map((x) => x.size)).toEqual(['kilo', 'kilo']);
    expect(r.path).toBe('contents/1');
    expect(validateFlexContents(r.root)).toBeNull();
    const mid = addBubble(carousel(), 'contents/0/body/contents/0')!;
    expect(mid.path).toBe('contents/1');
    expect((mid.root.contents as unknown[]).length).toBe(3);
    const full: FlexContainer = { type: 'carousel', contents: Array.from({ length: 12 }, () => newFlexPart('bubble')) };
    expect(addBubble(full, null)).toBeNull();
  });
  it('newFlexPart の初期値は LINE の形式として通る', () => {
    for (const kind of ['text', 'button', 'separator', 'box'] as const) {
      const r = addPart(bubble(), null, newFlexPart(kind, { linkUrl: 'https://liff.line.me/1-a' }))!;
      expect(validateFlexContents(r.root)).toBeNull();
    }
    expect(newFlexPart('button', { linkUrl: 'https://liff.line.me/1-a' })).toMatchObject({ action: { type: 'uri', uri: 'https://liff.line.me/1-a' } });
    expect(newFlexPart('image', { url: 'https://a/b.jpg' })).toMatchObject({ type: 'image', url: 'https://a/b.jpg' });
  });
});

describe('表示名・列挙', () => {
  it('describeFlexNode', () => {
    const c = carousel();
    expect(describeFlexNode(getAt(c, ''), '')).toBe('カルーセル');
    expect(describeFlexNode(getAt(c, 'contents/1'), 'contents/1')).toBe('カード 2');
    expect(describeFlexNode(getAt(c, 'contents/0/body'), 'contents/0/body')).toBe('本文');
    expect(describeFlexNode(getAt(c, 'contents/0/footer'), 'contents/0/footer')).toBe('フッター');
    expect(describeFlexNode(getAt(c, 'contents/0/body/contents/1'), 'contents/0/body/contents/1')).toBe('箱（横並び）');
    expect(describeFlexNode(getAt(c, 'contents/0/body/contents/0'), 'contents/0/body/contents/0')).toBe('文字');
    expect(describeFlexNode(getAt(bubble(), ''), '')).toBe('カード');
  });
  it('isInlineEditableText: 色分け（span）を持つ文字はその場で編集しない', () => {
    expect(isInlineEditableText({ type: 'text', text: 'a' })).toBe(true);
    expect(isInlineEditableText({ type: 'text', text: 'a', contents: [{ type: 'span', text: 'a' }] })).toBe(false);
    expect(isInlineEditableText({ type: 'image' })).toBe(false);
  });
  it('walkFlex はすべてのパーツをパス付きでたどる', () => {
    const seen: string[] = [];
    walkFlex(carousel(), (n, p) => seen.push(`${p}:${String(n.type)}`));
    expect(seen).toContain(':carousel');
    expect(seen).toContain('contents/0/hero:image');
    expect(seen).toContain('contents/0/body/contents/1/contents/1:text');
    expect(seen).toContain('contents/1/body/contents/0:text');
    expect(seen).toHaveLength(15);
  });
});
