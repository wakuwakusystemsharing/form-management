/**
 * 店舗ID生成ユーティリティ
 * 6文字のランダム文字列（小文字英数字）を生成
 */

/**
 * 6文字のランダムな店舗IDを生成
 * 使用文字: a-z, 0-9
 * @returns 6文字のランダム文字列
 */
export function generateStoreId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 重複しない店舗IDを生成（最大試行回数付き）
 * @param checkExists 既存IDをチェックする関数
 * @param maxAttempts 最大試行回数（デフォルト: 10）
 * @returns 重複しない6文字のランダム文字列
 */
export async function generateUniqueStoreId(
  checkExists: (id: string) => Promise<boolean>,
  maxAttempts: number = 10
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const id = generateStoreId();
    const exists = await checkExists(id);
    if (!exists) {
      return id;
    }
  }
  throw new Error(`店舗IDの生成に失敗しました（${maxAttempts}回試行後も重複）`);
}

/**
 * 店舗IDの形式を検証
 * @param id 検証するID
 * @returns 有効な形式かどうか
 */
export function isValidStoreId(id: string): boolean {
  return /^[a-z0-9]{6}$/.test(id);
}

