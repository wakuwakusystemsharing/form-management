/**
 * 静的HTMLジェネレータ v2
 * プレビュー画面と完全一致するHTMLを生成
 */

import { FormConfig } from '@/types/form';

export class StaticFormGenerator {
  /**
   * FormConfigから静的HTMLを生成
   * プレビュー画面と完全一致
   */
  generateHTML(config: FormConfig): string {
    // config は immutable に扱うため、深くコピーして修正
    const safeConfig: FormConfig = JSON.parse(JSON.stringify(config));

    // 必須フィールドの初期化
    if (!safeConfig.basic_info) {
      safeConfig.basic_info = {
        form_name: 'フォーム',
        store_name: '',
        liff_id: '',
        theme_color: '#3B82F6'
      };
    }
    
    if (!safeConfig.gender_selection) {
      safeConfig.gender_selection = {
        enabled: false,
        required: false,
        options: [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]
      };
    } else {
      safeConfig.gender_selection.enabled = safeConfig.gender_selection.enabled ?? false;
    }
    
    if (!safeConfig.visit_count_selection) {
      safeConfig.visit_count_selection = {
        enabled: false,
        required: false,
        options: [
          { value: 'first', label: '初回' },
          { value: 'repeat', label: '2回目以降' }
        ]
      };
    } else {
      safeConfig.visit_count_selection.enabled = safeConfig.visit_count_selection.enabled ?? false;
    }
    
    if (!safeConfig.coupon_selection) {
      safeConfig.coupon_selection = {
        enabled: false,
        options: [
          { value: 'use', label: '利用する' },
          { value: 'not_use', label: '利用しない' }
        ]
      };
    } else {
      safeConfig.coupon_selection.enabled = safeConfig.coupon_selection.enabled ?? false;
    }
    
    if (!safeConfig.menu_structure) {
      safeConfig.menu_structure = {
        structure_type: 'category_based',
        categories: [],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      };
    }
    
    if (!safeConfig.calendar_settings) {
      safeConfig.calendar_settings = {
        business_hours: {
          monday: { open: '09:00', close: '18:00', closed: false },
          tuesday: { open: '09:00', close: '18:00', closed: false },
          wednesday: { open: '09:00', close: '18:00', closed: false },
          thursday: { open: '09:00', close: '18:00', closed: false },
          friday: { open: '09:00', close: '18:00', closed: false },
          saturday: { open: '09:00', close: '18:00', closed: false },
          sunday: { open: '09:00', close: '18:00', closed: true }
        },
        advance_booking_days: 30
      };
    }
    
    if (!safeConfig.ui_settings) {
      safeConfig.ui_settings = {
        theme_color: '#3B82F6',
        button_style: 'rounded',
        show_repeat_booking: false,
        show_side_nav: true
      };
    }

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(safeConfig.basic_info.form_name)}</title>
    <script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>
    <style>${this.generateCSS(safeConfig)}</style>
</head>
<body>
    <div class="form-container">
        <div class="form-header">
            <h1>${this.escapeHtml(safeConfig.basic_info.form_name)}</h1>
            <p>${this.escapeHtml(safeConfig.basic_info.store_name || 'ご予約フォーム')}</p>
        </div>
        
        <div class="form-content">
            <h2 class="section-title">ご予約内容</h2>
            
            <!-- お客様名 -->
            <div class="field" id="name-field">
                <label class="field-label">お名前 <span class="required">*</span></label>
                <input type="text" id="customer-name" class="input" placeholder="山田太郎">
            </div>
            
            <!-- 電話番号 -->
            <div class="field" id="phone-field">
                <label class="field-label">電話番号 <span class="required">*</span></label>
                <input type="tel" id="customer-phone" class="input" placeholder="090-1234-5678">
            </div>
            
            ${safeConfig.gender_selection.enabled ? this.renderGenderField(safeConfig) : ''}
            ${safeConfig.visit_count_selection.enabled ? this.renderVisitCountField(safeConfig) : ''}
            ${safeConfig.coupon_selection.enabled ? this.renderCouponField(safeConfig) : ''}
            ${this.renderMenuField(safeConfig)}
            ${this.renderDateTimeField()}
            ${this.renderMessageField()}
            ${this.renderSummary()}
            
            <button type="button" id="submit-button" class="submit-button">予約する</button>
        </div>
    </div>
    
    <script>
const FORM_CONFIG = ${JSON.stringify(safeConfig, null, 2)};

class BookingForm {
    constructor(config) {
        this.config = config;
        this.state = {
            name: '',
            phone: '',
            gender: '',
            visitCount: '',
            coupon: '',
            selectedMenu: null,
            selectedSubmenu: null,
            selectedOptions: {}, // メニューIDをキーとしたオプションID配列
            selectedDate: '',
            selectedTime: '',
            message: ''
        };
        this.currentDate = new Date();
        this.init();
    }
    
