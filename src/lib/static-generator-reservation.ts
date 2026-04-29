/**
 * 静的HTMLジェネレータ v2
 * プレビュー画面と完全一致するHTMLを生成
 */

import { FormConfig } from '@/types/form';

export class StaticReservationGenerator {
  /**
   * FormConfigから静的HTMLを生成
   * プレビュー画面と完全一致
   * @param config フォーム設定
   * @param formId フォームID
   * @param storeId 店舗ID
   */
  generateHTML(config: FormConfig, formId: string, storeId: string): string {
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
        allow_cross_category_selection: false,
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      };
    } else {
      safeConfig.menu_structure.allow_cross_category_selection = safeConfig.menu_structure.allow_cross_category_selection ?? false;
    }
    if (!Array.isArray(safeConfig.custom_fields)) {
      safeConfig.custom_fields = [];
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
    <link rel="icon" href="data:,">
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

            ${safeConfig.basic_info?.notice ? `<div class="notice-banner">${this.escapeHtml(safeConfig.basic_info.notice)}</div>` : ''}

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
            ${safeConfig.custom_fields?.length ? this.renderCustomFields(safeConfig) : ''}
            ${this.renderMenuField(safeConfig)}
            ${this.renderDateTimeFields(safeConfig)}
            ${this.renderMessageField()}
            ${this.renderSummary()}
            
            <button type="button" id="submit-button" class="submit-button">予約する</button>
        </div>
    </div>
    
    <script>
const FORM_CONFIG = ${JSON.stringify(safeConfig, null, 2)};
const FORM_ID = ${JSON.stringify(formId)};
const STORE_ID = ${JSON.stringify(storeId)};

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
            selectedMenus: {}, // カテゴリーまたぎ時: categoryId -> [menuId]
            selectedSubMenus: {}, // カテゴリーまたぎ時: menuId -> submenuId
            selectedCategoryOptions: {}, // カテゴリーレベルオプション: categoryId -> [optionId]
            customFields: {}, // カスタムフィールドの値
            selectedDate: '',
            selectedTime: '',
            selectedDate2: '',
            selectedTime2: '',
            selectedDate3: '',
            selectedTime3: '',
            message: '',
            lineUserId: null, // LINEユーザーID
            lineDisplayName: null, // LINE表示名
            linePictureUrl: null, // LINEプロフィール画像URL
            lineStatusMessage: null, // LINEステータスメッセージ
            lineEmail: null, // LINEメールアドレス
            lineLanguage: null, // LINE言語設定
            lineOs: null, // デバイスOS
            lineFriendFlag: false // 友だち追加状態
        };
        this.currentDate = new Date();
        this.availabilityCache = {}; // カレンダー空き状況のキャッシュ
        this.availabilityData = null; // 現在の空き状況データ
        this.businessDays = []; // 営業日の情報
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

            // localStorageから名前・電話番号を復元
            try {
                const formId = this.config.basic_info?.form_name || this.config.id || 'default';
                const saved = localStorage.getItem(\`booking_\${formId}\`);
                if (saved) {
                    const data = JSON.parse(saved);
                    if (data.customerPhone) {
                        this.state.phone = data.customerPhone;
                        const phoneEl = document.getElementById('customer-phone');
                        if (phoneEl) phoneEl.value = data.customerPhone;
                    }
                    if (data.customerName && !this.state.name) {
                        this.state.name = data.customerName;
                        const nameEl = document.getElementById('customer-name');
                        if (nameEl) nameEl.value = data.customerName;
                    }
                }
            } catch (e) {}

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

                // LINEプロフィール情報を取得
                this.state.lineDisplayName = profile.displayName || null;
                this.state.linePictureUrl = profile.pictureUrl || null;
                this.state.lineStatusMessage = profile.statusMessage || null;

                // デバイスOSを取得
                try {
                    if (liff.isInClient()) {
                        const os = liff.getOS();
                        this.state.lineOs = os === 'ios' ? 'ios' : 'android';
                    } else {
                        this.state.lineOs = 'web';
                    }
                } catch (osError) {
                    console.warn('デバイスOS取得に失敗しました:', osError);
                    this.state.lineOs = 'unknown';
                }

                // LINEユーザーIDと追加情報を取得
                try {
                    const idToken = await liff.getDecodedIDToken();
                    if (idToken) {
                        if (idToken.sub) {
                            this.state.lineUserId = idToken.sub;
                        }
                        if (idToken.email) {
                            this.state.lineEmail = idToken.email;
                        }
                        if (idToken.language) {
                            this.state.lineLanguage = idToken.language;
                        }
                    }
                } catch (idTokenError) {
                    console.warn('LINE User ID取得に失敗しました:', idTokenError);
                }

                // 友だち追加状態を取得
                try {
                    const friendship = await liff.getFriendship();
                    this.state.lineFriendFlag = friendship.friendFlag;
                } catch (friendError) {
                    console.warn('友だち追加状態の取得に失敗しました:', friendError);
                    this.state.lineFriendFlag = false;
                }
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
        
        // カスタムフィールド
        if (this.config.custom_fields && this.config.custom_fields.length > 0) {
            const self = this;
            this.config.custom_fields.forEach(function(field) {
                const el = document.getElementById('custom-field-' + field.id);
                if (el && (field.type === 'text' || field.type === 'textarea')) {
                    el.addEventListener('input', function() {
                        self.state.customFields[field.id] = el.value;
                        self.updateSummary();
                    });
                }
                if (field.type === 'radio') {
                    document.querySelectorAll('input[name="custom-field-' + field.id + '"]').forEach(function(radio) {
                        radio.addEventListener('change', function() {
                            if (radio.checked) {
                                self.state.customFields[field.id] = radio.value;
                                self.updateSummary();
                            }
                        });
                    });
                }
                if (field.type === 'checkbox') {
                    document.querySelectorAll('input[data-field-id="' + field.id + '"][data-field-type="checkbox"]').forEach(function(cb) {
                        cb.addEventListener('change', function() {
                            const checked = Array.from(document.querySelectorAll('input[data-field-id="' + field.id + '"][data-field-type="checkbox"]:checked')).map(function(c) { return c.value; });
                            self.state.customFields[field.id] = checked;
                            self.updateSummary();
                        });
                    });
                }
            });
        }
        
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
                const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
                
                if (allowCross) {
                    // カテゴリーまたいでの複数選択
                    const currentInCat = this.state.selectedMenus[categoryId] || [];
                    const isSelected = currentInCat.includes(menuId);
                    if (isSelected) {
                        const next = currentInCat.filter(id => id !== menuId);
                        this.state.selectedMenus = { ...this.state.selectedMenus, [categoryId]: next };
                        if (next.length === 0) {
                            const copy = { ...this.state.selectedMenus };
                            delete copy[categoryId];
                            this.state.selectedMenus = copy;
                        }
                        delete this.state.selectedSubMenus[menuId];
                        delete this.state.selectedOptions[menuId];
                    } else {
                        const next = [...currentInCat, menuId];
                        this.state.selectedMenus = { ...this.state.selectedMenus, [categoryId]: next };
                        this.state.selectedMenu = menu;
                        if (menu.has_submenu) {
                            this.showSubmenu(categoryId, menuId);
                        } else {
                            const optionsContainer = document.getElementById('options-' + menuId);
                            if (optionsContainer) optionsContainer.style.display = 'block';
                            this.hideSubmenu();
                        }
                    }
                    document.querySelectorAll('.menu-item').forEach(m => {
                        m.classList.remove('selected', 'has-submenu');
                        const cid = m.dataset.categoryId;
                        const mid = m.dataset.menuId;
                        const list = this.state.selectedMenus[cid] || [];
                        if (list.includes(mid)) {
                            const cat = this.config.menu_structure.categories.find(c => c.id === cid);
                            const men = cat?.menus?.find(m => m.id === mid);
                            if (men?.has_submenu) m.classList.add('selected', 'has-submenu');
                            else m.classList.add('selected');
                        }
                    });
                    document.querySelectorAll('.menu-options-container').forEach(c => { c.style.display = 'none'; });
                    const allMenuIds = Object.values(this.state.selectedMenus).flat();
                    allMenuIds.forEach(mid => {
                        const cat = this.config.menu_structure.categories.find(c => c.menus.some(m => m.id === mid));
                        const men = cat?.menus?.find(m => m.id === mid);
                        if (men && !men.has_submenu && men.options && men.options.length > 0) {
                            const opt = document.getElementById('options-' + mid);
                            if (opt) opt.style.display = 'block';
                        }
                    });
                } else {
                    // 単一選択（従来）
                    const wasSelected = item.classList.contains('selected') && this.state.selectedMenu && this.state.selectedMenu.id === menuId;
                    document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('selected', 'has-submenu'));
                    this.hideSubmenu();
                    document.querySelectorAll('.menu-options-container').forEach(c => c.style.display = 'none');
                    this.state.selectedMenu = null;
                    this.state.selectedSubmenu = null;
                    this.state.selectedOptions = {};
                    this.state.selectedMenus = {};
                    this.state.selectedSubMenus = {};
                    if (!wasSelected) {
                        if (menu.has_submenu) {
                            item.classList.add('selected', 'has-submenu');
                            this.state.selectedMenu = menu;
                            this.showSubmenu(categoryId, menuId);
                        } else {
                            item.classList.add('selected');
                            this.state.selectedMenu = menu;
                            const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                            if (optionsContainer) optionsContainer.style.display = 'block';
                        }
                    }
                }
                
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
        
        // カテゴリーレベルオプション選択
        document.querySelectorAll('.category-option-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const categoryId = item.dataset.categoryId;
                const optionId = item.dataset.optionId;
                const current = this.state.selectedCategoryOptions[categoryId] || [];
                const isSelected = current.includes(optionId);
                if (isSelected) {
                    this.state.selectedCategoryOptions[categoryId] = current.filter(id => id !== optionId);
                    item.style.borderColor = '#d1d5db';
                    item.style.backgroundColor = 'white';
                    item.style.color = '#374151';
                } else {
                    this.state.selectedCategoryOptions[categoryId] = [...current, optionId];
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
        const messageInput = document.getElementById('customer-message');
        if (messageInput) {
            messageInput.addEventListener('input', (e) => {
                this.state.message = e.target.value;
            });
        }
        
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
    
    // 選択メニュー・オプションから所要時間のみ取得（スロット判定用）
    getDurations() {
        let menuDuration = 0;
        let optionsDuration = 0;
        const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
        if (allowCross && this.state.selectedMenus && Object.keys(this.state.selectedMenus).length > 0) {
            Object.entries(this.state.selectedMenus).forEach(([categoryId, menuIds]) => {
                const category = this.config.menu_structure.categories.find(c => c.id === categoryId);
                (menuIds || []).forEach(menuId => {
                    const menu = category?.menus?.find(m => m.id === menuId);
                    if (!menu) return;
                    const subId = this.state.selectedSubMenus?.[menuId];
                    const sub = subId && menu.sub_menu_items ? menu.sub_menu_items.find(s => s.id === subId) : null;
                    menuDuration += sub ? (sub.duration || 0) : (menu.duration || 0);
                    (this.state.selectedOptions?.[menuId] || []).forEach(optionId => {
                        const option = menu.options?.find(o => o.id === optionId);
                        if (option) optionsDuration += option.duration || 0;
                    });
                });
            });
        } else if (this.state.selectedSubmenu) {
            menuDuration = this.state.selectedSubmenu.duration || 0;
            const menuId = this.state.selectedMenu?.id;
            (this.state.selectedOptions?.[menuId] || []).forEach(optionId => {
                const option = this.state.selectedMenu?.options?.find(o => o.id === optionId);
                if (option) optionsDuration += option.duration || 0;
            });
        } else if (this.state.selectedMenu) {
            menuDuration = this.state.selectedMenu.duration || 0;
            const menuId = this.state.selectedMenu.id;
            (this.state.selectedOptions?.[menuId] || []).forEach(optionId => {
                const option = this.state.selectedMenu.options?.find(o => o.id === optionId);
                if (option) optionsDuration += option.duration || 0;
            });
        }
        return { menuDuration, optionsDuration };
    }
    
    // 選択内容をAPI・サマリー・LINE用に1か所で構築（重複排除）
    buildSelectionPayload() {
        const selectedMenus = [];
        const selectedOptions = [];
        let totalPrice = 0;
        let totalDuration = 0;
        const summaryLines = [];
        const messageParts = [];
        const menusByCategory = [];
        const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
        const processMenu = (category, menu, submenu, menuId) => {
            const price = submenu ? (submenu.price || 0) : (menu.price || 0);
            const duration = submenu ? (submenu.duration || 0) : (menu.duration || 0);
            totalPrice += price;
            totalDuration += duration;
            selectedMenus.push({
                menu_id: menu.id,
                menu_name: menu.name || '',
                category_name: category?.name || '',
                price,
                duration,
                ...(submenu ? { submenu_id: submenu.id, submenu_name: submenu.name || '' } : {})
            });
            let menuLine = menu.name + (submenu ? ' &gt; ' + submenu.name : '');
            if (price > 0 || duration > 0) menuLine += (price > 0 ? ' ¥' + price.toLocaleString() : '') + (duration > 0 ? ' ' + duration + '分' : '');
            summaryLines.push(menuLine);
            const msgLine = [category?.name, menu.name, submenu?.name].filter(Boolean).join(' > ');
            const optNames = [];
            const optIds = this.state.selectedOptions?.[menuId] || [];
            optIds.forEach(optionId => {
                const option = menu.options?.find(o => o.id === optionId);
                if (option) {
                    const op = option.price || 0;
                    const od = option.duration || 0;
                    totalPrice += op;
                    totalDuration += od;
                    selectedOptions.push({ option_id: option.id, option_name: option.name || '', menu_id: menuId, price: op, duration: od });
                    summaryLines.push('+ ' + option.name + (op > 0 ? ' (+¥' + op.toLocaleString() + ')' : '') + (od > 0 ? ' (+' + od + '分)' : ''));
                    optNames.push(option.name);
                }
            });
            messageParts.push(optNames.length > 0 ? msgLine + ', ' + optNames.join(', ') : msgLine);
            menusByCategory.push({ category: category?.name || '', menu: submenu ? menu.name + ' > ' + submenu.name : menu.name, options: optNames });
        };
        if (allowCross && this.state.selectedMenus && Object.keys(this.state.selectedMenus).length > 0) {
            Object.entries(this.state.selectedMenus).forEach(([categoryId, menuIds]) => {
                const category = this.config.menu_structure.categories.find(c => c.id === categoryId);
                (menuIds || []).forEach(menuId => {
                    const menu = category?.menus?.find(m => m.id === menuId);
                    if (!menu) return;
                    const subId = this.state.selectedSubMenus?.[menuId];
                    const sub = subId && menu.sub_menu_items ? menu.sub_menu_items.find(s => s.id === subId) : null;
                    processMenu(category, menu, sub, menuId);
                });
            });
        } else if (this.state.selectedMenu) {
            const category = this.config.menu_structure.categories.find(c => c.menus.some(m => m.id === this.state.selectedMenu.id));
            const sub = this.state.selectedSubmenu || null;
            processMenu(category, this.state.selectedMenu, sub, this.state.selectedMenu.id);
        }
        // カテゴリーレベルオプションを追加
        if (this.state.selectedCategoryOptions && Object.keys(this.state.selectedCategoryOptions).length > 0) {
            Object.entries(this.state.selectedCategoryOptions).forEach(([categoryId, optionIds]) => {
                const category = this.config.menu_structure.categories.find(c => c.id === categoryId);
                (optionIds || []).forEach(optId => {
                    const opt = category?.options?.find(o => o.id === optId);
                    if (!opt) return;
                    const op = opt.price || 0;
                    const od = opt.duration || 0;
                    totalPrice += op;
                    totalDuration += od;
                    selectedOptions.push({ option_id: opt.id, option_name: opt.name || '', category_id: categoryId, price: op, duration: od });
                    summaryLines.push('+ ' + opt.name + (op > 0 ? ' (+¥' + op.toLocaleString() + ')' : '') + (od > 0 ? ' (+' + od + '分)' : ''));
                });
            });
        }
        const menuTextForMessage = messageParts.length > 0 ? messageParts.join(' / ') : '';
        // 希望日時式用: カテゴリーごとにグループ化した改行フォーマット
        let menuTextGrouped = '';
        if (menusByCategory.length > 0) {
            const grouped = {};
            menusByCategory.forEach(item => {
                const cat = item.category || '未分類';
                if (!grouped[cat]) grouped[cat] = [];
                const line = item.options.length > 0 ? item.menu + '（' + item.options.join(', ') + '）' : item.menu;
                grouped[cat].push(line);
            });
            menuTextGrouped = Object.entries(grouped).map(([cat, menus]) => {
                return '-（' + cat + '）-\\n' + menus.map(m => '・' + m).join('\\n');
            }).join('\\n\\n');
        }
        const summaryHtml = summaryLines.map((line, i) => i === 0 ? \`<div style="margin-bottom:0.5rem;">\${line}</div>\` : \`<div style="font-size:0.75rem;color:#6b7280;margin-left:0.5rem;">\${line}</div>\`).join('');
        return { selectedMenus, selectedOptions, totalPrice, totalDuration, summaryHtml, menuTextForMessage, menuTextGrouped };
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
                            <img src="\${sub.image}" alt="\${sub.name}" class="menu-image" loading="lazy" onerror="this.parentElement.style.display='none'">
                        </div>
                    \` : ''}
                    <div class="menu-item-content">
                        <div class="menu-item-name">\${sub.name}</div>
                        \${sub.description ? \`<div class="menu-item-desc">\${sub.description}</div>\` : ''}
                    </div>
                    <div class="menu-item-info">
                        \${!sub.hide_price ? \`<div class="menu-item-price">¥\${sub.price.toLocaleString()}</div>\` : ''}
                        \${!sub.hide_duration ? \`<div class="menu-item-duration">\${sub.duration}分</div>\` : ''}
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
                const submenu = menu.sub_menu_items[idx];
                this.state.selectedSubmenu = submenu;
                if (!this.state.selectedSubMenus) this.state.selectedSubMenus = {};
                this.state.selectedSubMenus[menuId] = submenu.id;
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
    
    // カレンダー空き状況を取得
    async fetchAvailability(date) {
        const startTime = new Date(date);
        startTime.setHours(0, 0, 0, 0);
        const endTime = new Date(date);
        endTime.setDate(endTime.getDate() + 7);
        endTime.setHours(23, 59, 59, 999);
        
        const cacheKey = startTime.toISOString() + endTime.toISOString();
        
        // キャッシュを確認
        if (this.availabilityCache[cacheKey]) {
            this.availabilityData = this.availabilityCache[cacheKey].availability;
            this.businessDays = this.availabilityCache[cacheKey].businessDays;
            this.renderCalendar();
            return;
        }
        
        const url = \`\${window.location.origin}/api/stores/\${STORE_ID}/calendar/availability\` + 
            \`?start=\${startTime.toISOString()}&end=\${endTime.toISOString()}\`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            const data = await response.json();
            
            // 営業日の情報を抽出
            const businessDays = data.filter(event => event.title === "営業日" || event.summary === "営業日").map(event => {
                return {
                    start: new Date(event.startTime),
                    end: new Date(event.endTime)
                };
            });
            
            // データをキャッシュに保存
            this.availabilityCache[cacheKey] = { availability: data, businessDays: businessDays };
            this.availabilityData = data;
            this.businessDays = businessDays;
            
            // カレンダーを再レンダリング
            this.renderCalendar();
        } catch (error) {
            // エラー時は空き状況データをnullにして、営業時間のみで判定
            this.availabilityData = null;
            this.businessDays = [];
            this.renderCalendar();
        }
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

        // 全曜日の営業時間から最早open・最遅closeを算出してタイムスロットを動的生成
        const businessHours = this.config?.calendar_settings?.business_hours;
        let earliestOpen = 9 * 60;
        let latestClose = 18 * 60;
        if (businessHours) {
            let foundOpen = false;
            const dayKeys = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
            dayKeys.forEach(day => {
                const h = businessHours[day];
                if (h && !h.closed) {
                    const openM = parseInt(h.open.split(':')[0]) * 60 + parseInt(h.open.split(':')[1]);
                    const closeM = parseInt(h.close.split(':')[0]) * 60 + parseInt(h.close.split(':')[1]);
                    if (!foundOpen || openM < earliestOpen) earliestOpen = openM;
                    if (!foundOpen || closeM > latestClose) latestClose = closeM;
                    foundOpen = true;
                }
            });
        }
        const rawInterval = this.config?.calendar_settings?.time_interval;
        const timeInterval = (rawInterval === 10 || rawInterval === 15 || rawInterval === 30 || rawInterval === 60) ? rawInterval : 30;
        const timeSlots = [];
        for (let m = earliestOpen; m < latestClose; m += timeInterval) {
            const hh = String(Math.floor(m / 60)).padStart(2, '0');
            const mm = String(m % 60).padStart(2, '0');
            timeSlots.push(hh + ':' + mm);
        }
        
        // 月表示を更新
        const monthDisplay = document.getElementById('current-month');
        if (monthDisplay) {
            monthDisplay.textContent = this.state.currentWeekStart.toLocaleDateString('ja-JP', { 
                year: 'numeric', 
                month: 'long' 
            });
        }
        
        // テーブルヘッダー生成
        let headerHTML = '<thead><tr><th style="text-align:center;padding:0.5rem;background:#f3f4f6;border:1px solid #9ca3af;font-size:0.75rem;vertical-align:middle;width:17%;box-sizing:border-box;">時間</th>';
        weekDates.forEach(date => {
            const dayOfWeek = date.getDay();
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            headerHTML += \`<th style="text-align:center;padding:0.4rem 0.3rem;background:#f3f4f6;border:1px solid #9ca3af;font-size:0.7rem;vertical-align:middle;line-height:1.3;width:calc((100% - 17%) / 7);box-sizing:border-box;word-break:keep-all;white-space:normal;">\${date.getMonth() + 1}/\${date.getDate()}<br style="line-height:0.8;" />(\${dayNames[dayOfWeek]})</th>\`;
        });
        headerHTML += '</tr></thead>';
        
        // テーブルボディ生成
        let bodyHTML = '<tbody>';
        timeSlots.forEach((time, timeIndex) => {
            bodyHTML += '<tr>';
            bodyHTML += \`<td style="text-align:center;padding:0.25rem;border:1px solid #9ca3af;font-size:0.75rem;background:#f9fafb;font-weight:500;">\${time}</td>\`;
            
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
        
        // 現在の日時を取得
        const now = new Date();
        // 日付をローカル時間で取得し、時間を設定
        const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 
            parseInt(time.split(':')[0]), parseInt(time.split(':')[1]), 0, 0);
        
        // ミリ秒で比較してタイムゾーンの問題を回避
        const isPast = slotStart.getTime() < now.getTime();
        
        // メニュー＋オプション時間は共通ヘルパーで取得
        const { menuDuration, optionsDuration } = this.getDurations();
        let visitDuration = 0;
        if (this.state.visitCount && this.config.visit_count_selection?.enabled) {
            const visitOption = this.config.visit_count_selection.options?.find(opt => opt.value === this.state.visitCount);
            if (visitOption?.duration) visitDuration = visitOption.duration;
        }
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotStart.getMinutes() + menuDuration + optionsDuration + visitDuration);
        
        // 終了時間が翌日になる場合は不可
        let isNextDay = slotEnd.getDate() !== slotStart.getDate();
        
        // 営業時間超過チェック（閉店時間を動的参照）
        let endsAfterClose = false;
        const allowExceed = this.config?.calendar_settings?.allow_exceed_business_hours || false;
        if (!allowExceed && !isClosed && dayHours) {
            const closeTime2 = dayHours.close || '18:00';
            const closeH = parseInt(closeTime2.split(':')[0]);
            const closeM = parseInt(closeTime2.split(':')[1]);
            const endH = slotEnd.getHours();
            const endM = slotEnd.getMinutes();
            if (endH > closeH || (endH === closeH && endM > closeM)) {
                endsAfterClose = true;
            }
        }

        // 空き状況の判定
        let isAvailable = false;

        if (isPast || isNextDay || endsAfterClose || !withinWindow || isClosed || !isWithinBusinessHours) {
            isAvailable = false;
        } else if (this.availabilityData && this.availabilityData.length > 0) {
            // カレンダーAPIから取得したデータがある場合
            const day = new Date(date);
            day.setHours(0, 0, 0, 0);
            
            // 営業日のイベント時間帯を取得
            let businessEventTimes = [];
            this.availabilityData.forEach(slot => {
                const eventStart = new Date(slot.startTime);
                const eventEnd = new Date(slot.endTime);
                if (eventStart.toDateString() === day.toDateString() && (slot.title === "営業日" || slot.summary === "営業日")) {
                    businessEventTimes.push({ start: eventStart, end: eventEnd });
                }
            });
            
            // 営業日チェック
            const isBusinessDay = this.businessDays.some(businessDay => {
                const businessDayStart = new Date(businessDay.start);
                const businessDayEnd = new Date(businessDay.end);
                return slotStart >= businessDayStart && slotEnd <= businessDayEnd;
            });
            
            // 営業日のイベント時間内かチェック
            const isBusinessEventTime = businessEventTimes.some(event => {
                return slotStart < event.end && event.start < slotEnd;
            });
            
            // 予約済みイベントの数をカウント（営業日イベントは除外）
            const count = this.availabilityData.reduce((acc, slot) => {
                const eventStart = new Date(slot.startTime);
                const eventEnd = new Date(slot.endTime);
                if (eventStart < slotEnd && slotStart < eventEnd && slot.title !== "営業日" && slot.summary !== "営業日") {
                    return acc + 1;
                }
                return acc;
            }, 0);

            // 同時刻に何件イベントがあれば予約不可にするかの閾値（1以上、デフォルト1）
            const rawMax = this.config?.calendar_settings?.max_concurrent_events;
            const maxConcurrent = (typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= 1) ? Math.floor(rawMax) : 1;

            // 空き状況の判定ロジック（count >= maxConcurrent で予約不可）
            if (isBusinessEventTime && count >= maxConcurrent) {
                // 営業日のイベント時間内で同時刻に閾値以上のイベントがある場合
                isAvailable = false;
            } else if (isBusinessEventTime) {
                // 営業日のイベント時間（閾値未満）
                isAvailable = true;
            } else if (businessEventTimes.length > 0) {
                // 営業日で、指定されている時間以外の時間は×
                isAvailable = false;
            } else if (slotStart.getDay() === 0 && !isBusinessDay && businessEventTimes.length === 0) {
                // 日曜日で、営業日ではない場合
                isAvailable = false;
            } else if (isBusinessDay && count < maxConcurrent) {
                // 営業日でかつ閾値未満
                isAvailable = true;
            } else if (count < maxConcurrent) {
                // それ以外で閾値未満
                isAvailable = true;
            } else {
                isAvailable = false;
            }
        } else {
            // カレンダーAPIから取得したデータがない場合、営業時間のみで判定
            isAvailable = true;
        }
        
        const isSelected = this.state.selectedDate === dateStr && this.state.selectedTime === time;
                const bgColor = isSelected ? '#10b981' : (isAvailable && !isPast ? '#fff' : '#f3f4f6');
                const textColor = isSelected ? '#fff' : (isAvailable && !isPast ? '#111827' : '#9ca3af');
                const cursor = isAvailable && !isPast ? 'pointer' : 'not-allowed';
                const hoverStyle = isAvailable && !isPast ? 'onmouseover="this.style.backgroundColor=&quot;#e5e7eb&quot;" onmouseout="if(!this.classList.contains(&quot;selected&quot;)){this.style.backgroundColor=&quot;#fff&quot;}"' : '';
                
                bodyHTML += \`<td 
                    data-date="\${dateStr}" 
                    data-time="\${time}"
                    class="calendar-cell \${isSelected ? 'selected' : ''}"
                    style="text-align:center;padding:0.25rem;border:1px solid #9ca3af;font-size:0.75rem;cursor:\${cursor};background:\${bgColor};color:\${textColor};"
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
        // 空き状況を取得してからカレンダーをレンダリング
        this.fetchAvailability(this.state.currentWeekStart).then(() => {
        this.renderCalendar();
        }).catch(() => {
            // エラー時もカレンダーをレンダリング（営業時間のみで判定）
            this.renderCalendar();
        });
    }
    
    // カテゴリーアコーディオン切り替え
    toggleCategory(categoryId) {
        const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
        const target = document.getElementById('category-section-' + categoryId);
        const header = document.querySelector('.category-header[data-category-id="' + categoryId + '"]');
        if (!target) return;

        const isOpen = target.style.display !== 'none';

        if (!allowCross) {
            // 排他モード: 他をすべて閉じる
            document.querySelectorAll('.category-section').forEach(sec => {
                sec.style.display = 'none';
            });
            document.querySelectorAll('.category-header').forEach(h => {
                h.classList.remove('open');
            });
        }

        if (isOpen && allowCross) {
            target.style.display = 'none';
            if (header) header.classList.remove('open');
        } else {
            target.style.display = 'block';
            if (header) header.classList.add('open');
        }
    }

    // 月移動
    navigateMonth(direction) {
        const newDate = new Date(this.state.currentWeekStart);
        newDate.setMonth(this.state.currentWeekStart.getMonth() + (direction === 'next' ? 1 : -1));
        this.state.currentWeekStart = this.getWeekStart(newDate);
        // 空き状況を取得してからカレンダーをレンダリング
        this.fetchAvailability(this.state.currentWeekStart).then(() => {
        this.renderCalendar();
        }).catch(() => {
            // エラー時もカレンダーをレンダリング（営業時間のみで判定）
            this.renderCalendar();
        });
    }
    
    // 前回と同じメニューで予約する
    handleRepeatBooking() {
        const formId = this.config.basic_info?.form_name || this.config.id || 'default';
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
            
            // 全てのメニューの選択状態をリセット
            document.querySelectorAll('.menu-item').forEach(m => {
                m.classList.remove('selected', 'has-submenu');
            });
            this.hideSubmenu();
            document.querySelectorAll('.menu-options-container').forEach(c => c.style.display = 'none');
            
            // 状態をリセット
            this.state.selectedMenu = null;
            this.state.selectedSubmenu = null;
            this.state.selectedOptions = {};
            this.state.selectedMenus = {};
            this.state.selectedSubMenus = {};
            this.state.selectedCategoryOptions = {};
            
            // Previewページ形式（selectedMenus/selectedSubMenus）から復元
            if (selectionData.selectedMenus && Object.keys(selectionData.selectedMenus).length > 0) {
                const allowCrossRestore = this.config.menu_structure?.allow_cross_category_selection || false;
                this.state.selectedMenus = selectionData.selectedMenus || {};
                this.state.selectedSubMenus = selectionData.selectedSubMenus || {};
                this.state.selectedOptions = selectionData.selectedMenuOptions || {};
                if (allowCrossRestore) {
                    document.querySelectorAll('.menu-item').forEach(m => {
                        const cid = m.dataset.categoryId;
                        const mid = m.dataset.menuId;
                        const list = this.state.selectedMenus[cid] || [];
                        if (list.includes(mid)) {
                            const cat = this.config.menu_structure.categories.find(c => c.id === cid);
                            const men = cat?.menus?.find(mn => mn.id === mid);
                            if (men?.has_submenu) m.classList.add('selected', 'has-submenu');
                            else m.classList.add('selected');
                        }
                    });
                    document.querySelectorAll('.menu-options-container').forEach(c => { c.style.display = 'none'; });
                    Object.entries(this.state.selectedMenus).forEach(([cid, menuIds]) => {
                        const category = this.config.menu_structure.categories.find(c => c.id === cid);
                        (menuIds || []).forEach(mid => {
                            const menu = category?.menus?.find(m => m.id === mid);
                            if (menu && !menu.has_submenu && menu.options?.length > 0) {
                                const opt = document.getElementById('options-' + mid);
                                if (opt) opt.style.display = 'block';
                            }
                        });
                    });
                    this.toggleCalendarVisibility();
                    this.updateSummary();
                    return;
                }
                // 単一選択時: 最初に見つかったメニューを選択
                let foundMenu = null;
                let foundCategoryId = null;
                let foundSubMenuId = null;
                
                for (const [categoryId, menuIds] of Object.entries(selectionData.selectedMenus)) {
                    if (menuIds && menuIds.length > 0) {
                        foundCategoryId = categoryId;
                        const menuId = menuIds[0];
                        foundMenu = this.findMenu(categoryId, menuId);
                        
                        // サブメニューがあるかチェック
                        if (selectionData.selectedSubMenus && selectionData.selectedSubMenus[menuId]) {
                            foundSubMenuId = selectionData.selectedSubMenus[menuId];
                        }
                        break;
                    }
                }
                
                if (foundMenu && foundCategoryId) {
                    // メニューアイテムを探して選択状態にする
                    const menuItem = document.querySelector(\`.menu-item[data-menu-id="\${foundMenu.id}"][data-category-id="\${foundCategoryId}"]\`);
                    if (menuItem) {
                        if (foundMenu.has_submenu) {
                            menuItem.classList.add('selected', 'has-submenu');
                            this.state.selectedMenu = foundMenu;
                            this.showSubmenu(foundCategoryId, foundMenu.id);
                            
                            // サブメニューを選択
                            if (foundSubMenuId) {
                                setTimeout(() => {
                                    const subMenuItems = document.querySelectorAll('.submenu-item');
                                    subMenuItems.forEach((sub, idx) => {
                                        const subMenu = foundMenu.sub_menu_items?.[idx];
                                        if (subMenu && (subMenu.id === foundSubMenuId || (!subMenu.id && idx === 0))) {
                                            sub.classList.add('selected');
                                            this.state.selectedSubmenu = subMenu;
                                        }
                                    });
                                    this.updateSummary();
                                }, 100);
                            }
                        } else {
                            menuItem.classList.add('selected');
                            this.state.selectedMenu = foundMenu;
                            
                            // オプションコンテナを表示
                            const optionsContainer = document.getElementById(\`options-\${foundMenu.id}\`);
                            if (optionsContainer) {
                                optionsContainer.style.display = 'block';
                            }
                            
                            // オプションを復元
                            if (selectionData.selectedMenuOptions && selectionData.selectedMenuOptions[foundMenu.id]) {
                                const optionIds = selectionData.selectedMenuOptions[foundMenu.id];
                                this.state.selectedOptions[foundMenu.id] = optionIds;
                                optionIds.forEach(optionId => {
                                    const optionBtn = document.querySelector(\`.menu-option-item[data-option-id="\${optionId}"]\`);
                                    if (optionBtn) {
                                        optionBtn.classList.add('selected');
                                    }
                                });
                            }
                        }
                        
                        // 性別、来店回数、クーポンを復元
                        if (selectionData.gender) {
                            this.state.gender = selectionData.gender;
                            const genderBtn = document.querySelector(\`.gender-button[data-value="\${selectionData.gender}"]\`);
                            if (genderBtn) {
                                document.querySelectorAll('.gender-button').forEach(btn => btn.classList.remove('selected'));
                                genderBtn.classList.add('selected');
                            }
                        }
                        
                        if (selectionData.visitCount) {
                            this.state.visitCount = selectionData.visitCount;
                            const visitBtn = document.querySelector(\`.visit-count-button[data-value="\${selectionData.visitCount}"]\`);
                            if (visitBtn) {
                                document.querySelectorAll('.visit-count-button').forEach(btn => btn.classList.remove('selected'));
                                visitBtn.classList.add('selected');
                            }
                        }
                        
                        if (selectionData.couponUsage) {
                            this.state.coupon = selectionData.couponUsage;
                            const couponBtn = document.querySelector(\`.coupon-button[data-value="\${selectionData.couponUsage}"]\`);
                            if (couponBtn) {
                                document.querySelectorAll('.coupon-button').forEach(btn => btn.classList.remove('selected'));
                                couponBtn.classList.add('selected');
                            }
                        }
                        
                        this.updateSummary();
                        this.toggleCalendarVisibility();
                        
                        // カレンダーセクションにスクロール
                        setTimeout(() => {
                            const calendarField = document.getElementById('datetime-field');
                            if (calendarField) {
                                calendarField.style.display = 'block';
                                calendarField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                if (this.state.currentWeekStart) {
                                    this.fetchAvailability(this.state.currentWeekStart).then(() => {
                                        this.renderCalendar();
                                    });
                                }
                            }
                        }, 200);
                        
                        alert('前回のメニューを復元しました！');
                    } else {
                        alert('前回のメニューが見つかりません💦');
                    }
                } else {
                    alert('前回のメニューが見つかりません💦');
                }
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
        const hasMenuSelection = this.config.menu_structure?.allow_cross_category_selection
            ? (this.state.selectedMenus && Object.values(this.state.selectedMenus).flat().length > 0)
            : (this.state.selectedMenu || this.state.selectedSubmenu);
        if (hasMenuSelection) {
            const payload = this.buildSelectionPayload();
            items.push(\`<div class="summary-item" style="align-items:flex-start;"><div><strong>メニュー:</strong><div style="margin-top:0.25rem;">\${payload.summaryHtml}</div></div><button class="summary-edit-button" data-field="menu-field">修正</button></div>\`);
            if (payload.totalPrice > 0 || payload.totalDuration > 0) {
                let totalText = '';
                if (payload.totalPrice > 0) totalText += \`<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #e5e7eb;"><strong style="font-size:1rem;">合計金額: ¥\${payload.totalPrice.toLocaleString()}</strong></div>\`;
                if (payload.totalDuration > 0) totalText += \`<div style="margin-top:0.25rem;"><strong style="font-size:1rem;">合計時間: \${payload.totalDuration}分</strong></div>\`;
                if (totalText) items.push(\`<div class="summary-item" style="align-items:flex-start;"><div>\${totalText}</div></div>\`);
            }
        }
        if (this.state.selectedDate || this.state.selectedTime) {
            const bMode = this.config.calendar_settings?.booking_mode || 'calendar';
            if (bMode === 'multiple_dates') {
                let dateHtml = \`<strong>希望日時:</strong><div style="margin-top:0.25rem;font-size:0.875rem;">\`;
                dateHtml += \`第一希望: \${this.state.selectedDate} \${this.state.selectedTime}\`;
                if (this.state.selectedDate2 && this.state.selectedTime2) dateHtml += \`<br>第二希望: \${this.state.selectedDate2} \${this.state.selectedTime2}\`;
                if (this.state.selectedDate3 && this.state.selectedTime3) dateHtml += \`<br>第三希望: \${this.state.selectedDate3} \${this.state.selectedTime3}\`;
                dateHtml += \`</div>\`;
                items.push(\`<div class="summary-item" style="align-items:flex-start;"><div>\${dateHtml}</div><button class="summary-edit-button" data-field="datetime-field-1">修正</button></div>\`);
            } else {
                items.push(\`<div class="summary-item"><span><strong>希望日時:</strong> \${this.state.selectedDate} \${this.state.selectedTime}</span><button class="summary-edit-button" data-field="datetime-field">修正</button></div>\`);
            }
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
        // 二重送信防止
        if (this.state.isSubmitting) return;
        this.state.isSubmitting = true;
        const submitBtn = document.getElementById('submit-button');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '送信中...';
            submitBtn.style.opacity = '0.6';
        }

        const resetSubmitState = () => {
            this.state.isSubmitting = false;
            const btn = document.getElementById('submit-button');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '予約する';
                btn.style.opacity = '1';
            }
        };

        // バリデーション
        if (!this.state.name || !this.state.phone) {
            alert('お名前と電話番号を入力してください');
            resetSubmitState();
            return;
        }
        const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
        const hasSelection = allowCross
            ? (Object.values(this.state.selectedMenus || {}).flat().length > 0)
            : (this.state.selectedMenu || this.state.selectedSubmenu);
        if (!hasSelection) {
            alert('メニューを選択してください');
            resetSubmitState();
            return;
        }
        if (!this.state.selectedDate || !this.state.selectedTime) {
            alert('予約日時を選択してください');
            resetSubmitState();
            return;
        }
        // カスタムフィールドの必須チェック
        if (this.config.custom_fields && this.config.custom_fields.length > 0) {
            for (let i = 0; i < this.config.custom_fields.length; i++) {
                const field = this.config.custom_fields[i];
                if (!field.required) continue;
                const val = this.state.customFields[field.id];
                if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '') || (Array.isArray(val) && val.length === 0)) {
                    alert(field.title + 'を入力・選択してください');
                    const wrap = document.getElementById('custom-field-wrap-' + field.id);
                    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    resetSubmitState();
                    return;
                }
            }
        }
        
        try {
            const payload = this.buildSelectionPayload();
            const { selectedMenus, selectedOptions, totalPrice, totalDuration, menuTextForMessage, menuTextGrouped } = payload;
            
            // 顧客属性情報を構築
            const customerInfo = {};
            if (this.config.gender_selection?.enabled && this.state.gender) {
                customerInfo.gender = this.state.gender;
                const label = this.config.gender_selection.options?.find(o => o.value === this.state.gender)?.label;
                if (label) customerInfo.gender_label = label;
            }
            if (this.config.visit_count_selection?.enabled && this.state.visitCount) {
                customerInfo.visit_count = this.state.visitCount;
                const label = this.config.visit_count_selection.options?.find(o => o.value === this.state.visitCount)?.label;
                if (label) customerInfo.visit_count_label = label;
            }
            if (this.config.coupon_selection?.enabled && this.state.coupon) {
                customerInfo.coupon = this.state.coupon;
                const label = this.config.coupon_selection.options?.find(o => o.value === this.state.coupon)?.label;
                if (label) customerInfo.coupon_label = label;
            }
            if (this.state.customFields && Object.keys(this.state.customFields).length > 0) {
                customerInfo.custom_fields = this.state.customFields;
                // ラベル付きのカスタムフィールド（Googleカレンダー説明文用）
                const labeledFields = {};
                if (this.config.custom_fields) {
                    this.config.custom_fields.forEach(field => {
                        const val = this.state.customFields[field.id];
                        if (val) labeledFields[field.title] = val;
                    });
                }
                customerInfo.custom_fields_labeled = labeledFields;
            }
            customerInfo.total_price = totalPrice;
            customerInfo.total_duration = totalDuration;
            // 第二・第三希望日時（multiple_datesモードのみ）
            if (this.state.selectedDate2) customerInfo.preferred_date2 = this.state.selectedDate2;
            if (this.state.selectedTime2) customerInfo.preferred_time2 = this.state.selectedTime2;
            if (this.state.selectedDate3) customerInfo.preferred_date3 = this.state.selectedDate3;
            if (this.state.selectedTime3) customerInfo.preferred_time3 = this.state.selectedTime3;
            
            // 日付をYYYY-MM-DD形式に変換
            const dateObj = new Date(this.state.selectedDate);
            const reservationDate = \`\${dateObj.getFullYear()}-\${String(dateObj.getMonth() + 1).padStart(2, '0')}-\${String(dateObj.getDate()).padStart(2, '0')}\`;
            
            // 流入経路を推定（Web予約フォームのみ）
            const sourceMedium = (function() {
              try {
                const ref = (document.referrer || '').toLowerCase();
                const ua = (navigator.userAgent || '').toLowerCase();
                if (ua.includes('line/') || ref.includes('liff.line.me')) return 'line';
                if (ua.includes('instagram') || ref.includes('instagram.com')) return 'instagram';
                if (ua.includes('fbav') || ua.includes('fban') || ref.includes('facebook.com') || ref.includes('l.facebook.com')) return 'facebook';
                if (ua.includes('twitter') || ref.includes('t.co') || ref.includes('x.com')) return 'x_twitter';
                if (ref.includes('google.') && ref.includes('/maps')) return 'google_maps';
                if (ref.includes('google.')) return 'google_search';
                if (ref.includes('yahoo.')) return 'yahoo_search';
                return 'direct';
              } catch(e) { return 'direct'; }
            })();

            // APIに送信するデータを構築（合計金額・時間を構造化データに含める）
            const reservationData = {
                form_id: FORM_ID,
                store_id: STORE_ID,
                customer_name: this.state.name,
                customer_phone: this.state.phone,
                customer_email: this.state.lineEmail || null,
                selected_menus: selectedMenus,
                selected_options: selectedOptions,
                total_price: totalPrice,
                total_duration: totalDuration,
                reservation_date: reservationDate,
                reservation_time: this.state.selectedTime,
                reservation_date2: this.state.selectedDate2 || null,
                reservation_time2: this.state.selectedTime2 || null,
                reservation_date3: this.state.selectedDate3 || null,
                reservation_time3: this.state.selectedTime3 || null,
                customer_info: customerInfo,
                line_user_id: this.state.lineUserId || null, // LINEユーザーID
                line_display_name: this.state.lineDisplayName || null, // LINE表示名
                line_picture_url: this.state.linePictureUrl || null, // LINEプロフィール画像URL
                line_status_message: this.state.lineStatusMessage || null, // LINEステータスメッセージ
                line_language: this.state.lineLanguage || null, // LINE言語設定
                line_os: this.state.lineOs || null, // デバイスOS
                line_friend_flag: this.state.lineFriendFlag || false, // 友だち追加状態
                source_medium: sourceMedium,
                booking_mode: this.config.calendar_settings?.booking_mode || 'calendar'
            };
            
            // /api/reservationsにPOSTリクエストを送信
            let apiSuccess = false;
            let blockReason = null;
            try {
                const apiUrl = window.location.origin + '/api/reservations';
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(reservationData)
                });

                if (response.ok) {
                    apiSuccess = true;
                    console.log('予約データをデータベースに保存しました');
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    if (response.status === 409 && errorData && errorData.code === 'concurrent_reservation_limit') {
                        blockReason = errorData.error || '既に予約があります。予約が過ぎるまで新しい予約はできません。';
                    }
                    console.error('予約データの保存に失敗しました:', errorData);
                    // 409 (concurrent_reservation_limit) 以外は LINE メッセージ送信を継続（既存挙動）
                }
            } catch (apiError) {
                console.error('API送信エラー:', apiError);
                // API送信失敗でもLINEメッセージは送信する（既存の動作を維持）
            }

            // 同時予約数上限に達していた場合: 画面にエラーを表示し、成功画面・LIFF 送信をスキップ
            if (blockReason) {
                const formContent = document.querySelector('.form-content');
                if (formContent) {
                    const banner = document.createElement('div');
                    banner.className = 'concurrent-reservation-error';
                    banner.style.cssText = 'background:#fee;border:1px solid #f99;color:#c00;padding:1rem;margin-bottom:1rem;border-radius:0.375rem;font-size:0.875rem;line-height:1.6;';
                    banner.textContent = blockReason;
                    formContent.insertBefore(banner, formContent.firstChild);
                    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                resetSubmitState();
                return;
            }
            
            // 日時を日本語形式に変換（LINEメッセージ用）
            const formattedDate = \`\${dateObj.getFullYear()}年\${String(dateObj.getMonth() + 1).padStart(2, '0')}月\${String(dateObj.getDate()).padStart(2, '0')}日 \${this.state.selectedTime}\`;
            const formatDateStr = (dateStr, timeStr) => {
                if (!dateStr || !timeStr) return null;
                const d = new Date(dateStr);
                return \`\${d.getFullYear()}年\${String(d.getMonth() + 1).padStart(2, '0')}月\${String(d.getDate()).padStart(2, '0')}日 \${timeStr}\`;
            };
            const formattedDate2 = formatDateStr(this.state.selectedDate2, this.state.selectedTime2);
            const formattedDate3 = formatDateStr(this.state.selectedDate3, this.state.selectedTime3);
            
            // メッセージ本文を構築（《ラベル》\\n値 形式）
            const formName = this.config.basic_info?.form_name || '予約フォーム';
            let messageText = '【' + formName + '】\\n';

            // 常に表示：お名前、電話番号
            messageText += \`《お名前》\\n\${this.state.name || ''}\\n\`;
            messageText += \`《電話番号》\\n\${this.state.phone || ''}\\n\`;

            // ご来店回数（有効時のみ表示）
            if (this.config.visit_count_selection?.enabled && this.state.visitCount) {
                const visitLabel = this.config.visit_count_selection.options.find(o => o.value === this.state.visitCount)?.label;
                const visitCountText = visitLabel || this.state.visitCount || '';
                messageText += \`《ご来店回数》\\n\${visitCountText}\\n\`;
            }

            // メニュー（希望日時式はカテゴリーごとに改行表示）
            const bookingModeForMenu = this.config.calendar_settings?.booking_mode || 'calendar';
            if (bookingModeForMenu === 'multiple_dates' && menuTextGrouped) {
                messageText += \`\\n《メニュー》\\n\${menuTextGrouped}\\n\`;
            } else {
                messageText += \`\\n《メニュー》\\n\${menuTextForMessage || ''}\\n\`;
            }
            if (totalPrice > 0 || totalDuration > 0) {
                if (totalPrice > 0) messageText += \`\\n《合計金額》\\n¥\${totalPrice.toLocaleString()}\\n\`;
                if (totalDuration > 0) messageText += \`\\n《合計時間》\\n\${totalDuration}分\\n\`;
            }

            // 希望日時
            const bookingModeForMsg = this.config.calendar_settings?.booking_mode || 'calendar';
            messageText += \`\\n【希望日時】\\n\`;
            if (bookingModeForMsg === 'multiple_dates') {
                messageText += \`《第一希望日》\\n\${formattedDate}\\n\`;
                if (formattedDate2) messageText += \`《第二希望日》\\n\${formattedDate2}\\n\`;
                if (formattedDate3) messageText += \`《第三希望日》\\n\${formattedDate3}\\n\`;
            } else {
                messageText += \`《希望日》\\n\${formattedDate}\\n\`;
            }

            // メッセージ
            messageText += \`\\n《メッセージ》\\n\${this.state.message || 'なし'}\`;

            // 性別（オプション）
            if (this.config.gender_selection?.enabled && this.state.gender) {
                const genderLabel = this.config.gender_selection.options.find(o => o.value === this.state.gender)?.label;
                if (genderLabel) {
                    messageText += \`\\n\\n《性別》\\n\${genderLabel}\`;
                }
            }

            // クーポン（オプション）
            if (this.config.coupon_selection?.enabled && this.state.coupon) {
                const couponLabel = this.config.coupon_selection.options.find(o => o.value === this.state.coupon)?.label;
                if (couponLabel) {
                    messageText += \`\\n\\n《クーポン》\\n\${couponLabel}\`;
                }
            }

            // カスタムフィールド
            if (this.config.custom_fields && this.config.custom_fields.length > 0) {
                this.config.custom_fields.forEach(field => {
                    const value = this.state.customFields?.[field.id];
                    if (value) {
                        messageText += \`\\n\\n《\${field.title}》\\n\${value}\`;
                    }
                });
            }

            // 予約完了後に選択内容をlocalStorageへ保存（前回と同じメニューで予約する機能用）
            try {
                const bookingKey = \`booking_\${this.config.basic_info?.form_name || this.config.id || 'default'}\`;
                // 単一選択モードの場合、selectedMenu/selectedSubmenuからselectedMenus形式に変換
                let menusToSave = this.state.selectedMenus || {};
                let subMenusToSave = this.state.selectedSubMenus || {};
                if ((!menusToSave || Object.keys(menusToSave).length === 0) && this.state.selectedMenu) {
                    // selectedMenuからcategoryIdを探す
                    const cats = this.config.menu_structure?.categories || [];
                    for (const cat of cats) {
                        const found = (cat.menus || []).find(m => m.id === this.state.selectedMenu.id);
                        if (found) {
                            menusToSave = { [cat.id]: [found.id] };
                            if (this.state.selectedSubmenu && this.state.selectedSubmenu.id) {
                                subMenusToSave = { [found.id]: this.state.selectedSubmenu.id };
                            }
                            break;
                        }
                    }
                }
                localStorage.setItem(bookingKey, JSON.stringify({
                    timestamp: Date.now(),
                    selectedMenus: menusToSave,
                    selectedSubMenus: subMenusToSave,
                    selectedMenuOptions: this.state.selectedOptions,
                    selectedCategoryOptions: this.state.selectedCategoryOptions,
                    gender: this.state.gender,
                    visitCount: this.state.visitCount,
                    couponUsage: this.state.coupon,
                    customerName: this.state.name,
                    customerPhone: this.state.phone
                }));
            } catch (e) {
                // プライベートモードなどでlocalStorageが使えない場合も継続
            }

            // 成功画面を表示
            document.querySelector('.form-content').innerHTML = \`
                <div class="success">
                    <h3>予約が完了しました！</h3>
                    <p>ご予約ありがとうございます。</p>
                </div>
            \`;
            
            // LIFF メッセージ送信（Web予約フォームやLIFF未初期化の場合はスキップ）
            try {
                if (this.state.lineUserId && typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) {
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
            } catch (liffError) {
                console.warn('LIFF message send skipped:', liffError);
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert('送信に失敗しました。もう一度お試しください。');
            resetSubmitState();
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
                daySelect.addEventListener('change', () => {
                    // 日付変更時に曜日に応じた時間スロットを再生成
                    this.populateTimeOptions(i, settings, daySelect.value);
                    this.updateDateTime(i);
                });
                timeSelect.addEventListener('change', () => this.updateDateTime(i));
            }
        }
    }

    getWeekdayHours(settings, dayOfWeek) {
        // weekday_hours がある場合はそちらを優先
        if (settings.weekday_hours && settings.weekday_hours[String(dayOfWeek)]) {
            const wh = settings.weekday_hours[String(dayOfWeek)];
            return { open: wh.open, close: wh.close, closed: wh.closed };
        }
        // レガシー互換: exclude_weekdays + start_time/end_time
        return {
            open: settings.start_time || '09:00',
            close: settings.end_time || '18:00',
            closed: (settings.exclude_weekdays || []).includes(dayOfWeek)
        };
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

            // 曜日別の定休日チェック
            const hours = this.getWeekdayHours(settings, date.getDay());
            if (hours.closed) {
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

    populateTimeOptions(index, settings, selectedDateStr) {
        const select = document.getElementById(\`date\${index}_time\`);
        if (!select) return;

        // 既存オプションをクリア
        select.innerHTML = '';

        // デフォルトオプション
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '時間を選択';
        select.appendChild(defaultOption);

        // 選択された日付の曜日に基づいて時間スロットを生成
        let startTime = settings.start_time || '09:00';
        let endTime = settings.end_time || '18:00';

        if (selectedDateStr) {
            const selectedDate = new Date(selectedDateStr + 'T00:00:00');
            const dayOfWeek = selectedDate.getDay();
            const hours = this.getWeekdayHours(settings, dayOfWeek);
            startTime = hours.open;
            endTime = hours.close;
        }

        // 時間スロット生成
        const timeSlots = this.generateTimeSlots(startTime, endTime, settings.time_interval);

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
            if (index === 1) { this.state.selectedDate = daySelect.value; this.state.selectedTime = timeSelect.value; }
            if (index === 2) { this.state.selectedDate2 = daySelect.value; this.state.selectedTime2 = timeSelect.value; }
            if (index === 3) { this.state.selectedDate3 = daySelect.value; this.state.selectedTime3 = timeSelect.value; }
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
            const hasSel = this.config.menu_structure?.allow_cross_category_selection 
                ? (this.state.selectedMenus && Object.values(this.state.selectedMenus).flat().length > 0)
                : (this.state.selectedMenu || this.state.selectedSubmenu);
            fields.forEach(fieldId => {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.style.display = hasSel ? 'block' : 'none';
                }
            });
        } else {
            const hasSel = this.config.menu_structure?.allow_cross_category_selection 
                ? (this.state.selectedMenus && Object.values(this.state.selectedMenus).flat().length > 0)
                : (this.state.selectedMenu || this.state.selectedSubmenu);
            const datetimeField = document.getElementById('datetime-field');
            if (datetimeField) {
                if (hasSel) {
                    datetimeField.style.display = 'block';
                    // 空き状況を取得してからカレンダーをレンダリング
                    this.fetchAvailability(this.state.currentWeekStart).then(() => {
                    this.renderCalendar();
                    }).catch(() => {
                        // エラー時もカレンダーをレンダリング（営業時間のみで判定）
                        this.renderCalendar();
                    });
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

  private renderCustomFields(config: FormConfig): string {
    const fields = config.custom_fields || [];
    if (fields.length === 0) return '';
    return fields.map(field => {
      const label = `${this.escapeHtml(field.title)}${field.required ? ' <span class="required">*</span>' : ''}`;
      const id = `custom-field-${field.id}`;
      if (field.type === 'text') {
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label" for="${id}">${label}</label>
                <input type="text" id="${id}" class="input" data-field-id="${field.id}" placeholder="${this.escapeHtml(field.placeholder || '')}">
            </div>`;
      }
      if (field.type === 'textarea') {
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label" for="${id}">${label}</label>
                <textarea id="${id}" class="input" data-field-id="${field.id}" rows="4" placeholder="${this.escapeHtml(field.placeholder || '')}"></textarea>
            </div>`;
      }
      if (field.type === 'radio' && field.options?.length) {
        const optionsHtml = field.options.map(opt =>
          `<label class="choice-label"><input type="radio" name="${id}" value="${this.escapeHtml(opt.value)}" data-field-id="${field.id}"> ${this.escapeHtml(opt.label)}</label>`
        ).join('');
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label">${label}</label>
                <div class="button-group custom-field-radios">${optionsHtml}</div>
            </div>`;
      }
      if (field.type === 'checkbox' && field.options?.length) {
        const optionsHtml = field.options.map(opt =>
          `<label class="choice-label"><input type="checkbox" value="${this.escapeHtml(opt.value)}" data-field-id="${field.id}" data-field-type="checkbox"> ${this.escapeHtml(opt.label)}</label>`
        ).join('');
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label">${label}</label>
                <div class="custom-field-checkboxes">${optionsHtml}</div>
            </div>`;
      }
      return '';
    }).filter(Boolean).join('\n            ');
  }

  private renderMenuField(config: FormConfig): string {
    if (!config.menu_structure.categories.length) return '';
    const themeColor = config.basic_info.theme_color || '#3B82F6';
    const multiCat = config.menu_structure.categories.length > 1;
    const firstCatId = config.menu_structure.categories[0]?.id || '';

    const renderMenuButton = (menu: import('@/types/form').MenuItem, categoryId: string) => `
                                <div>
                                    <button type="button" class="menu-item" data-menu-id="${menu.id}" data-category-id="${categoryId}">
                                        ${menu.image ? `
                                            <div class="menu-item-image">
                                                <img src="${menu.image}" alt="${this.escapeHtml(menu.name)}" class="menu-image" loading="lazy" onerror="this.parentElement.style.display='none'">
                                            </div>
                                        ` : ''}
                                        <div class="menu-item-content">
                                            <div class="menu-item-name">${this.escapeHtml(menu.name)}${menu.has_submenu ? ' ▶' : ''}</div>
                                            ${menu.description ? `<div class="menu-item-desc">${this.escapeHtml(menu.description)}</div>` : ''}
                                        </div>
                                        ${!menu.has_submenu && (menu.price !== undefined || menu.duration) ? `
                                            <div class="menu-item-info">
                                                ${(menu.price || 0) > 0 && !menu.hide_price ? `<div class="menu-item-price">¥${(menu.price || 0).toLocaleString()}</div>` : ''}
                                                ${menu.duration && !menu.hide_duration ? `<div class="menu-item-duration">${menu.duration}分</div>` : ''}
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
                                                        ${!option.hide_price ? `<div style="font-weight:500;font-size:0.875rem;">${option.price > 0 ? `+¥${option.price.toLocaleString()}` : '無料'}</div>` : ''}
                                                        ${option.duration > 0 && !option.hide_duration ? `<div style="font-size:0.75rem;opacity:0.7;">+${option.duration}分</div>` : ''}
                                                    </div>
                                                </button>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>`;

    const renderCategoryOptions = (category: import('@/types/form').MenuCategory) => {
      if (!category.options || category.options.length === 0) return '';
      return `
                            <div class="category-options-section" style="margin-top:1rem;padding-top:1rem;border-top:1px solid #e5e7eb;">
                                <div style="font-size:0.875rem;font-weight:600;color:#374151;margin-bottom:0.75rem;">オプション</div>
                                <div class="category-options-list">
                                    ${category.options.map((opt, idx) => `
                                        <button type="button" class="category-option-item" data-category-id="${category.id}" data-option-id="${opt.id || `catopt-${idx}`}" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;border:2px solid #d1d5db;border-radius:0.375rem;background:white;cursor:pointer;margin-bottom:0.5rem;transition:all 0.15s;text-align:left;">
                                            <div>
                                                <div style="font-size:0.875rem;font-weight:500;">${this.escapeHtml(opt.name)}</div>
                                                ${opt.description ? `<div style="font-size:0.75rem;opacity:0.7;margin-top:0.125rem;">${this.escapeHtml(opt.description)}</div>` : ''}
                                            </div>
                                            <div style="text-align:right;margin-left:0.5rem;">
                                                ${(opt.price || 0) > 0 && !opt.hide_price ? `<div style="font-weight:500;font-size:0.875rem;">+¥${(opt.price || 0).toLocaleString()}</div>` : ''}
                                                ${(opt.duration || 0) > 0 && !opt.hide_duration ? `<div style="font-size:0.75rem;opacity:0.7;">+${opt.duration}分</div>` : ''}
                                            </div>
                                        </button>
                                    `).join('')}
                                </div>
                            </div>`;
    };

    return `
            <!-- メニュー選択 -->
            <div class="field" id="menu-field">
                <label class="field-label">メニューをお選びください</label>
                ${config.menu_structure.categories.map((category, idx) => `
                    ${multiCat ? `
                    <button type="button" class="category-header${idx === 0 ? ' open' : ''}" data-category-id="${category.id}" onclick="window.bookingForm.toggleCategory('${category.id}')">
                        <span class="category-header-name">${this.escapeHtml(category.display_name || category.name)}</span>
                        <span class="category-header-chevron"></span>
                    </button>
                    ` : ''}
                    <div id="category-section-${category.id}" class="category-section" style="${multiCat && idx > 0 ? 'display:none;' : ''}">
                        <div class="menu-list">
                            ${category.menus.map(menu => renderMenuButton(menu, category.id)).join('')}
                        </div>
                        ${renderCategoryOptions(category)}
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
                    <div class="month-button-container" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:0.5rem;">
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
                    <div class="week-button-container" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:0.5rem;">
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
                <textarea id="customer-message" class="input" rows="4" placeholder="ご要望などがあればご記入ください"></textarea>
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

        .notice-banner {
            background-color: #fff0f0;
            border: 1px solid #fecaca;
            border-radius: 0.5rem;
            padding: 0.75rem 1rem;
            font-size: 0.875rem;
            color: #991b1b;
            line-height: 1.5;
            margin-bottom: 1.25rem;
            white-space: pre-wrap;
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
        
        .category-header {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.75rem 1rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            background: #f9fafb;
            cursor: pointer;
            margin-bottom: 0;
            font-size: 0.9375rem;
            font-weight: 600;
            color: #374151;
            transition: all 0.15s;
        }
        .category-header:hover {
            background: #f3f4f6;
        }
        .category-header + .category-section {
            border: 1px solid #e5e7eb;
            border-top: none;
            border-radius: 0 0 0.5rem 0.5rem;
            padding: 0.75rem;
            margin-bottom: 0.75rem;
        }
        .category-header.open {
            border-radius: 0.5rem 0.5rem 0 0;
            margin-bottom: 0;
        }
        .category-header-chevron {
            display: inline-block;
            width: 0.5rem;
            height: 0.5rem;
            border-right: 2px solid #6b7280;
            border-bottom: 2px solid #6b7280;
            transform: rotate(45deg);
            transition: transform 0.2s;
        }
        .category-header.open .category-header-chevron {
            transform: rotate(-135deg);
        }

        .menu-list {
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            padding: 1rem;
        }
        .category-header + .category-section .menu-list {
            border: none;
            padding: 0.25rem 0;
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
            position: relative;
            width: 100%;
            padding-top: 56.25%; /* 16:9 aspect ratio - cross-browser */
            margin: 0;
            border-radius: 0;
            overflow: hidden;
            flex-shrink: 0;
        }

        .menu-image {
            position: absolute;
            top: 0;
            left: 0;
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
            font-weight: 400;
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
        
        .current-month-container {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .month-button-container {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .week-button-container {
            display: flex;
            align-items: center;
            justify-content: space-between;
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
            border: 1px solid #9ca3af;
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
            font-size: 0.7rem;
            line-height: 1.3;
            word-break: keep-all;
            white-space: normal;
            min-width: 0;
            padding: 0.4rem 0.3rem;
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
                width: 100%;
                padding-top: 45%;
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

            #calendar-table th:not(:first-child) {
                font-size: 0.55rem;
                line-height: 1.25;
                padding: 0.35rem 0.1rem;
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
                line-height: 1.2 !important;
            }

            #calendar-table th:not(:first-child) {
                font-size: 0.45rem !important;
                line-height: 1.25 !important;
                padding: 0.25rem 0.05rem !important;
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
            font-weight: 400;
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
