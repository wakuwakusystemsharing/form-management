/**
 * 抽選フォーム（LINE LIFF 専用）の型定義
 *
 * 設計書: docs/抽選フォーム_実装設計.md
 * - 即時抽選（instant）: その場でサーバーが抽選して結果を返す
 * - 後日抽選（deferred）: 応募を集め、締切後に管理画面で当選者を決めて Bot から通知する
 */
import type { StaticDeploy } from './form';
import type { SurveyQuestion } from './survey';

export type LotteryType = 'instant' | 'deferred';
export type LotteryRedeemMethod = 'code' | 'qr';
export type LotteryAnimation = 'scratch' | 'gacha' | 'simple';
export type LotteryEntryLimit = 'once' | 'daily' | 'period_n';
export type LotteryScratchStyle = 'silver' | 'gold' | 'image';
export type LotteryFormStatus = 'active' | 'inactive' | 'paused';
export type LotteryDraftStatus = 'none' | 'draft' | 'ready_to_publish';
export type DeferredDrawStatus = 'accepting' | 'closed' | 'drawn' | 'notified';

/**
 * 抽選履歴 1 行のステータス
 * - entered:     後日抽選の応募（未抽選）
 * - provisional: 後日抽選の仮当選（確定前）
 * - drawn:       当選（引換コード発行済み。残念賞もここ）
 * - lost:        はずれ / 落選
 * - redeemed:    引換済み
 * - cancelled:   管理者が取り消し（在庫・回数のカウント対象外）
 */
export type LotteryEntryStatus = 'entered' | 'provisional' | 'drawn' | 'lost' | 'redeemed' | 'cancelled';
/** 表示用ステータス。`drawn` かつ有効期限切れは `expired` として扱う */
export type LotteryEntryEffectiveStatus = LotteryEntryStatus | 'expired';

export interface LotteryPrize {
  id: string;                 // 12 文字ランダム
  name: string;               // 例: A 賞
  description?: string;       // 例: お会計 30% OFF
  image_url?: string;
  rank_color?: string;        // HEX。未設定は順位で 金 / 銀 / 銅 / グレー
  probability: number;        // 0〜100（%）。即時抽選のみ使用。全賞品の合計 ≤ 100
  stock: number | null;       // null = 無制限。後日抽選では「当選数」として必須
  expires_in_days?: number;   // 当選日から N 日で失効（expires_at と排他。両方あれば expires_at 優先）
  expires_at?: string;        // 固定の失効日 'YYYY-MM-DD'（その日の 23:59:59 JST まで有効）
  redeem_note?: string;       // 例: 店頭でこの画面をご提示ください
}

export interface LotteryConfig {
  lottery_type: LotteryType;             // 既定 'instant'
  redeem_method: LotteryRedeemMethod;    // 既定 'code'
  basic_info: {
    title: string;
    store_name?: string;
    liff_id: string;
    theme_color: string;
    logo_url?: string;
    notice?: string;
    /** 受付期間（ISO 8601）。未設定は無期限。後日抽選では end_at = 応募締切 */
    period?: { start_at?: string; end_at?: string };
    /** フォーム送信時に LIFF が 2 通目に流す固定テキスト（公式 LINE の完全一致応答用） */
    second_message?: { enabled: boolean; text: string };
  };
  /** 後日抽選の設定（lottery_type = 'deferred' のとき） */
  deferred?: {
    draw_scheduled_at?: string;          // 抽選予定日（お客様への表示用、ISO）
    entry_complete_text: string;         // 応募完了画面の文言
  };
  prizes: LotteryPrize[];
  /** 残念賞（はずれ時に必ず付与）。未設定なら純粋なはずれ */
  consolation_prize?: LotteryPrize;
  entry_rules: {
    limit: LotteryEntryLimit;            // 後日抽選は 'once' 固定
    period_max?: number;                 // limit = 'period_n' のときの上限回数（1 以上）
    require_friend: boolean;             // 友だち追加を必須にする
    when_sold_out: 'lose' | 'close';     // 全賞品在庫切れ時: はずれ扱い / 受付終了（即時のみ）
    pre_questions: SurveyQuestion[];     // 抽選前の質問（問数制限なし。アンケートの質問型を再利用）
  };
  presentation: {
    animation: LotteryAnimation;
    scratch_style: LotteryScratchStyle;
    scratch_image_url?: string;
    show_probability: boolean;
    show_stock: boolean;
    confetti: boolean;
    win_title: string;                   // 例: おめでとうございます！
    lose_title: string;                  // 例: 残念、今回ははずれでした
    lose_message?: string;
  };
  messages: {
    /** 当選時に LIFF から送るテキスト。{賞品名} {引換コード} {有効期限} {店舗名} {LINE名} {抽選名} を差し込める */
    win_text: string;
    /** はずれ時に LIFF から送るテキスト */
    lose_text: string;
    /** 後日抽選の応募完了時に LIFF から送るテキスト。{抽選日} も使える */
    entry_text: string;
    push_flex_enabled: boolean;          // Bot からの当選カード push（店舗にチャネルアクセストークンが必要）
    flex_footer_button?: { label: string; url: string };
  };
  ui_settings: {
    submit_button_text: string;
    theme_color: string;
  };
}

