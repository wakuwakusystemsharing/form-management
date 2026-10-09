/**
 * 予約フォームの設定を同じ店舗の別フォームへ反映する（純粋ロジック）
 *
 * 例: LINE 予約フォームと Web 予約フォームでメニュー・営業時間が同じ店舗で、
 * 片方を編集したあと「更新して他のフォームにも反映」でもう片方へコピーする。
 *
 * - 反映先は同じ店舗の予約フォームに限定（呼び出し側で絞る。listSyncTargets）
 * - 「送信時の項目編集」（line_message_items）は同期しない
 * - フォーム種別固有の項目（form_type / フォーム名 / LIFF ID / メール欄 / 通知メール / LINE 以外の制限 / 2 通目）は
 *   反映先の値を常に保持する
 */
import type { Form, FormConfig } from '@/types/form';

export type SyncSectionId =
  | 'basic_display'
  | 'menu_structure'
  | 'selections'
  | 'custom_fields'
  | 'calendar_settings'
  | 'cancel_rules'
  | 'notification_messages'
  | 'display_settings';

export interface SyncSection {
  id: SyncSectionId;
  label: string;
  description: string;
}

/** ダイアログに出す順。既定はすべて ON */
export const FORM_SYNC_SECTIONS: SyncSection[] = [
  { id: 'basic_display', label: '基本情報（共通部分）', description: 'テーマカラー・ロゴ・注意書き・ボタン文言・完了メッセージ（フォーム名・LIFF ID・種別固有の設定は除く）' },
  { id: 'menu_structure', label: 'メニュー構成', description: 'カテゴリー・メニュー・サブメニュー・オプション・追加質問・画像・複数選択の設定' },
  { id: 'selections', label: '詳細設定（性別・ご来店回数・クーポン・スタッフ選択）', description: '各選択の ON/OFF・選択肢・追加時間・表示設定' },
  { id: 'custom_fields', label: 'カスタム項目・画像 or テキスト設置', description: 'カスタム項目（追加質問含む）と任意位置のテキスト / 画像ブロック' },
  { id: 'calendar_settings', label: '営業時間・受付ルール・日時選択', description: '営業時間・祝日・臨時営業日・予約可能日数・✕時間帯・第三希望日時の設定・手動予約フォームの項目（メール欄の表示・店舗側通知メールは除く）' },
  { id: 'cancel_rules', label: 'キャンセルルール設定', description: 'キャンセル期限・規定文・店舗通知' },
  { id: 'notification_messages', label: '通知メッセージ', description: 'LINE 自動応答【ご予約確認】【キャンセル完了】の文言' },
  { id: 'display_settings', label: 'ご予約内容・表示設定', description: '合計金額 / 合計時間の表示・同意事項・ボタン形状など' },
];

export const FORM_SYNC_SECTION_IDS: SyncSectionId[] = FORM_SYNC_SECTIONS.map((s) => s.id);

/** 反映先で常に保持する項目（種別固有） */
const PRESERVED_BASIC_INFO_KEYS: Array<keyof FormConfig['basic_info']> = ['form_name', 'liff_id', 'line_only', 'second_message'];
const PRESERVED_CALENDAR_KEYS: Array<keyof FormConfig['calendar_settings']> = ['show_customer_email', 'notification_email'];

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

/**
 * source の選択セクションを target に上書きした新しい config を返す（target / source は変更しない）。
 * 未選択のセクションと種別固有の項目は target の値のまま
 */
