/**
 * Salon Board Integration Types
 * ホットペッパー サロンボード連携用の型定義
 */

// ==========================================
// メニュー・クーポン関連
// ==========================================

/**
 * サロンボードメニュー/クーポン
 */
export interface SalonBoardMenu {
  id: string;
  store_id: string;
  menu_id: string;                    // CP... or MN...
  title: string;
  custom_title: string | null;
  description: string | null;
  custom_description: string | null;
  image_url: string | null;
  original_image_url: string | null;
  reservation_url: string | null;
  type: 'coupon' | 'menu';
  price: string | null;
  custom_price: string | null;
  treatment_time: number | null;      // 分
  visit_date_conditions: string | null;
  other_condition: string | null;
  menu_category_cd: string | null;    // MC21, MC31, OFF等
  class: string | null;               // 対象クラス（全員等）
  is_hidden: boolean;
  is_custom_title: boolean;
  is_custom_description: boolean;
  is_custom_price: boolean;
  is_price_range: boolean;
  sync_source: string;
  display_order: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  // リレーション
  categories?: SalonBoardCategory[];
  stylists?: SalonBoardStylist[];
}

/**
 * サロンボードメニューカテゴリ
 */
export interface SalonBoardCategory {
  id: string;
  store_id: string;
  title: string;
  thumbnail: string | null;
  display_order: number;
  description: string | null;
  type: 'menu' | 'coupon';
  text_content: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

// ==========================================
// スタッフ関連
// ==========================================

/**
 * サロンボードスタッフ
 */
export interface SalonBoardStylist {
  id: string;
  store_id: string;
  stylist_id: string;                 // W...
  name: string;
  name_kana: string | null;
  custom_name: string | null;
  custom_name_kana: string | null;
  image_url: string | null;
  original_image_url: string | null;
  reservation_url: string | null;
  nomination_fee: number | null;
  is_hidden: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ==========================================
// 認証情報関連
// ==========================================

/**
 * サロンボード認証情報（メタデータのみ、パスワードは含まない）
 */
export interface SalonBoardCredentials {
  id: string;
  store_id: string;
  salon_board_salon_id: string | null;
  hotpepper_salon_id: string | null;
  connection_status: 'pending' | 'connected' | 'failed' | 'expired';
  last_connection_test_at: string | null;
  last_connection_error: string | null;
  sync_enabled: boolean;
  auto_sync_reservations: boolean;
  auto_sync_cancellations: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * 認証情報入力フォーム用
 */
export interface SalonBoardCredentialsInput {
  login_id: string;
  password: string;
  hotpepper_salon_id?: string;
  salon_board_salon_id?: string;
  sync_enabled?: boolean;
  auto_sync_reservations?: boolean;
  auto_sync_cancellations?: boolean;
}

// ==========================================
// 同期ログ関連
// ==========================================

/**
 * 同期タイプ
 */
export type SalonBoardSyncType =
  | 'reservation_create'
  | 'reservation_cancel'
  | 'reservation_modify'
  | 'menu_sync'
  | 'stylist_sync'
  | 'availability_fetch';

/**
 * 同期方向
 */
export type SalonBoardSyncDirection = 'outbound' | 'inbound';

/**
 * 同期ステータス
 */
export type SalonBoardSyncStatus = 'pending' | 'success' | 'failed' | 'retry';

/**
 * サロンボード同期ログ
 */
export interface SalonBoardSyncLog {
  id: string;
  store_id: string;
  reservation_id: string | null;
  sync_type: SalonBoardSyncType;
  sync_direction: SalonBoardSyncDirection;
  status: SalonBoardSyncStatus;
  error_message: string | null;
  retry_count: number;
  request_summary: Record<string, unknown> | null;
  response_summary: Record<string, unknown> | null;
  items_synced: number | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

// ==========================================
// API レスポンス型
// ==========================================

/**
 * メニュー同期APIレスポンス
 */
export interface SyncMenusResponse {
  success: boolean;
  items_synced: number;
  menus: SalonBoardMenu[];
  error?: string;
}

/**
 * スタッフ同期APIレスポンス
 */
export interface SyncStylistsResponse {
  success: boolean;
  items_synced: number;
  stylists: SalonBoardStylist[];
  error?: string;
}

/**
 * 接続テストAPIレスポンス
 */
export interface TestConnectionResponse {
  success: boolean;
  connection_status: SalonBoardCredentials['connection_status'];
  error?: string;
}

/**
 * 認証情報保存APIレスポンス
 */
export interface SaveCredentialsResponse {
  success: boolean;
  credentials?: SalonBoardCredentials;
  error?: string;
}

// ==========================================
// 予約同期関連
// ==========================================

/**
 * 予約のサロンボード同期ステータス
 */
export type ReservationSalonBoardSyncStatus = 'not_required' | 'pending' | 'synced' | 'failed';

/**
 * 予約データ拡張（サロンボード連携用）
 */
export interface ReservationSalonBoardExtension {
  salon_board_reservation_id: string | null;
  salon_board_synced_at: string | null;
  salon_board_sync_status: ReservationSalonBoardSyncStatus;
}

// ==========================================
// 空き日程関連
// ==========================================

/**
 * 空き日程スロット
 */
export interface AvailableSlot {
  date: string;           // YYYY-MM-DD
  time: string;           // HH:mm
  stylist_id?: string;    // 指定スタッフがある場合
  stylist_name?: string;
  available: boolean;
}

/**
 * 空き日程取得APIレスポンス
 */
export interface AvailabilityResponse {
  success: boolean;
  date_from: string;
  date_to: string;
  available_slots: AvailableSlot[];
  cached_at?: string;
  error?: string;
}

// ==========================================
// 外部サービス連携用型（スクレイピング結果）
// ==========================================

/**
 * スクレイピングで取得したメニューデータ（元の形式）
 */
export interface ScrapedMenuData {
  id: number;
  title: string;
  custom_title: string;
  menu_id: string;
  description: string;
  custom_description: string;
  image_url: string | null;
  original_image_url: string | null;
  reservation_url: string | null;
  type: 'coupon' | 'menu';
  price: string;
  custom_price: string | null;
  treatment_time: number;
  visit_date_conditions: string | null;
  other_condition: string | null;
  menu_category_cd: string | null;
  is_hidden: boolean;
  sync_source: string;
  class: string | null;
  is_custom_title: boolean;
  is_custom_description: boolean;
  is_custom_price: boolean;
  is_price_range: boolean;
  order: number;
  categories: ScrapedCategoryData[];
  stylists: ScrapedStylistData[];
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
}

/**
 * スクレイピングで取得したカテゴリデータ（元の形式）
 */
export interface ScrapedCategoryData {
  id: number;
  title: string;
  thumbnail: string | null;
  order: number;
  description: string | null;
  type: 'menu' | 'coupon';
  text_content: string | null;
  label: string;
  is_hidden: boolean | number;
  created_at: string;
  updated_at: string;
  pivot?: {
    menu_id: number;
    category_id: number;
  };
}

/**
 * スクレイピングで取得したスタッフデータ（元の形式）
 */
export interface ScrapedStylistData {
  id: number;
  name: string;
  name_kana: string;
  custom_name: string | null;
  custom_name_kana: string | null;
  stylist_id: string;
  image_url: string | null;
  original_image_url: string | null;
  reservation_url: string;
  nomination_fee: number | null;
  is_hidden: boolean | number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  pivot?: {
    menu_id: number;
    stylist_id: number;
  };
}
