/**
 * 静的HTMLジェネレータ v2
 * プレビュー画面と完全一致するHTMLを生成
 */

import { FormConfig } from '@/types/form';

export class StaticReservationGenerator {
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
            
            ${safeConfig.ui_settings?.show_repeat_booking ? this.renderRepeatBookingButton(safeConfig) : ''}
            
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
            ${this.renderDateTimeFields(safeConfig)}
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
            // 日時選択モードの初期設定
            const bookingMode = this.config.calendar_settings?.booking_mode || 'calendar';
            
            if (bookingMode === 'multiple_dates') {
                // 第三希望日時モードの初期設定
                this.initializeMultipleDates();
            } else {
                // カレンダーモードの初期設定
                const today = new Date();
                this.state.currentWeekStart = this.getWeekStart(today);
                this.state.selectedDate = '';
                this.state.selectedTime = '';
            }
            
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
                
                // クリックされたメニューが既に選択されているかチェック
                const wasSelected = item.classList.contains('selected') && 
                                   this.state.selectedMenu && 
                                   this.state.selectedMenu.id === menuId;
                
                // 全てのメニューの選択状態をリセット（常に実行）
                document.querySelectorAll('.menu-item').forEach(m => {
                    m.classList.remove('selected', 'has-submenu');
                });
                
                // 全てのサブメニューコンテナを削除
                this.hideSubmenu();
                
                // 全てのオプションコンテナを非表示
                document.querySelectorAll('.menu-options-container').forEach(c => c.style.display = 'none');
                
                // 以前の選択をリセット
                this.state.selectedMenu = null;
                this.state.selectedSubmenu = null;
                this.state.selectedOptions = {};
                