export interface LotteryForm {
  id: string;                 // 12 文字ランダム
  store_id: string;
  config: LotteryConfig;
  draft_config?: LotteryConfig | null;
  status: LotteryFormStatus;
  draft_status: LotteryDraftStatus;
  deferred_draw_status: DeferredDrawStatus;
  deferred_drawn_at?: string | null;
  deferred_notified_at?: string | null;
  created_at: string;
  updated_at: string;
  last_published_at?: string | null;
  static_deploy?: StaticDeploy | null;
}

/** 抽選履歴（1 行 = 1 回の抽選 / 1 口の応募） */
export interface LotteryEntry {
  id: string;
  lottery_form_id: string;
  store_id: string;
  line_user_id: string;
  line_display_name: string | null;
  line_friend_flag: boolean | null;
  customer_id: string | null;
  prize_id: string | null;               // null = はずれ / 未抽選
  prize_name: string | null;             // 当時の賞品名のスナップショット
  is_win: boolean;
  is_consolation: boolean;               // 残念賞
  redeem_code: string | null;            // 6 桁。店舗内ユニーク
  qr_token: string | null;               // QR 方式のみ。32 文字ランダム
  expires_at: string | null;
  status: LotteryEntryStatus;
  redeemed_at: string | null;
  redeemed_by: string | null;
  redeemed_note: string | null;
  answers: Record<string, unknown> | null; // 事前質問の回答
  message_sent: boolean;                 // LIFF sendMessages 完了
  push_sent: boolean;                    // Bot Flex push 完了
  user_agent: string | null;
  entered_at: string;
  created_at: string;
  updated_at: string;
}

/** 一覧表示用: 履歴に表示用ステータスと有効期限切れフラグを付けたもの */
export interface LotteryEntryView extends LotteryEntry {
  effective_status: LotteryEntryEffectiveStatus;
}

/** 抽選フォーム一覧カードに出す集計 */
export interface LotteryFormStats {
  entries: number;      // 参加（応募）数。cancelled は除く
  wins: number;         // 当選数（残念賞は含まない）
  redeemed: number;     // 引換済み数
  prize_counts: Record<string, number>; // prize_id → 発行数（cancelled 除く）
}

export interface LotteryFormWithStats extends LotteryForm {
  stats: LotteryFormStats;
}

/** 抽選 API（POST /api/lotteries/draw）がお客様に返す結果 */
export interface LotteryDrawResponse {
  entry: Pick<
    LotteryEntry,
    'id' | 'status' | 'is_win' | 'is_consolation' | 'prize_id' | 'prize_name' | 'redeem_code' | 'qr_token' | 'expires_at' | 'entered_at'
  >;
  prize: LotteryPrize | null;
  message_text: string;
  second_message: { enabled: boolean; text: string } | null;
  /** 回数制限などで新規に引けず、前回の結果を返した場合 true */
  is_existing: boolean;
}
