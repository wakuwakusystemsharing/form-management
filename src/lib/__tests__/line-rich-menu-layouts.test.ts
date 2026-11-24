/**
 * リッチメニュー: 分割の型と、タブ切り替え（別のメニューに切り替える）
 */
import { describe, expect, it } from 'vitest';
import {
  RICH_MENU_ALIAS_PREFIX,
  RICH_MENU_LAYOUTS,
  SWITCH_GROUP_MAX,
  applyRichMenuLayout,
  areaToBounds,
  areasOverlap,
  buildRichMenuAliasId,
  buildRichMenuObject,
  collectSwitchGroup,
  describeRichMenuAction,
  layoutDropsActions,
  layoutsForSize,
  menusSwitchingTo,
  normalizeRichMenuAreas,
  switchTargetsOf,
  validateRichMenu,
  type RichMenuArea,
  type RichMenuInput,
} from '../line-rich-menu';

const area = (id: string, x: number, y: number, w: number, h: number, action: RichMenuArea['action'] = { type: 'message', text: '予約確認' }): RichMenuArea => ({ id, x, y, w, h, action });
const menu = (id: string, name: string, areas: RichMenuArea[]) => ({ id, name, areas });
const sw = (menuId: string): RichMenuArea['action'] => ({ type: 'switch', menu_id: menuId });

