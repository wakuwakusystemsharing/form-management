import { SurveyConfig, SurveyQuestion } from '@/types/survey';

/**
 * アンケートフォーム用静的HTMLジェネレータ
 */
export class StaticSurveyGenerator {
  /**
   * SurveyConfigから静的HTMLを生成
   */
  generateHTML(config: SurveyConfig, surveyFormId?: string, storeId?: string): string {
    const safeConfig: SurveyConfig = JSON.parse(JSON.stringify(config));
    
    // CSS生成
    const css = this.generateCSS(safeConfig);
    
    // 質問フィールドの生成
    const questionsHtml = safeConfig.questions.map((q, index) => this.renderQuestion(q, index)).join('\n');

    // 注意事項（入力時のみ Q1 の上に表示）
    const noticeText = typeof safeConfig.basic_info.notice === 'string' ? safeConfig.basic_info.notice.trim() : '';
    const noticeHtml = noticeText
      ? `
                <div class="notice-box">
                    <div class="notice-title">
                        <svg class="notice-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        注意事項
                    </div>
                    <div class="notice-text">${this.escapeHtml(noticeText)}</div>
                </div>`
      : '';

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(safeConfig.basic_info.title)}</title>
    <link rel="icon" href="data:,">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Poppins:wght@400;600;800&display=swap" rel="stylesheet">
    <script src="https://kit.fontawesome.com/a076d05399.js" crossorigin="anonymous"></script>
    <style>
        ${css}
        ${this.generateDesignOverridesCSS(safeConfig)}
    </style>
</head>
<body>
    <!-- 右側の追従ナビ -->
    <div class="side-nav" id="sideNav">
        <a href="#section-submit">
            <span>⇩</span>
            <i class="fas fa-comment"></i>
        </a>
    </div>

    <div class="form-container">
        <div class="form-header">
            <h1>${this.escapeHtml(safeConfig.basic_info.title)}</h1>
            <p>以下全て入力後【${this.escapeHtml(safeConfig.ui_settings.submit_button_text || '送信')}】ボタンを押してください。</p>
        </div>
        
        <div class="form-content">
            <form id="surveyForm" onsubmit="return false;">${noticeHtml}
                ${questionsHtml}
                
                <button type="button" class="submit-button" onclick="submitForm()" id="section-submit">${this.escapeHtml(safeConfig.ui_settings.submit_button_text || '送信')}</button>
            </form>
        </div>
    </div>

    <script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>
    <script>
        // LINEユーザーIDを保持する変数
        let lineUserId = null;
        // null = 取得失敗（不明）。サーバ側で既存値を上書きしない。
        let lineFriendFlag = null;

        // 質問定義と復元機能用ストレージキー（このフォーム専用）
        const SURVEY_QUESTIONS = ${JSON.stringify(safeConfig.questions)};
        const SURVEY_STORAGE_KEY = ${JSON.stringify(`survey_${surveyFormId || safeConfig.basic_info.title || 'default'}`)};

        // 復元機能: 回答をこの端末の localStorage にのみ保存する（サーバーには送らない）
        function loadSurveySaved() {
            try {
                const s = localStorage.getItem(SURVEY_STORAGE_KEY);
                return s ? JSON.parse(s) : {};
            } catch (e) { return {}; }
        }

        function saveSurveyAnswer(questionId, payload) {
            const q = SURVEY_QUESTIONS.find(x => x.id === questionId);
            if (!q || q.restore_enabled !== true) return;
            try {
                const data = loadSurveySaved();
                data[questionId] = payload;
                localStorage.setItem(SURVEY_STORAGE_KEY, JSON.stringify(data));
            } catch (e) {
                // プライベートモードなどで localStorage が使えない場合も継続
            }
        }

