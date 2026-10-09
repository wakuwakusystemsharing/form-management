/**
 * 寄せ書きウォール（匿名の付箋コルクボード）の型
 * 設計: docs/寄せ書きウォール_要件定義書.md
 *
 * 匿名性のため、author_hash / reporter_hash / LINE ユーザー ID は「サーバー内部の型」（WallPostRow）にだけ持ち、
 * API が返す型（WallPublicPost / WallAdminPost）には含めない。
 */

export type WallModeration = 'instant' | 'approval';
/** login = LINE ログインのみ / friend_to_post = 投稿は友だち必須（閲覧は誰でも）/ friend_only = 閲覧も投稿も友だち必須 */
export type WallAccessMode = 'login' | 'friend_to_post' | 'friend_only';
export type WallPostStatus = 'published' | 'pending' | 'review' | 'hidden' | 'deleted';
export type WallPendingReason = 'approval' | 'ng_word';
export type WallReportReason = 'abuse' | 'personal_info' | 'advertising' | 'other';
/** お店からの「ありがとう」リアクション */
export type WallReaction = 'thanks' | 'heart' | 'smile' | 'party';
export type WallThemePreset = 'cork' | 'wood' | 'paper' | 'chalkboard';
export type WallFont = 'rounded' | 'standard' | 'handwriting';
/** 付箋の形: 正方形 / 角丸 / 横長 */
export type WallNoteShape = 'square' | 'rounded' | 'landscape';
/** 付箋の留め方: 押しピン / マスキングテープ / マグネット / なし */
export type WallNotePin = 'pin' | 'tape' | 'magnet' | 'none';
/** 付箋の紙: 無地 / 罫線 / 方眼 */
export type WallNoteTexture = 'plain' | 'lined' | 'grid';

export interface WallTheme {
  preset: WallThemePreset;
  /** プリセットの背景色を上書き（HEX）。空 = プリセットのまま */
  background_color: string;
  /** 付箋の色（HEX、3〜8 色） */
  note_colors: string[];
  font: WallFont;
  note_shape: WallNoteShape;
  note_pin: WallNotePin;
  note_texture: WallNoteTexture;
  /** 付箋の文字色（HEX）。空 = 既定の濃い茶色 */
  note_text_color: string;
  title: string;
  subtitle: string;
  placeholder: string;
}

export interface WallBoardSettings {
  store_id: string;
  enabled: boolean;
  liff_id: string;
  moderation: WallModeration;
  access_mode: WallAccessMode;
  /** 1 ユーザーが 1 日に貼れる枚数（1〜10。既定 1） */
  daily_max: number;
  /** 「共感」ボタンを出す（既定 false） */
  empathy_enabled: boolean;
  /** 共感の数をお客様に見せる（既定 true） */
  empathy_show_count: boolean;
  /** 貼る人が付箋の色・飾りを選べる（既定 false） */
  customer_pick_enabled: boolean;
  theme: WallTheme;
  ng_words: string[];
}

/** お題（店舗ごと。期間で 1 つだけ有効） */
export interface WallTopic {
  id: string;
  store_id: string;
  title: string;
  description: string;
  /** JST の日付 YYYY-MM-DD */
  starts_on: string;
  ends_on: string;
  created_at: string;
  updated_at: string;
}

/** お客様に見せるお題 */
export interface WallTopicPublic {
  id: string;
  title: string;
  description: string;
  ends_on: string;
}

/** DB の行（サーバー内部のみ。API には出さない） */
export interface WallPostRow {
  id: string;
  store_id: string;
  body: string;
  status: WallPostStatus;
  pending_reason: WallPendingReason | null;
  ng_hits: string[];
  author_hash: string;
  report_count: number;
  hidden_reason: 'terms_violation' | null;
  hidden_at: string | null;
  hidden_by: string | null;
  reaction: WallReaction | null;
  reaction_at: string | null;
  topic_id: string | null;
  note_color: string | null;
  note_deco: string | null;
  empathy_count: number;
  created_at: string;
  updated_at: string;
}

/** お客様向け API が返す付箋 */
export interface WallPublicPost {
  id: string;
  body: string;
  created_at: string;
  /** 閲覧者本人の付箋か（サーバーで判定。削除ボタンの表示に使う） */
  is_mine: boolean;
  /** お店からのリアクション */
  reaction: WallReaction | null;
  topic_id: string | null;
  topic_title: string | null;
  /** 貼った人が選んだ色・飾り（無ければ自動） */
  note_color: string | null;
  note_deco: string | null;
  /** 共感の数（店舗が数を見せない設定なら null） */
  empathy_count: number | null;
  /** 閲覧者本人が共感済みか */
  empathized: boolean;
}

/** 自分の付箋一覧（状態付き） */
export interface WallMyPost extends WallPublicPost {
  status: Exclude<WallPostStatus, 'deleted'>;
}

/** 店舗管理 API が返す付箋（投稿者の情報は含めない） */
export interface WallAdminPost {
  id: string;
  /** 一覧用の短い番号 */
  no: string;
  /** 本人削除済みは null（本文は出さない） */
  body: string | null;
  status: WallPostStatus;
  pending_reason: WallPendingReason | null;
  ng_hits: string[];
  report_count: number;
  report_reasons: Record<WallReportReason, number>;
  hidden_reason: 'terms_violation' | null;
  reaction: WallReaction | null;
  topic_id: string | null;
  topic_title: string | null;
  empathy_count: number;
  note_color: string | null;
  note_deco: string | null;
  created_at: string;
}

/** お客様向け GET /api/walls/{storeId} のレスポンス */
export interface WallPublicBoardResponse {
  board: {
    store_id: string;
    store_name: string;
    theme_color: string | null;
    enabled: boolean;
    liff_id: string;
    moderation: WallModeration;
    access_mode: WallAccessMode;
    daily_max: number;
    empathy_enabled: boolean;
    empathy_show_count: boolean;
    customer_pick_enabled: boolean;
    /** 貼る人が選べる飾り（固定セット） */
    decorations: string[];
    /** 開催中のお題（無ければ null） */
    topic: WallTopicPublic | null;
    theme: WallTheme;
    terms_version: string;
    consent_text: string;
  };
  /** 閲覧者が同意済みか（ID トークンが無いときは false） */
  consented: boolean;
  /** 閲覧できるか（friend_only で友だちでないときは false） */
  can_view: boolean;
  /** 投稿できるか（friend_to_post / friend_only で友だちでないときは false） */
  can_post: boolean;
  posts: WallPublicPost[];
  next_cursor: string | null;
}

export interface WallStats {
  enabled: boolean;
  week_posts: number;
  pending: number;
  review: number;
}

/** 店舗向け「見どころ」まとめ */
export interface WallInsightsResponse {
  total_30d: number;
  weeks: Array<{ week_start: string; count: number }>;
  words: Array<{ word: string; count: number }>;
}
