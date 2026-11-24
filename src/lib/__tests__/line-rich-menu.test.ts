import { describe, expect, it } from 'vitest';
import {
  RICH_MENU_KEYWORDS,
  areaToBounds,
  areasOverlap,
  buildRichMenuObject,
  canStartPublish,
  checkRichMenuImage,
  describeLineRichMenuError,
  describeRichMenuAction,
  detectExternalChange,
  isUsableRect,
  moveRect,
  nextAreaId,
  overlapsOthers,
  rectFromDrag,
  resizeRect,
  isRichMenuUri,
  normalizeRichMenuAreas,
  normalizeRichMenuInput,
  readImageInfo,
  validateRichMenu,
  type RichMenuArea,
  type RichMenuInput,
} from '../line-rich-menu';

const area = (id: string, x: number, y: number, w: number, h: number, action: RichMenuArea['action'] = { type: 'message', text: '予約確認' }): RichMenuArea => ({ id, x, y, w, h, action });

const input = (over: Partial<RichMenuInput> = {}): RichMenuInput => ({
  name: 'いつものメニュー',
  size: 'large',
  image_url: 'https://example.com/menu.jpg',
  areas: [area('a1', 0, 0, 0.5, 1), area('a2', 0.5, 0, 0.5, 1, { type: 'form', form_id: 'form1' })],
  chat_bar_text: 'メニュー',
  open_by_default: true,
  ...over,
});

