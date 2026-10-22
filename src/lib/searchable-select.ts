/**
 * ドロップダウン選択（select）の「検索・絞り込み機能」の純粋ロジック（クライアント / サーバー共通。DOM 非依存）。
 *
 * 予約フォームのカスタムフィールド / アンケートの質問で回答タイプが「ドロップダウン選択」のとき、
 * `select_search.enabled` を ON にすると静的 HTML では通常の <select> の代わりに
 *   - 名前で検索する入力欄
 *   - 五十音（あ / か / さ …）の絞り込みボタン
 *   - 絞り込み結果のリスト
 *   - 独立して配置する「不明」ボタン（`unknown_enabled`。表示名は `unknown_label`）
 * を表示する（店舗数が 80 件あるような長い選択肢向け）。
 *
 * 五十音の判定は選択肢の `kana`（ふりがな。任意）があればその先頭、無ければ表示名の先頭文字で行う。
 * 漢字で始まる名前は ふりがな が無いと五十音ボタンでは絞り込めない（名前検索はできる）。
 *
 * 埋め込み JS 側（`searchable-select-runtime-js.ts`）にも同じ判定を実装している。
 * 判定を直すときは両方を直し、`src/lib/__tests__/searchable-select.test.ts` で一致を確認する。
 */

export interface SelectSearchSettings {
  /** 検索・絞り込み機能を使う */
  enabled: boolean;
  /** 「不明」を独立した選択肢（ボタン）として表示する。既定 true */
  unknown_enabled?: boolean;
  /** 「不明」ボタンの表示名（送信される値にもなる）。空 = 既定の「不明」 */
  unknown_label?: string;
}

export interface ResolvedSelectSearchSettings {
  enabled: boolean;
  unknown_enabled: boolean;
  unknown_label: string;
}

export const SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL = '不明';
export const SELECT_SEARCH_UNKNOWN_LABEL_MAX = 20;

/** 五十音の行（ボタンの並び順）。chars は清音のみ。濁音・半濁音・小書きは判定時に清音へ寄せる */
export const KANA_ROWS: ReadonlyArray<{ key: string; chars: string }> = [
  { key: 'あ', chars: 'あいうえお' },
  { key: 'か', chars: 'かきくけこ' },
  { key: 'さ', chars: 'さしすせそ' },
  { key: 'た', chars: 'たちつてと' },
  { key: 'な', chars: 'なにぬねの' },
  { key: 'は', chars: 'はひふへほ' },
  { key: 'ま', chars: 'まみむめも' },
  { key: 'や', chars: 'やゆよ' },
  { key: 'ら', chars: 'らりるれろ' },
  { key: 'わ', chars: 'わをん' },
];

const SMALL_KANA: Record<string, string> = {
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ',
};

/** 設定値を既定値で補完する。オブジェクトでなければ OFF 扱い */
export function resolveSelectSearchSettings(raw: unknown): ResolvedSelectSearchSettings {
  if (!raw || typeof raw !== 'object') {
    return { enabled: false, unknown_enabled: true, unknown_label: SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL };
  }
  const r = raw as Partial<SelectSearchSettings>;
  const label = typeof r.unknown_label === 'string' ? r.unknown_label.trim().slice(0, SELECT_SEARCH_UNKNOWN_LABEL_MAX) : '';
  return {
    enabled: r.enabled === true,
    unknown_enabled: r.unknown_enabled !== false,
    unknown_label: label || SELECT_SEARCH_DEFAULT_UNKNOWN_LABEL,
  };
}

/** 検索用に正規化する: NFKC（全角英数 → 半角など）+ 小文字 + カタカナ → ひらがな + 前後の空白除去 */
export function normalizeSearchText(input: string | undefined | null): string {
  let s = String(input ?? '');
  try { s = s.normalize('NFKC'); } catch { /* 古い環境では normalize が無い */ }
  s = s.toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out.trim();
}

/** 先頭文字を五十音判定用に清音の大きいひらがなへ寄せる（が → か、ゃ → や、ヴ → う）。空なら '' */
export function kanaHeadChar(input: string | undefined | null): string {
  const n = normalizeSearchText(input);
  if (!n) return '';
  let ch = n.charAt(0);
  try { ch = ch.normalize('NFD').replace(/[゙゚]/g, ''); } catch { /* noop */ }
  return SMALL_KANA[ch] || ch;
}

/** 選択肢が属する五十音の行（'あ' 〜 'わ'）。ふりがな優先。かな以外で始まるときは '' */
export function kanaRowOf(label: string | undefined | null, kana?: string | null): string {
  const head = kanaHeadChar(kana) || kanaHeadChar(label);
  if (!head) return '';
  const row = KANA_ROWS.find((r) => r.chars.includes(head));
  return row ? row.key : '';
}

/** 検索語（部分一致。表示名 / ふりがな）と五十音の行の両方を満たすか */
export function matchesSelectSearch(
  option: { label: string; kana?: string | null },
  query: string | undefined | null,
  row: string | undefined | null,
): boolean {
  if (row && kanaRowOf(option.label, option.kana) !== row) return false;
  const q = normalizeSearchText(query);
  if (!q) return true;
  return normalizeSearchText(option.label).includes(q) || normalizeSearchText(option.kana).includes(q);
}
