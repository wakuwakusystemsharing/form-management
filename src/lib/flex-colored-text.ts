/**
 * `[color=#rrggbb]〜[/color]` 付きのテキストを LINE Flex Message の text コンポーネントに変換する（純粋ロジック）
 *
 * - 改行はそのまま（Flex は wrap: true のとき \n で折り返す）
 * - 色タグは span（contents）に展開。タグが無ければ従来どおり text だけを返す
 * - hex 以外の色は色として扱わない（colored-text.ts と同じ方針）
 */
import { stripColorTags } from './colored-text';

export interface FlexSpan {
  type: 'span';
  text: string;
  color?: string;
}

export interface FlexTextParts {
  /** 色タグを除いた素のテキスト（contents を使わないクライアント向けのフォールバック） */
  text: string;
  /** 色タグがあるときだけ */
  contents?: FlexSpan[];
}

const TAG = /\[color=(#[0-9a-fA-F]{3,8})\]([\s\S]*?)\[\/color\]/g;

export function toFlexTextParts(raw: string): FlexTextParts {
  const text = stripColorTags(raw);
  if (!/\[color=#[0-9a-fA-F]{3,8}\]/.test(raw)) return { text };
  const contents: FlexSpan[] = [];
  let last = 0;
  for (const m of raw.matchAll(TAG)) {
    const idx = m.index ?? 0;
    if (idx > last) contents.push({ type: 'span', text: raw.slice(last, idx) });
    if (m[2]) contents.push({ type: 'span', text: m[2], color: m[1].length === 4 ? expandShortHex(m[1]) : m[1].slice(0, 7) });
    last = idx + m[0].length;
  }
  if (last < raw.length) contents.push({ type: 'span', text: raw.slice(last) });
  return { text, contents: contents.filter((c) => c.text.length > 0) };
}

/** #abc → #aabbcc（Flex は 6 桁のみ） */
function expandShortHex(h: string): string {
  return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
}

/** Flex の text コンポーネントを作る。色タグがあれば contents（span）付き、常に wrap: true */
export function flexText(raw: string, props: Record<string, unknown> = {}): Record<string, unknown> {
  const parts = toFlexTextParts(raw);
  return { type: 'text', text: parts.text, wrap: true, ...props, ...(parts.contents ? { contents: parts.contents } : {}) };
}
