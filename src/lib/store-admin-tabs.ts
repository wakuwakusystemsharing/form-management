/**
 * 店舗管理者ページ（/{storeId}/admin）のタブ定義と表示制御
 *
 * - テナント（システム管理者）側の店舗設定「店舗管理者に表示するメニュー」で、
 *   店舗ごとに店舗管理者へ見せるタブを選べる（stores.admin_visible_tabs）
 * - null / 未設定 = すべて表示（後方互換）
 * - マスター管理者・システム管理者が店舗管理者ページを開いた場合は常にすべて表示
 */

export const STORE_ADMIN_TAB_IDS = ['dashboard', 'reservations', 'customers', 'surveys', 'lotteries', 'settings'] as const;
export type StoreAdminTabId = (typeof STORE_ADMIN_TAB_IDS)[number];

export const STORE_ADMIN_TABS: { id: StoreAdminTabId; label: string; description: string }[] = [
  { id: 'dashboard', label: 'ダッシュボード', description: '予約・顧客・アンケートの概況' },
  { id: 'reservations', label: '予約管理', description: '予約フォームと予約一覧・分析' },
  { id: 'customers', label: '顧客管理 β', description: '顧客一覧・顧客分析（CRM）' },
  { id: 'surveys', label: 'アンケート管理', description: 'アンケートフォームと回答一覧' },
  { id: 'lotteries', label: '抽選管理', description: '抽選フォームと抽選履歴・引換' },
  { id: 'settings', label: '設定', description: '店舗情報の確認・表示設定' },
];

export function isStoreAdminTabId(value: unknown): value is StoreAdminTabId {
  return typeof value === 'string' && (STORE_ADMIN_TAB_IDS as readonly string[]).includes(value);
}

/**
 * 保存値を正規化して「表示するタブ ID の配列」を返す。
 * null / 配列でない / 有効な ID が 1 つも無い場合はすべて表示（誤設定でロックアウトしない）
 */
export function resolveVisibleTabs(value: unknown): StoreAdminTabId[] {
  if (!Array.isArray(value)) return [...STORE_ADMIN_TAB_IDS];
  const ids = STORE_ADMIN_TAB_IDS.filter((id) => value.includes(id));
  return ids.length > 0 ? ids : [...STORE_ADMIN_TAB_IDS];
}