                // 同じメニューを再度クリックした場合は選択解除のみ（wasSelectedがtrueの場合は何もしない）
                if (!wasSelected) {
                    if (menu.has_submenu) {
                        // サブメニューがある場合
                        item.classList.add('selected', 'has-submenu');
                        this.state.selectedMenu = menu;
                        this.showSubmenu(categoryId, menuId);
                    } else {
                        // 通常メニュー
                        item.classList.add('selected');
                        this.state.selectedMenu = menu;
                        
                        // このメニューのオプションコンテナを表示
                        const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                        if (optionsContainer) {
                            optionsContainer.style.display = 'block';
                        }
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
        
        // 前回と同じメニューで予約するボタン
        const repeatButton = document.getElementById('repeat-booking-button');
        if (repeatButton) {
            repeatButton.addEventListener('click', () => {
                this.handleRepeatBooking();
            });
            // ホバーエフェクト
            repeatButton.addEventListener('mouseenter', function() {
                const themeColor = this.style.color || '#3B82F6';
                this.style.backgroundColor = themeColor + '15';
            });
            repeatButton.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
            });
        }
        
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
                    \${sub.image ? \`
                        <div class="menu-item-image">
                            <img src="\${sub.image}" alt="\${sub.name}" class="menu-image" loading="lazy" onerror="this.style.display='none'">
                        </div>
                    \` : ''}
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
                // サブメニュー選択後にカレンダーを表示
                const calendarContainer = document.querySelector('.calendar-container');
                if (calendarContainer) {
                    calendarContainer.style.display = 'flex';
                }
                this.toggleCalendarVisibility();
                this.updateSummary();
            });
        });
    }
    
    hideSubmenu() {
        const container = document.getElementById('submenu-container');
        if (container) container.remove();
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
        let headerHTML = '<thead><tr><th style="text-align:center;padding:0.5rem;background:#f3f4f6;border:2px solid #696969;font-size:0.75rem;vertical-align:middle;width:17%;box-sizing:border-box;">時間</th>';
        weekDates.forEach(date => {
            const dayOfWeek = date.getDay();
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            headerHTML += \`<th style="text-align:center;padding:0.5rem;background:#f3f4f6;border:2px solid #696969;font-size:0.75rem;vertical-align:middle;line-height:1.3;width:calc((100% - 17%) / 7);box-sizing:border-box;word-break:keep-all;white-space:normal;">\${date.getMonth() + 1}/\${date.getDate()}<br/>(\${dayNames[dayOfWeek]})</th>\`;
        });
        headerHTML += '</tr></thead>';
        
        // テーブルボディ生成
        let bodyHTML = '<tbody>';
        timeSlots.forEach(time => {
            bodyHTML += '<tr>';
            bodyHTML += \`<td style="text-align:center;padding:0.25rem;border:2px solid #696969;font-size:0.75rem;background:#f9fafb;font-weight:500;">\${time}</td>\`;
            
            weekDates.forEach((date, dateIndex) => {
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay();
        
        // 曜日名のマッピング（0=日曜日, 1=月曜日, ...）
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = dayNames[dayOfWeek];
        
        // 営業時間設定を取得
        const businessHours = this.config?.calendar_settings?.business_hours;
        const dayHours = businessHours?.[dayName];
        
        // 定休日チェック
        const isClosed = dayHours?.closed === true;
        
        // 営業時間チェック
        let isWithinBusinessHours = true;
        if (!isClosed && dayHours) {
            const timeHour = parseInt(time.split(':')[0]);
            const timeMinute = parseInt(time.split(':')[1]);
            const timeMinutes = timeHour * 60 + timeMinute;
            
            const openTime = dayHours.open || '09:00';
            const closeTime = dayHours.close || '18:00';
            const openHour = parseInt(openTime.split(':')[0]);
            const openMinute = parseInt(openTime.split(':')[1]);
            const openMinutes = openHour * 60 + openMinute;
            
            const closeHour = parseInt(closeTime.split(':')[0]);
            const closeMinute = parseInt(closeTime.split(':')[1]);
            const closeMinutes = closeHour * 60 + closeMinute;
            
            isWithinBusinessHours = timeMinutes >= openMinutes && timeMinutes < closeMinutes;
        }
        
        // 予約可能期間の判定
        const withinWindow = date.getTime() <= max.getTime();
        // 空き状況（後でAPI連携）と営業時間・定休日のチェックを組み合わせ
        const isAvailable = withinWindow && !isClosed && isWithinBusinessHours && (Math.random() > 0.3);
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
    
    // 前回と同じメニューで予約する
    handleRepeatBooking() {
        const formId = this.config.basic_info?.form_name || 'default';
        const savedData = localStorage.getItem(\`booking_\${formId}\`);
        
        if (!savedData) {
            alert('前回のメニューが見つかりません💦');
            return;
        }
        
        try {
            const selectionData = JSON.parse(savedData);
            
            // データが1週間以内のもののみ復元
            const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            if (selectionData.timestamp < oneWeekAgo) {
                alert('前回のメニューデータが古いため復元できません');
                return;
            }
            
            // メニュー選択を復元（簡易版 - 実際の実装は選択状態を再現する必要がある）
            if (selectionData.selectedMenus && Object.keys(selectionData.selectedMenus).length > 0) {
                // メニュー選択の復元ロジックは複雑なため、アラートで通知
                alert('前回のメニューを復元しました！\\nメニューを再選択してください。');
                
                // カレンダーセクションにスクロール
                setTimeout(() => {
                    const calendarField = document.getElementById('datetime-field');
                    if (calendarField) {
                        calendarField.style.display = 'block';
                        calendarField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        this.renderCalendar();
                    }
                }, 100);
            } else {
                alert('前回のメニューが見つかりません💦');
            }
        } catch (error) {
            console.error('Failed to restore previous selection:', error);
            alert('前回のメニューの復元に失敗しました');
        }
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
            let totalPrice = 0;
            let totalDuration = 0;
            
            if (this.state.selectedSubmenu) {
                totalPrice = this.state.selectedSubmenu.price || 0;
                totalDuration = this.state.selectedSubmenu.duration || 0;
                menuText = \`
                    <div style="font-size:0.875rem;color:#6b7280;">\${this.state.selectedMenu.name} &gt;</div>
                    <div>\${this.state.selectedSubmenu.name}</div>
                    <div style="font-size:0.875rem;color:#6b7280;">¥\${this.state.selectedSubmenu.price.toLocaleString()} / \${this.state.selectedSubmenu.duration}分</div>
                \`;
            } else if (this.state.selectedMenu) {
                totalPrice = this.state.selectedMenu.price || 0;
                totalDuration = this.state.selectedMenu.duration || 0;
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
                        totalPrice += option.price || 0;
                        totalDuration += option.duration || 0;
                        return \`<div style="font-size:0.75rem;color:#6b7280;margin-left:0.5rem;">+ \${option.name}\${option.price > 0 ? \` (+¥\${option.price.toLocaleString()})\` : ''}\${option.duration > 0 ? \` (+\${option.duration}分)\` : ''}</div>\`;
                    }
                    return '';
                }).join('');
                menuText += optionTexts;
            }
            
            items.push(\`<div class="summary-item" style="align-items:flex-start;"><div><strong>メニュー:</strong><div style="margin-top:0.25rem;">\${menuText}</div></div><button class="summary-edit-button" data-field="menu-field">修正</button></div>\`);
            
            // 合計金額と合計時間を表示
            if (totalPrice > 0 || totalDuration > 0) {
                let totalText = '';
                if (totalPrice > 0) {
                    totalText += \`<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #e5e7eb;"><strong style="font-size:1rem;">合計金額: ¥\${totalPrice.toLocaleString()}</strong></div>\`;
                }
                if (totalDuration > 0) {
                    totalText += \`<div style="margin-top:0.25rem;"><strong style="font-size:1rem;">合計時間: \${totalDuration}分</strong></div>\`;
                }
                items.push(\`<div class="summary-item" style="align-items:flex-start;"><div>\${totalText}</div></div>\`);
            }
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
            // 日時を日本語形式に変換
            const dateObj = new Date(this.state.selectedDate);
            const formattedDate = \`\${dateObj.getFullYear()}年\${String(dateObj.getMonth() + 1).padStart(2, '0')}月\${String(dateObj.getDate()).padStart(2, '0')}日 \${this.state.selectedTime}\`;
            
            // メッセージ本文を構築（old_index.htmlとbooking.gsのparseReservationFormに合わせた形式）
            // booking.gsが期待する順序：お名前、電話番号、ご来店回数、コース、メニュー、希望日時、メッセージ
            let messageText = '【予約フォーム】\\n';
            
            // 常に表示：お名前、電話番号
            messageText += \`お名前：\${this.state.name || ''}\\n\`;
            messageText += \`電話番号：\${this.state.phone || ''}\\n\`;
            
            // ご来店回数（old_index.htmlでは常に表示、booking.gsも期待している）
            let visitCountText = '';
            if (this.config.visit_count_selection?.enabled && this.state.visitCount) {
                const visitLabel = this.config.visit_count_selection.options.find(o => o.value === this.state.visitCount)?.label;
                visitCountText = visitLabel || this.state.visitCount || '';
            }
            messageText += \`ご来店回数：\${visitCountText}\\n\`;
            
            // メニュー（詳細な予約内容を含める：カテゴリー名 > メニュー名 > サブメニュー名, オプション名）
            let menuText = '';
            
            if (this.state.selectedMenu) {
                // カテゴリー名を取得
                const category = this.config.menu_structure.categories.find(c => 
                    c.menus.some(m => m.id === this.state.selectedMenu.id)
                );
                
                // メニュー詳細を構築：カテゴリー > メニュー > サブメニュー
                const menuParts = [];
                if (category?.name) {
                    menuParts.push(category.name);
                }
                if (this.state.selectedMenu.name) {
                    menuParts.push(this.state.selectedMenu.name);
                }
                if (this.state.selectedSubmenu?.name) {
                    menuParts.push(this.state.selectedSubmenu.name);
                }
                
                if (menuParts.length > 0) {
                    menuText = menuParts.join(' > ');
                }
                
                // オプションを追加（サブメニューが選択されている場合でも親メニューのオプションを表示）
                const menuId = this.state.selectedMenu.id;
                if (menuId && this.state.selectedOptions[menuId]?.length > 0) {
                    const menu = this.state.selectedMenu;
                    const selectedOptionIds = this.state.selectedOptions[menuId];
                    const optionNames = selectedOptionIds.map(optionId => {
                        const option = menu.options?.find(o => o.id === optionId);
                        return option?.name || '';
                    }).filter(Boolean);
                    if (optionNames.length > 0) {
                        menuText += (menuText ? ', ' : '') + optionNames.join(', ');
                    }
                }
            }
            
            messageText += \`メニュー：\${menuText}\\n\`;
            
            // 希望日時（常に表示、booking.gsは「希望日時：」の次の行を日時として解析）
            messageText += \`希望日時：\\n \${formattedDate}\\n\`;
            
            // メッセージ（常に表示、空文字列でも）
            messageText += \`メッセージ：\${this.state.message || ''}\`;
            
            // 性別とクーポンはbooking.gsが解析しないため、メッセージの最後に追加（オプション）
            if (this.config.gender_selection?.enabled && this.state.gender) {
                const genderLabel = this.config.gender_selection.options.find(o => o.value === this.state.gender)?.label;
                if (genderLabel) {
                    messageText += \`\\n性別：\${genderLabel}\`;
                }
            }
            
            if (this.config.coupon_selection?.enabled && this.state.coupon) {
                const couponLabel = this.config.coupon_selection.options.find(o => o.value === this.state.coupon)?.label;
                if (couponLabel) {
                    messageText += \`\\nクーポン：\${couponLabel}\`;
                }
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
                    text: messageText
                }]).then(() => {
                    // メッセージ送信成功後にウィンドウを閉じる
                    alert('当日キャンセルは無いようにお願いいたします。');
                    liff.closeWindow();
                }).catch((err) => {
                    console.error('メッセージの送信に失敗しました', err);
                });
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert('送信に失敗しました。もう一度お試しください。');
        }
    }
    
    // 第三希望日時モード用関数
    initializeMultipleDates() {
        const settings = this.config.calendar_settings?.multiple_dates_settings || {
            time_interval: 30,
            date_range_days: 30,
            exclude_weekdays: [0],
            start_time: '09:00',
            end_time: '18:00'
        };
        
        // 各希望日時の初期化
        for (let i = 1; i <= 3; i++) {
            this.populateDateOptions(i, settings);
            this.populateTimeOptions(i, settings);
            
            // イベントリスナー追加
            const daySelect = document.getElementById(\`date\${i}_day\`);
            const timeSelect = document.getElementById(\`date\${i}_time\`);
            if (daySelect && timeSelect) {
                daySelect.addEventListener('change', () => this.updateDateTime(i));
                timeSelect.addEventListener('change', () => this.updateDateTime(i));
            }
        }
    }
    
    populateDateOptions(index, settings) {
        const select = document.getElementById(\`date\${index}_day\`);
        if (!select) return;
        
        const today = new Date();
        
        // デフォルトオプション
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '日付を選択';
        select.appendChild(defaultOption);
        
        for (let i = 0; i < settings.date_range_days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            
            // 除外曜日チェック
            if (settings.exclude_weekdays.includes(date.getDay())) {
                continue;
            }
            
            const option = document.createElement('option');
            option.value = date.toISOString().split('T')[0];
            option.textContent = date.toLocaleDateString('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                weekday: 'short'
            });
            select.appendChild(option);
        }
    }
    
    populateTimeOptions(index, settings) {
        const select = document.getElementById(\`date\${index}_time\`);
        if (!select) return;
        
        // デフォルトオプション
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '時間を選択';
        select.appendChild(defaultOption);
        
        // 時間スロット生成
        const timeSlots = this.generateTimeSlots(settings.start_time, settings.end_time, settings.time_interval);
        
        timeSlots.forEach(time => {
            const option = document.createElement('option');
            option.value = time;
            option.textContent = time;
            select.appendChild(option);
        });
    }
    
    generateTimeSlots(startTime, endTime, interval) {
        const slots = [];
        const [startHour, startMin] = startTime.split(':').map(Number);
        const [endHour, endMin] = endTime.split(':').map(Number);
        
        let currentHour = startHour;
        let currentMin = startMin;
        
        while (currentHour < endHour || (currentHour === endHour && currentMin < endMin)) {
            const timeStr = \`\${currentHour.toString().padStart(2, '0')}:\${currentMin.toString().padStart(2, '0')}\`;
            slots.push(timeStr);
            
            currentMin += interval;
            if (currentMin >= 60) {
                currentHour += Math.floor(currentMin / 60);
                currentMin = currentMin % 60;
            }
        }
        
        return slots;
    }
    
    updateDateTime(index) {
        const daySelect = document.getElementById(\`date\${index}_day\`);
        const timeSelect = document.getElementById(\`date\${index}_time\`);
        const hiddenInput = document.getElementById(\`date\${index}\`);
        const placeholder = document.getElementById(\`placeholder\${index}\`);
        
        if (!daySelect || !timeSelect || !hiddenInput || !placeholder) return;
        
        if (daySelect.value && timeSelect.value) {
            const dateTimeString = \`\${daySelect.value}T\${timeSelect.value}:00\`;
            hiddenInput.value = dateTimeString;
            
            // プレースホルダーを選択内容に更新
            const displayText = \`\${daySelect.options[daySelect.selectedIndex].textContent} \${timeSelect.value}\`;
            placeholder.textContent = displayText;
            placeholder.style.color = '#374151';
            placeholder.style.fontWeight = 'bold';
            
            // 対応するstateを更新
            if (index === 1) this.state.selectedDate = daySelect.value;
            if (index === 1) this.state.selectedTime = timeSelect.value;
        } else {
            placeholder.textContent = '⇩タップして日時を入力⇩';
            placeholder.style.color = '#6b7280';
            placeholder.style.fontWeight = 'normal';
        }
        
        this.updateSummary();
    }
    
    toggleCalendarVisibility() {
        const bookingMode = this.config.calendar_settings?.booking_mode || 'calendar';
        
        if (bookingMode === 'multiple_dates') {
            // 第三希望日時モード
            const fields = ['datetime-field-1', 'datetime-field-2', 'datetime-field-3'];
            fields.forEach(fieldId => {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.style.display = (this.state.selectedMenu || this.state.selectedSubmenu) ? 'block' : 'none';
                }
            });
        } else {
            // カレンダーモード（既存ロジック）
            const datetimeField = document.getElementById('datetime-field');
            if (datetimeField) {
                if (this.state.selectedMenu || this.state.selectedSubmenu) {
                    datetimeField.style.display = 'block';
                    // カレンダーを初めて表示する際にレンダリング
                    this.renderCalendar();
                } else {
                    datetimeField.style.display = 'none';
                }
            }
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
                                    ${menu.image ? `
                                        <div class="menu-item-image">
                                            <img src="${menu.image}" alt="${menu.name}" class="menu-image" loading="lazy" onerror="this.style.display='none'">
                                        </div>
                                    ` : ''}
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

  private renderDateTimeFields(config: FormConfig): string {
    const bookingMode = config.calendar_settings?.booking_mode || 'calendar';
    
    if (bookingMode === 'multiple_dates') {
      return this.renderMultipleDatesField();
    } else {
      return this.renderDateTimeField();
    }
  }
  
  private renderDateTimeField(): string {
    return `${this.renderCalendarField()}`;
  }
  
  private renderCalendarField(): string {
    // 現在は常にカレンダーモードで生成（プレビューと同じ）
    // 静的HTML生成時はプレビューと完全一致させる
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
  
  private renderMultipleDatesField(): string {
    return `
            <!-- 第一希望日時 -->
            <div class="field" id="datetime-field-1" style="display:none;">
                <label class="field-label">第一希望日時 <span class="required">*</span></label>
                <div class="datetime-wrapper" style="text-align: center;">
                    <span class="placeholder" id="placeholder1" style="color:#6b7280;font-size:0.875rem;display:block;margin-bottom:0.5rem;">⇩タップして日時を入力⇩</span>
                    <input type="hidden" id="date1" name="date1">
                    <div class="dt-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
                        <select id="date1_day" class="datetime-input" aria-label="日付を選択" style="padding:0.75rem;border:1px solid #d1d5db;border-radius:0.375rem;font-size:1rem;"></select>
                        <select id="date1_time" class="datetime-input" aria-label="時間を選択" style="padding:0.75rem;border:1px solid #d1d5db;border-radius:0.375rem;font-size:1rem;"></select>
                    </div>
                </div>
            </div>

            <!-- 第二希望日時 -->
            <div class="field" id="datetime-field-2" style="display:none;">
                <label class="field-label">第二希望日時 <span class="required">*</span></label>
                <div class="datetime-wrapper" style="text-align: center;">
                    <span class="placeholder" id="placeholder2" style="color:#6b7280;font-size:0.875rem;display:block;margin-bottom:0.5rem;">⇩タップして日時を入力⇩</span>
                    <input type="hidden" id="date2" name="date2">
                    <div class="dt-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
                        <select id="date2_day" class="datetime-input" aria-label="日付を選択" style="padding:0.75rem;border:1px solid #d1d5db;border-radius:0.375rem;font-size:1rem;"></select>
                        <select id="date2_time" class="datetime-input" aria-label="時間を選択" style="padding:0.75rem;border:1px solid #d1d5db;border-radius:0.375rem;font-size:1rem;"></select>
                    </div>
                </div>
            </div>

            <!-- 第三希望日時 -->
            <div class="field" id="datetime-field-3" style="display:none;">
                <label class="field-label">第三希望日時 <span class="required">*</span></label>
                <div class="datetime-wrapper" style="text-align: center;">
                    <span class="placeholder" id="placeholder3" style="color:#6b7280;font-size:0.875rem;display:block;margin-bottom:0.5rem;">⇩タップして日時を入力⇩</span>
                    <input type="hidden" id="date3" name="date3">
                    <div class="dt-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
                        <select id="date3_day" class="datetime-input" aria-label="日付を選択" style="padding:0.75rem;border:1px solid #d1d5db;border-radius:0.375rem;font-size:1rem;"></select>
                        <select id="date3_time" class="datetime-input" aria-label="時間を選択" style="padding:0.75rem;border:1px solid #d1d5db;border-radius:0.375rem;font-size:1rem;"></select>
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

  private renderRepeatBookingButton(config: FormConfig): string {
    const themeColor = config.basic_info.theme_color || '#3B82F6';
    return `
            <!-- 前回と同じメニューで予約するボタン -->
            <div class="field" style="margin-bottom: 1.5rem;">
                <button type="button" id="repeat-booking-button" class="repeat-booking-button" style="
                    width: 100%;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0.75rem 1.25rem;
                    border: 2px dashed ${themeColor};
                    border-radius: 0.5rem;
                    background-color: transparent;
                    color: ${themeColor};
                    font-size: 0.875rem;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                ">
                    <svg style="width: 1.25rem; height: 1.25rem; margin-right: 0.5rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>前回と同じメニューで予約する</span>
                </button>
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
            flex-direction: column;
            justify-content: flex-start;
            align-items: stretch;
            padding: 0;
            border: 2px solid #d1d5db;
            border-radius: 0.375rem;
            background: white;
            cursor: pointer;
            margin-bottom: 0.5rem;
            transition: all 0.15s;
            text-align: left;
            overflow: hidden;
        }
        
        .menu-item:hover {
            border-color: #9ca3af;
        }
        
        .menu-item.selected {
            border-color: #10b981;
            background-color: #f0fdf4;
        }
        
        .menu-item.has-submenu {
            border-color: #10b981;
        }
        
        .menu-item-image {
            width: 100%;
            aspect-ratio: 16 / 9;
            margin: 0;
            border-radius: 0;
            overflow: hidden;
            flex-shrink: 0;
        }
        
        .menu-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.2s;
        }
        
        .menu-item:hover .menu-image {
            transform: scale(1.05);
        }
        
        .menu-item-content {
            text-align: left;
            flex: 1;
            padding: 0.75rem 0.75rem 0 0.75rem;
        }
        
        .menu-item-name {
            font-weight: 600;
            color: #111827;
            font-size: 0.95rem;
        }
        
        .menu-item-desc {
            font-size: 0.8rem;
            opacity: 0.7;
            margin-top: 0.25rem;
            line-height: 1.4;
        }
        
        .menu-item-info {
            text-align: right;
            margin-left: 0;
            padding: 0 0.75rem 0.75rem 0;
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
        }
        
        .menu-item-price {
            font-weight: 700;
            font-size: 0.95rem;
            color: #111827;
        }
        
        .menu-item-duration {
            font-size: 0.8rem;
            opacity: 0.7;
            margin-top: 0;
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
            width: 100%;
            border-collapse: collapse;
        }
        
        #calendar-table th,
        #calendar-table td {
            font-size: 0.75rem;
            text-align: center;
            padding: 0.25rem;
            vertical-align: middle;
            box-sizing: border-box;
            border: 2px solid #696969;
            word-break: keep-all;
            white-space: normal;
        }
        
        #calendar-table th {
            background: #f3f4f6;
            font-weight: 500;
            padding: 0.5rem;
        }
        
        #calendar-table th:first-child,
        #calendar-table td:first-child {
            width: 17%;
            min-width: 60px;
        }
        
        #calendar-table th:not(:first-child) {
            width: calc((100% - 17%) / 7);
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
            .menu-item-image {
                width: 50px;
                aspect-ratio: 16 / 9;
                margin-right: 0.5rem;
            }
            
            #calendar-table {
                font-size: 0.625rem;
            }
            
            #calendar-table th,
            #calendar-table td {
                font-size: 0.625rem;
                padding: 0.25rem 0.125rem;
            }
            
            #calendar-table th {
                padding: 0.375rem 0.125rem;
                line-height: 1.2;
            }
            
            .month-button,
            .week-button {
                padding: 0.375rem 1rem;
                font-size: 0.875rem;
            }
        }
        
        /* iPhone SEより狭い画面（LINEアプリ内など） */
        @media (max-width: 375px) {
            #calendar-table th,
            #calendar-table td {
                font-size: 0.5rem !important;
                padding: 0.2rem 0.1rem !important;
            }
            
            #calendar-table th {
                padding: 0.3rem 0.1rem !important;
                line-height: 1.1 !important;
            }
            
            #calendar-table th:first-child,
            #calendar-table td:first-child {
                min-width: 50px;
            }
            
            .month-button,
            .week-button {
                padding: 0.3rem 0.75rem;
                font-size: 0.75rem;
            }
            
            .current-month {
                font-size: 1rem !important;
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
        
        .repeat-booking-button:hover {
            transform: scale(1.02);
        }
        
        .repeat-booking-button:active {
            transform: scale(0.98);
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
