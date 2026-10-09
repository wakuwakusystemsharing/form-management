/**
 * 寄せ書きウォールの NG ワード判定 — 純粋ロジック
 *
 * 運営共通リスト（広め: 誹謗中傷・差別・性的・暴力・個人情報・宣伝 / 勧誘）+ 形式判定（URL・メール・電話番号・@ID）
 * + 店舗ごとの追加語。当たった投稿は「保留」（pending / ng_word）になり、店舗が確認して公開するか規約違反で非公開にする。
 *
 * 評価が低いだけの言葉（まずい・高い・遅い など）はここに入れない（悪い評価を理由に止めないため）。
 */

/** 比較用に正規化: NFKC（全角英数→半角・半角カナ→全角）、小文字化、ひらがな→カタカナ、空白と記号の一部を除去 */
export function normalizeForNgMatch(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s　・。、,.!?！？ー〜~_\-*＊]/g, '');
}

/** 運営共通の NG ワード（表示用ラベル = 語そのもの）。照合は normalizeForNgMatch 後の部分一致 */
export const WALL_COMMON_NG_WORDS: string[] = [
  // 誹謗中傷・暴言（「カスタム」「バカンス」「シネマ」「ピンボケ」などの普通の言葉に部分一致する短い語は入れない）
  '死ね', '氏ね', '殺す', 'ころす', '消えろ', 'きえろ', 'ぶっ殺', 'くたばれ',
  'キモい', 'きもい', 'うざい', 'ブス', 'デブ', 'ゴミ人間', 'アホ', '馬鹿', 'マヌケ', '無能', '低能', 'ガイジ',
  // 差別
  '池沼', 'つんぼ', 'きちがい', 'キチガイ', '気違い', 'シナ人', '支那',
  // 性的
  'セックス', 'sex', 'エッチしよ', 'ヤリマン', 'ヤリチン', 'ちんこ', 'ちんぽ', 'まんこ', 'おっぱい', '援交', '援助交際', 'パパ活', 'ママ活',
  // 個人情報らしき語
  '住所は', '電話番号は', 'ラインid', 'lineid', 'line交換', 'ライン交換', 'インスタ交換', '本名は',
  // 宣伝・勧誘
  '副業', '稼げる', '儲かる', '月収', '日給', '高収入', '投資', '仮想通貨', '暗号資産', 'fx', 'バイナリー', '出会い系', 'マッチングアプリ', '登録はこちら', 'プロフ見て', 'フォローして', '無料プレゼント', '友達追加で', 'dmください',
];

/** 形式判定（ラベル, 正規表現）。元の文字列（NFKC 後）に対して判定する */
export const WALL_NG_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'URL', re: /(https?:\/\/|www\.)|[a-z0-9-]+\.(com|net|jp|co|io|me|ly|link|xyz|info|site|shop)\b/i },
  { label: 'メールアドレス', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
  { label: '電話番号', re: /(?<!\d)0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}(?!\d)|(?<!\d)0[789]0\d{8}(?!\d)/ },
  { label: '@ID', re: /(?<![a-z0-9._%+-])@[a-z0-9._]{3,}/i },
];

/**
 * 本文が NG に当たるか。当たったラベルの一覧を返す（空 = 問題なし）。
 * storeWords は店舗ごとの追加語（同じ正規化で部分一致）
 */
export function findNgWords(body: string, storeWords: string[] = []): string[] {
  const nfkc = String(body || '').normalize('NFKC');
  const norm = normalizeForNgMatch(body);
  const hits: string[] = [];
  const push = (label: string) => { if (!hits.includes(label)) hits.push(label); };
  for (const w of WALL_COMMON_NG_WORDS) {
    const n = normalizeForNgMatch(w);
    if (n && norm.includes(n)) push(w);
  }
  for (const w of storeWords) {
    const n = normalizeForNgMatch(w);
    if (n && norm.includes(n)) push(w);
  }
  for (const p of WALL_NG_PATTERNS) {
    if (p.re.test(nfkc)) push(p.label);
  }
  return hits;
}