describe('分割の型', () => {
  it('どの型も、範囲が重ならず、画像をすき間なく埋める', () => {
    for (const layout of RICH_MENU_LAYOUTS) {
      const areas = normalizeRichMenuAreas(layout.rects.map((r) => ({ ...r, action: { type: 'none' } })));
      for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) expect(areasOverlap(areas[i], areas[j]), `${layout.id} ${i}/${j}`).toBe(false);
      for (const size of layout.sizes) {
        // 実寸の面積の合計が、画像全体と同じ（すき間も重なりも無い）
        const total = areas.map((a) => areaToBounds(a, size)).reduce((sum, b) => sum + b.width * b.height, 0);
        expect(total, `${layout.id} ${size}`).toBe(size === 'large' ? 2500 * 1686 : 2500 * 843);
      }
    }
  });

  it('型は保存できる内容になっている（小さすぎない・20 個以内）', () => {
    for (const layout of RICH_MENU_LAYOUTS) {
      for (const size of layout.sizes) {
        const areas = applyRichMenuLayout(layout.id, size, []);
        expect(areas, layout.id).not.toBeNull();
        const input: RichMenuInput = { name: 'テスト', size, image_url: '', areas: areas as RichMenuArea[], chat_bar_text: 'メニュー', open_by_default: true };
        expect(validateRichMenu(input), layout.id).toEqual([]);
      }
    }
  });

  it('大きさごとに使える型が違う', () => {
    expect(layoutsForSize('large').map((l) => l.id)).toEqual(['l6', 'l4', 'l1-3', 'l1-2', 'lside', 'lrows', 'c2', 'c1']);
    expect(layoutsForSize('small').map((l) => l.id)).toEqual(['c3', 'c1-2', 'c2-1', 'c2', 'c1']);
    expect(applyRichMenuLayout('l6', 'small', [])).toBeNull();
    expect(applyRichMenuLayout('nope', 'large', [])).toBeNull();
  });

  it('6 分割: 左上から右下の順に 6 つ', () => {
    const areas = applyRichMenuLayout('l6', 'large', []) as RichMenuArea[];
    expect(areas.map((a) => a.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(areaToBounds(areas[0], 'large')).toEqual({ x: 0, y: 0, width: 833, height: 843 });
    expect(areaToBounds(areas[5], 'large')).toEqual({ x: 1667, y: 843, width: 833, height: 843 });
  });

  it('いまのボタンの動きは、上から順に引き継ぐ。あふれたぶんは捨てる', () => {
    const current = [area('x', 0, 0, 0.3, 0.3, { type: 'message', text: '予約確認' }), area('y', 0.5, 0.5, 0.3, 0.3, { type: 'uri', uri: 'https://example.com' }), area('z', 0, 0.7, 0.2, 0.2, { type: 'form', form_id: 'f1' })];
    const two = applyRichMenuLayout('c2', 'large', current) as RichMenuArea[];
    expect(two.map((a) => a.action)).toEqual([{ type: 'message', text: '予約確認' }, { type: 'uri', uri: 'https://example.com' }]);
    expect(layoutDropsActions('c2', 'large', current)).toBe(1);
    const six = applyRichMenuLayout('l6', 'large', current) as RichMenuArea[];
    expect(six.map((a) => a.action.type)).toEqual(['message', 'uri', 'form', 'none', 'none', 'none']);
    expect(layoutDropsActions('l6', 'large', current)).toBe(0);
  });
});

describe('タブ切り替え', () => {
  const a = menu('menu-a', 'メニュー A', [area('a1', 0, 0, 0.5, 1), area('a2', 0.5, 0, 0.5, 1, sw('menu-b'))]);
  const b = menu('menu-b', 'メニュー B', [area('a1', 0, 0, 0.5, 1, sw('menu-a')), area('a2', 0.5, 0, 0.5, 1, sw('menu-c'))]);
  const c = menu('menu-c', 'メニュー C', [area('a1', 0, 0, 1, 1, sw('menu-a'))]);
  const alone = menu('menu-x', 'ひとりのメニュー', [area('a1', 0, 0, 1, 1)]);

  it('切り替え先を、重ならないように集める', () => {
    expect(switchTargetsOf(b)).toEqual(['menu-a', 'menu-c']);
    expect(switchTargetsOf(alone)).toEqual([]);
    expect(switchTargetsOf(menu('m', 'm', [area('1', 0, 0, 0.5, 1, sw('menu-a')), area('2', 0.5, 0, 0.5, 1, sw('menu-a'))]))).toEqual(['menu-a']);
  });

  it('反映するメニューと、切り替えでつながっているメニューをまとめる（最初が反映するメニュー）', () => {
    const r = collectSwitchGroup('menu-a', [alone, c, b, a]);
    expect(r.ok && r.group.map((m) => m.id)).toEqual(['menu-a', 'menu-b', 'menu-c']);
    const single = collectSwitchGroup('menu-x', [alone, a, b, c]);
    expect(single.ok && single.group.map((m) => m.id)).toEqual(['menu-x']);
  });

  it('切り替え先が消えている・数が多すぎるときは失敗', () => {
    const gone = collectSwitchGroup('menu-a', [a]);
    expect(gone).toMatchObject({ ok: false });
    if (!gone.ok) expect(gone.error).toContain('メニュー A');
    const chain = Array.from({ length: SWITCH_GROUP_MAX + 1 }, (_, i) => menu(`m${i}`, `m${i}`, [area('a1', 0, 0, 1, 1, sw(`m${i + 1}`))]));
    chain.push(menu(`m${SWITCH_GROUP_MAX + 1}`, 'last', [area('a1', 0, 0, 1, 1)]));
    const many = collectSwitchGroup('m0', chain);
    expect(many).toMatchObject({ ok: false });
    if (!many.ok) expect(many.error).toContain(`${SWITCH_GROUP_MAX} 個まで`);
    expect(collectSwitchGroup('nope', [a])).toMatchObject({ ok: false });
  });

  it('そのメニューを切り替え先にしているメニュー', () => {
    expect(menusSwitchingTo('menu-a', [a, b, c, alone]).map((m) => m.id)).toEqual(['menu-b', 'menu-c']);
    expect(menusSwitchingTo('menu-x', [a, b, c, alone])).toEqual([]);
  });

  it('名札は LINE の決まり（32 文字まで・英小文字 / 数字 / _ / -）に収まり、反映のたびに変わる', () => {
    const id = buildRichMenuAliasId('94B82833-0ADC-4EB5-88F5-FDDC6CE20F29', 'mwudamc7');
    expect(id).toBe(`${RICH_MENU_ALIAS_PREFIX}94b828330adc-mwudamc7`);
    expect(id.length).toBeLessThanOrEqual(32);
    expect(id).toMatch(/^[a-z0-9_-]+$/);
    expect(buildRichMenuAliasId('94B82833-0ADC-4EB5-88F5-FDDC6CE20F29', 'mwudamc8')).not.toBe(id);
    expect(buildRichMenuAliasId('', 'あ')).toMatch(/^[a-z0-9_-]+$/);
    expect(buildRichMenuAliasId('x'.repeat(100), 'y'.repeat(100)).length).toBeLessThanOrEqual(32);
  });

  it('検証: 切り替え先が未選択・自分自身・消えたメニューは反映できない（下書きの保存はできる）', () => {
    const input = (action: RichMenuArea['action']): RichMenuInput => ({ name: 'テスト', size: 'small', image_url: 'https://example.com/a.jpg', areas: [area('a1', 0, 0, 1, 1, action)], chat_bar_text: 'メニュー', open_by_default: true });
    expect(validateRichMenu(input(sw('')))).toEqual([]);
    expect(validateRichMenu(input(sw('')), { forPublish: true }).join()).toContain('切り替え先のメニューを選んで');
    expect(validateRichMenu(input(sw('self')), { forPublish: true, selfId: 'self', menuIds: ['self'] }).join()).toContain('このメニュー自身');
    expect(validateRichMenu(input(sw('gone')), { forPublish: true, menuIds: ['other'] }).join()).toContain('見つかりません');
    expect(validateRichMenu(input(sw('other')), { forPublish: true, menuIds: ['other'], selfId: 'self' })).toEqual([]);
  });

  it('LINE に送る形: 切り替えのボタンは、名札を書いた richmenuswitch にする', () => {
    const input: RichMenuInput = { name: 'A', size: 'small', image_url: 'x', areas: a.areas, chat_bar_text: 'メニュー', open_by_default: true };
    const r = buildRichMenuObject(input, () => null, (id) => (id === 'menu-b' ? 'nasrsv-menub-1' : null));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const areas = r.object.areas as Array<{ action: Record<string, unknown> }>;
    expect(areas[1].action).toMatchObject({ type: 'richmenuswitch', richMenuAliasId: 'nasrsv-menub-1' });
    expect(typeof areas[1].action.data).toBe('string');
    // 名札が無ければ失敗する
    expect(buildRichMenuObject(input, () => null).ok).toBe(false);
  });

  it('一覧に出す説明', () => {
    const name = (id: string) => (id === 'menu-b' ? 'メニュー B' : null);
    expect(describeRichMenuAction(sw('menu-b'), () => null, name)).toBe('メニューを切り替える: メニュー B');
    expect(describeRichMenuAction(sw('gone'), () => null, name)).toContain('削除されたメニュー');
    expect(describeRichMenuAction(sw(''), () => null, name)).toContain('未選択');
  });
});