export function buildSyncedConfig(
  source: FormConfig,
  target: FormConfig,
  sections: SyncSectionId[]
): FormConfig {
  const out: FormConfig = clone(target);
  const on = (id: SyncSectionId) => sections.includes(id);

  if (on('basic_display')) {
    const next = { ...clone(source.basic_info) } as FormConfig['basic_info'];
    for (const key of PRESERVED_BASIC_INFO_KEYS) {
      const kept = target.basic_info?.[key];
      if (kept === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = clone(kept);
    }
    out.basic_info = next;
  }
  if (on('menu_structure')) {
    out.menu_structure = clone(source.menu_structure);
  }
  if (on('selections')) {
    out.gender_selection = clone(source.gender_selection);
    out.visit_count_selection = clone(source.visit_count_selection);
    out.coupon_selection = clone(source.coupon_selection);
    out.staff_selection = clone(source.staff_selection);
    if (source.visit_options !== undefined) out.visit_options = clone(source.visit_options);
  }
  if (on('custom_fields')) {
    out.custom_fields = clone(source.custom_fields);
    out.content_blocks = clone(source.content_blocks);
  }
  if (on('calendar_settings')) {
    const next = { ...clone(source.calendar_settings) } as FormConfig['calendar_settings'];
    for (const key of PRESERVED_CALENDAR_KEYS) {
      const kept = target.calendar_settings?.[key];
      if (kept === undefined) delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = clone(kept);
    }
    out.calendar_settings = next;
    out.manual_form_settings = clone(source.manual_form_settings);
    out.validation_rules = clone(source.validation_rules);
  }
  if (on('cancel_rules')) {
    out.cancel_rules = clone(source.cancel_rules);
  }
  if (on('notification_messages')) {
    out.notification_messages = clone(source.notification_messages);
  }
  if (on('display_settings')) {
    out.reservation_summary = clone(source.reservation_summary);
    out.ui_settings = clone(source.ui_settings);
  }

  // 常に反映先のものを保持
  out.form_type = target.form_type;
  out.line_message_items = clone(target.line_message_items);
  return out;
}

/** config のトップレベルキー → 画面上のセクション名（差分表示用） */
export const CONFIG_SECTION_LABELS: Record<string, string> = {
  basic_info: '基本情報',
  form_type: 'フォームタイプ',
  menu_structure: 'メニュー構成',
  calendar_settings: '営業時間・ルール',
  custom_fields: 'カスタム項目',
  content_blocks: '画像orテキスト設置',
  staff_selection: 'スタッフ選択',
  gender_selection: '性別選択',
  visit_count_selection: 'ご来店回数選択',
  visit_options: 'ご来店回数の選択肢',
  coupon_selection: 'クーポン選択',
  manual_form_settings: '手動予約フォームの項目',
  notification_messages: '通知メッセージ',
  cancel_rules: 'キャンセルルール設定',
  line_message_items: '送信時の項目編集',
  reservation_summary: 'ご予約内容',
  ui_settings: '表示設定',
  validation_rules: '入力チェック',
};

/** 2 つの config で内容が違うセクション名の一覧（復元前の確認表示用） */
export function diffConfigSections(a: Partial<FormConfig> | null | undefined, b: Partial<FormConfig> | null | undefined): string[] {
  const keys = new Set<string>([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const changed: string[] = [];
  for (const key of keys) {
    const av = (a as Record<string, unknown> | null | undefined)?.[key];
    const bv = (b as Record<string, unknown> | null | undefined)?.[key];
    if (JSON.stringify(av ?? null) !== JSON.stringify(bv ?? null)) {
      changed.push(CONFIG_SECTION_LABELS[key] || key);
    }
  }
  return changed;
}

export interface SyncTargetSummary {
  id: string;
  name: string;
  form_type: 'line' | 'web';
  status: string;
}

/** 反映先の候補: 同じ店舗の予約フォームのうち、元のフォーム以外 */
export function listSyncTargets(
  forms: Array<Pick<Form, 'id' | 'store_id' | 'status'> & { config?: Partial<FormConfig> | null; form_name?: string | null }>,
  sourceFormId: string,
  storeId: string
): SyncTargetSummary[] {
  return forms
    .filter((f) => f && f.id !== sourceFormId && f.store_id === storeId)
    .map((f) => ({
      id: f.id,
      name: (f.config?.basic_info?.form_name || f.form_name || 'フォーム').trim() || 'フォーム',
      form_type: f.config?.form_type === 'web' ? 'web' : 'line',
      status: String(f.status || ''),
    }));
}