/** 大きさだけを持つ最小の PNG / JPEG の先頭 */
function pngHeader(width: number, height: number, total = 64): Uint8Array {
  const b = new Uint8Array(total);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255, (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 16);
  return b;
}
function jpegHeader(width: number, height: number): Uint8Array {
  // SOI + APP0（16 バイト）+ SOF0
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

describe('正規化', () => {
  it('範囲を画像の中に収め、小数 4 桁に丸める', () => {
    const [a] = normalizeRichMenuAreas([{ id: 'x', x: 0.8, y: -0.2, w: 0.5, h: 2, action: { type: 'none' } }]);
    expect(a).toMatchObject({ id: 'x', x: 0.8, y: 0, w: 0.2, h: 1 });
    expect(normalizeRichMenuAreas([{ x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 }])[0]).toMatchObject({ x: 0.3333, w: 0.3333 });
  });

  it('ID が無い・重なっているときは振り直す', () => {
    const list = normalizeRichMenuAreas([{ id: 'a' }, { id: 'a' }, { id: '<script>' }, {}]);
    expect(new Set(list.map((a) => a.id)).size).toBe(4);
    expect(list.every((a) => /^[A-Za-z0-9_-]+$/.test(a.id))).toBe(true);
  });

  it('動きは決まった形だけを通す。分からないものは「何もしない」', () => {
    const list = normalizeRichMenuAreas([
      { action: { type: 'message', text: ' 予約確認 ', extra: 1 } },
      { action: { type: 'uri', uri: ' https://example.com ' } },
      { action: { type: 'form', form_id: 'f1' } },
      { action: { type: 'postback', data: 'x' } },
      { action: null },
    ]);
    expect(list.map((a) => a.action)).toEqual([{ type: 'message', text: '予約確認' }, { type: 'uri', uri: 'https://example.com' }, { type: 'form', form_id: 'f1' }, { type: 'none' }, { type: 'none' }]);
  });

  it('入力の既定値: 大きさ = 大、バーの文言 = メニュー、最初から開く', () => {
    expect(normalizeRichMenuInput({ name: ' テスト ' })).toEqual({ name: 'テスト', size: 'large', image_url: '', areas: [], chat_bar_text: 'メニュー', open_by_default: true });
    expect(normalizeRichMenuInput({ size: 'small', open_by_default: false, chat_bar_text: 'ご予約はこちら' })).toMatchObject({ size: 'small', open_by_default: false, chat_bar_text: 'ご予約はこちら' });
    expect(normalizeRichMenuInput(null).areas).toEqual([]);
  });
});

describe('重なり', () => {
  it('重なっていれば true。辺が接しているだけなら false', () => {
    expect(areasOverlap(area('a', 0, 0, 0.5, 1), area('b', 0.4, 0, 0.5, 1))).toBe(true);
    expect(areasOverlap(area('a', 0, 0, 0.5, 1), area('b', 0.5, 0, 0.5, 1))).toBe(false);
    expect(areasOverlap(area('a', 0, 0, 1, 0.5), area('b', 0, 0.5, 1, 0.5))).toBe(false);
    // 3 分割（1/3 は割り切れない）でも、丸めの誤差で重なりにしない
    const [a, b, c] = normalizeRichMenuAreas([{ x: 0, y: 0, w: 1 / 3, h: 1 }, { x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 1 }]);
    expect(areasOverlap(a, b) || areasOverlap(b, c)).toBe(false);
  });
});

describe('validateRichMenu', () => {
  it('問題が無ければ空', () => {
    expect(validateRichMenu(input())).toEqual([]);
    expect(validateRichMenu(input(), { forPublish: true, formIds: ['form1'] })).toEqual([]);
  });

  it('下書きは、画像やボタンの動きが未設定でも保存できる', () => {
    expect(validateRichMenu(input({ image_url: '', areas: [area('a1', 0, 0, 0.5, 1, { type: 'uri', uri: '' })] }))).toEqual([]);
  });

  it('名前・バーの文言・ボタンの数', () => {
    expect(validateRichMenu(input({ name: '' }))[0]).toContain('名前');
    expect(validateRichMenu(input({ name: 'あ'.repeat(41) }))[0]).toContain('40 文字');
    expect(validateRichMenu(input({ chat_bar_text: 'あ'.repeat(15) }))[0]).toContain('14 文字');
    expect(validateRichMenu(input({ chat_bar_text: 'あ'.repeat(14) }))).toEqual([]);
    const many = Array.from({ length: 21 }, (_, i) => area(`a${i}`, (i % 7) / 7, Math.floor(i / 7) / 3, 1 / 7, 1 / 3));
    expect(validateRichMenu(input({ areas: many })).some((e) => e.includes('20 個まで'))).toBe(true);
  });

  it('重なっているボタン・小さすぎるボタンは保存できない', () => {
    expect(validateRichMenu(input({ areas: [area('a1', 0, 0, 0.6, 1), area('a2', 0.5, 0, 0.5, 1)] }))[0]).toContain('ボタン 1 と ボタン 2 の範囲が重なっています');
    expect(validateRichMenu(input({ areas: [area('a1', 0, 0, 0.01, 0.5)] }))[0]).toContain('小さすぎます');
  });

  it('反映のとき: 画像・ボタンの動きを確かめる', () => {
    expect(validateRichMenu(input({ image_url: '' }), { forPublish: true })).toContain('画像を選んでください');
    expect(validateRichMenu(input({ areas: [] }), { forPublish: true }).join()).toContain('1 つ以上');
    expect(validateRichMenu(input({ areas: [area('a1', 0, 0, 1, 1, { type: 'none' })] }), { forPublish: true }).join()).toContain('1 つ以上');
    expect(validateRichMenu(input({ areas: [area('a1', 0, 0, 1, 1, { type: 'uri', uri: 'javascript:alert(1)' })] }), { forPublish: true }).join()).toContain('https://');
    expect(validateRichMenu(input({ areas: [area('a1', 0, 0, 1, 1, { type: 'message', text: '' })] }), { forPublish: true }).join()).toContain('送る文字');
    expect(validateRichMenu(input({ areas: [area('a1', 0, 0, 1, 1, { type: 'form', form_id: '' })] }), { forPublish: true }).join()).toContain('予約フォームを選んで');
  });

  it('反映のとき: 消えたフォームを指すボタンがあれば知らせる', () => {
    expect(validateRichMenu(input(), { forPublish: true, formIds: ['other'] }).join()).toContain('見つかりません');
  });

  it('開ける URL', () => {
    expect(isRichMenuUri('https://example.com/a?b=1')).toBe(true);
    expect(isRichMenuUri('http://example.com')).toBe(true);
    expect(isRichMenuUri('tel:03-1234-5678')).toBe(true);
    expect(isRichMenuUri('javascript:alert(1)')).toBe(false);
    expect(isRichMenuUri('https://example.com/a b')).toBe(false);
    expect(isRichMenuUri('example.com')).toBe(false);
  });

  it('予約語は Webhook が受け取る言葉と同じ', () => {
    expect(RICH_MENU_KEYWORDS.map((k) => k.text)).toEqual(['予約確認', '予約を変更', 'キャンセル', '空き待ち確認']);
  });
});

describe('areaToBounds（割合 → 実寸）', () => {
  it('2 分割: すき間も重なりも無い', () => {
    const left = areaToBounds(area('a', 0, 0, 0.5, 1), 'large');
    const right = areaToBounds(area('b', 0.5, 0, 0.5, 1), 'large');
    expect(left).toEqual({ x: 0, y: 0, width: 1250, height: 1686 });
    expect(right).toEqual({ x: 1250, y: 0, width: 1250, height: 1686 });
  });

  it('3 分割（割り切れない）: 隣り合うボタンがぴったり並び、右端は画像の端', () => {
    const cols = normalizeRichMenuAreas([{ x: 0, y: 0, w: 1 / 3, h: 1 }, { x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 1 }]).map((a) => areaToBounds(a, 'small'));
    expect(cols[0].x + cols[0].width).toBe(cols[1].x);
    expect(cols[1].x + cols[1].width).toBe(cols[2].x);
    expect(cols[2].x + cols[2].width).toBe(2500);
    expect(cols.every((c) => c.height === 843)).toBe(true);
  });

  it('画像からはみ出さない。大きさは 1px 以上', () => {
    const b = areaToBounds({ x: 0.9999, y: 0.9999, w: 0.5, h: 0.5 }, 'large');
    expect(b.x + b.width).toBeLessThanOrEqual(2500);
    expect(b.y + b.height).toBeLessThanOrEqual(1686);
    expect(b.width).toBeGreaterThanOrEqual(1);
    expect(b.height).toBeGreaterThanOrEqual(1);
  });
});

describe('buildRichMenuObject', () => {
  const resolve = (id: string) => (id === 'form1' ? 'https://liff.line.me/1234567890-abcdefgh' : null);

  it('LINE に送る形にする（フォームは URL に、何もしないボタンは送らない）', () => {
    const r = buildRichMenuObject(input({ areas: [...input().areas, area('a3', 0, 0, 0, 0, { type: 'none' })], chat_bar_text: 'ご予約はこちら', open_by_default: false }), resolve);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.object).toMatchObject({ size: { width: 2500, height: 1686 }, selected: false, name: 'いつものメニュー', chatBarText: 'ご予約はこちら' });
    const areas = r.object.areas as Array<{ bounds: unknown; action: Record<string, unknown> }>;
    expect(areas).toHaveLength(2);
    expect(areas[0].action).toEqual({ type: 'message', label: '予約確認', text: '予約確認' });
    expect(areas[1].action).toMatchObject({ type: 'uri', uri: 'https://liff.line.me/1234567890-abcdefgh' });
  });

  it('開けないフォームがあれば失敗する', () => {
    const r = buildRichMenuObject(input({ areas: [area('a1', 0, 0, 1, 1, { type: 'form', form_id: 'gone' })] }), resolve);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('ボタン 1');
  });

  it('動きのあるボタンが 1 つも無ければ失敗する', () => {
    expect(buildRichMenuObject(input({ areas: [] }), resolve).ok).toBe(false);
  });
});

