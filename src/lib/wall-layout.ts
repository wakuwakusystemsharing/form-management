/**
 * 付箋の見た目（色・傾き・位置ずれ）を投稿 ID から決める擬似乱数 — 純粋ロジック
 *
 * 同じ投稿 ID なら誰が見ても・何度読み込んでも同じ見た目になる（サーバー / クライアント共通）。
 */

/** FNV-1a（32bit） */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: 32bit シードから 0 ≤ x < 1 の乱数列を返す */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoteStyle {
  color: string;
  /** 傾き（度）。-4〜+4 */
  rotate: number;
  /** 横ずれ（px）。-6〜+6 */
  offsetX: number;
  /** 縦ずれ（px）。-4〜+4 */
  offsetY: number;
}

export function noteStyleFor(postId: string, colors: string[]): NoteStyle {
  const rnd = mulberry32(fnv1a(postId));
  const palette = colors.length > 0 ? colors : ['#fff3a3'];
  const color = palette[Math.floor(rnd() * palette.length) % palette.length];
  const rotate = Math.round((-4 + rnd() * 8) * 10) / 10;
  const offsetX = Math.round(-6 + rnd() * 12);
  const offsetY = Math.round(-4 + rnd() * 8);
  return { color, rotate, offsetX, offsetY };
}
