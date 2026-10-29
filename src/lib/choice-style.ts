/**
 * 単一選択 / 複数選択の「表示形式」（ボタン式 / チェックボックス式）と、チェックボックスの大きさ。
 *
 * - 回答タイプ（`type`）は従来どおり `radio`（単一）/ `checkbox`（複数）のまま。表示形式は `choice_style`
 *   （未設定 = 'button' = 従来のボタン式）で切り替える。回答の値・追加質問・タグ・表示トリガー・復元は変わらない
 * - チェックボックス式は 1 列（縦並び）で、行全体をタップで選べる。単一は丸（ラジオ風）、複数は四角に ✓
 * - 大きさ `choice_size`（未設定 = 'medium'）: 小 = 18px / 中 = 24px / 大 = 32px。文字も少し大きくなる
 * - 対象: アンケートの質問・選択肢の追加質問（入れ子含む）・予約フォームのカスタム項目・追加質問
 * - 編集画面の回答タイプのプルダウンは「単一選択 (ボタン)」「複数選択 (ボタン)」「単一選択 (チェックボックス)」
 *   「複数選択 (チェックボックス)」の 4 つ（`CHOICE_TYPE_SELECT_OPTIONS`。キーと `type` / `choice_style` の相互変換）
 * - 生成 HTML は選択肢の入れ物（`.button-group` / `.custom-field-radios` 等）に `choiceGroupClass()` のクラスを付け、
 *   `CHOICE_CHECK_CSS` が見た目を変える（DOM 構造・JS は従来と同じ）
 */

export type ChoiceStyle = 'button' | 'checkbox';
export type ChoiceSize = 'small' | 'medium' | 'large';
export type ChoiceBaseType = 'radio' | 'checkbox';

export interface ChoiceStyleLike {
  type?: string;
  choice_style?: ChoiceStyle | string | null;
  choice_size?: ChoiceSize | string | null;
}

export const CHOICE_SIZE_OPTIONS: Array<{ value: ChoiceSize; label: string }> = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

/** 回答タイプのプルダウンに出す単一 / 複数選択の 4 つ（他のタイプは各編集画面がそのまま出す） */
export const CHOICE_TYPE_SELECT_OPTIONS: Array<{ key: string; type: ChoiceBaseType; style: ChoiceStyle; label: string }> = [
  { key: 'radio', type: 'radio', style: 'button', label: '単一選択 (ボタン)' },
  { key: 'checkbox', type: 'checkbox', style: 'button', label: '複数選択 (ボタン)' },
  { key: 'radio_check', type: 'radio', style: 'checkbox', label: '単一選択 (チェックボックス)' },
  { key: 'checkbox_check', type: 'checkbox', style: 'checkbox', label: '複数選択 (チェックボックス)' },
];

export function isChoiceBaseType(type: unknown): type is ChoiceBaseType {
  return type === 'radio' || type === 'checkbox';
}

export function resolveChoiceStyle(q: ChoiceStyleLike | null | undefined): ChoiceStyle {
  return q?.choice_style === 'checkbox' ? 'checkbox' : 'button';
}

export function resolveChoiceSize(q: ChoiceStyleLike | null | undefined): ChoiceSize {
  const s = q?.choice_size;
  return s === 'small' || s === 'large' ? s : 'medium';
}

/** チェックボックス式か（type が radio / checkbox で choice_style = 'checkbox'） */
export function isCheckboxStyle(q: ChoiceStyleLike | null | undefined): boolean {
  return !!q && isChoiceBaseType(q.type) && resolveChoiceStyle(q) === 'checkbox';
}

/** 編集画面のプルダウンの値（type + choice_style → キー）。radio / checkbox 以外はそのまま返す */
export function choiceTypeKey(type: string, choiceStyle: ChoiceStyle | string | null | undefined): string {
  if (!isChoiceBaseType(type)) return type;
  const style: ChoiceStyle = choiceStyle === 'checkbox' ? 'checkbox' : 'button';
  const found = CHOICE_TYPE_SELECT_OPTIONS.find((o) => o.type === type && o.style === style);
  return found ? found.key : type;
}

