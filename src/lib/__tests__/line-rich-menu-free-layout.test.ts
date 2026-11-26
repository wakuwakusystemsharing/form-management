/**
 * リッチメニュー: ボタンを自由に置く（8 方向の大きさ変更・吸い付き・空き場所探し・マス目・数字で合わせる）
 */
import { describe, expect, it } from 'vitest';
import {
  RICH_MENU_LIMITS,
  areasOverlap,
  buildGridAreas,
  findFreeRect,
  magnetRect,
  rectPercent,
  resizeRectBy,
  setRectField,
  validateRichMenu,
  type RichMenuArea,
} from '@/lib/line-rich-menu';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const area = (id: string, x: number, y: number, w: number, h: number, action: RichMenuArea['action'] = { type: 'none' }): RichMenuArea => ({ id, x, y, w, h, action });

describe('つまみで大きさを変える', () => {
  const base = R(0.2, 0.2, 0.4, 0.4);

  it('引いた側の辺だけが動く', () => {
    expect(resizeRectBy(base, 'e', 0.1, 0.3)).toEqual(R(0.2, 0.2, 0.5, 0.4));
    expect(resizeRectBy(base, 'w', -0.1, 0.3)).toEqual(R(0.1, 0.2, 0.5, 0.4));
    expect(resizeRectBy(base, 'n', 0.3, -0.1)).toEqual(R(0.2, 0.1, 0.4, 0.5));
    expect(resizeRectBy(base, 's', 0.3, 0.1)).toEqual(R(0.2, 0.2, 0.4, 0.5));
    expect(resizeRectBy(base, 'nw', 0.1, 0.1)).toEqual(R(0.3, 0.3, 0.3, 0.3));
    expect(resizeRectBy(base, 'se', 0.1, 0.1)).toEqual(R(0.2, 0.2, 0.5, 0.5));
  });

  it('最小の大きさより小さくならず、反対側の辺を追い越さない', () => {
    const min = RICH_MENU_LIMITS.minAreaRatio;
    expect(resizeRectBy(base, 'w', 0.9, 0)).toEqual(R(0.55, 0.2, min, 0.4));
    expect(resizeRectBy(base, 'e', -0.9, 0)).toEqual(R(0.2, 0.2, min, 0.4));
    expect(resizeRectBy(base, 'n', 0, 0.9)).toEqual(R(0.2, 0.55, 0.4, min));
  });

  it('画像の外には出ない', () => {
    expect(resizeRectBy(base, 'nw', -0.9, -0.9)).toEqual(R(0, 0, 0.6, 0.6));
    expect(resizeRectBy(base, 'se', 0.9, 0.9)).toEqual(R(0.2, 0.2, 0.8, 0.8));
  });
});

describe('吸い付き', () => {
  const others = [R(0, 0, 0.5, 0.5)];

  it('動かしているとき: となりのボタンの辺に寄る（大きさは変わらない）', () => {
    expect(magnetRect(R(0.51, 0.01, 0.3, 0.3), others, 'move')).toEqual(R(0.5, 0, 0.3, 0.3));
  });

  it('動かしているとき: 画像の端に寄る', () => {
    expect(magnetRect(R(0.69, 0.69, 0.3, 0.3), [], 'move')).toEqual(R(0.7, 0.7, 0.3, 0.3));
  });

  it('遠いときは寄らない', () => {
    expect(magnetRect(R(0.55, 0.6, 0.3, 0.3), others, 'move')).toEqual(R(0.55, 0.6, 0.3, 0.3));
  });

  it('大きさを変えているとき: 引いている辺だけが寄る', () => {
    // 右の辺を引いていて 0.49 → となりの右端 0.5 に寄る。左の辺は動かない
    expect(magnetRect(R(0.13, 0.6, 0.36, 0.2), others, 'e')).toEqual(R(0.13, 0.6, 0.37, 0.2));
    // 上の辺を引いていて 0.51 → となりの下端 0.5 に寄る
    expect(magnetRect(R(0.6, 0.51, 0.2, 0.2), others, 'n')).toEqual(R(0.6, 0.5, 0.2, 0.21));
  });

  it('寄せても、最小の大きさより小さくならない', () => {
    const r = magnetRect(R(0.5, 0.6, 0.06, 0.2), [R(0.55, 0, 0.2, 0.2)], 'e');
    expect(r.w).toBeGreaterThanOrEqual(RICH_MENU_LIMITS.minAreaRatio);
  });
});