    async init() {
        try {
            // カレンダーの初期設定
            const today = new Date();
            this.state.currentWeekStart = this.getWeekStart(today);
            this.state.selectedDate = '';
            this.state.selectedTime = '';
            
            await this.initializeLIFF();
            
            // カレンダーは初期表示しない（メニュー選択後に表示）
            // this.renderCalendar();
        } catch (error) {
            console.error('Init error:', error);
        } finally {
            // エラーが発生してもイベントリスナーは必ず設定する
            this.attachEventListeners();
        }
    }
    
    async initializeLIFF() {
        const liffId = this.config.basic_info.liff_id;
        if (!liffId || liffId.length < 10) return;
        
        try {
            await liff.init({ liffId });
            if (liff.isLoggedIn()) {
                const profile = await liff.getProfile();
                this.state.name = profile.displayName || '';
                document.getElementById('customer-name').value = this.state.name;
            }
        } catch (error) {
            console.warn('LIFF init failed:', error);
        }
    }
    
    attachEventListeners() {
        // 名前・電話番号
        document.getElementById('customer-name').addEventListener('input', (e) => {
            this.state.name = e.target.value;
            this.updateSummary();
        });
        
        document.getElementById('customer-phone').addEventListener('input', (e) => {
            this.state.phone = e.target.value;
            this.updateSummary();
        });
        
        // 性別選択
        document.querySelectorAll('.gender-button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.gender-button').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.state.gender = btn.dataset.value;
                this.updateSummary();
            });
        });
        
        // 来店回数選択
        document.querySelectorAll('.visit-count-button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.visit-count-button').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.state.visitCount = btn.dataset.value;
                this.updateSummary();
            });
        });
        
        // クーポン選択
        document.querySelectorAll('.coupon-button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.coupon-button').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.state.coupon = btn.dataset.value;
                this.updateSummary();
            });
        });
        
        // メニュー選択
        document.querySelectorAll('.menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // オプションボタンからのイベント伝播を防ぐ
                if (e.target.closest('.menu-option-item')) {
                    return;
                }
                
                const menuId = item.dataset.menuId;
                const categoryId = item.dataset.categoryId;
                const menu = this.findMenu(categoryId, menuId);
                
                if (menu.has_submenu) {
                    // サブメニューがある場合
                    const wasSelected = item.classList.contains('selected');
                    document.querySelectorAll('.menu-item').forEach(m => {
                        m.classList.remove('selected', 'has-submenu');
                    });
                    
                    // オプションコンテナを全て非表示
                    document.querySelectorAll('.menu-options-container').forEach(c => c.style.display = 'none');
                    
                    if (!wasSelected) {
                        item.classList.add('selected', 'has-submenu');
                        this.state.selectedMenu = menu;
                        this.state.selectedSubmenu = null;
                        this.showSubmenu(categoryId, menuId);
                    } else {
                        this.state.selectedMenu = null;
                        this.hideSubmenu();
                    }
                } else {
                    // 通常メニュー
                    const wasSelected = item.classList.contains('selected');
                    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('selected'));
                    
                    // 全てのオプションコンテナを非表示
                    document.querySelectorAll('.menu-options-container').forEach(c => c.style.display = 'none');
                    
                    if (!wasSelected) {
                        item.classList.add('selected');
                        this.state.selectedMenu = menu;
                        this.state.selectedSubmenu = null;
                        this.hideSubmenu();
                        
                        // このメニューのオプションコンテナを表示
                        const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                        if (optionsContainer) {
                            optionsContainer.style.display = 'block';
                        }
                    } else {
                        this.state.selectedMenu = null;
                    }
                }
                
                // カレンダーの表示/非表示を切り替え
                this.toggleCalendarVisibility();
                this.updateSummary();
            });
        });
        
        // メニューオプション選択
        document.querySelectorAll('.menu-option-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const menuId = item.dataset.menuId;
                const optionId = item.dataset.optionId;
                
                // 現在のメニューのオプション配列を取得
                const currentOptions = this.state.selectedOptions[menuId] || [];
                
                // オプションがすでに選択されているかチェック
                const isSelected = currentOptions.includes(optionId);
                
                if (isSelected) {
                    // 選択解除
                    this.state.selectedOptions[menuId] = currentOptions.filter(id => id !== optionId);
                    item.style.borderColor = '#d1d5db';
                    item.style.backgroundColor = 'white';
                    item.style.color = '#374151';
                } else {
                    // 選択
                    this.state.selectedOptions[menuId] = [...currentOptions, optionId];
                    item.style.borderColor = '#3b82f6';
                    item.style.backgroundColor = '#eff6ff';
                    item.style.color = '#1e40af';
                }
                
                this.updateSummary();
            });
        });
        
        // 日付選択
        document.querySelectorAll('.calendar-day').forEach(day => {
            day.addEventListener('click', () => {
                document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
                day.classList.add('selected');
                this.state.selectedDate = day.dataset.date;
                this.showTimeSlots();
                this.updateSummary();
            });
        });
        
        // メッセージ
        document.getElementById('customer-message').addEventListener('input', (e) => {
            this.state.message = e.target.value;
        });
        
        // 送信
        document.getElementById('submit-button').addEventListener('click', () => {
            this.handleSubmit();
        });
        
        // サマリー修正ボタン
        document.querySelectorAll('.summary-edit-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const fieldId = btn.dataset.field;
                document.getElementById(fieldId).scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    }
    
    findMenu(categoryId, menuId) {
        const category = this.config.menu_structure.categories.find(c => c.id === categoryId);
        return category?.menus.find(m => m.id === menuId);
    }
    
    showSubmenu(categoryId, menuId) {
        const existing = document.getElementById('submenu-container');
        if (existing) existing.remove();
        
        const menu = this.findMenu(categoryId, menuId);
        if (!menu || !menu.sub_menu_items) return;
        
        const container = document.createElement('div');
        container.id = 'submenu-container';
        container.className = 'submenu-container';
        container.innerHTML = \`
            <div class="submenu-title">サブメニューを選択してください</div>
            \${menu.sub_menu_items.map((sub, idx) => \`
                <button class="submenu-item" data-submenu-index="\${idx}">
                    <div class="menu-item-content">
                        <div class="menu-item-name">\${sub.name}</div>
                        \${sub.description ? \`<div class="menu-item-desc">\${sub.description}</div>\` : ''}
                    </div>
                    <div class="menu-item-info">
                        <div class="menu-item-price">¥\${sub.price.toLocaleString()}</div>
                        <div class="menu-item-duration">\${sub.duration}分</div>
                    </div>
                </button>
            \`).join('')}
        \`;
        
        document.querySelector(\`.menu-item[data-menu-id="\${menuId}"]\`).after(container);
        
        container.querySelectorAll('.submenu-item').forEach(sub => {
            sub.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(sub.dataset.submenuIndex);
                document.querySelectorAll('.submenu-item').forEach(s => s.classList.remove('selected'));
                sub.classList.add('selected');
                this.state.selectedSubmenu = menu.sub_menu_items[idx];
                this.toggleCalendarVisibility();
                this.updateSummary();
            });
        });
    }
    
    hideSubmenu() {
        const container = document.getElementById('submenu-container');
        if (container) container.remove();
    }
    
    toggleCalendarVisibility() {
        const calendarField = document.getElementById('datetime-field');
        if (!calendarField) return;
        
        // メニューまたはサブメニューが選択されている場合のみカレンダーを表示
        if (this.state.selectedMenu || this.state.selectedSubmenu) {
            calendarField.style.display = 'block';
            // カレンダーを初めて表示する際にレンダリング
            this.renderCalendar();
        } else {
            calendarField.style.display = 'none';
        }
    }
    
    // 週の開始日を取得（月曜日）
    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff));
    }
    
    // 週の日付配列を生成
    getWeekDates(weekStart) {
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(weekStart);
            date.setDate(weekStart.getDate() + i);
            dates.push(date);
        }
        return dates;
    }
    
    // カレンダーをレンダリング
    renderCalendar() {
        const table = document.getElementById('calendar-table');
        if (!table) return;
        
    // 事前予約可能日数の上限日を算出
    const days = (this.config?.calendar_settings?.advance_booking_days ?? 30);
    const today = new Date();
    today.setHours(0,0,0,0);
    const max = new Date(today);
    max.setDate(today.getDate() + days);
    max.setHours(23,59,59,999);

        const weekDates = this.getWeekDates(this.state.currentWeekStart);
        const timeSlots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
                          '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'];
        
        // 月表示を更新
        const monthDisplay = document.getElementById('current-month');
        if (monthDisplay) {
            monthDisplay.textContent = this.state.currentWeekStart.toLocaleDateString('ja-JP', { 
                year: 'numeric', 
                month: 'long' 
            });
        }
        
        // テーブルヘッダー生成
        let headerHTML = '<thead><tr><th style="text-align:center;padding:0.5rem;background:#f3f4f6;border:2px solid #696969;font-size:0.75rem;">時間</th>';
        weekDates.forEach(date => {
            const dayOfWeek = date.getDay();
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            headerHTML += \`<th style="text-align:center;padding:0.5rem;background:#f3f4f6;border:2px solid #696969;font-size:0.75rem;">
                \${date.getMonth() + 1}/\${date.getDate()}<br/>(\${dayNames[dayOfWeek]})
            </th>\`;
        });
        headerHTML += '</tr></thead>';
        
        // テーブルボディ生成
        let bodyHTML = '<tbody>';
        timeSlots.forEach(time => {
            bodyHTML += '<tr>';
            bodyHTML += \`<td style="text-align:center;padding:0.25rem;border:2px solid #696969;font-size:0.75rem;background:#f9fafb;font-weight:500;">\${time}</td>\`;
            
            weekDates.forEach((date, dateIndex) => {
        const dateStr = date.toISOString().split('T')[0];
        // 予約可能期間の判定
        const withinWindow = date.getTime() <= max.getTime();
        const isAvailable = withinWindow && (Math.random() > 0.3); // 空き状況（後でAPI連携）
                const isSelected = this.state.selectedDate === dateStr && this.state.selectedTime === time;
                const isPast = new Date() > new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
                    parseInt(time.split(':')[0]), parseInt(time.split(':')[1]));
                
                const bgColor = isSelected ? '#10b981' : (isAvailable && !isPast ? '#fff' : '#f3f4f6');
                const textColor = isSelected ? '#fff' : (isAvailable && !isPast ? '#111827' : '#9ca3af');
                const cursor = isAvailable && !isPast ? 'pointer' : 'not-allowed';
                const hoverStyle = isAvailable && !isPast ? 'onmouseover="this.style.backgroundColor=&quot;#e5e7eb&quot;" onmouseout="if(!this.classList.contains(&quot;selected&quot;)){this.style.backgroundColor=&quot;#fff&quot;}"' : '';
                
                bodyHTML += \`<td 
                    data-date="\${dateStr}" 
                    data-time="\${time}"
                    class="calendar-cell \${isSelected ? 'selected' : ''}"
                    style="text-align:center;padding:0.25rem;border:2px solid #696969;font-size:0.75rem;cursor:\${cursor};background:\${bgColor};color:\${textColor};"
                    \${hoverStyle}
                    onclick="window.bookingForm.handleDateTimeSelect('\${dateStr}', '\${time}', \${isAvailable && !isPast})"
                >\${isAvailable && !isPast ? '○' : '×'}</td>\`;
            });
            
            bodyHTML += '</tr>';
        });
        bodyHTML += '</tbody>';
        
        table.innerHTML = headerHTML + bodyHTML;
    }
    
    // 日時選択ハンドラー
    handleDateTimeSelect(dateStr, time, isAvailable) {
        if (!isAvailable) return;
        
        // 以前の選択をクリア
        document.querySelectorAll('.calendar-cell.selected').forEach(cell => {
            cell.classList.remove('selected');
            cell.style.backgroundColor = '#fff';
            cell.style.color = '#111827';
        });
        
        // 新しい選択を適用
        const cell = document.querySelector(\`.calendar-cell[data-date="\${dateStr}"][data-time="\${time}"]\`);
        if (cell) {
            cell.classList.add('selected');
            cell.style.backgroundColor = '#10b981';
            cell.style.color = '#fff';
        }
        
        this.state.selectedDate = dateStr;
        this.state.selectedTime = time;
        this.updateSummary();
    }
    
    // 週移動
    navigateWeek(direction) {
        const newWeekStart = new Date(this.state.currentWeekStart);
        newWeekStart.setDate(this.state.currentWeekStart.getDate() + (direction === 'next' ? 7 : -7));
        this.state.currentWeekStart = newWeekStart;
        this.renderCalendar();
    }
    
    // 月移動
    navigateMonth(direction) {
        const newDate = new Date(this.state.currentWeekStart);
        newDate.setMonth(this.state.currentWeekStart.getMonth() + (direction === 'next' ? 1 : -1));
        this.state.currentWeekStart = this.getWeekStart(newDate);
        this.renderCalendar();
    }
    
    updateSummary() {
        const items = [];
        
        if (this.state.name) {
            items.push(\`<div class="summary-item"><span><strong>お名前:</strong> \${this.state.name}</span><button class="summary-edit-button" data-field="name-field">修正</button></div>\`);
        }
        if (this.state.phone) {
            items.push(\`<div class="summary-item"><span><strong>電話番号:</strong> \${this.state.phone}</span><button class="summary-edit-button" data-field="phone-field">修正</button></div>\`);
        }
        if (this.state.gender) {
            const label = this.config.gender_selection.options.find(o => o.value === this.state.gender)?.label;
            items.push(\`<div class="summary-item"><span><strong>性別:</strong> \${label}</span><button class="summary-edit-button" data-field="gender-field">修正</button></div>\`);
        }
        if (this.state.visitCount) {
            const label = this.config.visit_count_selection?.options.find(o => o.value === this.state.visitCount)?.label;
            items.push(\`<div class="summary-item"><span><strong>ご来店回数:</strong> \${label}</span><button class="summary-edit-button" data-field="visit-count-field">修正</button></div>\`);
        }
        if (this.state.coupon) {
            const label = this.config.coupon_selection?.options.find(o => o.value === this.state.coupon)?.label;
            items.push(\`<div class="summary-item"><span><strong>クーポン:</strong> \${label}</span><button class="summary-edit-button" data-field="coupon-field">修正</button></div>\`);
        }
        if (this.state.selectedMenu || this.state.selectedSubmenu) {
            let menuText = '';
            if (this.state.selectedSubmenu) {
                menuText = \`
                    <div style="font-size:0.875rem;color:#6b7280;">\${this.state.selectedMenu.name} &gt;</div>
                    <div>\${this.state.selectedSubmenu.name}</div>
                    <div style="font-size:0.875rem;color:#6b7280;">¥\${this.state.selectedSubmenu.price.toLocaleString()} / \${this.state.selectedSubmenu.duration}分</div>
                \`;
            } else if (this.state.selectedMenu) {
                menuText = \`
                    <div>\${this.state.selectedMenu.name}</div>
                    \${this.state.selectedMenu.price ? \`<div style="font-size:0.875rem;color:#6b7280;">¥\${this.state.selectedMenu.price.toLocaleString()} / \${this.state.selectedMenu.duration}分</div>\` : ''}
                \`;
            }
            
            // オプションを追加
            const menuId = this.state.selectedMenu?.id;
            if (menuId && this.state.selectedOptions[menuId] && this.state.selectedOptions[menuId].length > 0) {
                const menu = this.state.selectedMenu;
                const selectedOptionIds = this.state.selectedOptions[menuId];
                const optionTexts = selectedOptionIds.map(optionId => {
                    const option = menu.options?.find(o => o.id === optionId);
                    if (option) {
                        return \`<div style="font-size:0.75rem;color:#6b7280;margin-left:0.5rem;">+ \${option.name}\${option.price > 0 ? \` (+¥\${option.price.toLocaleString()})\` : ''}</div>\`;
                    }
                    return '';
                }).join('');
                menuText += optionTexts;
            }
            
            items.push(\`<div class="summary-item" style="align-items:flex-start;"><div><strong>メニュー:</strong><div style="margin-top:0.25rem;">\${menuText}</div></div><button class="summary-edit-button" data-field="menu-field">修正</button></div>\`);
        }
        if (this.state.selectedDate || this.state.selectedTime) {
            items.push(\`<div class="summary-item"><span><strong>希望日時:</strong> \${this.state.selectedDate} \${this.state.selectedTime}</span><button class="summary-edit-button" data-field="datetime-field">修正</button></div>\`);
        }
        if (this.state.message) {
            items.push(\`<div class="summary-item" style="align-items:flex-start;"><div><strong>メッセージ:</strong><div style="margin-top:0.25rem;font-size:0.875rem;color:#6b7280;">\${this.state.message}</div></div><button class="summary-edit-button" data-field="message-field">修正</button></div>\`);
        }
        
        const container = document.getElementById('summary-content');
        if (container) {
            container.innerHTML = items.join('');
            // 修正ボタンのイベントを再アタッチ
            container.querySelectorAll('.summary-edit-button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const fieldId = btn.dataset.field;
                    document.getElementById(fieldId).scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            });
        }
    }
    
    async handleSubmit() {
        // バリデーション
        if (!this.state.name || !this.state.phone) {
            alert('お名前と電話番号を入力してください');
            return;
        }
        if (!this.state.selectedMenu && !this.state.selectedSubmenu) {
            alert('メニューを選択してください');
            return;
        }
        if (!this.state.selectedDate || !this.state.selectedTime) {
            alert('予約日時を選択してください');
            return;
        }
        
        try {
            // GASエンドポイントに送信
            if (this.config.gas_endpoint) {
                await fetch(this.config.gas_endpoint, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        formData: this.state,
                        submittedAt: new Date().toISOString()
                    })
                });
            }
            
            // 成功画面を表示
            document.querySelector('.form-content').innerHTML = \`
                <div class="success">
                    <h3>予約が完了しました！</h3>
                    <p>ご予約ありがとうございます。</p>
                </div>
            \`;
            
            // LIFF メッセージ送信
            if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) {
                liff.sendMessages([{
                    type: 'text',
                    text: \`【予約確認】\\n店舗: \${this.config.basic_info.store_name}\\n日時: \${this.state.selectedDate} \${this.state.selectedTime}\\nお名前: \${this.state.name}\\n電話番号: \${this.state.phone}\\n\\nご予約ありがとうございます。\`
                }]);
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert('送信に失敗しました。もう一度お試しください。');
        }
    }
}

// 初期化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.bookingForm = new BookingForm(FORM_CONFIG);
    });
} else {
    window.bookingForm = new BookingForm(FORM_CONFIG);
}
    </script>
</body>
</html>`;
  }

  private renderGenderField(config: FormConfig): string {
    if (!config.gender_selection) return '';
    const genderSel = config.gender_selection;
    return `
            <!-- 性別選択 -->
            <div class="field" id="gender-field">
                <label class="field-label">性別 ${genderSel.required ? '<span class="required">*</span>' : ''}</label>
                <div class="button-group">
                    ${genderSel.options?.map(opt => 
                        `<button type="button" class="choice-button gender-button" data-value="${opt.value}">${opt.label}</button>`
                    ).join('') || ''}
                </div>
            </div>`;
  }

  private renderVisitCountField(config: FormConfig): string {
    if (!config.visit_count_selection) return '';
    const visitSel = config.visit_count_selection;
    return `
            <!-- 来店回数選択 -->
            <div class="field" id="visit-count-field">
                <label class="field-label">ご来店回数 ${visitSel.required ? '<span class="required">*</span>' : ''}</label>
                <div class="button-group">
                    ${visitSel.options?.map(opt =>
                        `<button type="button" class="choice-button visit-count-button" data-value="${opt.value}">${opt.label}</button>`
                    ).join('') || ''}
                </div>
            </div>`;
  }

  private renderCouponField(config: FormConfig): string {
    if (!config.coupon_selection) return '';
    const couponSel = config.coupon_selection;
    const couponName = couponSel.coupon_name ? `${couponSel.coupon_name}クーポン利用有無` : 'クーポン利用有無';
    return `
            <!-- クーポン選択 -->
            <div class="field" id="coupon-field">
                <label class="field-label">${couponName}</label>
                <div class="button-group">
                    ${couponSel.options?.map(opt =>
                        `<button type="button" class="choice-button coupon-button" data-value="${opt.value}">${opt.label}</button>`
                    ).join('') || ''}
                </div>
            </div>`;
  }

  private renderMenuField(config: FormConfig): string {
    if (!config.menu_structure.categories.length) return '';
    
    return `
            <!-- メニュー選択 -->
            <div class="field" id="menu-field">
                <label class="field-label">メニューをお選びください</label>
                ${config.menu_structure.categories.map(category => `
                    <div class="menu-list">
                        ${category.menus.map(menu => `
                            <div>
                                <button type="button" class="menu-item" data-menu-id="${menu.id}" data-category-id="${category.id}">
                                    <div class="menu-item-content">
                                        <div class="menu-item-name">${menu.name}${menu.has_submenu ? ' ▶' : ''}</div>
                                        ${menu.description ? `<div class="menu-item-desc">${menu.description}</div>` : ''}
                                    </div>
                                    ${!menu.has_submenu && menu.price !== undefined ? `
                                        <div class="menu-item-info">
                                            ${config.menu_structure.display_options.show_price ? `<div class="menu-item-price">¥${menu.price.toLocaleString()}</div>` : ''}
                                            ${config.menu_structure.display_options.show_duration && menu.duration ? `<div class="menu-item-duration">${menu.duration}分</div>` : ''}
                                        </div>
                                    ` : `<div class="menu-item-info"><div class="menu-item-desc">サブメニューを選択</div></div>`}
                                </button>
                                ${!menu.has_submenu && menu.options && menu.options.length > 0 ? `
                                    <div id="options-${menu.id}" class="menu-options-container" style="display:none;margin-left:1.5rem;padding-left:1rem;border-left:2px solid #bbf7d0;margin-top:0.75rem;margin-bottom:0.75rem;">
                                        <div style="font-size:0.875rem;font-weight:500;color:#374151;margin-bottom:0.75rem;">オプション</div>
                                        ${menu.options.map((option, optionIndex) => `
                                            <button type="button" class="menu-option-item" data-menu-id="${menu.id}" data-option-id="${option.id || `option-${optionIndex}`}" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:0.5rem;border:2px solid #d1d5db;border-radius:0.375rem;background:white;cursor:pointer;margin-bottom:0.5rem;transition:all 0.15s;text-align:left;">
                                                <div style="display:flex;align-items:center;">
                                                    <div>
                                                        <div style="text-align:left;font-size:0.875rem;font-weight:500;">
                                                            ${this.escapeHtml(option.name)}
                                                            ${option.is_default ? '<span style="margin-left:0.5rem;padding:0.25rem 0.5rem;font-size:0.75rem;background:#fed7aa;color:#9a3412;border-radius:0.25rem;">おすすめ</span>' : ''}
                                                        </div>
                                                        ${option.description ? `<div style="font-size:0.75rem;opacity:0.7;text-align:left;margin-top:0.125rem;">${this.escapeHtml(option.description)}</div>` : ''}
                                                    </div>
                                                </div>
                                                <div style="text-align:right;margin-left:0.5rem;">
                                                    ${config.menu_structure.display_options.show_price ? `<div style="font-weight:500;font-size:0.875rem;">${option.price > 0 ? `+¥${option.price.toLocaleString()}` : '無料'}</div>` : ''}
                                                    ${config.menu_structure.display_options.show_duration && option.duration > 0 ? `<div style="font-size:0.75rem;opacity:0.7;">+${option.duration}分</div>` : ''}
                                                </div>
                                            </button>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>`;
  }

  private renderDateTimeField(): string {
    return `
            <!-- 日時選択 -->
            <div class="field" id="datetime-field" style="display:none;">
                <label class="field-label">希望日時 <span class="required">*</span></label>
                <div style="font-size:0.875rem;color:#6b7280;margin-bottom:1rem;">
                    ※メニューを選択すると空き状況のカレンダーが表示されます
                </div>
                
                <div class="calendar-container">
                    <!-- 現在の月表示 -->
                    <div class="current-month-container" style="margin-bottom:1rem;text-align:center;">
                        <span id="current-month" class="current-month" style="font-size:1.125rem;font-weight:bold;color:#374151;"></span>
                    </div>

                    <!-- 月移動ボタン -->
                    <div class="month-button-container" style="display:flex;justify-content:space-between;margin-bottom:0.75rem;gap:0.5rem;">
                        <button type="button" onclick="window.bookingForm.navigateMonth('prev')" 
                                class="month-button" style="flex:1;padding:0.5rem 1.25rem;background:#374151;color:#fff;border:none;border-radius:0.25rem;cursor:pointer;font-weight:500;">
                            前月
                        </button>
                        <button type="button" onclick="window.bookingForm.navigateMonth('next')" 
                                class="month-button" style="flex:1;padding:0.5rem 1.25rem;background:#374151;color:#fff;border:none;border-radius:0.25rem;cursor:pointer;font-weight:500;">
                            翌月
                        </button>
                    </div>

                    <!-- 週移動ボタン -->
                    <div class="week-button-container" style="display:flex;justify-content:space-between;margin-bottom:0.75rem;gap:0.5rem;">
                        <button type="button" onclick="window.bookingForm.navigateWeek('prev')" 
                                class="week-button" style="flex:1;padding:0.5rem 1.25rem;background:#374151;color:#fff;border:none;border-radius:0.25rem;cursor:pointer;font-weight:500;">
                            前週
                        </button>
                        <button type="button" onclick="window.bookingForm.navigateWeek('next')" 
                                class="week-button" style="flex:1;padding:0.5rem 1.25rem;background:#374151;color:#fff;border:none;border-radius:0.25rem;cursor:pointer;font-weight:500;">
                            翌週
                        </button>
                    </div>

                    <!-- カレンダーテーブル -->
                    <div class="calendar-table-wrapper" style="overflow-x:auto;background:#fff;border:1px solid #d1d5db;border-radius:0.25rem;box-shadow:0 1px 2px 0 rgba(0,0,0,0.05);">
                        <table id="calendar-table" style="width:100%;border-collapse:collapse;">
                            <!-- JavaScriptで動的生成 -->
                        </table>
                    </div>
                </div>
            </div>`;
  }

  private renderMessageField(): string {
    return `
            <!-- メッセージ -->
            <div class="field" id="message-field">
                <label class="field-label">メッセージ（任意）</label>
                <textarea id="customer-message" class="input" rows="3" placeholder="ご質問やご要望がございましたらこちらにご記入ください"></textarea>
            </div>`;
  }

  private renderSummary(): string {
    return `
            <!-- 予約内容確認 -->
            <div class="summary-box">
                <h3 class="summary-title">ご予約内容</h3>
                <div id="summary-content">
                    <div style="color:#6b7280;font-size:0.875rem;">入力内容がここに表示されます</div>
                </div>
            </div>`;
  }

  private generateCSS(config: FormConfig): string {
    const themeColor = config.basic_info.theme_color || '#3B82F6';
    
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
        }
        
        .form-content {
            background: white;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1);
            padding: 1.5rem;
        }
        
        .section-title {
            font-size: 1.125rem;
            font-weight: 600;
            color: #111827;
            margin-bottom: 1.5rem;
        }
        
        .field {
            margin-bottom: 1.5rem;
        }
        
        .field-label {
            display: block;
            font-size: 0.875rem;
            font-weight: 500;
            color: #374151;
            margin-bottom: 0.5rem;
        }
        
        .required {
            color: #ef4444;
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
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        textarea.input {
            resize: vertical;
        }
        
        .button-group {
            display: flex;
            gap: 1rem;
        }
        
        .choice-button {
            flex: 1;
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
            border-color: #3b82f6;
            background-color: #eff6ff;
            color: #1e40af;
        }
        
        .menu-list {
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            padding: 1rem;
        }
        
        .menu-item {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem;
            border: 2px solid #d1d5db;
            border-radius: 0.375rem;
            background: white;
            cursor: pointer;
            margin-bottom: 0.5rem;
            transition: all 0.15s;
            text-align: left;
        }
        
        .menu-item:hover {
            border-color: #9ca3af;
        }
        
        .menu-item.selected {
            border-color: #3b82f6;
            background-color: #eff6ff;
        }
        
        .menu-item.has-submenu {
            border-color: #3b82f6;
        }
        
        .menu-item-content {
            text-align: left;
        }
        
        .menu-item-name {
            font-weight: 500;
            color: #111827;
        }
        
        .menu-item-desc {
            font-size: 0.875rem;
            opacity: 0.7;
            margin-top: 0.25rem;
        }
        
        .menu-item-info {
            text-align: right;
            margin-left: 1rem;
        }
        
        .menu-item-price {
            font-weight: 600;
        }
        
        .menu-item-duration {
            font-size: 0.875rem;
            opacity: 0.7;
        }
        
        .submenu-container {
            margin-left: 1.5rem;
            margin-top: 0.75rem;
            margin-bottom: 0.75rem;
            padding-left: 1rem;
            border-left: 2px solid #bfdbfe;
        }
        
        .submenu-title {
            font-size: 0.875rem;
            font-weight: 500;
            color: #374151;
            margin-bottom: 0.75rem;
        }
        
        .submenu-item {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem;
            border: 2px solid #d1d5db;
            border-radius: 0.375rem;
            background: white;
            cursor: pointer;
            margin-bottom: 0.5rem;
            transition: all 0.15s;
            text-align: left;
        }
        
        .submenu-item:hover {
            border-color: #9ca3af;
        }
        
        .submenu-item.selected {
            border-color: #10b981;
            background-color: #f0fdf4;
            color: #166534;
        }
        
        /* カレンダーコンテナ */
        .calendar-container {
            width: 100%;
            margin-bottom: 1.5rem;
        }
        
        .calendar-table-wrapper {
            width: 100%;
        }
        
        #calendar-table {
            table-layout: fixed;
        }
        
        #calendar-table th,
        #calendar-table td {
            font-size: 0.75rem;
            text-align: center;
            padding: 0.25rem;
            vertical-align: middle;
            box-sizing: border-box;
            border: 2px solid #696969;
        }
        
        #calendar-table th {
            background: #f3f4f6;
            font-weight: 500;
        }
        
        #calendar-table th:first-child,
        #calendar-table td:first-child {
            width: 17%;
        }
        
        #calendar-table td.calendar-cell {
            transition: background-color 0.15s, color 0.15s;
        }
        
        #calendar-table td.calendar-cell.selected {
            background-color: #10b981 !important;
            color: #fff !important;
        }
        
        .month-button,
        .week-button {
            transition: background-color 0.15s;
        }
        
        .month-button:hover,
        .week-button:hover {
            background-color: #1f2937;
        }
        
        @media (max-width: 768px) {
            #calendar-table th,
            #calendar-table td {
                font-size: 0.625rem;
                padding: 0.125rem;
            }
            
            .month-button,
            .week-button {
                padding: 0.375rem 1rem;
                font-size: 0.875rem;
            }
        }
        
        .submit-button {
            width: 100%;
            padding: 0.75rem;
            background-color: ${themeColor};
            color: white;
            border: none;
            border-radius: 0.375rem;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s;
            margin-top: 1.5rem;
        }
        
        .submit-button:hover {
            opacity: 0.9;
        }
        
        .summary-box {
            margin-bottom: 1.5rem;
            padding: 1rem;
            border: 2px solid #e5e7eb;
            border-radius: 0.5rem;
            background-color: #f9fafb;
        }
        
        .summary-title {
            font-size: 1.125rem;
            font-weight: 600;
            color: #111827;
            margin-bottom: 1rem;
        }
        
        .summary-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5rem 0;
        }
        
        .summary-edit-button {
            padding: 0.25rem 0.75rem;
            font-size: 0.75rem;
            background: white;
            border: 1px solid #d1d5db;
            border-radius: 0.25rem;
            cursor: pointer;
            transition: background 0.15s;
        }
        
        .summary-edit-button:hover {
            background-color: #f9fafb;
        }
        
        .success {
            background-color: #f0fdf4;
            border: 1px solid #bbf7d0;
            color: #166534;
            padding: 2rem;
            border-radius: 0.5rem;
            text-align: center;
        }
        
        .success h3 {
            font-size: 1.25rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }
    `;
  }

  private escapeHtml(text: string | undefined | null): string {
    if (!text) return '';
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }
}
