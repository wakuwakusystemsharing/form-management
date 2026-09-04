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

// ---------------------------------------------------------------------------
// タブ内の項目単位の表示設定（stores.admin_visible_options）
// ---------------------------------------------------------------------------

export const STORE_ADMIN_OPTION_KEYS = [
  'reservation_forms',
  'survey_forms',
  'lottery_forms',
  'customer_reservation_history',
  'customer_lottery_history',
] as const;
export type StoreAdminOptionKey = (typeof STORE_ADMIN_OPTION_KEYS)[number];

/** 保存形式。キーが無い = 親タブの表示状態に連動 */
export type StoreAdminVisibleOptions = Partial<Record<StoreAdminOptionKey, boolean>>;

/** 判定済み（すべて boolean） */
export type ResolvedStoreAdminOptions = Record<StoreAdminOptionKey, boolean>;

export interface StoreAdminOptionDef {
  key: StoreAdminOptionKey;
  /** 設定画面でどのタブの下に出すか */
  tab: StoreAdminTabId;
  label: string;
  description: string;
  /** 未設定時に連動するタブ */
  followsTab: StoreAdminTabId;
}

export const STORE_ADMIN_OPTIONS: StoreAdminOptionDef[] = [
  { key: 'reservation_forms', tab: 'reservations', label: 'フォーム管理を表示', description: '予約フォームの一覧（編集・プレビュー・URL）', followsTab: 'reservations' },
  { key: 'survey_forms', tab: 'surveys', label: 'フォーム管理を表示', description: 'アンケートフォームの一覧（編集・プレビュー・URL）', followsTab: 'surveys' },
  { key: 'lottery_forms', tab: 'lotteries', label: 'フォーム管理を表示', description: '抽選フォームの一覧（編集・プレビュー・URL）', followsTab: 'lotteries' },
  { key: 'customer_reservation_history', tab: 'customers', label: '顧客詳細に予約履歴・来店履歴・統計情報を表示', description: '未設定のときは「予約管理」の表示に連動します', followsTab: 'reservations' },
  { key: 'customer_lottery_history', tab: 'customers', label: '顧客詳細に抽選履歴を表示', description: '未設定のときは「抽選管理」の表示に連動します', followsTab: 'lotteries' },
];

export function isStoreAdminOptionKey(value: unknown): value is StoreAdminOptionKey {
  return typeof value === 'string' && (STORE_ADMIN_OPTION_KEYS as readonly string[]).includes(value);
}

/** 保存値を正規化（不正なキー・boolean 以外は捨てる） */
export function normalizeAdminVisibleOptions(value: unknown): StoreAdminVisibleOptions {
  const out: StoreAdminVisibleOptions = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isStoreAdminOptionKey(k) && typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * 項目ごとの表示可否を判定する。
 * - 明示的に true / false が保存されていればそれを使う
 * - 未設定なら「連動するタブ」が表示されているかどうかに従う
 * - 上位管理者（マスター / システム）として開いた場合は呼び出し側で null を渡し、すべて true
 */
export function resolveAdminVisibleOptions(
  visibleTabs: unknown,
  options: unknown,
  /** true なら上位管理者 = すべて表示 */
  upperAdmin = false
): ResolvedStoreAdminOptions {
  const tabs = resolveVisibleTabs(visibleTabs);
  const opts = normalizeAdminVisibleOptions(options);
  const result = {} as ResolvedStoreAdminOptions;
  for (const def of STORE_ADMIN_OPTIONS) {
    if (upperAdmin) {
      result[def.key] = true;
      continue;
    }
    const explicit = opts[def.key];
    result[def.key] = typeof explicit === 'boolean' ? explicit : tabs.includes(def.followsTab);
  }
  return result;
}