        // radio/checkbox の現在の選択状態 + その他理由を保存
        function saveChoiceAnswer(questionId) {
            const container = document.getElementById('container-' + questionId);
            if (!container) return;
            const sel = Array.from(container.querySelectorAll('.choice-button.selected'))
                .map(btn => ({ label: btn.innerText, other: !!btn.dataset.other }));
            const reasonInput = document.getElementById('other-input-' + questionId);
            saveSurveyAnswer(questionId, { sel, otherReason: reasonInput ? reasonInput.value : '' });
        }

        // 復元機能ONの質問の回答を復元 + 入力保存リスナーを設定
        document.addEventListener('DOMContentLoaded', function () {
            const saved = loadSurveySaved();
            SURVEY_QUESTIONS.forEach(function (q) {
                if (q.restore_enabled !== true) return;
                const data = saved[q.id];

                if (q.type === 'radio' || q.type === 'checkbox') {
                    // 復元: 保存済みの選択肢を selected に戻す（ラベル一致 / その他は data-other で判定）
                    if (data && Array.isArray(data.sel)) {
                        const container = document.getElementById('container-' + q.id);
                        if (container) {
                            const buttons = Array.from(container.querySelectorAll('.choice-button'));
                            data.sel.forEach(function (s) {
                                buttons.forEach(function (btn) {
                                    const match = s.other ? !!btn.dataset.other : (!btn.dataset.other && btn.innerText === s.label);
                                    if (match) btn.classList.add('selected');
                                });
                            });
                            updateOtherReasonVisibility(q.id);
                        }
                        const reasonInput = document.getElementById('other-input-' + q.id);
                        if (reasonInput && typeof data.otherReason === 'string') reasonInput.value = data.otherReason;
                    }
                    // その他理由の入力を保存
                    const reasonInput = document.getElementById('other-input-' + q.id);
                    if (reasonInput) {
                        reasonInput.addEventListener('input', function () { saveChoiceAnswer(q.id); });
                    }
                } else {
                    const el = document.getElementById(q.id);
                    if (!el) return;
                    // 復元
                    if (data && typeof data.v === 'string' && data.v !== '') {
                        el.value = data.v;
                    }
                    // 入力の保存
                    el.addEventListener(q.type === 'select' ? 'change' : 'input', function () {
                        saveSurveyAnswer(q.id, { v: el.value });
                    });
                }
            });
        });

        // 日付/日時入力: 値の有無でヒント表示を切り替え
        document.addEventListener('DOMContentLoaded', function () {
            document.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach(function (el) {
                const syncDateHint = function () { el.classList.toggle('has-value', !!el.value); };
                el.addEventListener('change', syncDateHint);
                el.addEventListener('input', syncDateHint);
                syncDateHint();
            });
        });

        // LIFF初期化
        document.addEventListener('DOMContentLoaded', async function () {
            const liffId = '${safeConfig.basic_info.liff_id}';
            if (!liffId || liffId.length < 10) return;

            try {
                await liff.init({ liffId });
                if (liff.isLoggedIn()) {
                    // LINEユーザーIDを取得
                    try {
                        const idToken = await liff.getDecodedIDToken();
                        if (idToken && idToken.sub) {
                            lineUserId = idToken.sub;
                        }
                    } catch (idTokenError) {
                        console.warn('LINE User ID取得に失敗しました:', idTokenError);
                    }

                    // 友だち追加状態を取得
                    try {
                        const friendship = await liff.getFriendship();
                        lineFriendFlag = friendship.friendFlag;
                    } catch (friendError) {
                        console.warn('友だち追加状態の取得に失敗しました:', friendError);
                    }

                    console.log('LIFF初期化成功');
                }
            } catch (err) {
                console.error('LIFF初期化失敗', err);
            }
        });

        // 選択ボタンの制御
        function selectOption(element, questionId, type) {
            const container = element.parentElement;
            
            if (type === 'radio') {
                // 単一選択
                const buttons = container.querySelectorAll('.choice-button');
                buttons.forEach(btn => btn.classList.remove('selected'));
                element.classList.add('selected');
                
                // 隠しフィールド更新 (もしあれば)
            } else if (type === 'checkbox') {
                // 複数選択
                element.classList.toggle('selected');
            }

            updateOtherReasonVisibility(questionId);
            saveChoiceAnswer(questionId);
        }

