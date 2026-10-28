/**
 * 選択肢ごとの「送信時の追加メッセージ」（`extra_message`）の純粋ロジック（クライアント / サーバー共用）
 *
 * - LIFF の `liff.sendMessages()` は 1 回の送信で最大 5 通。本文（1 通）+ 基本情報の 2 通目（最大 1 通）+
 *   選ばれた選択肢の追加メッセージ をこの範囲に収める
 * - 保存時は「同時に選ばれうる最大の組み合わせ」を数え、5 通を超える設定は保存できない
 *   （`countSurveyMaxLineMessages` / `countReservationMaxLineMessages` + `validateLiffMessageLimit`）
 * - 送信時は保険として `capLiffMessages` で 5 通に収める（あふれた分は最後の 1 通に改行区切りでまとめる）
 * - 静的 HTML に埋め込む同じ処理は `EXTRA_MESSAGE_RUNTIME_JS`（`xmResolve` / `xmCapMessages`）
 */
import type { AdditionalQuestion, FormConfig, MenuCategory, MenuItem, MenuOption, OptionExtraMessage } from '@/types/form';
import type { SurveyConfig, SurveyFollowUpQuestion, SurveyQuestionOption } from '@/types/survey';

/** LIFF `sendMessages` で 1 回に送れるメッセージ数の上限 */
export const LIFF_MAX_MESSAGES = 5;
/** 追加メッセージ 1 通の最大文字数（LINE のテキストメッセージ上限 5000 より十分小さく） */
export const EXTRA_MESSAGE_MAX_LENGTH = 1000;

/** ON かつ文言があるときだけトリム済みの文言を返す */
export function resolveExtraMessage(raw: OptionExtraMessage | null | undefined): string | null {
  if (!raw || raw.enabled !== true || typeof raw.text !== 'string') return null;
  const text = raw.text.trim();
  return text ? text : null;
}

function hasExtraMessage(raw: OptionExtraMessage | null | undefined): number {
  return resolveExtraMessage(raw) ? 1 : 0;
}

/**
 * 送信するテキストの一覧を LIFF の上限に収める。
 * 同じ文言は 1 回だけ。上限を超える分は最後の 1 通に空行区切りで連結する（文言は欠けない）
 */
export function capLiffMessages(texts: string[]): string[] {
  const unique: string[] = [];
  for (const t of texts) {
    if (typeof t !== 'string' || !t) continue;
    if (unique.indexOf(t) === -1) unique.push(t);
  }
  if (unique.length <= LIFF_MAX_MESSAGES) return unique;
  const head = unique.slice(0, LIFF_MAX_MESSAGES - 1);
  head.push(unique.slice(LIFF_MAX_MESSAGES - 1).join('\n\n'));
  return head;
}

/** 上限を超えているときのエラー文（超えていなければ null） */
export function validateLiffMessageLimit(maxCount: number): string | null {
  if (maxCount <= LIFF_MAX_MESSAGES) return null;
  return `送信時に追加で送るメッセージが多すぎます。LINE には 1 回の送信で本文・2 通目のメッセージを含めて最大 ${LIFF_MAX_MESSAGES} 通までしか送れません（現在の設定では同時に選ばれたとき最大 ${maxCount} 通になります）。選択肢の「設定」で追加メッセージを減らしてください。`;
}

function isChoiceType(type: string | undefined): boolean {
  return type === 'radio' || type === 'checkbox' || type === 'select';
}

/** 単一選択（radio / select）は最も多い選択肢 1 つ、複数選択（checkbox）は全選択肢の合計 */
function combine(type: string | undefined, counts: number[]): number {
  if (counts.length === 0) return 0;
  return type === 'checkbox' ? counts.reduce((a, b) => a + b, 0) : Math.max(...counts);
}

// ===== アンケート =====

function surveyFollowUps(opt: SurveyQuestionOption): SurveyFollowUpQuestion[] {
  if (Array.isArray(opt.follow_ups)) return opt.follow_ups;
  return opt.follow_up ? [opt.follow_up] : [];
}

function surveyOptionWorst(opt: SurveyQuestionOption | null | undefined): number {
  if (!opt) return 0;
  let n = hasExtraMessage(opt.extra_message);
  for (const fu of surveyFollowUps(opt)) {
    if (!fu || fu.enabled !== true || !isChoiceType(fu.type)) continue;
    n += combine(fu.type, (fu.options || []).map(surveyOptionWorst));
  }
  return n;
}

/**
 * アンケートで 1 回の送信で LINE へ送られうる最大メッセージ数
 * （本文 1 通 + 2 通目 + 同時に選ばれうる選択肢の追加メッセージ。非表示の質問も表示されうるものとして数える）
 */
export function countSurveyMaxLineMessages(config: SurveyConfig | null | undefined): number {
  let n = 1 + hasExtraMessage(config?.basic_info?.second_message);
  for (const q of config?.questions || []) {
    if (!q || !isChoiceType(q.type)) continue;
    n += combine(q.type, (q.options || []).map(surveyOptionWorst));
  }
  return n;
}

