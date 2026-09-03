/**
 * 抽選フォーム用 静的 HTML ジェネレータ（LINE LIFF 専用）
 *
 * - 結果はサーバー（POST /api/lotteries/draw）で確定し、この HTML は演出と表示だけを担当する
 * - vanilla JS のみ（React なし）。テンプレートリテラル内の JS はバッククォートを使わない
 * - mode = 'preview': LIFF を使わず、抽選 API も呼ばずにクライアント側で仮抽選して演出だけ確認する
 *
 * 設計書: docs/抽選フォーム_実装設計.md（4. 画面デザイン案 / 8. 静的 HTML）
 */
import type { LotteryConfig, LotteryForm } from '@/types/lottery';
import type { SurveyQuestion } from '@/types/survey';
import { computeAccentColor } from './color-utils';
import { getLoseProbability } from './lottery-engine';

export type LotteryGenerateMode = 'production' | 'preview';

const OTHER_OPTION_VALUE = '__other__';

export class StaticLotteryGenerator {
  static readonly OTHER_OPTION_VALUE = OTHER_OPTION_VALUE;

  generateHTML(form: LotteryForm, mode: LotteryGenerateMode = 'production'): string {
    const config: LotteryConfig = JSON.parse(JSON.stringify(form.config));
    const isPreview = mode === 'preview';
    const themeColor = /^#[0-9a-fA-F]{6}$/.test(config.basic_info.theme_color) ? config.basic_info.theme_color : '#1b2a4e';
    const accentColor = computeAccentColor(themeColor);
    const title = config.basic_info.title || '抽選';
    const isDeferred = config.lottery_type === 'deferred';

    const runtime = {
      form_id: form.id,
      store_id: form.store_id,
      mode,
      lottery_type: config.lottery_type,
      redeem_method: config.redeem_method,
      liff_id: config.basic_info.liff_id || '',
      title,
      store_name: config.basic_info.store_name || '',
      prizes: config.prizes,
      consolation_prize: config.consolation_prize ?? null,
      lose_probability: getLoseProbability(config.prizes),
      entry_rules: {
        limit: config.entry_rules.limit,
        require_friend: config.entry_rules.require_friend,
        pre_questions: config.entry_rules.pre_questions,
      },
      presentation: config.presentation,
      messages: {
        win_text: config.messages.win_text,
        lose_text: config.messages.lose_text,
        entry_text: config.messages.entry_text,
      },
      second_message:
        config.basic_info.second_message?.enabled && config.basic_info.second_message.text.trim()
          ? config.basic_info.second_message.text.trim()
          : null,
      deferred: config.deferred ?? null,
      period: config.basic_info.period ?? null,
      ui: config.ui_settings,
    };

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>${this.escapeHtml(title)}</title>
    <link rel="icon" href="data:,">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Poppins:wght@600;800&display=swap" rel="stylesheet">
    <style>
        ${this.generateCSS(themeColor, accentColor)}
    </style>
</head>
<body class="anim-${config.presentation.animation}">
    ${isPreview ? '<div class="preview-banner">プレビュー（抽選は記録されません・LINE への送信も行いません）</div>' : ''}

    <div class="form-container">
        <header class="form-header">
            ${config.basic_info.logo_url ? `<img class="form-logo" src="${this.escapeAttr(config.basic_info.logo_url)}" alt="">` : ''}
            <h1>${this.escapeHtml(title)}</h1>
            ${this.renderPeriodBadge(config)}
        </header>

        <main class="form-content" id="mainContent">
            <section class="stage" id="stage" aria-live="polite">
                <div class="stage-deco" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
                <div class="stage-inner" id="stageInner">
                    ${this.renderStageIdle(config)}
                </div>
            </section>

            <section class="section">
                <h2 class="field-label">賞品</h2>
                <div class="prize-list" id="prizeList">
                    ${config.prizes.map((p, i) => this.renderPrizeCard(p, i, config)).join('\n')}
                    ${config.consolation_prize ? this.renderPrizeCard(config.consolation_prize, -1, config, true) : ''}
                </div>
                ${config.presentation.show_probability ? `<p class="prize-note">はずれ ${this.escapeHtml(String(getLoseProbability(config.prizes)))}%</p>` : ''}
            </section>

            ${this.renderNotice(config)}

            ${config.entry_rules.pre_questions.length > 0 ? `
            <section class="section" id="questionsSection">
                <form id="preQuestions" onsubmit="return false;">
                    ${config.entry_rules.pre_questions.map((q, i) => this.renderQuestion(q, i)).join('\n')}
                </form>
            </section>` : ''}

            <section class="result hidden" id="resultPanel" aria-live="assertive"></section>
        </main>

        <footer class="form-footer" id="formFooter">
            <button type="button" class="submit-button" id="drawButton" onclick="startDraw()">${this.escapeHtml(isDeferred ? (config.ui_settings.submit_button_text === '抽選する' ? '応募する' : config.ui_settings.submit_button_text) : config.ui_settings.submit_button_text || '抽選する')}</button>
        </footer>
    </div>

    <div class="confetti-layer" id="confettiLayer" aria-hidden="true"></div>

    ${isPreview ? '' : '<script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>'}
    <script>
        var FORM_CONFIG = ${this.embedJson(runtime)};
        var OTHER_OPTION_VALUE = ${JSON.stringify(OTHER_OPTION_VALUE)};
        var IS_PREVIEW = ${isPreview ? 'true' : 'false'};
        var STORAGE_KEY = 'lottery_' + FORM_CONFIG.form_id;
        var REDUCED_MOTION = false;
        try { REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

        var state = {
            idToken: null,
            lineUserId: null,
            displayName: null,
            friendFlag: null,
            result: null,        // LotteryDrawResponse
            revealed: false,
            busy: false,
            gateBlocked: false
        };

        ${this.generateHelpersJS()}
        ${this.generateQuestionsJS()}
        ${this.generateLiffJS()}
        ${this.generateDrawJS()}
        ${this.generateAnimationJS()}
        ${this.generateResultJS()}

        document.addEventListener('DOMContentLoaded', function () {
            initQuestions();
            if (IS_PREVIEW) {
                var banner = document.querySelector('.preview-banner');
                if (banner) banner.setAttribute('role', 'status');
                return;
            }
            initLiff();
        });
    </script>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // HTML パーツ
  // ---------------------------------------------------------------------------

  private renderPeriodBadge(config: LotteryConfig): string {
    const period = config.basic_info.period;
    if (!period || (!period.start_at && !period.end_at)) return '';
    const fmt = (iso?: string) => {
      if (!iso) return '';
      const t = new Date(iso);
      if (Number.isNaN(t.getTime())) return '';
      const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
      const dow = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()];
      return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${dow}）`;
    };
    const start = fmt(period.start_at);
    const end = fmt(period.end_at);
    const label = config.lottery_type === 'deferred'
      ? (end ? `応募締切 ${end}` : '')
      : `${start || ''}${start && end ? ' 〜 ' : ''}${end ? (start ? end : `〜 ${end}`) : ''}`;
    if (!label) return '';
    return `<p class="period-badge">${this.escapeHtml(label)}</p>`;
  }

  private renderStageIdle(config: LotteryConfig): string {
    const isDeferred = config.lottery_type === 'deferred';
    const hint = isDeferred ? '応募するボタンを押してください' : '下のボタンを押して抽選スタート';
    switch (config.presentation.animation) {
      case 'gacha':
        return `
                    <div class="gacha" id="gacha">
                        <div class="gacha-dome"><span class="gacha-ball b1"></span><span class="gacha-ball b2"></span><span class="gacha-ball b3"></span><span class="gacha-ball b4"></span><span class="gacha-ball b5"></span></div>
                        <div class="gacha-body"><div class="gacha-lever" id="gachaLever"></div><div class="gacha-slot"></div></div>
                        <div class="gacha-capsule hidden" id="gachaCapsule"><div class="cap-top"></div><div class="cap-bottom"></div></div>
                    </div>
                    <p class="stage-hint" id="stageHint">${this.escapeHtml(hint)}</p>`;
      case 'simple':
        return `
                    <div class="drum" id="drum"><span class="drum-text" id="drumText">？</span></div>
                    <p class="stage-hint" id="stageHint">${this.escapeHtml(hint)}</p>`;
      case 'scratch':
      default: {
        const style = config.presentation.scratch_style;
        const cls = style === 'gold' ? 'gold' : style === 'image' ? 'image' : 'silver';
        return `
                    <div class="scratch ${cls}" id="scratch">
                        <div class="scratch-under" id="scratchUnder"><span class="scratch-under-text">？</span></div>
                        <canvas id="scratchCanvas" class="scratch-canvas hidden"></canvas>
                        <div class="scratch-cover" id="scratchCover"${style === 'image' && config.presentation.scratch_image_url ? ` style="background-image:url('${this.escapeAttr(config.presentation.scratch_image_url)}')"` : ''}><span>SCRATCH</span></div>
                    </div>
                    <p class="stage-hint" id="stageHint">${this.escapeHtml(hint)}</p>`;
      }
    }
  }

  private renderPrizeCard(prize: LotteryConfig['prizes'][number], index: number, config: LotteryConfig, isConsolation = false): string {
    const rank = /^#[0-9a-fA-F]{6}$/.test(prize.rank_color || '')
      ? prize.rank_color!
      : ['#d4af37', '#a8a9ad', '#cd7f32'][index] || '#6b7280';
    const meta: string[] = [];
    if (config.presentation.show_probability && config.lottery_type === 'instant' && !isConsolation) meta.push(`${prize.probability}%`);
    if (config.presentation.show_stock && prize.stock !== null && prize.stock !== undefined) {
      meta.push(`<span class="prize-stock" data-prize-stock="${this.escapeAttr(prize.id)}" data-stock="${prize.stock}">${config.lottery_type === 'deferred' ? `${prize.stock}名` : `残り${prize.stock}`}</span>`);
    }
    return `
                    <div class="prize-card${isConsolation ? ' consolation' : ''}" style="--rank:${rank}">
                        ${prize.image_url ? `<img class="prize-image" src="${this.escapeAttr(prize.image_url)}" alt="">` : '<div class="prize-image placeholder" aria-hidden="true">🎁</div>'}
                        <div class="prize-name">${this.escapeHtml(prize.name)}${isConsolation ? '<small>残念賞</small>' : ''}</div>
                        ${prize.description ? `<div class="prize-desc">${this.escapeHtml(prize.description)}</div>` : ''}
                        ${meta.length ? `<div class="prize-meta">${meta.join(' ・ ')}</div>` : ''}
                    </div>`;
  }

  private renderNotice(config: LotteryConfig): string {
    const lines: string[] = [];
    switch (config.entry_rules.limit) {
      case 'daily': lines.push('お一人様 1 日 1 回まで参加できます'); break;
      case 'period_n': lines.push(`お一人様 期間中 ${config.entry_rules.period_max ?? 1} 回まで参加できます`); break;
      default: lines.push(config.lottery_type === 'deferred' ? 'お一人様 1 口まで応募できます' : 'お一人様 1 回まで参加できます');
    }
    if (config.entry_rules.require_friend) lines.push('参加には公式 LINE の友だち追加が必要です');
    if (config.lottery_type === 'instant') {
      lines.push(config.redeem_method === 'qr' ? '当選された方は店頭で QR コードをご提示ください' : '当選された方は店頭で引換コードをご提示ください');
    } else {
      lines.push('抽選結果は当選された方にのみ LINE でお知らせします');
    }
    const custom = (config.basic_info.notice || '').trim();
    return `
            <section class="section notice-box">
                <h2 class="notice-title">ご注意</h2>
                <ul class="notice-list">${lines.map((l) => `<li>${this.escapeHtml(l)}</li>`).join('')}</ul>
                ${custom ? `<div class="notice-text">${this.escapeHtml(custom)}</div>` : ''}
            </section>`;
  }

  private renderQuestion(q: SurveyQuestion, index: number): string {
    const requiredMark = q.required ? '<span class="required">必須</span>' : '';
    const id = this.escapeAttr(q.id);
    let field = '';
    switch (q.type) {
      case 'textarea':
        field = `<textarea id="q-${id}" class="input" rows="3" placeholder="${this.escapeAttr(q.placeholder || '入力してください')}"></textarea>`;
        break;
      case 'date':
        field = `<input type="date" id="q-${id}" class="input">`;
        break;
      case 'datetime':
        field = `<input type="datetime-local" id="q-${id}" class="input">`;
        break;
      case 'select': {
        const opts = (q.options || []).map((o) => `<option value="${this.escapeAttr(o.value)}">${this.escapeHtml(o.label)}</option>`).join('');
        const other = q.allow_other ? `<option value="${OTHER_OPTION_VALUE}">その他</option>` : '';
        field = `<select id="q-${id}" class="input" onchange="onQuestionChange('${id}')"><option value="">選択してください</option>${opts}${other}</select>`;
        break;
      }
      case 'radio':
      case 'checkbox': {
        const buttons = (q.options || []).map((o, i) =>
          `<button type="button" class="choice-button" data-index="${i}" data-value="${this.escapeAttr(o.value)}" onclick="selectChoice(this, '${id}', '${q.type}')">${this.escapeHtml(o.label)}</button>`
        ).join('');
        const other = q.allow_other
          ? `<button type="button" class="choice-button" data-other="1" data-value="${OTHER_OPTION_VALUE}" onclick="selectChoice(this, '${id}', '${q.type}')">その他</button>`
          : '';
        field = `<div class="choice-group" id="choices-${id}">${buttons}${other}</div>`;
        break;
      }
      case 'text':
      default:
        field = `<input type="text" id="q-${id}" class="input" placeholder="${this.escapeAttr(q.placeholder || '入力してください')}">`;
    }
    const otherInput = q.allow_other && (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select')
      ? `<input type="text" id="other-${id}" class="input other-input hidden" placeholder="その他の内容を入力してください">`
      : '';
    const followUps = (q.options || []).map((o, i) => {
      const fu = o.follow_up;
      if (!fu || !fu.enabled) return '';
      return `<div class="follow-up hidden" id="fu-${id}-${i}"><label class="follow-up-title">${this.escapeHtml(fu.title || `${q.title}（${o.label}）`)}${fu.required ? '<span class="required">必須</span>' : ''}</label>${this.renderFollowUpField(q.id, i, fu)}</div>`;
    }).join('');
    return `
                    <div class="question" id="question-${id}">
                        <label class="field-label">Q${index + 1}. ${this.escapeHtml(q.title)}${requiredMark}</label>
                        ${q.description ? `<p class="question-desc">${this.escapeHtml(q.description)}</p>` : ''}
                        ${field}
                        ${otherInput}
                        ${followUps}
                    </div>`;
  }

  private renderFollowUpField(questionId: string, optionIndex: number, fu: NonNullable<SurveyQuestion['options']>[number]['follow_up'] & object): string {
    const fid = `fu-${this.escapeAttr(questionId)}-${optionIndex}-input`;
    switch (fu.type) {
      case 'textarea':
        return `<textarea id="${fid}" class="input" rows="2" placeholder="入力してください"></textarea>`;
      case 'select':
        return `<select id="${fid}" class="input"><option value="">選択してください</option>${(fu.options || []).map((o) => `<option value="${this.escapeAttr(o.value)}">${this.escapeHtml(o.label)}</option>`).join('')}</select>`;
      case 'radio':
      case 'checkbox':
        return `<div class="choice-group" id="${fid}" data-type="${fu.type}">${(fu.options || []).map((o) => `<button type="button" class="choice-button" data-value="${this.escapeAttr(o.value)}" onclick="selectFollowUpChoice(this, '${fid}', '${fu.type}')">${this.escapeHtml(o.label)}</button>`).join('')}</div>`;
      case 'text':
      default:
        return `<input type="text" id="${fid}" class="input" placeholder="入力してください">`;
    }
  }

  // ---------------------------------------------------------------------------
  // JS パーツ（バッククォート不使用）
  // ---------------------------------------------------------------------------

  private generateHelpersJS(): string {
    return `
        function $(id) { return document.getElementById(id); }
        function escapeHtml(s) {
            return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        }
        function formatDateJst(iso) {
            if (!iso) return '';
            var t = new Date(iso);
            if (isNaN(t.getTime())) return '';
            var jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            return jst.getUTCFullYear() + '/' + p(jst.getUTCMonth() + 1) + '/' + p(jst.getUTCDate());
        }
        function setBusy(busy) {
            state.busy = busy;
            var btn = $('drawButton');
            if (btn) btn.disabled = busy || state.gateBlocked;
        }
        function showFooter(show) {
            var f = $('formFooter');
            if (f) f.classList.toggle('hidden', !show);
        }
        function scrollToStage() {
            var st = $('stage');
            if (st && st.scrollIntoView) st.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'center' });
        }
        function findPrize(prizeId) {
            if (!prizeId) return null;
            for (var i = 0; i < FORM_CONFIG.prizes.length; i++) if (FORM_CONFIG.prizes[i].id === prizeId) return FORM_CONFIG.prizes[i];
            if (FORM_CONFIG.consolation_prize && FORM_CONFIG.consolation_prize.id === prizeId) return FORM_CONFIG.consolation_prize;
            return null;
        }
        function rankColor(prize) {
            if (prize && /^#[0-9a-fA-F]{6}$/.test(prize.rank_color || '')) return prize.rank_color;
            var idx = -1;
            for (var i = 0; i < FORM_CONFIG.prizes.length; i++) if (prize && FORM_CONFIG.prizes[i].id === prize.id) idx = i;
            return ['#d4af37', '#a8a9ad', '#cd7f32'][idx] || '#6b7280';
        }
        function loadLocal(key) {
            try { var s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
        }
        function saveLocal(key, value) {
            try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
        }
        function showGate(title, body) {
            if ($('line-only-gate')) return;
            state.gateBlocked = true;
            var gate = document.createElement('div');
            gate.id = 'line-only-gate';
            gate.setAttribute('role', 'dialog');
            gate.setAttribute('aria-modal', 'true');
            gate.innerHTML = '<div class="line-only-gate-card"><div class="line-only-gate-icon" aria-hidden="true">LINE</div><h2>' + escapeHtml(title) + '</h2><p>' + body + '</p></div>';
            document.body.appendChild(gate);
            document.body.classList.add('line-only-blocked');
            setBusy(false);
        }`;
  }

  private generateQuestionsJS(): string {
    return `
        function initQuestions() {
            var qs = FORM_CONFIG.entry_rules.pre_questions || [];
            for (var i = 0; i < qs.length; i++) {
                if (qs[i].type === 'select') onQuestionChange(qs[i].id);
            }
        }
        function getQuestion(qid) {
            var qs = FORM_CONFIG.entry_rules.pre_questions || [];
            for (var i = 0; i < qs.length; i++) if (qs[i].id === qid) return qs[i];
            return null;
        }
        function selectChoice(el, qid, type) {
            var group = el.parentElement;
            if (type === 'radio') {
                var all = group.querySelectorAll('.choice-button');
                for (var i = 0; i < all.length; i++) all[i].classList.remove('selected');
                el.classList.add('selected');
            } else {
                el.classList.toggle('selected');
            }
            onQuestionChange(qid);
        }
        function selectFollowUpChoice(el, groupId, type) {
            var group = $(groupId);
            if (type === 'radio') {
                var all = group.querySelectorAll('.choice-button');
                for (var i = 0; i < all.length; i++) all[i].classList.remove('selected');
                el.classList.add('selected');
            } else {
                el.classList.toggle('selected');
            }
        }
        function selectedIndexes(q) {
            var out = [];
            if (q.type === 'select') {
                var sel = $('q-' + q.id);
                if (!sel) return out;
                for (var i = 0; i < (q.options || []).length; i++) if (q.options[i].value === sel.value) out.push(i);
                return out;
            }
            var group = $('choices-' + q.id);
            if (!group) return out;
            var btns = group.querySelectorAll('.choice-button.selected');
            for (var j = 0; j < btns.length; j++) {
                if (btns[j].dataset.other) continue;
                out.push(parseInt(btns[j].dataset.index, 10));
            }
            return out;
        }
        function isOtherSelected(q) {
            if (q.type === 'select') { var sel = $('q-' + q.id); return !!sel && sel.value === OTHER_OPTION_VALUE; }
            var group = $('choices-' + q.id);
            return !!group && !!group.querySelector('.choice-button.selected[data-other]');
        }
        function onQuestionChange(qid) {
            var q = getQuestion(qid);
            if (!q) return;
            var other = $('other-' + qid);
            if (other) other.classList.toggle('hidden', !isOtherSelected(q));
            var idx = selectedIndexes(q);
            for (var i = 0; i < (q.options || []).length; i++) {
                var fu = $('fu-' + qid + '-' + i);
                if (fu) fu.classList.toggle('hidden', idx.indexOf(i) === -1);
            }
        }
        function followUpValue(fid, type) {
            if (type === 'radio' || type === 'checkbox') {
                var group = $(fid);
                if (!group) return '';
                var btns = group.querySelectorAll('.choice-button.selected');
                var vals = [];
                for (var i = 0; i < btns.length; i++) vals.push(btns[i].dataset.value);
                return vals.join(', ');
            }
            var el = $(fid);
            return el ? String(el.value || '').trim() : '';
        }
        // 回答を { 質問タイトル: 値 } で集める。必須未入力があればエラー文言を返す
        function collectAnswers() {
            var qs = FORM_CONFIG.entry_rules.pre_questions || [];
            var answers = {};
            for (var i = 0; i < qs.length; i++) {
                var q = qs[i];
                var value = '';
                if (q.type === 'radio' || q.type === 'checkbox' || q.type === 'select') {
                    var vals = [];
                    var idx = selectedIndexes(q);
                    for (var k = 0; k < idx.length; k++) vals.push(q.options[idx[k]].value);
                    if (isOtherSelected(q)) {
                        var otherEl = $('other-' + q.id);
                        var otherText = otherEl ? String(otherEl.value || '').trim() : '';
                        if (!otherText) return { error: '「' + q.title + '」のその他の内容を入力してください' };
                        vals.push('その他（' + otherText + '）');
                    }
                    value = vals.join(', ');
                } else {
                    var el = $('q-' + q.id);
                    value = el ? String(el.value || '').trim() : '';
                }
                if (q.required && !value) return { error: '「' + q.title + '」を入力してください' };
                answers[q.title] = value;
                if (q.options) {
                    var sidx = selectedIndexes(q);
                    for (var m = 0; m < sidx.length; m++) {
                        var opt = q.options[sidx[m]];
                        var fu = opt && opt.follow_up;
                        if (!fu || fu.enabled !== true) continue;
                        var fid = 'fu-' + q.id + '-' + sidx[m] + '-input';
                        var fuVal = followUpValue(fid, fu.type);
                        var fuTitle = (fu.title || '').trim() || (q.title + '（' + opt.label + '）');
                        if (fu.required && !fuVal) return { error: '「' + fuTitle + '」を入力してください' };
                        if (!fuVal) continue;
                        var key = fuTitle;
                        if (Object.prototype.hasOwnProperty.call(answers, key)) key = key + '（' + opt.label + '）';
                        answers[key] = fuVal;
                    }
                }
            }
            return { answers: answers };
        }`;
  }

  private generateLiffJS(): string {
    return `
        function isOutsideLineClient() {
            try {
                if (typeof liff === 'undefined' || typeof liff.isInClient !== 'function') return false;
                return liff.isInClient() !== true;
            } catch (e) { return false; }
        }
        async function initLiff() {
            var liffId = FORM_CONFIG.liff_id;
            if (!liffId || liffId.length < 10) {
                showGate('準備中です', 'この抽選フォームはまだ公開設定が完了していません。店舗にお問い合わせください。');
                return;
            }
            if (isOutsideLineClient()) {
                showGate('公式LINEから開いてください', 'この抽選は公式LINEから開かれた場合のみご参加いただけます。<br>お手数ですが、公式LINEのトークから開き直してください。');
                return;
            }
            try {
                await liff.init({ liffId: liffId });
            } catch (err) {
                console.error('LIFF init failed', err);
                showGate('読み込みに失敗しました', 'LINE の初期化に失敗しました。トークから開き直してください。');
                return;
            }
            if (isOutsideLineClient()) {
                showGate('公式LINEから開いてください', 'この抽選は公式LINEから開かれた場合のみご参加いただけます。<br>お手数ですが、公式LINEのトークから開き直してください。');
                return;
            }
            if (!liff.isLoggedIn()) {
                liff.login({ redirectUri: window.location.href });
                return;
            }
            try { state.idToken = liff.getIDToken(); } catch (e) { console.warn('getIDToken failed', e); }
            try {
                var profile = await liff.getProfile();
                if (profile && profile.displayName) state.displayName = profile.displayName;
            } catch (e) { console.warn('getProfile failed', e); }
            try {
                var decoded = liff.getDecodedIDToken();
                if (decoded && decoded.sub) state.lineUserId = decoded.sub;
                if (!state.displayName && decoded && decoded.name) state.displayName = decoded.name;
            } catch (e) {}
            try {
                var friendship = await liff.getFriendship();
                if (friendship && typeof friendship.friendFlag === 'boolean') state.friendFlag = friendship.friendFlag;
            } catch (e) { console.warn('getFriendship failed', e); }

            if (FORM_CONFIG.entry_rules.require_friend && state.friendFlag === false) {
                showGate('友だち追加が必要です', 'この抽選に参加するには公式LINEの友だち追加が必要です。<br>友だち追加をしてから、もう一度トークから開いてください。');
                return;
            }
            if (!state.idToken) {
                // ID トークンが取れない（古いセッション）→ 再ログイン
                try { liff.logout(); } catch (e) {}
                liff.login({ redirectUri: window.location.href });
                return;
            }
            await trySendPendingMessage();
            await loadExistingResult();
        }
        function authBody(extra) {
            var body = extra || {};
            body.id_token = state.idToken;
            if (state.lineUserId) body.line_user_id = state.lineUserId;
            if (state.displayName) body.line_display_name = state.displayName;
            body.line_friend_flag = state.friendFlag;
            return body;
        }
        async function loadExistingResult() {
            try {
                var url = window.location.origin + '/api/lotteries/' + encodeURIComponent(FORM_CONFIG.form_id) + '/my-result?id_token=' + encodeURIComponent(state.idToken || '')
                    + (state.lineUserId ? '&line_user_id=' + encodeURIComponent(state.lineUserId) : '');
                var res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) return;
                var json = await res.json();
                if (json && json.result) {
                    var canRetry = FORM_CONFIG.lottery_type === 'instant' && FORM_CONFIG.entry_rules.limit !== 'once';
                    showResult(json.result, { existing: true, canRetry: canRetry });
                }
            } catch (e) { console.warn('my-result failed', e); }
        }`;
  }

  private generateDrawJS(): string {
    return `
        async function startDraw() {
            if (state.busy || state.gateBlocked) return;
            var collected = collectAnswers();
            if (collected.error) { alert(collected.error); return; }
            setBusy(true);
            if (IS_PREVIEW) {
                var fake = previewDraw(collected.answers);
                beginReveal(fake);
                return;
            }
            try {
                var res = await fetch(window.location.origin + '/api/lotteries/draw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authBody({
                        lottery_form_id: FORM_CONFIG.form_id,
                        store_id: FORM_CONFIG.store_id,
                        answers: collected.answers
                    }))
                });
                var json = null;
                try { json = await res.json(); } catch (e) {}
                if (res.status === 409 && json && json.existing_result) {
                    alert(json.error || 'すでに参加済みです');
                    showResult(json.existing_result, { existing: true, canRetry: false });
                    return;
                }
                if (res.status === 401 && !IS_PREVIEW) {
                    // ID トークン失効 → 再ログインして開き直す
                    try { liff.logout(); } catch (e) {}
                    liff.login({ redirectUri: window.location.href });
                    return;
                }
                if (!res.ok || !json || !json.entry) {
                    alert((json && json.error) || '抽選の実行に失敗しました。時間をおいて再度お試しください');
                    setBusy(false);
                    return;
                }
                beginReveal(json);
            } catch (err) {
                console.error('draw failed', err);
                alert('通信に失敗しました。電波の良い場所で再度お試しください');
                setBusy(false);
            }
        }
        // プレビュー用の仮抽選（確率に従うが在庫・回数は見ない。サーバーには何も送らない）
        function previewDraw(answers) {
            var now = new Date();
            if (FORM_CONFIG.lottery_type === 'deferred') {
                return { entry: { id: 'preview', status: 'entered', is_win: false, is_consolation: false, prize_id: null, prize_name: null, redeem_code: null, qr_token: null, expires_at: null, entered_at: now.toISOString() }, prize: null, message_text: renderTemplate(FORM_CONFIG.messages.entry_text, null, null), second_message: null, is_existing: false };
            }
            var r = Math.random() * 100, cum = 0, prize = null;
            for (var i = 0; i < FORM_CONFIG.prizes.length; i++) {
                var p = FORM_CONFIG.prizes[i];
                if (!(p.probability > 0)) continue;
                cum += p.probability;
                if (r < cum) { prize = p; break; }
            }
            var consolation = false;
            if (!prize && FORM_CONFIG.consolation_prize) { prize = FORM_CONFIG.consolation_prize; consolation = true; }
            var code = null, qr = null, expires = null;
            if (prize) {
                var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                code = '';
                for (var k = 0; k < 6; k++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
                if (FORM_CONFIG.redeem_method === 'qr') qr = 'preview';
                if (prize.expires_at) expires = prize.expires_at + 'T14:59:59.999Z';
                else if (typeof prize.expires_in_days === 'number') expires = new Date(now.getTime() + (prize.expires_in_days + 1) * 86400000).toISOString();
            }
            var entry = { id: 'preview', status: prize ? 'drawn' : 'lost', is_win: !!prize && !consolation, is_consolation: consolation, prize_id: prize ? prize.id : null, prize_name: prize ? prize.name : null, redeem_code: code, qr_token: qr, expires_at: expires, entered_at: now.toISOString() };
            return { entry: entry, prize: prize, message_text: renderTemplate(prize ? FORM_CONFIG.messages.win_text : FORM_CONFIG.messages.lose_text, entry, prize), second_message: null, is_existing: false };
        }
        function renderTemplate(template, entry, prize) {
            var values = {
                '{抽選名}': FORM_CONFIG.title,
                '{賞品名}': prize ? (prize.description ? prize.name + '「' + prize.description + '」' : prize.name) : '',
                '{引換コード}': entry && entry.redeem_code ? entry.redeem_code : '',
                '{有効期限}': entry ? formatDateJst(entry.expires_at) : '',
                '{店舗名}': FORM_CONFIG.store_name,
                '{LINE名}': state.displayName || '',
                '{抽選日}': FORM_CONFIG.deferred ? formatDateJst(FORM_CONFIG.deferred.draw_scheduled_at) : ''
            };
            var keys = Object.keys(values);
            var out = [];
            var lines = String(template || '').split('\\n');
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                var used = keys.filter(function (k) { return line.indexOf(k) !== -1; });
                if (used.length > 0 && used.every(function (k) { return !values[k]; })) continue;
                for (var j = 0; j < used.length; j++) line = line.split(used[j]).join(values[used[j]]);
                out.push(line);
            }
            return out.join('\\n').trim();
        }`;
  }

  private generateAnimationJS(): string {
    return `
        // 結果を受け取ってから演出を開始する。演出が終わったら showResult()
        function beginReveal(result) {
            state.result = result;
            state.revealed = false;
            showFooter(false);
            scrollToStage();
            var anim = FORM_CONFIG.presentation.animation;
            var isEntry = result.entry.status === 'entered';
            if (REDUCED_MOTION || isEntry) { revealNow(); return; }
            if (anim === 'gacha') startGacha();
            else if (anim === 'simple') startDrum();
            else startScratch();
        }
        function revealNow() {
            if (state.revealed) return;
            state.revealed = true;
            var hint = $('stageHint');
            if (hint) hint.textContent = '';
            showResult(state.result, { existing: false, canRetry: false });
        }
        function resultLabel(result) {
            if (!result || !result.entry) return '？';
            if (result.entry.status === 'entered') return '応募完了';
            if (result.prize) return result.prize.name;
            return 'はずれ';
        }

        // ---- スクラッチ ----
        function startScratch() {
            var under = $('scratchUnder');
            var canvas = $('scratchCanvas');
            var cover = $('scratchCover');
            var hint = $('stageHint');
            if (!under || !canvas || !cover) { revealNow(); return; }
            var color = state.result.prize ? rankColor(state.result.prize) : '#6b7280';
            under.innerHTML = '<span class="scratch-under-text" style="color:' + color + '">' + escapeHtml(resultLabel(state.result)) + '</span>';
            if (hint) hint.textContent = '指でこすって結果を見てね';
            var rect = cover.getBoundingClientRect();
            var dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            var ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            var style = FORM_CONFIG.presentation.scratch_style;
            var g = ctx.createLinearGradient(0, 0, rect.width, rect.height);
            if (style === 'gold') { g.addColorStop(0, '#f6e27a'); g.addColorStop(0.5, '#d4af37'); g.addColorStop(1, '#b8860b'); }
            else { g.addColorStop(0, '#e6e6e6'); g.addColorStop(0.5, '#b8b8b8'); g.addColorStop(1, '#d9d9d9'); }
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, rect.width, rect.height);
            if (style === 'image' && FORM_CONFIG.presentation.scratch_image_url) {
                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () { try { ctx.drawImage(img, 0, 0, rect.width, rect.height); } catch (e) {} };
                img.src = FORM_CONFIG.presentation.scratch_image_url;
            }
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.font = 'bold 22px Poppins, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('SCRATCH', rect.width / 2, rect.height / 2 + 8);
            cover.classList.add('hidden');
            canvas.classList.remove('hidden');
            ctx.globalCompositeOperation = 'destination-out';
            var scratching = false, moves = 0;
            function pos(ev) {
                var r = canvas.getBoundingClientRect();
                var t = ev.touches ? ev.touches[0] : ev;
                return { x: t.clientX - r.left, y: t.clientY - r.top };
            }
            function scratchAt(p) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
                ctx.fill();
                moves++;
                if (moves % 6 === 0 && clearedRatio() >= 0.55) finishScratch();
            }
            function clearedRatio() {
                try {
                    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    var cleared = 0, total = data.length / 4;
                    for (var i = 3; i < data.length; i += 4 * 4) if (data[i] === 0) cleared++;
                    return cleared / (total / 4);
                } catch (e) { return 1; }
            }
            function finishScratch() {
                canvas.style.transition = 'opacity .4s';
                canvas.style.opacity = '0';
                setTimeout(revealNow, 350);
            }
            function down(ev) { scratching = true; scratchAt(pos(ev)); ev.preventDefault(); }
            function move(ev) { if (!scratching) return; scratchAt(pos(ev)); ev.preventDefault(); }
            function up() { scratching = false; }
            canvas.addEventListener('touchstart', down, { passive: false });
            canvas.addEventListener('touchmove', move, { passive: false });
            canvas.addEventListener('touchend', up);
            canvas.addEventListener('mousedown', down);
            canvas.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
            // 削らずに 20 秒経ったら自動で開ける（操作に迷った人向け）
            setTimeout(function () { if (!state.revealed) finishScratch(); }, 20000);
        }

        // ---- ガチャ ----
        function startGacha() {
            var gacha = $('gacha'), lever = $('gachaLever'), capsule = $('gachaCapsule'), hint = $('stageHint');
            if (!gacha || !capsule) { revealNow(); return; }
            if (hint) hint.textContent = 'レバーをタップ！';
            var pulled = false;
            function pull() {
                if (pulled) return;
                pulled = true;
                gacha.classList.add('shaking');
                if (hint) hint.textContent = '';
                setTimeout(function () {
                    gacha.classList.remove('shaking');
                    capsule.style.setProperty('--cap', state.result.prize ? rankColor(state.result.prize) : '#9ca3af');
                    capsule.classList.remove('hidden');
                    capsule.classList.add('drop');
                    if (hint) hint.textContent = 'カプセルをタップして開けよう';
                    capsule.addEventListener('click', function open() {
                        capsule.removeEventListener('click', open);
                        capsule.classList.add('open');
                        setTimeout(revealNow, 500);
                    });
                    setTimeout(function () { if (!state.revealed) { capsule.classList.add('open'); setTimeout(revealNow, 500); } }, 8000);
                }, 1200);
            }
            if (lever) lever.addEventListener('click', pull);
            gacha.addEventListener('click', pull);
            setTimeout(function () { if (!pulled) pull(); }, 6000);
        }

        // ---- シンプル（ドラムロール） ----
        function startDrum() {
            var text = $('drumText'), drum = $('drum'), hint = $('stageHint');
            if (!text) { revealNow(); return; }
            var names = FORM_CONFIG.prizes.map(function (p) { return p.name; });
            names.push('はずれ');
            if (hint) hint.textContent = '';
            if (drum) drum.classList.add('rolling');
            var i = 0, delay = 60, elapsed = 0, total = 1800;
            function tick() {
                text.textContent = names[i++ % names.length];
                elapsed += delay;
                if (elapsed >= total) {
                    text.textContent = resultLabel(state.result);
                    text.style.color = state.result.prize ? rankColor(state.result.prize) : '#ffffff';
                    if (drum) drum.classList.remove('rolling');
                    setTimeout(revealNow, 500);
                    return;
                }
                delay = Math.min(260, delay * 1.08);
                setTimeout(tick, delay);
            }
            tick();
        }

        function launchConfetti() {
            if (!FORM_CONFIG.presentation.confetti || REDUCED_MOTION) return;
            var layer = $('confettiLayer');
            if (!layer) return;
            var colors = ['#f94144', '#f3722c', '#f9c74f', '#90be6d', '#43aa8b', '#577590', '#d4af37'];
            for (var i = 0; i < 90; i++) {
                var el = document.createElement('i');
                el.style.left = Math.random() * 100 + '%';
                el.style.background = colors[i % colors.length];
                el.style.animationDelay = (Math.random() * 0.8) + 's';
                el.style.animationDuration = (2 + Math.random() * 1.5) + 's';
                el.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
                layer.appendChild(el);
            }
            setTimeout(function () { layer.innerHTML = ''; }, 4000);
        }`;
  }

  private generateResultJS(): string {
    return `
        function showResult(result, opts) {
            state.result = result;
            opts = opts || {};
            var entry = result.entry;
            var prize = result.prize || findPrize(entry.prize_id);
            var panel = $('resultPanel');
            if (!panel) return;
            var pres = FORM_CONFIG.presentation;
            // 仮当選（provisional）は確定するまでお客様には「応募済み」として見せる
            var isEntry = entry.status === 'entered' || entry.status === 'provisional';
            var isWin = !isEntry && !!prize;
            var html = '';
            if (isEntry) {
                var complete = FORM_CONFIG.deferred && FORM_CONFIG.deferred.entry_complete_text ? FORM_CONFIG.deferred.entry_complete_text : '応募を受け付けました';
                var drawDate = FORM_CONFIG.deferred ? formatDateJst(FORM_CONFIG.deferred.draw_scheduled_at) : '';
                html += '<h2 class="result-title">応募を受け付けました</h2>';
                html += '<div class="result-card" style="--rank:' + (rankColor(null)) + '">';
                html += '<div class="result-body"><p class="result-text">' + escapeHtml(complete).replace(/\\n/g, '<br>') + '</p>';
                if (drawDate) html += '<div class="result-row"><span>抽選日</span><strong>' + escapeHtml(drawDate) + '</strong></div>';
                html += '<div class="result-row"><span>応募日時</span><strong>' + escapeHtml(formatDateJst(entry.entered_at)) + '</strong></div></div></div>';
            } else if (isWin) {
                var color = rankColor(prize);
                html += '<h2 class="result-title win">' + escapeHtml(entry.is_consolation ? '残念賞をプレゼント！' : pres.win_title) + '</h2>';
                html += '<div class="result-card" style="--rank:' + color + '">';
                if (prize.image_url) html += '<img class="result-image" src="' + escapeHtml(prize.image_url) + '" alt="">';
                html += '<div class="result-body">';
                html += '<div class="result-prize" style="color:' + color + '">' + escapeHtml(prize.name) + (entry.is_consolation ? ' <small>残念賞</small>' : '') + '</div>';
                if (prize.description) html += '<div class="result-desc">' + escapeHtml(prize.description) + '</div>';
                html += '<hr class="result-sep">';
                if (FORM_CONFIG.redeem_method === 'qr' && entry.qr_token) {
                    if (entry.qr_token === 'preview') html += '<div class="result-qr preview-qr">QR</div>';
                    else html += '<img class="result-qr" src="' + window.location.origin + '/api/lotteries/qr/' + encodeURIComponent(entry.qr_token) + '.png" alt="引換用 QR コード">';
                    html += '<div class="result-label">スキャンできない場合はこちら</div>';
                }
                if (entry.redeem_code) {
                    html += '<div class="result-label">引換コード</div>';
                    html += '<button type="button" class="result-code" onclick="copyCode(this)" data-code="' + escapeHtml(entry.redeem_code) + '">' + escapeHtml(entry.redeem_code) + '</button>';
                }
                var exp = formatDateJst(entry.expires_at);
                if (exp) html += '<div class="result-row"><span>有効期限</span><strong>' + escapeHtml(exp) + '</strong></div>';
                html += '<p class="result-note">' + escapeHtml(prize.redeem_note || '店頭でこの画面をご提示ください') + '</p>';
                html += '</div></div>';
            } else {
                html += '<div class="result-lose-icon" aria-hidden="true">🍀</div>';
                html += '<h2 class="result-title lose">' + escapeHtml(pres.lose_title) + '</h2>';
                html += '<p class="result-text">' + escapeHtml(pres.lose_message || '次回のご来店をお待ちしております').replace(/\\n/g, '<br>') + '</p>';
            }
            if (opts.existing) {
                html += '<p class="result-existing">' + (isEntry ? '応募済みです' : 'こちらは前回の結果です') + '（' + escapeHtml(formatDateJst(entry.entered_at)) + '）</p>';
            }
            html += '<div class="result-actions">';
            if (opts.existing && opts.canRetry) {
                html += '<button type="button" class="submit-button" onclick="retryDraw()">もう一度抽選する</button>';
            } else if (!opts.existing || !result.__sent) {
                html += '<button type="button" class="submit-button" id="sendButton" onclick="sendResult()">' + (IS_PREVIEW ? 'LINE に結果を送る（プレビュー）' : 'LINE に結果を送る') + '</button>';
            }
            html += '</div>';
            panel.innerHTML = html;
            panel.classList.remove('hidden');
            var stageInner = $('stageInner');
            if (stageInner && !opts.existing) stageInner.classList.add('done');
            var qsec = $('questionsSection');
            if (qsec) qsec.classList.add('hidden');
            showFooter(false);
            setBusy(false);
            if (isWin && !entry.is_consolation && !opts.existing) launchConfetti();
            if (!opts.existing || opts.canRetry === false) {
                setTimeout(function () { if (panel.scrollIntoView) panel.scrollIntoView({ behavior: REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' }); }, 100);
            }
        }
        function retryDraw() {
            var panel = $('resultPanel');
            if (panel) { panel.classList.add('hidden'); panel.innerHTML = ''; }
            var qsec = $('questionsSection');
            if (qsec) qsec.classList.remove('hidden');
            var stageInner = $('stageInner');
            if (stageInner) stageInner.classList.remove('done');
            showFooter(true);
            window.scrollTo({ top: 0, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
        }
        function copyCode(btn) {
            var code = btn.dataset.code;
            if (!code || !navigator.clipboard) return;
            navigator.clipboard.writeText(code).then(function () {
                var original = btn.textContent;
                btn.textContent = 'コピーしました';
                setTimeout(function () { btn.textContent = original; }, 1200);
            }).catch(function () {});
        }
        async function sendResult() {
            var result = state.result;
            if (!result) return;
            var messages = [{ type: 'text', text: result.message_text }];
            if (result.second_message && result.second_message.text) messages.push({ type: 'text', text: result.second_message.text });
            if (IS_PREVIEW) {
                alert('（プレビュー）LINE に送る内容:\\n\\n' + messages.map(function (m) { return m.text; }).join('\\n\\n---\\n\\n'));
                return;
            }
            var btn = $('sendButton');
            if (btn) btn.disabled = true;
            if (isOutsideLineClient()) {
                alert('LINE アプリ内から開いてください。');
                if (btn) btn.disabled = false;
                return;
            }
            try {
                await liff.sendMessages(messages);
                await markMessageSent();
                alert('抽選結果を LINE に送信しました。');
                liff.closeWindow();
            } catch (err) {
                console.error('sendMessages failed', err);
                var errText = String((err && err.message) || err);
                if (/access[_ ]?token|login first|expired|unauthorized|401|403/i.test(errText)) {
                    saveLocal(STORAGE_KEY + '_pendingMessage', { messages: messages, savedAt: Date.now() });
                    try { liff.logout(); } catch (e) {}
                    liff.login({ redirectUri: window.location.href });
                    return;
                }
                alert('抽選結果は保存されています。\\n（LINE トークへの送信に失敗しました。この画面をスクリーンショットで保存してください）');
                if (btn) btn.disabled = false;
            }
        }
        async function markMessageSent() {
            try {
                await fetch(window.location.origin + '/api/lotteries/' + encodeURIComponent(FORM_CONFIG.form_id) + '/my-result', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(authBody({ message_sent: true }))
                });
            } catch (e) {}
        }
        async function trySendPendingMessage() {
            var pending = loadLocal(STORAGE_KEY + '_pendingMessage');
            if (!pending || !Array.isArray(pending.messages) || pending.messages.length === 0) return;
            saveLocal(STORAGE_KEY + '_pendingMessage', null);
            if (typeof pending.savedAt !== 'number' || Date.now() - pending.savedAt > 15 * 60 * 1000) return;
            if (isOutsideLineClient()) return;
            try {
                await liff.sendMessages(pending.messages);
                await markMessageSent();
                alert('抽選結果を LINE に送信しました。');
                liff.closeWindow();
            } catch (err) {
                console.error('pending resend failed', err);
            }
        }`;
  }

  // ---------------------------------------------------------------------------
  // CSS
  // ---------------------------------------------------------------------------

  private generateCSS(primary: string, accent: string): string {
    return `
        :root {
            --primary-color: ${primary};
            --accent-color: ${accent};
            --bg-color: #f4f6f9;
            --text-color: #333333;
            --white: #ffffff;
            --required-bg: #ff4c4c;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { -webkit-text-size-adjust: 100%; }
        body {
            font-family: 'Noto Sans JP', 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            line-height: 1.6;
            min-height: 100dvh;
            padding-bottom: env(safe-area-inset-bottom);
        }
        button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; font-family: inherit; cursor: pointer; }
        .hidden { display: none !important; }
        .preview-banner {
            background: #fff4d6; color: #7a4d00; font-size: 12px; text-align: center; padding: 8px 12px;
            border-bottom: 1px solid #f1d38a; position: sticky; top: 0; z-index: 20;
        }
        .form-container { max-width: 500px; margin: 0 auto; padding: 10px 0 120px; }
        .form-header {
            background-color: var(--primary-color); color: var(--white); text-align: center;
            padding: 22px 16px 18px; border-radius: 4px 4px 0 0; border-top: 4px solid var(--accent-color);
        }
        .form-logo { max-height: 56px; max-width: 70%; margin-bottom: 8px; object-fit: contain; }
        .form-header h1 { font-size: 22px; font-weight: 700; letter-spacing: 1px; line-height: 1.4; }
        .period-badge {
            display: inline-block; margin-top: 10px; padding: 3px 14px; border-radius: 999px;
            background: rgba(255,255,255,0.92); color: var(--primary-color); font-size: 13px; font-weight: 700;
        }
        .form-content { background: var(--white); border-radius: 0 0 4px 4px; box-shadow: 0 2px 20px rgba(0,0,0,0.08); padding: 20px 18px 24px; }
        .section { margin-top: 26px; }
        .field-label {
            display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 14px; margin-bottom: 12px;
            font-weight: 700; font-size: 16px; color: var(--primary-color);
            border-bottom: 2px solid var(--primary-color); border-left: 6px solid var(--accent-color); line-height: 1.4;
        }
        .required { margin-left: auto; background: var(--required-bg); color: var(--white); font-size: 11px; padding: 2px 6px; border-radius: 2px; font-weight: normal; }

        /* 演出ステージ */
        .stage {
            position: relative; overflow: hidden; border-radius: 10px; min-height: 240px;
            background: linear-gradient(145deg, var(--primary-color) 0%, color-mix(in srgb, var(--primary-color) 55%, #000) 100%);
            display: flex; align-items: center; justify-content: center; padding: 22px 16px;
        }
        @supports not (color: color-mix(in srgb, red 50%, blue)) {
            .stage { background: var(--primary-color); }
        }
        .stage-deco span {
            position: absolute; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-color); opacity: .35;
            animation: float 6s ease-in-out infinite;
        }
        .stage-deco span:nth-child(1) { left: 8%; top: 18%; }
        .stage-deco span:nth-child(2) { left: 84%; top: 12%; width: 9px; height: 9px; animation-delay: -1s; }
        .stage-deco span:nth-child(3) { left: 14%; top: 78%; width: 8px; height: 8px; animation-delay: -2s; }
        .stage-deco span:nth-child(4) { left: 90%; top: 70%; animation-delay: -3s; }
        .stage-deco span:nth-child(5) { left: 50%; top: 6%; width: 7px; height: 7px; animation-delay: -4s; }
        .stage-deco span:nth-child(6) { left: 66%; top: 88%; width: 10px; height: 10px; animation-delay: -5s; }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        .stage-inner { position: relative; z-index: 1; width: 100%; text-align: center; }
        .stage-inner.done { opacity: .85; }
        .stage-hint { color: rgba(255,255,255,0.92); font-size: 14px; font-weight: 500; margin-top: 12px; min-height: 1.6em; }

        /* スクラッチ */
        .scratch { position: relative; width: 100%; max-width: 320px; height: 150px; margin: 0 auto; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }
        .scratch-under { position: absolute; inset: 0; background: var(--white); display: flex; align-items: center; justify-content: center; }
        .scratch-under-text { font-family: 'Poppins', 'Noto Sans JP', sans-serif; font-size: 30px; font-weight: 800; letter-spacing: 1px; color: var(--primary-color); padding: 0 12px; text-align: center; line-height: 1.2; }
        .scratch-canvas { position: absolute; inset: 0; touch-action: none; cursor: crosshair; }
        .scratch-cover { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #e6e6e6, #b8b8b8 50%, #d9d9d9); background-size: cover; background-position: center; }
        .scratch.gold .scratch-cover { background: linear-gradient(135deg, #f6e27a, #d4af37 50%, #b8860b); }
        .scratch-cover span { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 22px; letter-spacing: 3px; color: rgba(0,0,0,0.35); }

        /* ガチャ */
        .gacha { position: relative; width: 160px; margin: 0 auto; }
        .gacha.shaking { animation: shake .25s linear infinite; }
        @keyframes shake { 0% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } 100% { transform: rotate(-2deg); } }
        .gacha-dome { position: relative; width: 150px; height: 120px; margin: 0 auto; border-radius: 75px 75px 10px 10px; background: rgba(255,255,255,0.22); border: 3px solid rgba(255,255,255,0.7); overflow: hidden; }
        .gacha-ball { position: absolute; width: 34px; height: 34px; border-radius: 50%; bottom: 8px; }
        .gacha-ball.b1 { left: 10px; background: #f94144; } .gacha-ball.b2 { left: 45px; bottom: 30px; background: #f9c74f; }
        .gacha-ball.b3 { left: 80px; background: #43aa8b; } .gacha-ball.b4 { left: 105px; bottom: 34px; background: #577590; }
        .gacha-ball.b5 { left: 60px; bottom: 60px; background: #f3722c; }
        .gacha-body { position: relative; width: 160px; height: 86px; margin: -4px auto 0; background: var(--accent-color); border-radius: 10px 10px 14px 14px; box-shadow: 0 8px 20px rgba(0,0,0,0.3); }
        .gacha-lever { position: absolute; left: 50%; top: 16px; width: 44px; height: 44px; margin-left: -22px; border-radius: 50%; background: var(--white); border: 6px solid rgba(0,0,0,0.25); box-shadow: 0 3px 0 rgba(0,0,0,0.2); }
        .gacha-lever::after { content: ''; position: absolute; left: 50%; top: 50%; width: 6px; height: 22px; margin: -11px 0 0 -3px; background: rgba(0,0,0,0.35); border-radius: 3px; }
        .gacha-slot { position: absolute; left: 50%; bottom: 8px; width: 60px; height: 18px; margin-left: -30px; background: rgba(0,0,0,0.35); border-radius: 6px; }
        .gacha-capsule { position: absolute; left: 50%; top: 150px; width: 64px; height: 64px; margin-left: -32px; z-index: 2; cursor: pointer; }
        .gacha-capsule.drop { animation: drop .7s cubic-bezier(.3,1.4,.6,1) forwards; }
        @keyframes drop { 0% { transform: translateY(-60px) scale(.6); opacity: 0; } 100% { transform: translateY(40px) scale(1); opacity: 1; } }
        .cap-top, .cap-bottom { position: absolute; left: 0; width: 64px; height: 32px; transition: transform .45s ease; }
        .cap-top { top: 0; border-radius: 32px 32px 0 0; background: var(--cap, #ccc); }
        .cap-bottom { bottom: 0; border-radius: 0 0 32px 32px; background: rgba(255,255,255,0.9); }
        .gacha-capsule.open .cap-top { transform: translateY(-28px) rotate(-20deg); }
        .gacha-capsule.open .cap-bottom { transform: translateY(10px); }

        /* ドラムロール */
        .drum { width: 100%; max-width: 320px; height: 120px; margin: 0 auto; border-radius: 12px; background: rgba(255,255,255,0.12); border: 2px solid rgba(255,255,255,0.5); display: flex; align-items: center; justify-content: center; }
        .drum.rolling { border-color: var(--accent-color); }
        .drum-text { color: var(--white); font-size: 30px; font-weight: 900; letter-spacing: 1px; text-align: center; padding: 0 12px; }

        /* 賞品 */
        .prize-list { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 10px; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
        .prize-card { flex: 0 0 132px; scroll-snap-align: start; background: #fafafa; border: 1px solid #e5e7eb; border-left: 5px solid var(--rank); border-radius: 8px; padding: 10px; }
        .prize-card.consolation { opacity: .85; }
        .prize-image { width: 100%; height: 84px; object-fit: cover; border-radius: 6px; background: #eee; }
        .prize-image.placeholder { display: flex; align-items: center; justify-content: center; font-size: 34px; }
        .prize-name { font-weight: 700; font-size: 15px; margin-top: 8px; color: var(--rank); }
        .prize-name small { display: block; font-size: 11px; color: #888; font-weight: 500; }
        .prize-desc { font-size: 12px; color: #555; margin-top: 2px; line-height: 1.4; }
        .prize-meta { font-size: 12px; color: #777; margin-top: 6px; }
        .prize-note { font-size: 12px; color: #777; text-align: right; }

        /* 注意事項 */
        .notice-box { background: #fff9ea; border: 1px solid #f1d38a; border-radius: 6px; padding: 12px 14px; }
        .notice-title { font-size: 14px; font-weight: 700; color: #7a4d00; margin-bottom: 6px; }
        .notice-list { padding-left: 18px; font-size: 13px; color: #5a4a2a; }
        .notice-text { white-space: pre-wrap; font-size: 13px; color: #5a4a2a; margin-top: 8px; border-top: 1px dashed #e7c87a; padding-top: 8px; }

        /* 事前質問 */
        .question { margin-bottom: 22px; }
        .question-desc { font-size: 13px; color: #666; margin: -6px 0 10px; white-space: pre-wrap; }
        .input { width: 100%; padding: 14px; border: 1px solid #ccc; border-radius: 2px; font-size: 16px; background: #fafafa; font-family: inherit; }
        .input:focus { outline: none; border-color: var(--primary-color); background: var(--white); box-shadow: 0 0 0 1px var(--primary-color); }
        .other-input, .follow-up { margin-top: 10px; }
        .follow-up { padding: 10px; background: #f7f8fa; border-radius: 6px; }
        .follow-up-title { display: flex; gap: 6px; align-items: center; font-size: 14px; font-weight: 700; margin-bottom: 8px; }
        .choice-group { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .choice-button { padding: 12px 8px; border: 1px solid #ccc; border-radius: 2px; background: var(--white); font-weight: 500; font-size: 15px; color: var(--text-color); }
        .choice-button.selected { background: var(--primary-color); border-color: var(--primary-color); color: var(--white); box-shadow: 0 2px 8px rgba(0,0,0,0.3); }

        /* 結果 */
        .result { margin-top: 26px; text-align: center; }
        .result-title { font-size: 22px; font-weight: 900; color: var(--primary-color); margin-bottom: 14px; }
        .result-title.lose { color: #555; }
        .result-lose-icon { font-size: 44px; margin-bottom: 4px; }
        .result-card { text-align: left; background: var(--white); border: 1px solid #e5e7eb; border-left: 8px solid var(--rank); border-radius: 10px; overflow: hidden; box-shadow: 0 6px 24px rgba(0,0,0,0.12); }
        .result-image { width: 100%; max-height: 180px; object-fit: cover; display: block; }
        .result-body { padding: 16px 18px 18px; }
        .result-prize { font-size: 28px; font-weight: 900; line-height: 1.2; }
        .result-prize small { font-size: 12px; color: #888; font-weight: 500; }
        .result-desc { font-size: 16px; margin-top: 4px; }
        .result-sep { border: 0; border-top: 1px dashed #ddd; margin: 14px 0; }
        .result-label { font-size: 12px; color: #888; margin-top: 8px; }
        .result-code { display: block; width: 100%; margin-top: 4px; padding: 12px; border: 2px dashed var(--rank); border-radius: 8px; background: #fafafa; font-family: 'Poppins', monospace; font-size: 30px; font-weight: 800; letter-spacing: 6px; text-align: center; color: var(--text-color); }
        .result-qr { display: block; width: 180px; height: 180px; margin: 4px auto 0; border: 1px solid #eee; border-radius: 8px; background: #fff; }
        .preview-qr { display: flex; align-items: center; justify-content: center; font-weight: 800; color: #999; }
        .result-row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 14px; }
        .result-row span { color: #888; }
        .result-text { font-size: 15px; color: #555; }
        .result-note { margin-top: 12px; font-size: 13px; color: #555; background: #f7f8fa; padding: 10px; border-radius: 6px; }
        .result-existing { font-size: 12px; color: #888; margin-top: 10px; }
        .result-actions { margin-top: 18px; }

        /* フッター（固定ボタン） */
        .form-footer { position: fixed; left: 0; right: 0; bottom: 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: rgba(255,255,255,0.96); backdrop-filter: blur(6px); box-shadow: 0 -4px 20px rgba(0,0,0,0.08); z-index: 10; }
        .form-footer .submit-button { max-width: 500px; margin: 0 auto; }
        .submit-button { display: block; width: 100%; min-height: 56px; padding: 14px; font-size: 18px; font-weight: 700; color: var(--white); background: var(--accent-color); border: 0; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,0.25); border-bottom: 4px solid rgba(0,0,0,0.25); }
        .submit-button:active { transform: translateY(2px); border-bottom-width: 2px; box-shadow: none; }
        .submit-button:disabled { opacity: .55; cursor: not-allowed; }

        /* 紙吹雪 */
        .confetti-layer { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 30; }
        .confetti-layer i { position: absolute; top: -12px; width: 9px; height: 14px; opacity: .95; animation: fall 3s linear forwards; }
        @keyframes fall { to { transform: translateY(105vh) rotate(720deg); opacity: .7; } }

        /* LINE 外ゲート */
        #line-only-gate { position: fixed; inset: 0; z-index: 100; background: rgba(15,23,42,0.72); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .line-only-gate-card { background: var(--white); border-radius: 12px; padding: 28px 22px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
        .line-only-gate-icon { display: inline-block; background: #06c755; color: #fff; font-weight: 800; letter-spacing: 1px; padding: 6px 14px; border-radius: 8px; margin-bottom: 12px; }
        .line-only-gate-card h2 { font-size: 18px; margin-bottom: 10px; color: var(--text-color); }
        .line-only-gate-card p { font-size: 14px; color: #555; line-height: 1.7; }
        body.line-only-blocked { overflow: hidden; }

        @media (prefers-reduced-motion: reduce) {
            .stage-deco span, .gacha.shaking, .gacha-capsule.drop { animation: none !important; }
        }
        @media (max-width: 600px) {
            .form-container { padding: 0 0 120px; }
            .form-header { border-radius: 0; }
            .form-content { border-radius: 0; box-shadow: none; padding: 18px 14px 24px; }
            .form-header h1 { font-size: 20px; }
        }
    `;
  }

  // ---------------------------------------------------------------------------

  /** <script> 内に JSON を埋め込む。"</script>" や "<!--" でスクリプトを閉じられないよう < > & を \\u エスケープする */
  private embedJson(value: unknown): string {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  private escapeHtml(text: string): string {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttr(text: string): string {
    return this.escapeHtml(text);
  }
}