        // 「その他」ボタンの選択状態に応じて理由入力欄を表示/非表示
        function updateOtherReasonVisibility(questionId) {
            const block = document.getElementById('other-block-' + questionId);
            if (!block) return;
            const otherSelected = document.querySelector('#container-' + questionId + ' .choice-button.selected[data-other]');
            block.style.display = otherSelected ? 'block' : 'none';
        }

        // 選択ボタンの送信値を取得（「その他」は理由を付加）
        function getChoiceValue(btn, questionId) {
            if (btn.dataset.other) {
                const reasonInput = document.getElementById('other-input-' + questionId);
                const reason = reasonInput ? reasonInput.value.trim() : '';
                return reason ? 'その他（' + reason + '）' : 'その他';
            }
            return btn.innerText;
        }

        function formatDateTimeForDisplay(value) {
            if (!value || typeof value !== 'string') return value;
            const dt = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
            if (dt) return dt[1] + '年' + dt[2] + '月' + dt[3] + '日 ' + dt[4] + ':' + dt[5];
            const date = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (date) return date[1] + '年' + date[2] + '月' + date[3] + '日';
            return value;
        }

        function submitForm() {
            const formData = {};
            const formDataDisplay = {};
            const questions = SURVEY_QUESTIONS;
            let hasError = false;

            for (const q of questions) {
                let value = '';

                if (q.type === 'text' || q.type === 'textarea' || q.type === 'date' || q.type === 'datetime' || q.type === 'select') {
                    const input = document.getElementById(q.id);
                    if (input) value = input.value;
                } else if (q.type === 'radio') {
                    const activeBtn = document.querySelector(\`#container-\${q.id} .choice-button.selected\`);
                    if (activeBtn) value = getChoiceValue(activeBtn, q.id);
                } else if (q.type === 'checkbox') {
                    const activeBtns = document.querySelectorAll(\`#container-\${q.id} .choice-button.selected\`);
                    value = Array.from(activeBtns).map(btn => getChoiceValue(btn, q.id)).join(', ');
                }

                if (q.required && !value) {
                    alert(\`\${q.title}を入力してください。\`);
                    hasError = true;
                    return; // 最初のエラーで止める
                }

                // 同意チェック: 選択肢に「同意する」が含まれている場合、それが選択されていないとエラー
                if (q.type === 'radio' && q.options && q.options.some(o => o.label === '同意する')) {
                    if (value !== '同意する') {
                        alert(\`\${q.title}に同意していただく必要があります。\`);
                        hasError = true;
                        return;
                    }
                }
                
                formData[q.title] = value;
                // メッセージ表示用は date/datetime のみ日本語整形
                formDataDisplay[q.title] = (q.type === 'date' || q.type === 'datetime') ? formatDateTimeForDisplay(value) : value;
            }

            if (hasError) return;

            // メッセージ作成（date/datetime は日本語表示）
            let messageText = \`≪\${document.title}≫\\n\`;
            for (const [key, val] of Object.entries(formDataDisplay)) {
                messageText += \`【\${key}】\\n・\${val}\\n\\n\`;
            }

            // データベースに保存
            const surveyFormId = '${surveyFormId || ''}';
            const storeId = '${storeId || ''}';
            
            if (surveyFormId && storeId) {
                // 現在のURLからベースパスを取得
                const baseUrl = window.location.origin;
                fetch(\`\${baseUrl}/api/surveys/submit\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        survey_form_id: surveyFormId,
                        store_id: storeId,
                        responses: formData,
                        line_user_id: lineUserId || null, // LINEユーザーID
                        line_friend_flag: lineFriendFlag // 友だち追加状態
                    })
                }).catch((err) => {
                    console.error('データベースへの保存に失敗しました', err);
                });
            }

            // LINEトークにメッセージを送信
            if (!liff.isInClient()) {
                alert('LINEアプリ内から開いてください。\\n\\n送信内容:\\n' + messageText);
                return;
            }

            const surveyMessages = [{ type: 'text', text: messageText.trim() }];${
              safeConfig.basic_info?.second_message?.enabled && typeof safeConfig.basic_info?.second_message?.text === 'string' && safeConfig.basic_info.second_message.text.trim()
                ? `\n            surveyMessages.push({ type: 'text', text: ${JSON.stringify(safeConfig.basic_info.second_message.text.trim())} });`
                : ''
            }
            liff.sendMessages(surveyMessages).then(() => {
                alert('ご記入ありがとうございます。');
                liff.closeWindow();
            }).catch((err) => {
                console.error('メッセージの送信に失敗しました', err);
                alert('メッセージの送信に失敗しました: ' + err);
            });
        }
    </script>
</body>
</html>`;
  }

  private renderQuestion(q: SurveyQuestion, index: number): string {
    let fieldHtml = '';
    const requiredMark = q.required ? '<span class="required">必須</span>' : '';

    switch (q.type) {
      case 'text':
      case 'textarea':
        // テキスト入力は全てtextareaとしてレンダリング（要件通り）
        fieldHtml = `<textarea id="${q.id}" class="input" rows="${q.type === 'textarea' ? 3 : 1}" placeholder="入力してください"></textarea>`;
        break;
      case 'date':
        fieldHtml = `<div class="date-inputs date-input-wrap"><input type="date" id="${q.id}" class="input"><span class="date-input-hint">タップしてご選択ください</span></div>`;
        break;
      case 'datetime':
        fieldHtml = `<div class="date-inputs date-input-wrap"><input type="datetime-local" id="${q.id}" class="input"><span class="date-input-hint">タップしてご選択ください</span></div>`;
        break;
      case 'select': {
        const opts = (q.options || []).map(opt =>
          `<option value="${this.escapeHtml(opt.value || opt.label)}">${this.escapeHtml(opt.label)}</option>`
        ).join('\n');
        fieldHtml = `<select id="${q.id}" class="input"><option value="">選択してください</option>${opts}</select>`;
        break;
      }
      case 'radio':
      case 'checkbox': {
        let buttons = q.options?.map(opt =>
          `<button type="button" class="choice-button" onclick="selectOption(this, '${q.id}', '${q.type}')">${this.escapeHtml(opt.label)}</button>`
        ).join('\n') || '';
        let otherReasonHtml = '';
        if (q.allow_other) {
          buttons += `\n<button type="button" class="choice-button" data-other="1" onclick="selectOption(this, '${q.id}', '${q.type}')">その他</button>`;
          otherReasonHtml = `
            <div class="other-reason" id="other-block-${q.id}" style="display:none;">
                <label class="field-label" for="other-input-${q.id}">その他を選択されている方はご理由をお書きください。</label>
                <textarea id="other-input-${q.id}" class="input" rows="2" placeholder="入力してください"></textarea>
            </div>`;
        }
        fieldHtml = `<div class="button-group" id="container-${q.id}">${buttons}</div>${otherReasonHtml}`;
        break;
      }
    }

    let descriptionHtml = '';
    if (q.description) {
        descriptionHtml = `<div class="field-description">${q.description.replace(/\n/g, '<br>')}</div>`;
    }

    return `
        <div class="field">
            <label class="field-label">Q${index + 1}. ${this.escapeHtml(q.title)} ${requiredMark}</label>
            ${descriptionHtml}
            ${fieldHtml}
        </div>
    `;
  }

  // 参考デザイン（ダークネイビー×シャンパンゴールド）を既存クラスに適用する上書きCSS。
  // DOM 構造・クラス名・JS は変更せず、見た目のみ差し替える。
  private generateDesignOverridesCSS(config: SurveyConfig): string {
    const themeColor = config.basic_info.theme_color || '#1b2a4e';
    return `
        :root {
            --primary-color: ${themeColor};
            --accent-color: #c5a059;
            --bg-color: #f4f6f9;
            --text-color: #333333;
            --white: #ffffff;
            --required-bg: #ff4c4c;
        }
        button { touch-action: manipulation; -webkit-tap-highlight-color: transparent; font-family: inherit; }
        body {
            font-family: 'Noto Sans JP', 'Poppins', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
        }
        .form-container { max-width: 500px; padding: 10px 0 40px; }
        .form-header {
            background-color: var(--primary-color) !important;
            color: var(--white);
            border-radius: 4px 4px 0 0;
            border-top: 4px solid var(--accent-color);
            box-shadow: none;
            margin-bottom: 0;
            text-align: center;
            padding: 20px 15px;
        }
        .form-header h1 { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
        .form-content {
            border-radius: 0 0 4px 4px;
            box-shadow: 0 2px 20px rgba(0, 0, 0, 0.08);
            padding: 25px;
        }
        .field-label {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px;
            padding: 8px 15px;
            font-weight: 700;
            color: #1b2a4e;
            font-size: 16px;
            border-bottom: 2px solid var(--primary-color);
            border-left: 6px solid var(--accent-color);
            line-height: 1.4;
            margin-bottom: 15px;
        }
        .required {
            margin-left: auto;
            background: var(--required-bg);
            color: var(--white);
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 2px;
            font-weight: normal;
        }
        .input {
            padding: 14px;
            border: 1px solid #ccc;
            border-radius: 2px;
            font-size: 16px;
            background-color: #fafafa;
        }
        .input:focus {
            border-color: var(--primary-color);
            background-color: var(--white);
            box-shadow: 0 0 0 1px var(--primary-color);
        }
        .choice-button {
            border: 1px solid #ccc;
            border-radius: 2px;
            font-weight: 500;
            font-size: 15px;
        }
        @media (hover: hover) and (pointer: fine) {
            .choice-button:hover { border-color: var(--accent-color); background-color: #fffcf5; }
        }
        .choice-button.selected {
            background-color: var(--primary-color) !important;
            border-color: var(--primary-color) !important;
            color: var(--white) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        /* 選択中バッジ（疑似要素なので innerText・送信内容には影響しない） */
        .choice-button.selected::after {
            content: "✓ 選択中";
            display: block;
            width: fit-content;
            margin: 6px auto 0;
            padding: 1px 12px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: bold;
            letter-spacing: 1px;
            line-height: 1.7;
            background-color: var(--accent-color);
            color: var(--white);
        }
        /* 日付・日時入力: スマホで横幅をページに収める + 未選択時ヒント */
        input[type="date"].input,
        input[type="datetime-local"].input {
            width: 100%;
            max-width: 100%;
            min-width: 0;
            box-sizing: border-box;
            display: block;
            -webkit-appearance: none;
            appearance: none;
            min-height: 48px;
        }
        .date-input-wrap { position: relative; }
        .date-input-wrap input:not(.has-value) { color: transparent; }
        .date-input-wrap input:not(.has-value)::-webkit-datetime-edit { color: transparent; }
        .date-input-hint {
            position: absolute;
            left: 14px;
            top: 50%;
            transform: translateY(-50%);
            color: #9aa0a6;
            font-size: 15px;
            pointer-events: none;
            white-space: nowrap;
        }
        .date-input-wrap input.has-value + .date-input-hint { display: none; }
        .submit-button {
            padding: 18px;
            font-size: 18px;
            font-weight: bold;
            background: var(--primary-color);
            border-radius: 4px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            border-bottom: 4px solid var(--accent-color);
        }
        .submit-button:active { transform: translateY(2px); border-bottom-width: 2px; box-shadow: none; }
        .side-nav { background: var(--primary-color); }
        .side-nav a { color: var(--accent-color); }
        @media (max-width: 600px) {
            .form-container { padding: 0 0 30px; }
            .form-header { border-radius: 0; }
            .form-content { border-radius: 0; box-shadow: none; padding: 20px 15px; }
            .form-header h1 { font-size: 20px; }
            .field-label { font-size: 15px; padding: 8px 10px; }
            .submit-button { font-size: 17px; padding: 16px; }
        }
    `;
  }

  private generateCSS(config: SurveyConfig): string {
    const themeColor = config.basic_info.theme_color || '#13ca5e';
    
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #f9fafb;
            color: #111827;
            line-height: 1.5;
            min-height: 100vh;
        }
        
        .form-container {
            max-width: 42rem;
            margin: 0 auto;
            padding: 2rem 1rem;
        }
        
        .form-header {
            background-color: ${themeColor};
            color: white;
            padding: 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            margin-bottom: 1.5rem;
        }
        
        .form-header h1 {
            font-size: 1.5rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
        
        .form-header p {
            opacity: 0.9;
            font-size: 0.875rem;
        }
        
        .form-content {
            background: white;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            padding: 1.5rem;
        }
        
        .notice-box {
            background: #fffbeb;
            border: 2px solid #f59e0b;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 1.5rem;
        }

        .notice-title {
            display: flex;
            align-items: center;
            gap: 0.375rem;
            font-weight: 700;
            font-size: 0.9375rem;
            color: #b45309;
            margin-bottom: 0.5rem;
        }

        .notice-icon {
            width: 1.125rem;
            height: 1.125rem;
            flex-shrink: 0;
        }

        .notice-text {
            color: #92400e;
            font-size: 0.875rem;
            line-height: 1.6;
            white-space: pre-wrap;
        }

        .field {
            margin-bottom: 1.5rem;
        }
        
        .field-label {
            display: block;
            font-size: 0.875rem;
            font-weight: 600;
            color: #374151;
            margin-bottom: 0.5rem;
        }
        
        .field-description {
            font-size: 0.875rem;
            color: #6b7280;
            margin-bottom: 0.75rem;
            line-height: 1.4;
            white-space: pre-wrap;
        }
        
        .required {
            color: #ef4444;
            margin-left: 0.25rem;
            font-size: 0.75rem;
            background: #fee2e2;
            padding: 2px 6px;
            border-radius: 4px;
        }
        
        .input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            font-size: 1rem;
            transition: all 0.15s;
        }
        
        .input:focus {
            outline: none;
            border-color: ${themeColor};
            box-shadow: 0 0 0 3px rgba(19, 202, 94, 0.1);
        }
        
        textarea.input {
            resize: vertical;
        }
        
        .button-group {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
        }
        
        .choice-button {
            flex: 1;
            min-width: 45%;
            padding: 0.75rem 1rem;
            border: 2px solid #d1d5db;
            border-radius: 0.375rem;
            background: white;
            color: #374151;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
        }
        
        .choice-button:hover {
            border-color: #9ca3af;
        }
        
        .other-reason {
            margin-top: 0.75rem;
        }

        .choice-button.selected {
            border-color: ${themeColor};
            background-color: #f0fdf4;
            color: #064e3b;
        }
        
        .submit-button {
            width: 100%;
            padding: 0.75rem;
            background-color: ${themeColor};
            color: white;
            border: none;
            border-radius: 0.375rem;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.15s;
            margin-top: 1rem;
        }
        
        .submit-button:hover {
            opacity: 0.9;
        }

        /* 右端の細いナビ（固定） */
        .side-nav {
            position: fixed;
            right: 0;
            top: 80%;
            transform: translateY(-50%);
            background: ${themeColor};
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 4px;
            border-radius: 8px 0 0 8px;
            z-index: 1000;
            box-shadow: -2px 2px 5px rgba(0,0,0,0.1);
        }

        .side-nav a {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            text-decoration: none;
            font-size: 10px;
            padding: 5px;
            width: 30px;
            height: 30px;
        }

        .side-nav a span {
            font-size: 16px;
            margin-bottom: -5px;
        }
        
        @media (max-width: 600px) {
            .form-container {
                padding: 1rem;
            }
            
            .choice-button {
                min-width: 100%;
            }
        }
    `;
  }

  private escapeHtml(text: string | undefined | null): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
