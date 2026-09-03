/**
 * 文字色マークアップ `[color=#rrggbb]〜[/color]` の共通処理
 *
 * 予約フォームの「画像orテキスト設置」と同じ書式。アンケート / 抽選フォームの説明文・
 * テキストブロックでも使う。HTML エスケープしてから hex 色だけを span に変換する
 * （CSS インジェクション防止のため hex 以外は色として扱わない）。
 */

export const CONTENT_TEXT_COLORS: Array<{ label: string; hex: string }> = [
  { label: '赤', hex: '#dc2626' },
  { label: '青', hex: '#2563eb' },
  { label: '緑', hex: '#16a34a' },
  { label: 'オレンジ', hex: '#ea580c' },
];

export function escapeHtmlText(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** エスケープ + 色タグ変換 + 改行を <br> に */
export function renderColoredTextHtml(text: string | null | undefined): string {
  return escapeHtmlText(text)
    .replace(/\[color=(#[0-9a-fA-F]{3,8})\]/g, '<span style="color:$1">')
    .replace(/\[\/color\]/g, '</span>')
    .replace(/\r?\n/g, '<br>');
}

/** 色タグをすべて取り除く */
export function stripColorTags(text: string): string {
  return text.replace(/\[color=#[0-9a-fA-F]{3,8}\]/g, '').replace(/\[\/color\]/g, '');
}

/** 選択範囲 [start, end) を色タグで囲む。範囲が空なら null */
export function wrapSelectionWithColor(text: string, start: number, end: number, color: string): string | null {
  if (start === end) return null;
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) return null;
  const s = Math.max(0, Math.min(start, end));
  const e = Math.min(text.length, Math.max(start, end));
  return text.slice(0, s) + `[color=${color}]` + text.slice(s, e) + '[/color]' + text.slice(e);
}

export function hasColorTags(text: string | null | undefined): boolean {
  return /\[color=#[0-9a-fA-F]{3,8}\]/.test(text || '');
}