describe('画像の確認', () => {
  it('PNG / JPEG の大きさを読む', () => {
    expect(readImageInfo(pngHeader(2500, 1686))).toEqual({ type: 'png', width: 2500, height: 1686 });
    expect(readImageInfo(jpegHeader(2500, 843))).toEqual({ type: 'jpeg', width: 2500, height: 843 });
    expect(readImageInfo(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]))).toBeNull(); // GIF
    expect(readImageInfo(new Uint8Array(0))).toBeNull();
  });

  it('大きさがメニューと合っていれば通る', () => {
    expect(checkRichMenuImage(jpegHeader(2500, 1686), 'large')).toBeNull();
    expect(checkRichMenuImage(pngHeader(2500, 843), 'small')).toBeNull();
  });

  it('大きさが違う・形式が違う・1MB を超える画像は断る', () => {
    expect(checkRichMenuImage(jpegHeader(2500, 843), 'large')).toContain('2500×1686');
    expect(checkRichMenuImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'large')).toContain('JPEG か PNG');
    expect(checkRichMenuImage(pngHeader(2500, 1686, 1024 * 1024 + 1), 'large')).toContain('1MB');
    expect(checkRichMenuImage(new Uint8Array(0), 'large')).toContain('読み込めません');
  });
});

describe('反映の進み具合・エラーの文言', () => {
  it('反映の途中は、もう一度始められない（2 分たてば始められる）', () => {
    const now = new Date('2026-11-25T03:00:00Z');
    expect(canStartPublish({ status: 'draft', updated_at: '2026-11-25T02:59:59Z' }, now)).toBe(true);
    expect(canStartPublish({ status: 'publishing', updated_at: '2026-11-25T02:59:00Z' }, now)).toBe(false);
    expect(canStartPublish({ status: 'publishing', updated_at: '2026-11-25T02:57:00Z' }, now)).toBe(true);
  });

  it('LINE のエラーを分かる言葉にする', () => {
    expect(describeLineRichMenuError(401, '{"message":"Authentication failed"}')).toContain('チャネルアクセストークン');
    expect(describeLineRichMenuError(403, '')).toContain('チャネルアクセストークン');
    expect(describeLineRichMenuError(0, 'fetch failed')).toContain('通信できません');
    const e = describeLineRichMenuError(400, '{"message":"The request body has 1 error(s)","details":[{"message":"must be at least 1.45","property":"size"}]}');
    expect(e).toContain('400');
    expect(e).toContain('size: must be at least 1.45');
  });

  it('ほかの場所で変更されたかどうか', () => {
    expect(detectExternalChange('rm-1', 'rm-1')).toBe('none');
    expect(detectExternalChange('rm-1', 'rm-2')).toBe('replaced');
    expect(detectExternalChange('rm-1', 'other')).toBe('replaced');
    expect(detectExternalChange('rm-1', null)).toBe('removed');
    expect(detectExternalChange(null, 'rm-9')).toBe('other_set');
    expect(detectExternalChange(null, null)).toBe('none');
  });
});