// ===== 予約フォーム =====

function additionalQuestionsWorst(list: AdditionalQuestion[] | undefined): number {
  let n = 0;
  for (const q of list || []) {
    if (!q || !isChoiceType(q.type)) continue;
    n += combine(q.type, (q.options || []).map((o) => hasExtraMessage(o?.extra_message)));
  }
  return n;
}

function menuOptionWorst(opt: MenuOption | null | undefined): number {
  if (!opt) return 0;
  return hasExtraMessage(opt.extra_message) + additionalQuestionsWorst(opt.additional_questions);
}

/** メニュー 1 つを選んだときの最大（メニュー本体 + 最も多いサブメニュー + オプション全部 + 追加質問） */
function menuWorst(menu: MenuItem | null | undefined): number {
  if (!menu) return 0;
  let n = hasExtraMessage(menu.extra_message) + additionalQuestionsWorst(menu.additional_questions);
  if (menu.has_submenu && Array.isArray(menu.sub_menu_items) && menu.sub_menu_items.length > 0) {
    n += Math.max(...menu.sub_menu_items.map((s) => hasExtraMessage(s?.extra_message)));
  }
  n += (menu.options || []).reduce((sum, o) => sum + menuOptionWorst(o), 0);
  return n;
}

function categoryOptionsWorst(cat: MenuCategory | null | undefined): number {
  return (cat?.options || []).reduce((sum, o) => sum + menuOptionWorst(o as unknown as MenuOption), 0);
}

/**
 * 予約フォームで 1 回の送信で LINE へ送られうる最大メッセージ数
 * - 本文 1 通 + 2 通目
 * - メニュー: カテゴリーまたぎ複数選択なら上限数ぶんの多いメニュー、それ以外は最も多いメニュー 1 つ。
 *   カテゴリー共通オプションは複数選択なので全部（単一選択モードでは最も多いカテゴリー 1 つ）
 * - カスタム項目: 単一選択は最も多い選択肢、複数選択は全部。選択肢の追加質問も含む（非表示の項目も表示されうるものとして数える）
 */
export function countReservationMaxLineMessages(config: FormConfig | null | undefined): number {
  let n = 1 + hasExtraMessage(config?.basic_info?.second_message);
  const ms = config?.menu_structure;
  const categories = Array.isArray(ms?.categories) ? ms!.categories : [];
  const menuCounts: number[] = [];
  for (const cat of categories) for (const m of cat?.menus || []) menuCounts.push(menuWorst(m));
  for (const m of ms?.menus || []) menuCounts.push(menuWorst(m));
  menuCounts.sort((a, b) => b - a);
  const catOptionCounts = categories.map(categoryOptionsWorst);
  if (ms?.allow_cross_category_selection === true) {
    const rawMax = Number(ms.max_cross_category_selections);
    const limit = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 3;
    n += menuCounts.slice(0, limit).reduce((a, b) => a + b, 0);
    n += catOptionCounts.reduce((a, b) => a + b, 0);
  } else {
    n += menuCounts.length > 0 ? menuCounts[0] : 0;
    n += catOptionCounts.length > 0 ? Math.max(...catOptionCounts) : 0;
  }
  for (const field of config?.custom_fields || []) {
    if (!field || !isChoiceType(field.type)) continue;
    n += combine(
      field.type,
      (field.options || []).map((o) => hasExtraMessage(o?.extra_message) + additionalQuestionsWorst(o?.additional_questions))
    );
  }
  return n;
}

/** 編集中のフォーム設定から上限エラーを返す（予約 / アンケート共通の入口） */
export function validateFormExtraMessages(config: unknown, kind: 'reservation' | 'survey'): string | null {
  const count = kind === 'survey'
    ? countSurveyMaxLineMessages(config as SurveyConfig)
    : countReservationMaxLineMessages(config as FormConfig);
  return validateLiffMessageLimit(count);
}

/**
 * 静的 HTML に埋め込む共通 JS（バッククォート不使用）
 * - `xmResolve(raw)`: `resolveExtraMessage` と同じ
 * - `xmCapMessages(list)`: `capLiffMessages` と同じ（重複除去 + 5 通に収める）
 */
export const EXTRA_MESSAGE_RUNTIME_JS = `
        var XM_MAX_MESSAGES = ${LIFF_MAX_MESSAGES};
        function xmResolve(raw) {
            if (!raw || raw.enabled !== true || typeof raw.text !== 'string') return null;
            var t = raw.text.trim();
            return t ? t : null;
        }
        function xmCapMessages(list) {
            var unique = [];
            for (var i = 0; i < list.length; i++) {
                var t = list[i];
                if (typeof t !== 'string' || !t) continue;
                if (unique.indexOf(t) === -1) unique.push(t);
            }
            if (unique.length <= XM_MAX_MESSAGES) return unique;
            var head = unique.slice(0, XM_MAX_MESSAGES - 1);
            head.push(unique.slice(XM_MAX_MESSAGES - 1).join('\\n\\n'));
            return head;
        }
`;
