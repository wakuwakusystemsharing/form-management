import { SurveyConfig, SurveyQuestion } from '@/types/survey';

/**
 * アンケートフォーム用静的HTMLジェネレータ
 */
export class StaticSurveyGenerator {
  /**
   * SurveyConfigから静的HTMLを生成
   */
  generateHTML(config: SurveyConfig): string {
    const safeConfig: SurveyConfig = JSON.parse(JSON.stringify(config));
    
    // CSS生成
    const css = this.generateCSS(safeConfig);
    
    // 質問フィールドの生成
    const questionsHtml = safeConfig.questions.map((q, index) => this.renderQuestion(q, index)).join('\n');

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(safeConfig.basic_info.title)}</title>
    <script src="https://kit.fontawesome.com/a076d05399.js" crossorigin="anonymous"></script>
    <style>
        ${css}
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
            <form id="surveyForm" onsubmit="return false;">
                ${questionsHtml}
                
                <button type="button" class="submit-button" onclick="submitForm()" id="section-submit">${this.escapeHtml(safeConfig.ui_settings.submit_button_text || '送信')}</button>
            </form>
        </div>
    </div>

    <script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>
    <script>
        // LIFF初期化
        document.addEventListener('DOMContentLoaded', function () {
            liff.init({
                liffId: '${safeConfig.basic_info.liff_id}'
            }).then(() => {
                console.log('LIFF初期化成功');
            }).catch((err) => {
                console.error('LIFF初期化失敗', err);
            });
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
        }

        function submitForm() {
            const formData = {};
            const questions = ${JSON.stringify(safeConfig.questions)};
            let hasError = false;

            for (const q of questions) {
                let value = '';
                
                if (q.type === 'text' || q.type === 'textarea' || q.type === 'date') {
                    const input = document.getElementById(q.id);
                    if (input) value = input.value;
                } else if (q.type === 'radio') {
                    const activeBtn = document.querySelector(\`#container-\${q.id} .choice-button.selected\`);
                    if (activeBtn) value = activeBtn.innerText;
                } else if (q.type === 'checkbox') {
                    const activeBtns = document.querySelectorAll(\`#container-\${q.id} .choice-button.selected\`);
                    value = Array.from(activeBtns).map(btn => btn.innerText).join(', ');
                }

                if (q.required && !value) {
                    alert(\`\${q.title}を入力してください。\`);
                    hasError = true;
                    return; // 最初のエラーで止める
                }
                
                formData[q.title] = value;
            }

            if (hasError) return;

            // メッセージ作成
            let messageText = \`≪\${document.title}≫\\n\`;
            for (const [key, val] of Object.entries(formData)) {
                messageText += \`【\${key}】\\n・\${val}\\n\\n\`;
            }

            // LINEトークにメッセージを送信
            if (!liff.isInClient()) {
                alert('LINEアプリ内から開いてください。\\n\\n送信内容:\\n' + messageText);
                return;
            }

            liff.sendMessages([{
                type: 'text',
                text: messageText.trim()
            }]).then(() => {
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
        fieldHtml = `<div class="date-inputs"><input type="date" id="${q.id}" class="input"></div>`;
        break;
      case 'radio':
      case 'checkbox':
        const buttons = q.options?.map(opt => 
          `<button type="button" class="choice-button" onclick="selectOption(this, '${q.id}', '${q.type}')">${this.escapeHtml(opt.label)}</button>`
        ).join('\n') || '';
        fieldHtml = `<div class="button-group" id="container-${q.id}">${buttons}</div>`;
        break;
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
