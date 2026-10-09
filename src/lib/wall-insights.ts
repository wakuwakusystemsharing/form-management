/**
 * 寄せ書きウォール「見どころ」まとめ — 純粋ロジック（Vitest 対象。外部 AI・形態素解析は使わない）
 *
 * - よく出る言葉: 本文からカタカナ / 漢字 / 英数字のかたまり（2 文字以上）を取り出し、含む付箋の数で数える
 *   （ひらがなだけの語は助詞・活用語尾が多いので数えない）。一般語と店舗の NG ワードは除外
 * - 週ごとの件数: JST の月曜始まりで直近 N 週
 * 投稿者の情報は一切使わない（本文と日時だけ）
 */

export interface WallInsightRow {
  body: string;
  created_at: string;
  status: string;
}

export interface WallInsights {
  /** 直近 30 日の公開中の付箋数 */
  total_30d: number;
  /** 直近 8 週（古い順）。week_start は JST の月曜（YYYY-MM-DD） */
  weeks: Array<{ week_start: string; count: number }>;
  /** よく出る言葉（含む付箋の数の多い順、上位 10） */
  words: Array<{ word: string; count: number }>;
}

/** 数えても意味の薄い語 */
export const WALL_INSIGHT_STOPWORDS = new Set([
  '今日', '本日', '今回', '前回', '次回', '今度', '自分', '本当', '感じ', '時間', '気持', '気分', '場所', 'お店', '店舗', '店員',
  '以上', '以下', '全部', '毎回', '一番', '最初', '最後', '普通', '非常', '色々', '沢山', '大変', '丁寧', '利用', '来店', '予約',
  '対応', '仕事', '気持ち', '皆様', '皆さん', 'スタッフ', '店長', 'オーナー', 'ありがとう', 'ありがとうございます', 'サービス',
  'メニュー', 'コース', 'お願い', '期待', '満足', '安心', '思い', '思います', '思う', '笑顔', '雰囲気', '最高', '素敵', '素晴らしい',
]);

const KATAKANA = /[ァ-ヶー]{2,}/g;
const KANJI = /[一-龠々〆ヵヶ]{2,}/g;
const ALNUM = /[A-Za-z0-9][A-Za-z0-9._-]{1,}/g;

/** 本文から数える対象の語を取り出す（重複なし） */
export function extractWallWords(body: string, extraStop: Iterable<string> = []): string[] {
  const text = (body || '').normalize('NFKC');
  const stop = new Set<string>([...WALL_INSIGHT_STOPWORDS, ...extraStop]);
  const out = new Set<string>();
  for (const re of [KATAKANA, KANJI, ALNUM]) {
    for (const m of text.matchAll(re)) {
      const w = m[0];
      if (w.length < 2 || w.length > 12) continue;
      if (/^\d+$/.test(w)) continue;
      if (stop.has(w) || [...stop].some((s) => s.length >= 2 && w === s)) continue;
      out.add(w);
    }
  }
  return [...out];
}

/** JST の「その週の月曜 0:00」を UTC の Date で返す */
export function jstWeekStart(d: Date): Date {
  const jst = new Date(d.getTime() + 9 * 3600000);
  const dow = (jst.getUTCDay() + 6) % 7; // 月曜 = 0
  const mondayUtcMidnight = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - dow);
  return new Date(mondayUtcMidnight - 9 * 3600000);
}

function ymdJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

export function buildWallInsights(rows: WallInsightRow[], now: Date, opts: { ngWords?: string[]; weeks?: number; topWords?: number } = {}): WallInsights {
  const weeksN = opts.weeks ?? 8;
  const since30 = now.getTime() - 30 * 24 * 3600000;
  const published = rows.filter((r) => r.status === 'published');

  // 週ごと（削除以外すべて。貼られた勢いを見るため）
  const thisWeek = jstWeekStart(now).getTime();
  const weeks: Array<{ week_start: string; count: number }> = [];
  for (let i = weeksN - 1; i >= 0; i--) {
    const start = thisWeek - i * 7 * 24 * 3600000;
    const end = start + 7 * 24 * 3600000;
    const count = rows.filter((r) => {
      if (r.status === 'deleted') return false;
      const t = new Date(r.created_at).getTime();
      return t >= start && t < end;
    }).length;
    weeks.push({ week_start: ymdJst(new Date(start)), count });
  }

  // よく出る言葉（直近 30 日の公開中）
  const recent = published.filter((r) => new Date(r.created_at).getTime() >= since30);
  const counts = new Map<string, number>();
  for (const r of recent) {
    for (const w of extractWallWords(r.body, opts.ngWords || [])) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const words = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], 'ja'))
    .slice(0, opts.topWords ?? 10)
    .map(([word, count]) => ({ word, count }));

  return { total_30d: recent.length, weeks, words };
}