describe('空いている場所を探す（ボタンを足す）', () => {
  it('何も無ければ左上', () => {
    expect(findFreeRect([])).toEqual(R(0, 0, 0.25, 0.25));
  });

  it('いまのボタンと重ならない場所を返す', () => {
    const areas = [R(0, 0, 0.5, 1)];
    const free = findFreeRect(areas)!;
    expect(free).toEqual(R(0.5, 0, 0.25, 0.25));
    expect(areas.some((a) => areasOverlap(a, free))).toBe(false);
  });

  it('大きい場所が無ければ、小さくして探す', () => {
    const free = findFreeRect([R(0, 0, 1, 0.9)])!;
    expect(free.y).toBeGreaterThanOrEqual(0.9);
    expect(free.h).toBeLessThanOrEqual(0.1);
  });

  it('全部埋まっていれば null', () => {
    expect(findFreeRect([R(0, 0, 1, 1)])).toBeNull();
  });
});

describe('マス目で作る', () => {
  it('横 4 × 縦 2 = 8 個。すき間・重なり・はみ出しが無く、そのまま保存できる', () => {
    const areas = buildGridAreas(4, 2)!;
    expect(areas).toHaveLength(8);
    expect(areas[0]).toMatchObject({ id: 'a1', x: 0, y: 0, w: 0.25, h: 0.5 });
    expect(areas[7]).toMatchObject({ id: 'a8', x: 0.75, y: 0.5, w: 0.25, h: 0.5 });
    expect(validateRichMenu({ name: 'x', size: 'large', image_url: '', areas, chat_bar_text: 'メニュー', open_by_default: true, rule: null })).toEqual([]);
  });

  it('割り切れない数（横 3・横 6・縦 3）でも、右端・下端がぴったり 100% で重ならない', () => {
    for (const [cols, rows] of [[3, 3], [6, 3], [5, 4], [1, 1]] as const) {
      const areas = buildGridAreas(cols, rows)!;
      expect(areas).toHaveLength(cols * rows);
      const last = areas[areas.length - 1];
      expect(Math.round((last.x + last.w) * 10000)).toBe(10000);
      expect(Math.round((last.y + last.h) * 10000)).toBe(10000);
      for (let i = 0; i < areas.length; i++) for (let j = i + 1; j < areas.length; j++) expect(areasOverlap(areas[i], areas[j])).toBe(false);
    }
  });

  it('いまのボタンの動きを、上から順に引き継ぐ', () => {
    const current = [area('x', 0, 0, 1, 1, { type: 'message', text: '予約確認' })];
    const areas = buildGridAreas(2, 1, current)!;
    expect(areas.map((a) => a.action)).toEqual([{ type: 'message', text: '予約確認' }, { type: 'none' }]);
  });

  it('20 個を超える・範囲の外の数は作らない', () => {
    expect(buildGridAreas(6, 4)).toBeNull();
    expect(buildGridAreas(7, 1)).toBeNull();
    expect(buildGridAreas(0, 1)).toBeNull();
    expect(buildGridAreas(2.5, 1)).toBeNull();
  });
});

describe('数字で合わせる', () => {
  const base = R(0.2, 0.2, 0.4, 0.4);

  it('% で位置・大きさを直す', () => {
    expect(setRectField(base, 'x', 33.3)).toEqual(R(0.333, 0.2, 0.4, 0.4));
    expect(setRectField(base, 'w', 12.5)).toEqual(R(0.2, 0.2, 0.125, 0.4));
  });

  it('画像の中に収める。最小の大きさより小さくしない', () => {
    expect(setRectField(base, 'x', 90)).toEqual(R(0.6, 0.2, 0.4, 0.4));
    expect(setRectField(base, 'y', -5)).toEqual(R(0.2, 0, 0.4, 0.4));
    expect(setRectField(base, 'h', 100)).toEqual(R(0.2, 0.2, 0.4, 0.8));
    expect(setRectField(base, 'w', 1)).toEqual(R(0.2, 0.2, RICH_MENU_LIMITS.minAreaRatio, 0.4));
    expect(setRectField(base, 'w', NaN)).toEqual(base);
  });

  it('画面に出す %', () => {
    expect(rectPercent(0.3333)).toBe(33.3);
    expect(rectPercent(0.25)).toBe(25);
  });
});