/**
 * プルダウンのキー → `type` と `choice_style`。radio / checkbox 以外のキーは type としてそのまま返し、
 * choice_style は undefined（JSON に残さない）
 */
export function parseChoiceTypeKey(key: string): { type: string; choice_style: ChoiceStyle | undefined } {
  const found = CHOICE_TYPE_SELECT_OPTIONS.find((o) => o.key === key);
  if (!found) return { type: key, choice_style: undefined };
  return { type: found.type, choice_style: found.style === 'checkbox' ? 'checkbox' : undefined };
}

/**
 * 生成 HTML で選択肢の入れ物に付けるクラス（先頭に空白付き。ボタン式なら空文字）。
 * 例: ' choice-check choice-check--single choice-check--medium'
 */
export function choiceGroupClass(q: ChoiceStyleLike | null | undefined): string {
  if (!q || !isCheckboxStyle(q)) return '';
  const kind = q.type === 'radio' ? 'single' : 'multi';
  return ` choice-check choice-check--${kind} choice-check--${resolveChoiceSize(q)}`;
}

/**
 * チェックボックス式の見た目（アンケート `.choice-button` / 予約フォーム `.choice-label` 共通）。
 * 各ジェネレータのボタン式 CSS より後ろに入れる（選択中の背景色・「✓ 選択中」バッジを打ち消すため）
 */
export const CHOICE_CHECK_CSS = `
        /* チェックボックス式の単一 / 複数選択: 1 列（縦並び）・行全体をタップ。単一は丸、複数は四角に ✓ */
        .choice-check { display: flex; flex-direction: column; flex-wrap: nowrap; gap: 8px; --chk-size: 24px; --chk-font: 16px; --chk-pad: 12px 14px; }
        .choice-check--small { --chk-size: 18px; --chk-font: 15px; --chk-pad: 10px 12px; }
        .choice-check--large { --chk-size: 32px; --chk-font: 18px; --chk-pad: 14px 16px; }
        .choice-check > .choice-button,
        .choice-check > .choice-label {
            flex: 0 0 auto !important;
            width: 100%;
            min-width: 100% !important;
            box-sizing: border-box;
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            gap: 12px;
            padding: var(--chk-pad);
            margin: 0;
            border: 1px solid #ccc;
            border-radius: 6px;
            background-color: #fff;
            color: #1b2a4e;
            font-size: var(--chk-font);
            font-weight: 500;
            text-align: left;
            line-height: 1.4;
            cursor: pointer;
            word-break: break-word;
        }
        .choice-check > .choice-button::before,
        .choice-check > .choice-label::before {
            content: "";
            flex: 0 0 auto;
            width: var(--chk-size);
            height: var(--chk-size);
            box-sizing: border-box;
            border: 2px solid #9ca3af;
            border-radius: 4px;
            background-color: #fff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: calc(var(--chk-size) * 0.7);
            font-weight: 700;
            line-height: 1;
        }
        .choice-check--single > .choice-button::before,
        .choice-check--single > .choice-label::before { border-radius: 50%; }
        .choice-check > .choice-button.selected,
        .choice-check > .choice-label.selected {
            background-color: #fff7ed !important;
            border-color: var(--primary-color) !important;
            color: #1b2a4e !important;
            box-shadow: none !important;
        }
        .choice-check--multi > .choice-button.selected::before,
        .choice-check--multi > .choice-label.selected::before {
            content: "\\2713";
            border-color: var(--primary-color);
            background-color: var(--primary-color);
        }
        .choice-check--single > .choice-button.selected::before,
        .choice-check--single > .choice-label.selected::before {
            border-color: var(--primary-color);
            background-color: var(--primary-color);
            box-shadow: inset 0 0 0 calc(var(--chk-size) * 0.18) #fff;
        }
        /* ボタン式の「✓ 選択中」バッジは出さない */
        .choice-check > .choice-button.selected::after,
        .choice-check > .choice-label.selected::after { content: none !important; display: none !important; }
        @media (hover: hover) and (pointer: fine) {
            .choice-check > .choice-button:hover,
            .choice-check > .choice-label:hover { border-color: var(--primary-color); background-color: #fffcf5; }
        }`;