describe('画面での範囲の編集', () => {
  it('ドラッグで作る: どの向きに引いても同じ。1% 刻みに合わせ、画像の中に収める', () => {
    expect(rectFromDrag(0.104, 0.2, 0.497, 0.803)).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.6 });
    expect(rectFromDrag(0.497, 0.803, 0.104, 0.2)).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.6 });
    expect(rectFromDrag(-0.3, 0.5, 1.4, 2)).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 });
  });

  it('押しただけ・小さすぎるドラッグでは作らない', () => {
    expect(isUsableRect(rectFromDrag(0.5, 0.5, 0.5, 0.5))).toBe(false);
    expect(isUsableRect(rectFromDrag(0.5, 0.5, 0.52, 0.9))).toBe(false);
    expect(isUsableRect(rectFromDrag(0.5, 0.5, 0.6, 0.6))).toBe(true);
  });

  it('動かす: 大きさはそのまま。画像の外には出ない', () => {
    const r = { x: 0.1, y: 0.1, w: 0.4, h: 0.5 };
    expect(moveRect(r, 0.203, -0.05)).toEqual({ x: 0.3, y: 0.05, w: 0.4, h: 0.5 });
    expect(moveRect(r, 5, 5)).toEqual({ x: 0.6, y: 0.5, w: 0.4, h: 0.5 });
    expect(moveRect(r, -5, -5)).toEqual({ x: 0, y: 0, w: 0.4, h: 0.5 });
  });

  it('大きさを変える: 左上は動かない。最小より小さくならず、外には出ない', () => {
    const r = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(resizeRect(r, 0.1, 0.05)).toEqual({ x: 0.5, y: 0.5, w: 0.3, h: 0.25 });
    expect(resizeRect(r, 5, 5)).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(resizeRect(r, -5, -5)).toEqual({ x: 0.5, y: 0.5, w: 0.05, h: 0.05 });
  });

  it('ほかのボタンとの重なり（自分は数えない）', () => {
    const areas = [area('a1', 0, 0, 0.5, 1), area('a2', 0.5, 0, 0.5, 1)];
    expect(overlapsOthers(areas, 'a1', { x: 0, y: 0, w: 0.5, h: 1 })).toBe(false);
    expect(overlapsOthers(areas, 'a1', { x: 0.1, y: 0, w: 0.5, h: 1 })).toBe(true);
  });

  it('新しいボタンの ID は、使っていないものにする', () => {
    expect(nextAreaId([])).toBe('a1');
    expect(nextAreaId([{ id: 'a1' }, { id: 'a3' }])).toBe('a4');
    expect(nextAreaId([{ id: 'a2' }])).toBe('a3');
  });

  it('ボタンの動きを 1 行で説明する', () => {
    const name = (id: string) => (id === 'form1' ? 'カット予約' : null);
    expect(describeRichMenuAction({ type: 'form', form_id: 'form1' }, name)).toBe('予約フォームを開く: カット予約');
    expect(describeRichMenuAction({ type: 'form', form_id: 'gone' }, name)).toContain('削除されたフォーム');
    expect(describeRichMenuAction({ type: 'message', text: '予約確認' }, name)).toBe('「予約確認」と送る');
    expect(describeRichMenuAction({ type: 'uri', uri: '' }, name)).toContain('未入力');
    expect(describeRichMenuAction({ type: 'none' }, name)).toBe('何もしない');
  });
});
