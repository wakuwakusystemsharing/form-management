/**
 * Supabase（PostgREST）の 1 リクエスト上限（既定 1000 行）を超えてすべての行を取得する
 *
 * `buildQuery(from, to)` は `.range(from, to)` まで付けたクエリを返す。
 * 1000 行未満が返ってきた時点で終了する。
 */
const PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
  maxRows = 100_000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || 'Supabase fetch error');
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}
