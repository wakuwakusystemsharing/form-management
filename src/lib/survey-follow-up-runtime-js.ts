/**
 * 「選択肢ごとの追加質問」（複数・入れ子）の静的 HTML 用の共通実装。
 * アンケートフォーム（`static-generator-survey.ts`）と抽選フォームの事前質問（`static-generator-lottery.ts`）の両方が使う。
 *
 * - DOM の id 規則（path = [選択肢 index, 追加質問 index, 選択肢 index, 追加質問 index, ...]）:
 *   - ブロック:        `followup-{questionId}-{path を - で連結}`
 *   - 入力欄:          `fu-{questionId}-{path}`（text / textarea / select / birthday の hidden）
 *   - ボタンの入れ物:  `fu-container-{questionId}-{path}`（radio / checkbox）
 *   - その他の理由欄:  `fu-other-block-{questionId}-{path}` / `fu-other-{questionId}-{path}`（`allow_other` のとき）
 * - 追加質問の上下のテキスト / 画像ブロック（`content_blocks`）は追加質問ブロックの中に描画する
 *   例: 質問 q2 の選択肢 1 の追加質問 0 → `fu-q2-1-0`、その選択肢 2 の追加質問 0 → `fu-q2-1-0-2-0`
 * - 入れ子の追加質問ブロックは親の追加質問ブロックの中に描画する（親を隠せば子も隠れる）
 * - 埋め込み JS はバッククォート不使用（抽選フォームの制約）。各ジェネレータは `fuOnChange(questionId)` を定義して
 *   追加質問内の選択が変わったときの処理（表示更新・保存）を受け取る
 */
import type { SurveyContentBlock, SurveyFollowUpQuestion, SurveyQuestionOption } from '@/types/survey';
import { renderBirthdayFieldHtml } from './multiple-dates-runtime-js';
import { renderColoredTextHtml } from './colored-text';
import { FOLLOW_UP_OTHER_VALUE, followUpTitle, getOptionFollowUps, isChoiceFollowUpType } from './survey-follow-ups';

export interface FollowUpRenderOptions {
  /** 追加質問の見出しに付けるクラス */
  labelClass: string;
  /** radio / checkbox のボタンを包む div のクラス */
  buttonGroupClass: string;
  /** 1 行テキストの入力欄の形 */
  textAs: 'textarea' | 'input';
}

