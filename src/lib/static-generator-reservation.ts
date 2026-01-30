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

    // config の後方互換性/必須フィールドを正規化
    this.normalizeConfig(safeConfig);

    // フォームタイプを判定（後方互換性のため）
    const formType = safeConfig.form_type || 
      (safeConfig.basic_info.liff_id ? 'line' : 'web');
    const isLineForm = formType === 'line';

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(safeConfig.basic_info.form_name)}</title>
    ${isLineForm ? '<script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>' : ''}
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
            ${safeConfig.custom_fields && safeConfig.custom_fields.length > 0 ? this.renderCustomFields(safeConfig) : ''}
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
            selectedMenu: null, // 後方互換性のため保持
            selectedMenus: {}, // カテゴリーIDをキーとしたメニューID配列（複数選択対応）
            selectedSubmenu: null,
            selectedSubMenus: {}, // メニューIDをキーとしたサブメニューID（複数選択対応）
            selectedOptions: {}, // メニューIDをキーとしたオプションID配列
            customFields: {}, // カスタムフィールドの値
            selectedDate: '',
            selectedTime: '',
            message: ''
        };
        this.currentDate = new Date();
        this.availabilityCache = {}; // カレンダー空き状況のキャッシュ
        this.availabilityData = null; // 現在の空き状況データ
        this.businessDays = []; // 営業日の情報
        this.init();
    }

    // ---------------------------
    // Helpers (duplication cleanup)
    // ---------------------------
    clearSelectedButtons(selector) {
        document.querySelectorAll(selector).forEach(b => b.classList.remove('selected'));
    }

    bindSingleSelectButtons({ selector, stateKey }) {
        document.querySelectorAll(selector).forEach(btn => {
            btn.addEventListener('click', () => {
                this.clearSelectedButtons(selector);
                btn.classList.add('selected');
                this.state[stateKey] = btn.dataset.value;
                this.updateSummary();
            });
        });
    }

    applySingleSelectValue({ selector, stateKey, value }) {
        if (!value) return;
        this.state[stateKey] = value;
        const btn = document.querySelector(selector + '[data-value="' + value + '"]');
        if (btn) {
            this.clearSelectedButtons(selector);
            btn.classList.add('selected');
        }
    }

    getSelectedOptionObjects(menu, optionIds) {
        if (!menu || !menu.options || !optionIds || optionIds.length === 0) return [];
        return optionIds.map(optionId => menu.options.find(o => o.id === optionId)).filter(Boolean);
    }

    formatOptionSummaryLine(option) {
        const price = Number(option?.price || 0);
        const duration = Number(option?.duration || 0);
        return '<div style="font-size:0.75rem;color:#6b7280;margin-left:0.5rem;">+ '
            + option.name
            + (price > 0 ? ' (+¥' + price.toLocaleString() + ')' : '')
            + (duration > 0 ? ' (+' + duration + '分)' : '')
            + '</div>';
    }

    fetchAndRenderCalendar() {
        // 空き状況を取得してからカレンダーをレンダリング（失敗時も営業時間のみで判定して描画）
        return this.fetchAvailability(this.state.currentWeekStart).then(() => {
            this.renderCalendar();
        }).catch(() => {
            this.renderCalendar();
        });
    }

    formatCustomFieldValue(field, value) {
        if (value === undefined || value === null) return '';
        if (Array.isArray(value)) {
            const labels = value.map(v => {
                const opt = field?.options?.find(o => o.value === v);
                return (opt && opt.label) ? opt.label : String(v);
            }).filter(Boolean);
            return labels.join(', ');
        }
        const str = String(value);
        if (field?.type === 'radio' && field?.options) {
            const opt = field.options.find(o => o.value === str);
            return (opt && opt.label) ? opt.label : str;
        }
        return str;
    }

    getAllSelectedMenuIds() {
        const ids = [];
        const map = this.state.selectedMenus || {};
        Object.keys(map).forEach(catId => {
            const menuIds = map[catId] || [];
            menuIds.forEach(menuId => {
                if (menuId && !ids.includes(menuId)) ids.push(menuId);
            });
        });
        if (ids.length === 0 && this.state.selectedMenu && this.state.selectedMenu.id) {
            ids.push(this.state.selectedMenu.id);
        }
        return ids;
    }

    findMenuAny(menuId) {
        if (!menuId) return { menu: null, category: null };
        for (const category of (this.config.menu_structure?.categories || [])) {
            const menu = (category.menus || []).find(m => m.id === menuId);
            if (menu) return { menu, category };
        }
        return { menu: null, category: null };
    }

    getSubMenu(menu, subMenuId) {
        if (!menu || !menu.sub_menu_items || !subMenuId) return null;
        const direct = menu.sub_menu_items.find(sm => sm.id === subMenuId);
        if (direct) return direct;
        // idがないサブメニュー対策（indexベースのIDも許容）
        const idxMatch = menu.sub_menu_items.find((sm, idx) => {
            const fallbackId = sm.id || ('submenu-' + idx);
            return fallbackId === subMenuId;
        });
        return idxMatch || null;
    }

    buildSelectedMenuPayload() {
        const result = [];
        const allMenuIds = this.getAllSelectedMenuIds();
        allMenuIds.forEach(menuId => {
            const found = this.findMenuAny(menuId);
            const menu = found.menu;
            const category = found.category;
            if (!menu) return;

            const subMenuId = (this.state.selectedSubMenus && this.state.selectedSubMenus[menuId]) ? this.state.selectedSubMenus[menuId] : null;
            const subMenu = this.getSubMenu(menu, subMenuId);

            const menuData = {
                menu_id: menu.id,
                menu_name: menu.name || '',
                category_name: (category && category.name) ? category.name : '',
                price: menu.price || 0,
                duration: menu.duration || 0
            };

            if (subMenu) {
                menuData.submenu_id = subMenu.id || subMenuId;
                menuData.submenu_name = subMenu.name || '';
                if (subMenu.price) menuData.price = subMenu.price;
                if (subMenu.duration) menuData.duration = subMenu.duration;
            }

            result.push(menuData);
        });
        return result;
    }

    buildSelectedOptionsPayload() {
        const selectedOptions = [];
        const allMenuIds = this.getAllSelectedMenuIds();
        allMenuIds.forEach(menuId => {
            const found = this.findMenuAny(menuId);
            const menu = found.menu;
            if (!menu) return;
            const optionIds = (this.state.selectedOptions && this.state.selectedOptions[menuId]) ? this.state.selectedOptions[menuId] : [];
            const optionObjs = this.getSelectedOptionObjects(menu, optionIds);
            optionObjs.forEach(option => {
                selectedOptions.push({
                    option_id: option.id,
                    option_name: option.name || '',
                    menu_id: menuId
                });
            });
        });
        return selectedOptions;
    }

    buildMenuTextForMessage() {
        const parts = [];
        const allMenuIds = this.getAllSelectedMenuIds();
        allMenuIds.forEach(menuId => {
            const found = this.findMenuAny(menuId);
            const menu = found.menu;
            const category = found.category;
            if (!menu) return;

            const segs = [];
            if (category && category.name) segs.push(category.name);
            if (menu.name) segs.push(menu.name);

            const subMenuId = (this.state.selectedSubMenus && this.state.selectedSubMenus[menuId]) ? this.state.selectedSubMenus[menuId] : null;
            const subMenu = this.getSubMenu(menu, subMenuId);
            if (subMenu && subMenu.name) segs.push(subMenu.name);

            let line = segs.join(' > ');

            const optionIds = (this.state.selectedOptions && this.state.selectedOptions[menuId]) ? this.state.selectedOptions[menuId] : [];
            const optionNames = this.getSelectedOptionObjects(menu, optionIds).map(o => o?.name || '').filter(Boolean);
            if (optionNames.length > 0) {
                line += (line ? ', ' : '') + optionNames.join(', ');
            }

            if (line) parts.push(line);
        });
        return parts.join(' / ');
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
        
        // LIFF SDKが読み込まれていない場合はスキップ
        if (typeof liff === 'undefined') {
            console.warn('LIFF SDK is not loaded');
            return;
        }
        
        try {
            await liff.init({ liffId });
            if (liff.isLoggedIn()) {
                const profile = await liff.getProfile();
                this.state.name = profile.displayName || '';
                const nameInput = document.getElementById('customer-name');
                if (nameInput) {
                    nameInput.value = this.state.name;
                }
            }
        } catch (error) {
            console.warn('LIFF init failed:', error);
        }
    }
    
    attachEventListeners() {
        // 名前・電話番号
        const nameInput = document.getElementById('customer-name');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                this.state.name = e.target.value;
                this.updateSummary();
            });
        }
        
        const phoneInput = document.getElementById('customer-phone');
        if (phoneInput) {
            phoneInput.addEventListener('input', (e) => {
                this.state.phone = e.target.value;
                this.updateSummary();
            });
        }
        
        // 性別/来店回数/クーポン（単一選択ボタン）
        this.bindSingleSelectButtons({ selector: '.gender-button', stateKey: 'gender' });
        this.bindSingleSelectButtons({ selector: '.visit-count-button', stateKey: 'visitCount' });
        this.bindSingleSelectButtons({ selector: '.coupon-button', stateKey: 'coupon' });
        
        // カスタムフィールド
        // テキスト入力
        document.querySelectorAll('input[type="text"].input, textarea.input').forEach(input => {
            if (input.id && input.id.startsWith('custom-field-')) {
                input.addEventListener('input', (e) => {
                    const fieldId = input.id.replace('custom-field-', '');
                    this.state.customFields[fieldId] = e.target.value;
                });
            }
        });
        
        // ラジオボタン
        document.querySelectorAll('.custom-field-radio-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const fieldId = btn.dataset.fieldId;
                const value = btn.dataset.value;
                // 同じフィールドの他のボタンの選択を解除
                document.querySelectorAll(\`.custom-field-radio-button[data-field-id="\${fieldId}"]\`).forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.state.customFields[fieldId] = value;
                const hiddenInput = document.getElementById(\`custom-field-\${fieldId}\`);
                if (hiddenInput) {
                    hiddenInput.value = value;
                }
                this.updateSummary();
            });
        });
        
        // チェックボックス
        document.querySelectorAll('.custom-field-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const fieldId = checkbox.dataset.fieldId;
                const value = checkbox.dataset.value;
                const checked = e.target.checked;
                
                if (!this.state.customFields[fieldId]) {
                    this.state.customFields[fieldId] = [];
                }
                const currentValues = this.state.customFields[fieldId];
                
                if (checked) {
                    if (!currentValues.includes(value)) {
                        currentValues.push(value);
                    }
                } else {
                    const index = currentValues.indexOf(value);
                    if (index > -1) {
                        currentValues.splice(index, 1);
                    }
                }
                this.state.customFields[fieldId] = currentValues;
                this.updateSummary();
            });
        });
        
        // メニュー選択
        const menuItems = document.querySelectorAll('.menu-item');
        if (menuItems.length === 0) {
            console.warn('[StaticForm] No menu items found');
        }
        menuItems.forEach(item => {
            item.addEventListener('click', async (e) => {
                try {
                    // オプションボタンからのイベント伝播を防ぐ
                    if (e.target.closest('.menu-option-item')) {
                        return;
                    }
                    
                    const menuId = item.dataset.menuId;
                    const categoryId = item.dataset.categoryId;
                    
                    if (!menuId || !categoryId) {
                        console.error('[StaticForm] Missing menuId or categoryId', { menuId, categoryId });
                        return;
                    }
                    
                    const menu = this.findMenu(categoryId, menuId);
                    
                    if (!menu) {
                        console.error('[StaticForm] Menu not found', { categoryId, menuId });
                        return;
                    }
                    
                    // カテゴリーまたいでの複数選択が有効かチェック
                    const allowCrossCategory = this.config.menu_structure?.allow_cross_category_selection || false;
                    const category = this.config.menu_structure.categories.find(c => c.id === categoryId);
                    const isMultiple = allowCrossCategory || (category?.selection_mode === 'multiple');
                    
                    if (isMultiple) {
                        // 複数選択モード
                        if (allowCrossCategory) {
                            // カテゴリーまたいでの複数選択
                            const allSelectedMenuIds = Object.values(this.state.selectedMenus).flat();
                            const isSelected = allSelectedMenuIds.includes(menuId);
                            
                            if (isSelected) {
                                // 選択解除
                                Object.keys(this.state.selectedMenus).forEach(catId => {
                                    this.state.selectedMenus[catId] = (this.state.selectedMenus[catId] || []).filter(id => id !== menuId);
                                    if (this.state.selectedMenus[catId].length === 0) {
                                        delete this.state.selectedMenus[catId];
                                    }
                                });
                                item.classList.remove('selected', 'has-submenu');
                                this.state.selectedSubMenus[menuId] = null;
                                this.state.selectedOptions[menuId] = [];
                                
                                // オプションコンテナを非表示
                                const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                                if (optionsContainer) {
                                    optionsContainer.style.display = 'none';
                                }
                                this.hideSubmenu();
                            } else {
                                // 選択追加
                                if (!this.state.selectedMenus[categoryId]) {
                                    this.state.selectedMenus[categoryId] = [];
                                }
                                this.state.selectedMenus[categoryId].push(menuId);
                                
                                if (menu.has_submenu) {
                                    item.classList.add('selected', 'has-submenu');
                                    this.state.selectedMenu = menu;
                                    this.showSubmenu(categoryId, menuId);
                                } else {
                                    item.classList.add('selected');
                                    this.state.selectedMenu = menu;
                                    
                                    // オプションコンテナを表示
                                    const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                                    if (optionsContainer) {
                                        optionsContainer.style.display = 'block';
                                    }
                                }
                            }
                        } else {
                            // カテゴリー内での複数選択
                            const categoryMenus = this.state.selectedMenus[categoryId] || [];
                            const isSelected = categoryMenus.includes(menuId);
                            
                            if (isSelected) {
                                // 選択解除
                                this.state.selectedMenus[categoryId] = categoryMenus.filter(id => id !== menuId);
                                if (this.state.selectedMenus[categoryId].length === 0) {
                                    delete this.state.selectedMenus[categoryId];
                                }
                                item.classList.remove('selected', 'has-submenu');
                                this.state.selectedSubMenus[menuId] = null;
                                this.state.selectedOptions[menuId] = [];
                                
                                // オプションコンテナを非表示
                                const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                                if (optionsContainer) {
                                    optionsContainer.style.display = 'none';
                                }
                                this.hideSubmenu();
                            } else {
                                // 選択追加
                                if (!this.state.selectedMenus[categoryId]) {
                                    this.state.selectedMenus[categoryId] = [];
                                }
                                this.state.selectedMenus[categoryId].push(menuId);
                                
                                if (menu.has_submenu) {
                                    item.classList.add('selected', 'has-submenu');
                                    this.state.selectedMenu = menu;
                                    this.showSubmenu(categoryId, menuId);
                                } else {
                                    item.classList.add('selected');
                                    this.state.selectedMenu = menu;
                                    
                                    // オプションコンテナを表示
                                    const optionsContainer = document.getElementById(\`options-\${menuId}\`);
                                    if (optionsContainer) {
                                        optionsContainer.style.display = 'block';
                                    }
                                }
                            }
                        }
                    } else {
                        // 単一選択モード（既存の動作）
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
                        this.state.selectedMenus = {};
                        this.state.selectedSubmenu = null;
                        this.state.selectedSubMenus = {};
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
                    }
                    
                    // カレンダーの表示/非表示を切り替え
                    await this.toggleCalendarVisibility();
                    this.updateSummary();
                } catch (error) {
                    console.error('[StaticForm] Error in menu selection:', error);
                }
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
        const submitButton = document.getElementById('submit-button');
        if (submitButton) {
            submitButton.addEventListener('click', () => {
                this.handleSubmit();
            });
        }
        
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
            sub.addEventListener('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt(sub.dataset.submenuIndex);
                document.querySelectorAll('.submenu-item').forEach(s => s.classList.remove('selected'));
                sub.classList.add('selected');
                this.state.selectedSubmenu = menu.sub_menu_items[idx];
                const selectedId = (this.state.selectedSubmenu && this.state.selectedSubmenu.id) ? this.state.selectedSubmenu.id : ('submenu-' + idx);
                if (!this.state.selectedSubMenus) this.state.selectedSubMenus = {};
                this.state.selectedSubMenus[menuId] = selectedId;
                // サブメニュー選択後にカレンダーを表示
                await this.toggleCalendarVisibility();
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
        console.log('[StaticForm] fetchCalendarAvailability called:', { 
            date: date.toISOString(),
            dateLocal: date.toLocaleString('ja-JP'),
            form_type: this.config.form_type,
            hasGasEndpoint: !!this.config.gas_endpoint,
            gasEndpoint: this.config.gas_endpoint,
            hasCalendarUrl: !!this.config.calendar_url,
            calendarUrl: this.config.calendar_url
        });
        
        const isLineForm = this.config.form_type === 'line' || 
            (this.config.basic_info.liff_id && this.config.basic_info.liff_id.length >= 10);
        
        // LINE予約フォームは gas_endpoint、Web予約フォームは calendar_url を使用
        const endpoint = isLineForm ? this.config.gas_endpoint : this.config.calendar_url;
        
        if (!endpoint) {
            console.log('[StaticForm] No availability endpoint, skipping availability fetch');
            return;
        }
        
        const startTime = new Date(date);
        startTime.setHours(0, 0, 0, 0);
        const endTime = new Date(date);
        endTime.setDate(endTime.getDate() + 7);
        endTime.setHours(23, 59, 59, 999);
        
        const cacheKey = startTime.toISOString() + endTime.toISOString();
        console.log('[StaticForm] Cache key:', cacheKey);
        console.log('[StaticForm] Time range:', {
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            startTimeLocal: startTime.toLocaleString('ja-JP'),
            endTimeLocal: endTime.toLocaleString('ja-JP')
        });
        
        // キャッシュを確認
        if (this.availabilityCache[cacheKey]) {
            console.log('[StaticForm] Using cached availability data:', {
                cacheKey,
                availabilityCount: this.availabilityCache[cacheKey].availability?.length || 0,
                businessDaysCount: this.availabilityCache[cacheKey].businessDays?.length || 0
            });
            this.availabilityData = this.availabilityCache[cacheKey].availability;
            this.businessDays = this.availabilityCache[cacheKey].businessDays;
            this.renderCalendar();
            return;
        }
        
        const url = endpoint + 
            \`?startTime=\${startTime.toISOString()}&endTime=\${endTime.toISOString()}\`;
        console.log('[StaticForm] Fetching from URL:', url);
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            const data = await response.json();
            console.log('[StaticForm] Availability data received:', {
                dataCount: data?.length || 0,
                data: data,
                sampleEvent: data?.[0]
            });
            
            // 営業日の情報を抽出
            const businessDays = data.filter(event => event.title === "営業日" || event.summary === "営業日").map(event => {
                return {
                    start: new Date(event.startTime),
                    end: new Date(event.endTime)
                };
            });
            console.log('[StaticForm] Business days extracted:', {
                businessDaysCount: businessDays.length,
                businessDays: businessDays.map(bd => ({
                    start: bd.start.toISOString(),
                    end: bd.end.toISOString(),
                    startLocal: bd.start.toLocaleString('ja-JP'),
                    endLocal: bd.end.toLocaleString('ja-JP')
                }))
            });
            
            // データをキャッシュに保存
            this.availabilityCache[cacheKey] = { availability: data, businessDays: businessDays };
            this.availabilityData = data;
            this.businessDays = businessDays;
            console.log('[StaticForm] Availability data set to state:', {
                availabilityDataCount: data?.length || 0,
                businessDaysCount: businessDays.length
            });
            
            // カレンダーを再レンダリング
            this.renderCalendar();
        } catch (error) {
            console.error('[StaticForm] Error fetching calendar availability:', error);
            
            // エラー時は空き状況データをnullにして、営業時間のみで判定
            this.availabilityData = null;
            this.businessDays = [];
            this.renderCalendar();
        }
    }
    
    // カレンダーをレンダリング
    async renderCalendar() {
        const table = document.getElementById('calendar-table');
        if (!table) return;
        
        console.log('[StaticForm] renderCalendar called');
        // フォームタイプを判定（Web/LINE）
        const isLineForm = this.config.form_type === 'line' || 
            (this.config.basic_info.liff_id && this.config.basic_info.liff_id.length >= 10);
        
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
        
        // メニュー時間とオプション時間を計算
        let menuDuration = 0;
        if (this.state.selectedSubmenu) {
            menuDuration = this.state.selectedSubmenu.duration || 0;
        } else if (this.state.selectedMenu) {
            menuDuration = this.state.selectedMenu.duration || 0;
        }
        
        // オプション時間を合計（サブメニューが選択されている場合でも、親メニューのオプションを使用）
        let optionsDuration = 0;
        if (this.state.selectedMenu) {
            const menuId = this.state.selectedMenu.id;
            const selectedOptionIds = this.state.selectedOptions[menuId] || [];
            selectedOptionIds.forEach(optionId => {
                const option = this.state.selectedMenu.options?.find(o => o.id === optionId);
                if (option && option.duration) {
                    optionsDuration += option.duration;
                }
            });
        }
        
        // 訪問回数の時間を取得
        let visitDuration = 0;
        if (this.state.visitCount && this.config.visit_count_selection?.enabled) {
            const visitOption = this.config.visit_count_selection.options.find(
                opt => opt.value === this.state.visitCount
            );
            if (visitOption?.duration) {
                visitDuration = visitOption.duration;
            }
        }
        
        // 終了時間を計算
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotStart.getMinutes() + menuDuration + optionsDuration + visitDuration);
        
        // 終了時間が翌日になる場合は不可
        let isNextDay = slotEnd.getDate() !== slotStart.getDate();
        
        // 18時以降に終了する予約を不可にする（17:30は可）
        let endsAfter18 = false;
        if (slotEnd.getHours() === 18 && slotEnd.getMinutes() > 0) {
            endsAfter18 = true;
        } else if (slotEnd.getHours() > 18) {
            endsAfter18 = true;
        }
        
        // 空き状況の判定
        let isAvailable = false;
        
        if (isPast || isNextDay || endsAfter18 || !withinWindow || isClosed || !isWithinBusinessHours) {
            isAvailable = false;
        } else if (this.availabilityData && this.availabilityData.length > 0) {
            // GASから取得したデータがある場合
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
            
            // 予約済みイベントの数をカウント
            const count = this.availabilityData.reduce((acc, slot) => {
                const eventStart = new Date(slot.startTime);
                const eventEnd = new Date(slot.endTime);
                if (eventStart < slotEnd && slotStart < eventEnd && slot.title !== "営業日" && slot.summary !== "営業日") {
                    return acc + 1;
                }
                return acc;
            }, 0);
            
            // 空き状況の判定ロジック
            if (isBusinessEventTime && count > 0) {
                // 営業日のイベント時間内に他のイベントがある場合
                isAvailable = false;
            } else if (isBusinessEventTime) {
                // 営業日のイベント時間（他のイベントがない場合）
                isAvailable = true;
            } else if (businessEventTimes.length > 0) {
                // 営業日で、指定されている時間以外の時間は×
                isAvailable = false;
            } else if (slotStart.getDay() === 0 && !isBusinessDay && businessEventTimes.length === 0) {
                // 日曜日で、営業日ではない場合
                isAvailable = false;
            } else if (isBusinessDay && count === 0) {
                // 営業日でかつ他のイベントがない場合
                isAvailable = true;
            } else if (count <= 0) {
                // それ以外の条件
                isAvailable = true;
            } else {
                isAvailable = false;
            }
        } else {
            // GASから取得したデータがない場合、営業時間のみで判定
            isAvailable = true;
        }
        
        // デバッグログ（最初の数回のみ）
        if (dateIndex === 0 && timeIndex === 0) {
            console.log('[StaticForm] Cell availability check:', {
                date: date.toISOString(),
                dateLocal: date.toLocaleString('ja-JP'),
                time,
                slotStartUTC: slotStart.toISOString(),
                slotStartLocal: slotStart.toLocaleString('ja-JP'),
                nowUTC: now.toISOString(),
                nowLocal: now.toLocaleString('ja-JP'),
                slotStartTime: slotStart.getTime(),
                nowTime: now.getTime(),
                timeDiff: slotStart.getTime() - now.getTime(),
                isPast,
                isNextDay,
                endsAfter18,
                withinWindow,
                isClosed,
                isWithinBusinessHours,
                isAvailable,
                availabilityDataCount: this.availabilityData?.length || 0,
                businessDaysCount: this.businessDays.length
            });
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
        console.log('[StaticForm] handleDateTimeSelect called:', { 
            dateStr, 
            time, 
            isAvailable,
            dateStrLocal: new Date(dateStr).toLocaleString('ja-JP'),
            timeLocal: time
        });
        
        if (!isAvailable) {
            console.log('[StaticForm] Cell click ignored (not available):', { dateStr, time });
            return;
        }
        
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
        console.log('[StaticForm] formData updated:', {
            selectedDate: this.state.selectedDate,
            selectedTime: this.state.selectedTime
        });
        this.updateSummary();
    }
    
    // 週移動
    navigateWeek(direction) {
        console.log('[StaticForm] navigateWeek called:', { 
            direction, 
            currentWeekStart: this.state.currentWeekStart.toISOString(),
            currentWeekStartLocal: this.state.currentWeekStart.toLocaleString('ja-JP')
        });
        const newWeekStart = new Date(this.state.currentWeekStart);
        newWeekStart.setDate(this.state.currentWeekStart.getDate() + (direction === 'next' ? 7 : -7));
        console.log('[StaticForm] navigateWeek result:', {
            newWeekStart: newWeekStart.toISOString(),
            newWeekStartLocal: newWeekStart.toLocaleString('ja-JP')
        });
        this.state.currentWeekStart = newWeekStart;
        this.fetchAndRenderCalendar();
    }
    
    // 月移動
    navigateMonth(direction) {
        console.log('[StaticForm] navigateMonth called:', { 
            direction, 
            currentWeekStart: this.state.currentWeekStart.toISOString(),
            currentWeekStartLocal: this.state.currentWeekStart.toLocaleString('ja-JP')
        });
        const newDate = new Date(this.state.currentWeekStart);
        newDate.setMonth(this.state.currentWeekStart.getMonth() + (direction === 'next' ? 1 : -1));
        this.state.currentWeekStart = this.getWeekStart(newDate);
        console.log('[StaticForm] navigateMonth result:', {
            nextWeekStart: this.state.currentWeekStart.toISOString(),
            nextWeekStartLocal: this.state.currentWeekStart.toLocaleString('ja-JP')
        });
        this.fetchAndRenderCalendar();
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
            
            // Previewページ形式（selectedMenus/selectedSubMenus）から復元
            if (selectionData.selectedMenus && Object.keys(selectionData.selectedMenus).length > 0) {
                // 最初に見つかったメニューを選択（静的HTMLは単一選択形式）
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
                        this.applySingleSelectValue({ selector: '.gender-button', stateKey: 'gender', value: selectionData.gender });
                        this.applySingleSelectValue({ selector: '.visit-count-button', stateKey: 'visitCount', value: selectionData.visitCount });
                        this.applySingleSelectValue({ selector: '.coupon-button', stateKey: 'coupon', value: selectionData.couponUsage });
                        
                        this.updateSummary();
                        this.toggleCalendarVisibility();
                
                // カレンダーセクションにスクロール
                setTimeout(() => {
                    const calendarField = document.getElementById('datetime-field');
                    if (calendarField) {
                        calendarField.style.display = 'block';
                        calendarField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                if (this.state.currentWeekStart) {
                                    this.fetchAndRenderCalendar();
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

        // カスタムフィールド（入力/選択内容を表示）
        if (this.config.custom_fields && this.config.custom_fields.length > 0) {
            this.config.custom_fields.forEach(field => {
                const value = this.state.customFields ? this.state.customFields[field.id] : undefined;
                const formatted = this.formatCustomFieldValue(field, value);
                if (formatted && String(formatted).trim() !== '') {
                    items.push(\`<div class="summary-item" style="align-items:flex-start;"><div><strong>\${field.title}:</strong><div style="margin-top:0.25rem;font-size:0.875rem;color:#6b7280;">\${formatted}</div></div><button class="summary-edit-button" data-field="custom-field-\${field.id}">修正</button></div>\`);
                }
            });
        }
        // 選択されたメニューを取得（複数選択対応）
        const hasSelectedMenus = Object.keys(this.state.selectedMenus).length > 0 || 
                                 this.state.selectedMenu || 
                                 this.state.selectedSubmenu ||
                                 Object.keys(this.state.selectedSubMenus).length > 0;
        
        if (hasSelectedMenus) {
            let menuText = '';
            let totalPrice = 0;
            let totalDuration = 0;
            
            // 複数選択モードの場合
            if (Object.keys(this.state.selectedMenus).length > 0) {
                const allSelectedMenuIds = Object.values(this.state.selectedMenus).flat();
                const menuItems = [];
                
                allSelectedMenuIds.forEach(menuId => {
                    // カテゴリーからメニューを検索
                    let foundMenu = null;
                    let foundCategory = null;
                    for (const category of this.config.menu_structure.categories) {
                        const menu = category.menus.find(m => m.id === menuId);
                        if (menu) {
                            foundMenu = menu;
                            foundCategory = category;
                            break;
                        }
                    }
                    
                    if (!foundMenu) return;
                    
                    // サブメニューが選択されているかチェック
                    const selectedSubMenuId = this.state.selectedSubMenus[menuId];
                    let subMenu = null;
                    if (selectedSubMenuId && foundMenu.sub_menu_items) {
                        subMenu = foundMenu.sub_menu_items.find(sm => sm.id === selectedSubMenuId);
                    }
                    
                    if (subMenu) {
                        totalPrice += subMenu.price || 0;
                        totalDuration += subMenu.duration || 0;
                        menuItems.push(\`
                            <div style="margin-bottom:0.5rem;">
                                <div style="font-size:0.875rem;color:#6b7280;">\${foundMenu.name} &gt;</div>
                                <div>\${subMenu.name}</div>
                                <div style="font-size:0.875rem;color:#6b7280;">¥\${subMenu.price.toLocaleString()} / \${subMenu.duration}分</div>
                            </div>
                        \`);
                    } else {
                        totalPrice += foundMenu.price || 0;
                        totalDuration += foundMenu.duration || 0;
                        menuItems.push(\`
                            <div style="margin-bottom:0.5rem;">
                                <div>\${foundMenu.name}</div>
                                \${foundMenu.price ? \`<div style="font-size:0.875rem;color:#6b7280;">¥\${foundMenu.price.toLocaleString()} / \${foundMenu.duration}分</div>\` : ''}
                            </div>
                        \`);
                    }
                    
                    // オプションを追加
                    if (this.state.selectedOptions[menuId] && this.state.selectedOptions[menuId].length > 0) {
                        const selectedOptionIds = this.state.selectedOptions[menuId];
                        const optionObjs = this.getSelectedOptionObjects(foundMenu, selectedOptionIds);
                        optionObjs.forEach(option => {
                            totalPrice += option.price || 0;
                            totalDuration += option.duration || 0;
                        });
                        const optionTexts = optionObjs.map(option => this.formatOptionSummaryLine(option)).join('');
                        menuItems[menuItems.length - 1] += optionTexts;
                    }
                });
                
                menuText = menuItems.join('');
            } else if (this.state.selectedSubmenu) {
                // 単一選択モード（サブメニュー）
                totalPrice = this.state.selectedSubmenu.price || 0;
                totalDuration = this.state.selectedSubmenu.duration || 0;
                menuText = \`
                    <div style="font-size:0.875rem;color:#6b7280;">\${this.state.selectedMenu.name} &gt;</div>
                    <div>\${this.state.selectedSubmenu.name}</div>
                    <div style="font-size:0.875rem;color:#6b7280;">¥\${this.state.selectedSubmenu.price.toLocaleString()} / \${this.state.selectedSubmenu.duration}分</div>
                \`;
                
                // オプションを追加
                const menuId = this.state.selectedMenu?.id;
                if (menuId && this.state.selectedOptions[menuId] && this.state.selectedOptions[menuId].length > 0) {
                    const menu = this.state.selectedMenu;
                    const selectedOptionIds = this.state.selectedOptions[menuId];
                    const optionObjs = this.getSelectedOptionObjects(menu, selectedOptionIds);
                    optionObjs.forEach(option => {
                        totalPrice += option.price || 0;
                        totalDuration += option.duration || 0;
                    });
                    const optionTexts = optionObjs.map(option => this.formatOptionSummaryLine(option)).join('');
                    menuText += optionTexts;
                }
            } else if (this.state.selectedMenu) {
                // 単一選択モード（通常メニュー）
                totalPrice = this.state.selectedMenu.price || 0;
                totalDuration = this.state.selectedMenu.duration || 0;
                menuText = \`
                    <div>\${this.state.selectedMenu.name}</div>
                    \${this.state.selectedMenu.price ? \`<div style="font-size:0.875rem;color:#6b7280;">¥\${this.state.selectedMenu.price.toLocaleString()} / \${this.state.selectedMenu.duration}分</div>\` : ''}
                \`;
                
                // オプションを追加
                const menuId = this.state.selectedMenu?.id;
                if (menuId && this.state.selectedOptions[menuId] && this.state.selectedOptions[menuId].length > 0) {
                    const menu = this.state.selectedMenu;
                    const selectedOptionIds = this.state.selectedOptions[menuId];
                    const optionObjs = this.getSelectedOptionObjects(menu, selectedOptionIds);
                    optionObjs.forEach(option => {
                        totalPrice += option.price || 0;
                        totalDuration += option.duration || 0;
                    });
                    const optionTexts = optionObjs.map(option => this.formatOptionSummaryLine(option)).join('');
                    menuText += optionTexts;
                }
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
        const hasSelectedMenus = Object.keys(this.state.selectedMenus || {}).length > 0 || !!this.state.selectedMenu || !!this.state.selectedSubmenu;
        if (!hasSelectedMenus) {
            alert('メニューを選択してください');
            return;
        }
        if (!this.state.selectedDate || !this.state.selectedTime) {
            alert('予約日時を選択してください');
            return;
        }
        
        // カスタムフィールドのバリデーション
        if (this.config.custom_fields) {
            for (const field of this.config.custom_fields) {
                if (field.required) {
                    const value = this.state.customFields[field.id];
                    if (!value || (Array.isArray(value) && value.length === 0) || (typeof value === 'string' && !value.trim())) {
                        alert(\`\${field.title}を入力してください\`);
                        return;
                    }
                }
            }
        }
        
        // フォームタイプを判定
        const isLineForm = this.config.form_type === 'line' || 
            (this.config.basic_info.liff_id && this.config.basic_info.liff_id.length >= 10);
        
        try {
            // メニュー/オプション情報（複数選択対応）
            const selectedMenus = this.buildSelectedMenuPayload();
            const selectedOptions = this.buildSelectedOptionsPayload();
            
            // 顧客属性情報を構築
            const customerInfo = {};
            if (this.config.gender_selection?.enabled && this.state.gender) {
                customerInfo.gender = this.state.gender;
            }
            if (this.config.visit_count_selection?.enabled && this.state.visitCount) {
                customerInfo.visit_count = this.state.visitCount;
            }
            if (this.config.coupon_selection?.enabled && this.state.coupon) {
                customerInfo.coupon = this.state.coupon;
            }
            // カスタムフィールドの値を追加
            if (this.config.custom_fields && Object.keys(this.state.customFields).length > 0) {
                customerInfo.custom_fields = this.state.customFields;
            }
            
            // 日付をYYYY-MM-DD形式に変換
            const dateObj = new Date(this.state.selectedDate);
            const reservationDate = \`\${dateObj.getFullYear()}-\${String(dateObj.getMonth() + 1).padStart(2, '0')}-\${String(dateObj.getDate()).padStart(2, '0')}\`;
            
            // APIに送信するデータを構築
            const reservationData = {
                form_id: FORM_ID,
                store_id: STORE_ID,
                customer_name: this.state.name,
                customer_phone: this.state.phone,
                customer_email: null, // メールアドレスフィールドがない場合はnull
                selected_menus: selectedMenus,
                selected_options: selectedOptions,
                reservation_date: reservationDate,
                reservation_time: this.state.selectedTime,
                customer_info: customerInfo
            };
            
            // /api/reservationsにPOSTリクエストを送信
            let apiSuccess = false;
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
                    console.error('予約データの保存に失敗しました:', errorData);
                    // API送信失敗でもLINEメッセージは送信する（既存の動作を維持）
                }
            } catch (apiError) {
                console.error('API送信エラー:', apiError);
                // API送信失敗でもLINEメッセージは送信する（既存の動作を維持）
            }
            
            // 日時を日本語形式に変換（LINEメッセージ用）
            const formattedDate = \`\${dateObj.getFullYear()}年\${String(dateObj.getMonth() + 1).padStart(2, '0')}月\${String(dateObj.getDate()).padStart(2, '0')}日 \${this.state.selectedTime}\`;
            
            // ISO形式の日時も生成（Web予約フォーム用）
            const startIso = \`\${dateObj.getFullYear()}-\${String(dateObj.getMonth() + 1).padStart(2, '0')}-\${String(dateObj.getDate()).padStart(2, '0')}T\${this.state.selectedTime}:00+09:00\`;
            
            // メニュー名を取得
            const menuText = this.buildMenuTextForMessage();
            const selectedMenuName = selectedMenus.map(m => (m.submenu_name || m.menu_name || '')).filter(Boolean).join(' / ');
            
            // 時間を計算（分単位）
            let durationMin = 0;
            selectedMenus.forEach(m => { durationMin += (m.duration || 0); });
            const allMenuIdsForDuration = this.getAllSelectedMenuIds();
            allMenuIdsForDuration.forEach(menuId => {
                const found = this.findMenuAny(menuId);
                const menu = found.menu;
                if (!menu) return;
                const optionIds = (this.state.selectedOptions && this.state.selectedOptions[menuId]) ? this.state.selectedOptions[menuId] : [];
                const optionObjs = this.getSelectedOptionObjects(menu, optionIds);
                optionObjs.forEach(option => {
                    if (option && option.duration) durationMin += option.duration;
                });
            });
            if (!durationMin || durationMin <= 0) durationMin = 60;
            
            if (isLineForm) {
                // LINE予約フォーム：LIFF経由でメッセージ送信
                let messageText = '【予約フォーム】\\n';
                messageText += \`お名前：\${this.state.name || ''}\\n\`;
                messageText += \`電話番号：\${this.state.phone || ''}\\n\`;
                
                let visitCountText = '';
                if (this.config.visit_count_selection?.enabled && this.state.visitCount) {
                    const visitLabel = this.config.visit_count_selection.options.find(o => o.value === this.state.visitCount)?.label;
                    visitCountText = visitLabel || this.state.visitCount || '';
                }
                messageText += \`ご来店回数：\${visitCountText}\\n\`;
                messageText += \`メニュー：\${menuText}\\n\`;
                messageText += \`希望日時：\\n \${formattedDate}\\n\`;
            messageText += \`メッセージ：\${this.state.message || ''}\`;

            // カスタムフィールド（任意/必須の追加質問）
            if (this.config.custom_fields && this.config.custom_fields.length > 0) {
                this.config.custom_fields.forEach(field => {
                    const value = this.state.customFields ? this.state.customFields[field.id] : undefined;
                    const formatted = this.formatCustomFieldValue(field, value);
                    if (formatted && String(formatted).trim() !== '') {
                        messageText += \`\\n\${field.title}：\${formatted}\`;
                    }
                });
            }
            
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
                    alert('当日キャンセルは無いようにお願いいたします。');
                    liff.closeWindow();
                }).catch((err) => {
                    console.error('メッセージの送信に失敗しました', err);
                        alert('送信に失敗しました。もう一度お試しください。');
                    });
                } else {
                    alert('LINEにログインしてください。');
                }
            } else {
                // Web予約フォーム：GASエンドポイントに直接送信
                if (!this.config.gas_endpoint) {
                    alert('GASエンドポイントが設定されていません');
                    return;
                }
                
                // 冪等性キー生成
                function genRequestId() {
                    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
                    const rnd = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(-4);
                    return \`\${rnd()}\${rnd()}-\${rnd()}-\${rnd()}-\${rnd()}-\${rnd()}\${rnd()}\${rnd()}\`;
                }
                
                const payload = {
                    name: this.state.name,
                    phone: this.state.phone,
                    visitCount: this.state.visitCount || '',
                    selectedMenu: selectedMenuName,
                    selectedSymptom: menuText ? [menuText] : null,
                    optiCount: '',
                    dates: [formattedDate],
                    message: this.state.message || '',
                    startIso: startIso,
                    durationMin: durationMin,
                    secret: this.config.security_secret || '',
                    requestId: genRequestId(),
                    referrer: document.referrer || '',
                    userAgent: navigator.userAgent || ''
                };
                
                // 送信中の表示
                const submitButton = document.getElementById('submit-button');
                if (submitButton) {
                    submitButton.disabled = true;
                    submitButton.textContent = '送信中...';
                }
                
                const res = await fetch(this.config.gas_endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                });
                
                const text = await res.text();
                let json = null;
                try { json = JSON.parse(text); } catch(_) {}
                
                if (!res.ok || !json || !json.ok) {
                    const msg = (json && json.error) ? json.error
                        : (res.status === 302 || text.includes('ServiceLogin')) ? '認証が必要なURL（/dev等）です'
                        : \`HTTP \${res.status}\`;
                    throw new Error(msg);
                }
                
                // 成功画面を表示
                document.querySelector('.form-content').innerHTML = \`
                    <div class="success">
                        <h3>予約が完了しました！</h3>
                        <p>ご予約ありがとうございます。</p>
                    </div>
                \`;
            }
        } catch (error) {
            console.error('Submit error:', error);
            alert(error.message || '送信に失敗しました。もう一度お試しください。');
            const submitButton = document.getElementById('submit-button');
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = '予約する';
            }
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
        
        // 選択されたメニューがあるかチェック（複数選択対応）
        const hasSelectedMenu = this.state.selectedMenu || 
                               Object.keys(this.state.selectedMenus).length > 0 ||
                               this.state.selectedSubmenu ||
                               Object.keys(this.state.selectedSubMenus).length > 0;
        
        if (bookingMode === 'multiple_dates') {
            // 第三希望日時モード
            const fields = ['datetime-field-1', 'datetime-field-2', 'datetime-field-3'];
            fields.forEach(fieldId => {
                const field = document.getElementById(fieldId);
                if (field) {
                    field.style.display = hasSelectedMenu ? 'block' : 'none';
                }
            });
        } else {
            // カレンダーモード（既存ロジック）
            const datetimeField = document.getElementById('datetime-field');
            if (datetimeField) {
                if (hasSelectedMenu) {
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
    // DOMContentLoadedが既に発火している場合、即座に実行
    window.bookingForm = new BookingForm(FORM_CONFIG);
}
    </script>
</body>
</html>`;
    
    return html;
  }

  private normalizeConfig(safeConfig: FormConfig): void {
    // 必須フィールドの初期化
    if (!safeConfig.basic_info) {
      safeConfig.basic_info = {
        form_name: 'フォーム',
        store_name: '',
        liff_id: undefined,
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
  }

  private renderChoiceField(params: {
    comment: string;
    fieldId: string;
    labelHtml: string;
    requiredMarkHtml?: string;
    options?: Array<{ value: string; label: string }>;
    buttonClass: string;
  }): string {
    const requiredMark = params.requiredMarkHtml ?? '';
    return `
            <!-- ${params.comment} -->
            <div class="field" id="${params.fieldId}">
                <label class="field-label">${params.labelHtml}${requiredMark}</label>
                <div class="button-group">
                    ${params.options?.map(opt => 
                        `<button type="button" class="choice-button ${params.buttonClass}" data-value="${opt.value}">${opt.label}</button>`
                    ).join('') || ''}
                </div>
            </div>`;
  }

  private renderGenderField(config: FormConfig): string {
    if (!config.gender_selection) return '';
    const genderSel = config.gender_selection;
    return this.renderChoiceField({
      comment: '性別選択',
      fieldId: 'gender-field',
      labelHtml: '性別',
      requiredMarkHtml: ` ${genderSel.required ? '<span class="required">*</span>' : ''}`,
      options: genderSel.options,
      buttonClass: 'gender-button'
    });
  }

  private renderVisitCountField(config: FormConfig): string {
    if (!config.visit_count_selection) return '';
    const visitSel = config.visit_count_selection;
    return this.renderChoiceField({
      comment: '来店回数選択',
      fieldId: 'visit-count-field',
      labelHtml: 'ご来店回数',
      requiredMarkHtml: ` ${visitSel.required ? '<span class="required">*</span>' : ''}`,
      options: visitSel.options,
      buttonClass: 'visit-count-button'
    });
  }

  private renderCustomFields(config: FormConfig): string {
    if (!config.custom_fields || config.custom_fields.length === 0) {
      return '';
    }
    
    return config.custom_fields.map(field => {
      let fieldHTML = '';
      const fieldId = `custom-field-${field.id}`;
      
      if (field.type === 'text') {
        fieldHTML = `
            <div class="field mb-6">
                <div class="mb-4">
                    <label for="${fieldId}" class="field-label">
                        ${field.title} ${field.required ? '<span class="required">*</span>' : ''}
                    </label>
                    <input type="text" id="${fieldId}" class="input custom-field-input" data-field-id="${field.id}" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}>
                </div>
            </div>
        `;
      } else if (field.type === 'textarea') {
        fieldHTML = `
            <div class="field mb-6">
                <div class="mb-4">
                    <label for="${fieldId}" class="field-label">
                        ${field.title} ${field.required ? '<span class="required">*</span>' : ''}
                    </label>
                    <textarea id="${fieldId}" class="input custom-field-input" data-field-id="${field.id}" rows="4" placeholder="${field.placeholder || ''}" ${field.required ? 'required' : ''}></textarea>
                </div>
            </div>
        `;
      } else if (field.type === 'radio' && field.options) {
        const optionsHTML = field.options.map((opt, idx) => `
            <button type="button" class="choice-button custom-field-radio-button" data-value="${opt.value}" data-field-id="${field.id}">
                ${opt.label}
            </button>
        `).join('');
        fieldHTML = `
            <div class="field mb-6">
                <div class="mb-4">
                    <label class="field-label">
                        ${field.title} ${field.required ? '<span class="required">*</span>' : ''}
                    </label>
                    <div class="button-group">
                        ${optionsHTML}
                    </div>
                    <input type="hidden" id="${fieldId}" class="custom-field-hidden" data-field-id="${field.id}" ${field.required ? 'required' : ''}>
                </div>
            </div>
        `;
      } else if (field.type === 'checkbox' && field.options) {
        const optionsHTML = field.options.map((opt, idx) => `
            <label class="custom-field-checkbox-label" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem; cursor: pointer; transition: background-color 0.15s;">
                <input type="checkbox" class="custom-field-checkbox" data-value="${opt.value}" data-field-id="${field.id}" style="width: 1rem; height: 1rem; cursor: pointer;">
                <span style="font-size: 0.875rem; color: #374151;">${this.escapeHtml(opt.label)}</span>
            </label>
        `).join('');
        fieldHTML = `
            <div class="field mb-6">
                <div class="mb-4">
                    <label class="field-label">
                        ${field.title} ${field.required ? '<span class="required">*</span>' : ''}
                    </label>
                    <div class="space-y-2">
                        ${optionsHTML}
                    </div>
                </div>
            </div>
        `;
      }
      
      return fieldHTML;
    }).join('');
  }

  private renderCouponField(config: FormConfig): string {
    if (!config.coupon_selection) return '';
    const couponSel = config.coupon_selection;
    const couponName = couponSel.coupon_name ? `${couponSel.coupon_name}クーポン利用有無` : 'クーポン利用有無';
    return this.renderChoiceField({
      comment: 'クーポン選択',
      fieldId: 'coupon-field',
      labelHtml: couponName,
      options: couponSel.options,
      buttonClass: 'coupon-button'
    });
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
        
        .space-y-2 > * + * {
            margin-top: 0.5rem;
        }
        
        .custom-field-checkbox-label:hover {
            background-color: #f9fafb;
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
                /* モバイルでもPCと同様にカード内で画像を自然に表示 */
                width: 100%;
                aspect-ratio: 16 / 9;
                margin-right: 0;
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
