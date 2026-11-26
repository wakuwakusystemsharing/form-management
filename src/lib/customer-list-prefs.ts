/**
 * 顧客一覧の「LINE 友だちのみも表示」のチェックを、端末ごと・店舗ごとに覚える。
 * DB には保存しない（localStorage）。保存先が使えないとき（プライベートウィンドウなど）は覚えないだけで、画面は今までどおり動く。
 */

type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function showFriendsStorageKey(storeId: string): string {
  return `customer_list_show_friends_${storeId}`;
}

function browserStorage(): PrefStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 覚えている値を読む。覚えていない・読めないときは false（既定 = 表示しない） */
export function readShowFriends(storeId: string, storage: PrefStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(showFriendsStorageKey(storeId)) === '1';
  } catch {
    return false;
  }
}

/** チェックの状態を覚える（入れた = '1' / 外した = '0'） */
export function writeShowFriends(storeId: string, value: boolean, storage: PrefStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(showFriendsStorageKey(storeId), value ? '1' : '0');
  } catch {
    // 保存できなくても、画面の動きは変えない
  }
}