function esc(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 質問（または追加質問）の選択肢に付いた追加質問ブロックをすべて描画する（初期状態は非表示。入れ子は再帰）
 * @param questionId 親質問の ID
 * @param parentTitle 親（質問 or 追加質問）のタイトル。追加質問の文言が空のときの見出しに使う
 */
export function renderFollowUpBlocksHtml(
  questionId: string,
  parentTitle: string,
  options: SurveyQuestionOption[] | undefined,
  render: FollowUpRenderOptions,
  path: number[] = []
): string {
  const qid = esc(questionId);
  return (options || []).map((opt, i) => {
    return getOptionFollowUps(opt).map((fu, j) => {
      if (!fu || fu.enabled !== true) return '';
      const p = [...path, i, j];
      const fid = `${qid}-${p.join('-')}`;
      const title = followUpTitle(fu, parentTitle, opt.label);
      const depth = p.length / 2;
      const nested = isChoiceFollowUpType(fu.type)
        ? renderFollowUpBlocksHtml(questionId, title, fu.options, render, p)
        : '';
      const other = isChoiceFollowUpType(fu.type) && fu.allow_other === true
        ? `
                <div class="other-reason follow-up-other" id="fu-other-block-${fid}" style="display:none;">
                    <label class="${render.labelClass}" for="fu-other-${fid}">その他を選択されている方はご理由をお書きください。</label>
                    <textarea id="fu-other-${fid}" class="input" rows="2" placeholder="入力してください"></textarea>
                </div>`
        : '';
      return `
            <div class="follow-up" id="followup-${fid}" data-question="${qid}" data-opt-index="${i}" data-fu-depth="${depth}" style="display:none;">
                ${renderFollowUpContentBlocks(fu.content_blocks, 'above')}
                <label class="${render.labelClass}">${esc(title)}${fu.required ? ' <span class="required">必須</span>' : ''}</label>
                ${renderFollowUpFieldHtml(qid, fid, fu, render)}${other}${nested}
                ${renderFollowUpContentBlocks(fu.content_blocks, 'below')}
            </div>`;
    }).join('');
  }).join('');
}

/** 追加質問の上下のテキスト / 画像ブロック（空のテキスト・URL でない画像は出さない） */
function renderFollowUpContentBlocks(blocks: SurveyContentBlock[] | undefined, position: 'above' | 'below'): string {
  return (blocks || []).filter((b) => {
    if (!b || (b.position || 'above') !== position) return false;
    if (b.type === 'text') return !!(b.text && b.text.trim());
    if (b.type === 'image') return !!(b.image_url && /^https?:/i.test(b.image_url.trim()));
    return false;
  }).map((b) => {
    if (b.type === 'image') {
      return `<div class="content-block content-block-image"><img src="${esc((b.image_url || '').trim())}" alt="" loading="lazy"></div>`;
    }
    return `<div class="content-block content-block-text">${renderColoredTextHtml(b.text || '')}</div>`;
  }).join('');
}

function renderFollowUpFieldHtml(qid: string, fid: string, fu: SurveyFollowUpQuestion, render: FollowUpRenderOptions): string {
  const fieldId = `fu-${fid}`;
  const allowOther = fu.allow_other === true;
  switch (fu.type) {
    case 'select': {
      let opts = (fu.options || []).map((o, k) =>
        `<option value="${esc(o.value || o.label)}" data-opt-index="${k}">${esc(o.label)}</option>`
      ).join('\n');
      if (allowOther) opts += `\n<option value="${FOLLOW_UP_OTHER_VALUE}">その他</option>`;
      return `<select id="${fieldId}" class="input" onchange="fuOnChange('${qid}')"><option value="">選択してください</option>${opts}</select>`;
    }
    case 'radio':
    case 'checkbox': {
      let buttons = (fu.options || []).map((o, k) =>
        `<button type="button" class="choice-button" data-opt-index="${k}" data-value="${esc(o.value || o.label)}" onclick="fuSelectChoice(this, '${qid}', '${fu.type}')">${esc(o.label)}</button>`
      ).join('\n');
      if (allowOther) buttons += `\n<button type="button" class="choice-button" data-other="1" data-value="${FOLLOW_UP_OTHER_VALUE}" onclick="fuSelectChoice(this, '${qid}', '${fu.type}')">その他</button>`;
      return `<div class="${render.buttonGroupClass}" id="fu-container-${fid}">${buttons}</div>`;
    }
    case 'textarea':
      return `<textarea id="${fieldId}" class="input" rows="3" placeholder="入力してください"></textarea>`;
    case 'birthday':
      return renderBirthdayFieldHtml(fieldId);
    case 'text':
    default:
      return render.textAs === 'input'
        ? `<input type="text" id="${fieldId}" class="input" placeholder="入力してください">`
        : `<textarea id="${fieldId}" class="input" rows="1" placeholder="入力してください"></textarea>`;
  }
}

/** 入れ子の追加質問を少し字下げする CSS（各ジェネレータの CSS に追加する） */
export const FOLLOW_UP_NESTED_CSS = `
        .follow-up .follow-up { margin-left: 0.5rem; }
        .follow-up .follow-up-other { margin-top: 0.75rem; }
        .follow-up .follow-up-other textarea { margin-top: 0.25rem; }
        .follow-up .content-block { margin: 0.5rem 0; }
        .follow-up .content-block-text { font-size: 14px; color: #333; line-height: 1.7; white-space: normal; }
        .follow-up .content-block-image img { display: block; max-width: 100%; margin: 0 auto; border-radius: 4px; }`;

/**
 * 追加質問の共通ランタイム JS。
 * 各ジェネレータ側で `function fuOnChange(questionId) { ... }` を定義すること
 */
export const FOLLOW_UP_RUNTIME_JS = `
        // ===== 選択肢ごとの追加質問（複数・入れ子）共通ランタイム =====
        function fuRawList(opt) {
            if (!opt) return [];
            if (Array.isArray(opt.follow_ups)) return opt.follow_ups;
            return opt.follow_up ? [opt.follow_up] : [];
        }
        function fuEnabled(fu) { return !!fu && fu.enabled === true; }
        function fuIsChoice(fu) { return !!fu && (fu.type === 'radio' || fu.type === 'checkbox' || fu.type === 'select'); }
        function fuId(qid, path) { return qid + '-' + path.join('-'); }
        function fuHas(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

        // 追加質問（radio / checkbox / select）で選ばれている選択肢の index
        function fuSelectedOptIndexes(fid, fu) {
            var out = [];
            if (fu.type === 'select') {
                var sel = document.getElementById('fu-' + fid);
                if (!sel || !sel.selectedOptions || !sel.selectedOptions[0]) return out;
                var o = sel.selectedOptions[0];
                if (o.value !== '' && o.dataset.optIndex !== undefined) out.push(Number(o.dataset.optIndex));
                return out;
            }
            var c = document.getElementById('fu-container-' + fid);
            if (!c) return out;
            var btns = c.querySelectorAll('.choice-button.selected[data-opt-index]');
            for (var i = 0; i < btns.length; i++) out.push(Number(btns[i].dataset.optIndex));
            return out;
        }

        // 「その他」の内部値（各ジェネレータが OTHER_OPTION_VALUE を定義。無ければ既定値）
        function fuOtherValue() { return (typeof OTHER_OPTION_VALUE === 'string') ? OTHER_OPTION_VALUE : '__other__'; }
        // 追加質問で「その他」が選ばれているか
        function fuOtherSelected(fid, fu) {
            if (fu.type === 'select') {
                var sel = document.getElementById('fu-' + fid);
                return !!sel && sel.value === fuOtherValue();
            }
            var c = document.getElementById('fu-container-' + fid);
            return !!c && !!c.querySelector('.choice-button.selected[data-other]');
        }
        // 「その他」の送信値（理由があれば「その他（理由）」）
        function fuOtherText(fid) {
            var el = document.getElementById('fu-other-' + fid);
            var reason = el ? String(el.value || '').trim() : '';
            return reason ? 'その他（' + reason + '）' : 'その他';
        }
        function fuButtonValue(btn) { return btn.dataset.value !== undefined ? btn.dataset.value : btn.innerText; }

        // 追加質問の回答値（radio / checkbox は ", " 区切り。「その他」は理由を付加）
        function fuValue(fid, fu) {
            if (fu.type === 'radio' || fu.type === 'checkbox') {
                var c = document.getElementById('fu-container-' + fid);
                if (!c) return '';
                var btns = c.querySelectorAll('.choice-button.selected');
                var vals = [];
                for (var i = 0; i < btns.length; i++) vals.push(btns[i].dataset.other ? fuOtherText(fid) : fuButtonValue(btns[i]));
                return vals.join(', ');
            }
            var el = document.getElementById('fu-' + fid);
            if (!el) return '';
            if (fu.type === 'select' && el.value === fuOtherValue()) return fuOtherText(fid);
            return String(el.value || '').trim();
        }

        // 選択中の選択肢に紐づく追加質問だけ表示（入れ子も再帰。親が非表示なら子も非表示）
        function fuUpdateVisibility(qid, options, selectedIdx, path, parentVisible) {
            path = path || [];
            if (parentVisible === undefined) parentVisible = true;
            options = options || [];
            for (var i = 0; i < options.length; i++) {
                var list = fuRawList(options[i]);
                for (var j = 0; j < list.length; j++) {
                    var fu = list[j];
                    if (!fuEnabled(fu)) continue;
                    var p = path.concat([i, j]);
                    var fid = fuId(qid, p);
                    var visible = parentVisible && selectedIdx.indexOf(i) !== -1;
                    var block = document.getElementById('followup-' + fid);
                    if (block) block.style.display = visible ? 'block' : 'none';
                    // 「その他」の理由欄は、この追加質問が表示中かつ「その他」選択中のときだけ
                    var otherBlock = document.getElementById('fu-other-block-' + fid);
                    if (otherBlock) otherBlock.style.display = (visible && fuOtherSelected(fid, fu)) ? 'block' : 'none';
                    if (fuIsChoice(fu)) fuUpdateVisibility(qid, fu.options, visible ? fuSelectedOptIndexes(fid, fu) : [], p, visible);
                }
            }
        }

        // 追加質問内の選択ボタン
        function fuSelectChoice(el, qid, type) {
            var c = el.parentElement;
            if (type === 'radio') {
                var all = c.querySelectorAll('.choice-button');
                for (var i = 0; i < all.length; i++) all[i].classList.remove('selected');
                el.classList.add('selected');
            } else {
                el.classList.toggle('selected');
            }
            if (typeof fuOnChange === 'function') fuOnChange(qid);
        }

        function fuTitle(fu, parentTitle, optLabel) {
            var t = String(fu.title || '').trim();
            return t || (parentTitle + '（' + optLabel + '）');
        }
        // 回答のキー（同名があれば「（選択肢名）」、それも重複すれば番号）
        function fuResponseKey(title, optLabel, answers) {
            if (!fuHas(answers, title)) return title;
            var withLabel = title + '（' + optLabel + '）';
            if (!fuHas(answers, withLabel)) return withLabel;
            var n = 2;
            while (fuHas(answers, withLabel + ' ' + n)) n++;
            return withLabel + ' ' + n;
        }
        // 必須未入力の文言（「〜ください」で終わる文言は二重表現を避ける）
        function fuRequiredMessage(title) {
            var t = title.replace(/。$/, '');
            return /ください$/.test(t) ? t + '。' : t + 'を入力してください。';
        }

        // 選択中の選択肢の追加質問の回答を answers に親の直後の順で追加（入れ子も再帰）。
        // 必須未入力があれば { error } を返す。display があれば表示用の値（誕生日は日本語整形）も入れる
        function fuCollect(qid, parentTitle, options, selectedIdx, path, answers, display) {
            options = options || [];
            for (var s = 0; s < selectedIdx.length; s++) {
                var opt = options[selectedIdx[s]];
                if (!opt) continue;
                var list = fuRawList(opt);
                for (var j = 0; j < list.length; j++) {
                    var fu = list[j];
                    if (!fuEnabled(fu)) continue;
                    var p = path.concat([selectedIdx[s], j]);
                    var fid = fuId(qid, p);
                    var val = fuValue(fid, fu);
                    var title = fuTitle(fu, parentTitle, opt.label);
                    if (fu.required && !val) return { error: fuRequiredMessage(title), title: title };
                    if (val) {
                        var key = fuResponseKey(title, opt.label, answers);
                        answers[key] = val;
                        if (display) display[key] = (fu.type === 'birthday' && typeof formatDateTimeForDisplay === 'function') ? formatDateTimeForDisplay(val) : val;
                    }
                    if (fuIsChoice(fu)) {
                        var r = fuCollect(qid, title, fu.options, fuSelectedOptIndexes(fid, fu), p, answers, display);
                        if (r) return r;
                    }
                }
            }
            return null;
        }

        // ---- 復元機能用（入力状態の保存 / 復元 / 保存リスナー）。state は { [fid]: { v } | { sel: [value] } } ----
        function fuCollectState(qid, options, path, state) {
            options = options || [];
            path = path || [];
            state = state || {};
            for (var i = 0; i < options.length; i++) {
                var list = fuRawList(options[i]);
                for (var j = 0; j < list.length; j++) {
                    var fu = list[j];
                    if (!fuEnabled(fu)) continue;
                    var p = path.concat([i, j]);
                    var fid = fuId(qid, p);
                    if (fu.type === 'radio' || fu.type === 'checkbox') {
                        var c = document.getElementById('fu-container-' + fid);
                        var vals = [];
                        if (c) {
                            var btns = c.querySelectorAll('.choice-button.selected');
                            for (var k = 0; k < btns.length; k++) vals.push(fuButtonValue(btns[k]));
                        }
                        state[fid] = { sel: vals };
                    } else {
                        var el = document.getElementById('fu-' + fid);
                        state[fid] = { v: el ? el.value : '' };
                    }
                    var otherEl = document.getElementById('fu-other-' + fid);
                    if (otherEl) state[fid].r = otherEl.value;
                    if (fuIsChoice(fu)) fuCollectState(qid, fu.options, p, state);
                }
            }
            return state;
        }
        function fuRestoreState(qid, options, path, state) {
            if (!state || typeof state !== 'object') return;
            options = options || [];
            path = path || [];
            for (var i = 0; i < options.length; i++) {
                var list = fuRawList(options[i]);
                for (var j = 0; j < list.length; j++) {
                    var fu = list[j];
                    if (!fuEnabled(fu)) continue;
                    var p = path.concat([i, j]);
                    var fid = fuId(qid, p);
                    var data = state[fid];
                    if (data) {
                        if (fu.type === 'radio' || fu.type === 'checkbox') {
                            if (Array.isArray(data.sel)) {
                                var c = document.getElementById('fu-container-' + fid);
                                if (c) {
                                    var btns = c.querySelectorAll('.choice-button');
                                    for (var k = 0; k < btns.length; k++) {
                                        var v = fuButtonValue(btns[k]);
                                        if (data.sel.indexOf(v) !== -1 || data.sel.indexOf(btns[k].innerText) !== -1) btns[k].classList.add('selected');
                                    }
                                }
                            }
                        } else {
                            var el = document.getElementById('fu-' + fid);
                            if (el && typeof data.v === 'string') {
                                el.value = data.v;
                                if (fu.type === 'birthday' && typeof bdSyncFromHidden === 'function') bdSyncFromHidden(el);
                            }
                        }
                        var otherEl = document.getElementById('fu-other-' + fid);
                        if (otherEl && typeof data.r === 'string') otherEl.value = data.r;
                    }
                    if (fuIsChoice(fu)) fuRestoreState(qid, fu.options, p, state);
                }
            }
        }
        // テキスト系の入力に保存リスナーを付ける（ボタンは fuSelectChoice、ドロップダウンは onchange の fuOnChange が担当）
        function fuBindSave(qid, options, path, onSave) {
            options = options || [];
            path = path || [];
            for (var i = 0; i < options.length; i++) {
                var list = fuRawList(options[i]);
                for (var j = 0; j < list.length; j++) {
                    var fu = list[j];
                    if (!fuEnabled(fu)) continue;
                    var p = path.concat([i, j]);
                    var fid = fuId(qid, p);
                    if (!fuIsChoice(fu)) {
                        var el = document.getElementById('fu-' + fid);
                        if (el) el.addEventListener('input', onSave);
                    } else {
                        var otherEl = document.getElementById('fu-other-' + fid);
                        if (otherEl) otherEl.addEventListener('input', onSave);
                        fuBindSave(qid, fu.options, p, onSave);
                    }
                }
            }
        }
`;
