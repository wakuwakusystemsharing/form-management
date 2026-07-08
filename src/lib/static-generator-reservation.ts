/**
 * 静的HTMLジェネレータ v2
 * プレビュー画面と完全一致するHTMLを生成
 */

import { computeAccentColor, hexToRgb } from './color-utils';
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
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Poppins:wght@400;600;800&display=swap" rel="stylesheet">
    <script src="https://static.line-scdn.net/liff/edge/2.1/sdk.js"></script>
    <style>${this.generateCSS(safeConfig)}
${this.generateDesignOverridesCSS(safeConfig)}</style>
</head>
<body>
    ${safeConfig.ui_settings?.show_side_nav === false ? '' : `
    <!-- 右側の追従ナビ -->
    <div class="side-nav" id="sideNav">
        <a href="#submit-button">
            <span>⇩</span>
            <i class="fas fa-comment"></i>
        </a>
    </div>
    `}
    <div id="treatment-text"></div>

    <div class="form-container">
        <div class="form-header">
            <h1>${this.escapeHtml(safeConfig.basic_info.form_name)}</h1>
            <p>${this.escapeHtml(safeConfig.basic_info.store_name || 'ご予約フォーム')}</p>
        </div>

        <div class="form-content">
            ${safeConfig.basic_info?.notice ? `<div class="notice-banner">${this.escapeHtml(safeConfig.basic_info.notice)}</div>` : ''}
            ${this.renderNoticeButtons(safeConfig)}

            ${safeConfig.ui_settings?.show_repeat_booking ? this.renderRepeatBookingButton(safeConfig) : ''}
            
            ${this.renderContentBlocksAt(safeConfig, 'name', 'above')}
            ${safeConfig.calendar_settings?.show_customer_name === false ? '' : `
            <!-- お客様名 -->
            <div class="field" id="name-field">
                <label class="field-label">お名前 <span class="required">*</span></label>
                <input type="text" id="customer-name" class="input" placeholder="山田太郎">
            </div>
            `}
            ${this.renderContentBlocksAt(safeConfig, 'name', 'below')}
            ${this.renderContentBlocksAt(safeConfig, 'phone', 'above')}
            ${safeConfig.calendar_settings?.show_customer_phone === false ? '' : `
            <!-- 電話番号 -->
            <div class="field" id="phone-field">
                <label class="field-label">電話番号 <span class="required">*</span></label>
                <input type="tel" id="customer-phone" class="input" placeholder="090-1234-5678">
            </div>
            `}
            ${this.renderContentBlocksAt(safeConfig, 'phone', 'below')}
            ${this.renderContentBlocksAt(safeConfig, 'email', 'above')}
            ${(safeConfig.calendar_settings?.show_customer_email === true || safeConfig.form_type === 'web') ? `
            <!-- メールアドレス（Web 予約フォームでは必須、それ以外は show_customer_email に従う） -->
            <div class="field" id="email-field">
                <label class="field-label">メールアドレス <span class="required">*</span></label>
                <input type="email" id="customer-email" class="input" placeholder="example@domain.com" autocomplete="email" inputmode="email">
                <p style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;">予約確認メールをお送りします</p>
            </div>
            <div class="field" id="email-confirm-field">
                <label class="field-label">メールアドレス（確認） <span class="required">*</span></label>
                <input type="email" id="customer-email-confirm" class="input" placeholder="もう一度入力してください" autocomplete="off" inputmode="email">
                <p id="email-mismatch-hint" style="font-size:0.75rem;color:#dc2626;margin-top:0.25rem;display:none;">メールアドレスが一致しません</p>
            </div>
            ` : ''}
            ${this.renderContentBlocksAt(safeConfig, 'email', 'below')}

            ${this.renderContentBlocksAt(safeConfig, 'staff', 'above')}
            ${this.renderStaffField(safeConfig)}
            ${this.renderContentBlocksAt(safeConfig, 'staff', 'below')}
            ${safeConfig.gender_selection.enabled ? this.renderGenderField(safeConfig) : ''}
            ${safeConfig.visit_count_selection.enabled ? this.renderVisitCountField(safeConfig) : ''}
            ${safeConfig.coupon_selection.enabled ? this.renderCouponField(safeConfig) : ''}
            ${safeConfig.custom_fields?.length ? this.renderCustomFields(safeConfig) : ''}
            ${this.renderContentBlocksAt(safeConfig, 'menu', 'above')}
            ${this.renderMenuField(safeConfig)}
            ${this.renderContentBlocksAt(safeConfig, 'menu', 'below')}
            ${this.renderContentBlocksAt(safeConfig, 'datetime', 'above')}
            ${this.renderDateTimeFields(safeConfig)}
            ${this.renderContentBlocksAt(safeConfig, 'datetime', 'below')}
            ${this.renderContentBlocksAt(safeConfig, 'message', 'above')}
            ${this.renderMessageField()}
            ${this.renderContentBlocksAt(safeConfig, 'message', 'below')}
            ${this.renderContentBlocksAt(safeConfig, 'summary', 'above')}
            ${this.renderSummary()}
            ${this.renderContentBlocksAt(safeConfig, 'summary', 'below')}
            ${this.renderAgreementField(safeConfig)}

            ${this.renderContentBlocksAt(safeConfig, 'submit', 'above')}
            <button type="button" id="submit-button" class="submit-button">予約する</button>
            ${this.renderContentBlocksAt(safeConfig, 'submit', 'below')}
        </div>
    </div>
    
    <script>
const FORM_CONFIG = ${JSON.stringify(safeConfig, null, 2)};
const FORM_ID = ${JSON.stringify(formId)};
const STORE_ID = ${JSON.stringify(storeId)};

// ========== 祝日判定ロジック（1980-2099年対応）==========
function calcVernalEquinox(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function calcAutumnalEquinox(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}
function nthWeekday(year, month, n, dayOfWeek) {
    const first = new Date(year, month - 1, 1);
    const offset = (dayOfWeek - first.getDay() + 7) % 7;
    return 1 + offset + (n - 1) * 7;
}
// 当日が「主祝日」かどうかを判定し type id を返す（祝日でなければ null）
function getHolidayType(date) {
    const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
    if (m === 1 && d === 1) return 'new_year';
    if (m === 1 && d === nthWeekday(y, 1, 2, 1)) return 'coming_of_age';
    if (m === 2 && d === 11) return 'national_foundation';
    if (m === 2 && d === 23) return 'emperor_birthday';
    if (m === 3 && d === calcVernalEquinox(y)) return 'vernal_equinox';
    if (m === 4 && d === 29) return 'showa';
    if (m === 5 && d === 3) return 'constitution';
    if (m === 5 && d === 4) return 'greenery';
    if (m === 5 && d === 5) return 'childrens';
    if (m === 7 && d === nthWeekday(y, 7, 3, 1)) return 'marine';
    if (m === 8 && d === 11) return 'mountain';
    if (m === 9 && d === nthWeekday(y, 9, 3, 1)) return 'respect_for_aged';
    if (m === 9 && d === calcAutumnalEquinox(y)) return 'autumnal_equinox';
    if (m === 10 && d === nthWeekday(y, 10, 2, 1)) return 'sports';
    if (m === 11 && d === 3) return 'culture';
    if (m === 11 && d === 23) return 'labor_thanksgiving';
    return null;
}
// 振替休日: 当日は祝日ではないが、前を遡って最初の日曜が主祝日であれば true
// 当日と最初の日曜の間が「日曜でなく祝日でもない」と途中で false（連続でないとダメ）
function isSubstituteHoliday(date) {
    if (getHolidayType(date)) return false;
    const cur = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let safety = 0;
    while (safety++ < 10) {
        cur.setDate(cur.getDate() - 1);
        if (cur.getDay() === 0) {
            return !!getHolidayType(cur);
        }
        if (!getHolidayType(cur)) return false;
    }
    return false;
}
// 国民の休日: 当日が祝日でも日曜でもなく、前後とも「主祝日 or 振替」
function isNationalDay(date) {
    if (getHolidayType(date)) return false;
    if (date.getDay() === 0) return false;
    const yesterday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const yIsHoliday = !!getHolidayType(yesterday) || isSubstituteHoliday(yesterday);
    const tIsHoliday = !!getHolidayType(tomorrow) || isSubstituteHoliday(tomorrow);
    return yIsHoliday && tIsHoliday;
}
function getEffectiveHolidayType(date) {
    const t = getHolidayType(date);
    if (t) return t;
    if (isSubstituteHoliday(date)) return 'substitute';
    if (isNationalDay(date)) return 'national_day';
    return null;
}
function formatDateTimeForDisplay(value) {
    // "2026-04-30T15:08[:00]" → "2026年04月30日 15:08"
    // "2026-04-30"            → "2026年04月30日"
    if (!value || typeof value !== 'string') return value;
    const dt = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (dt) return dt[1] + '年' + dt[2] + '月' + dt[3] + '日 ' + dt[4] + ':' + dt[5];
    const date = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (date) return date[1] + '年' + date[2] + '月' + date[3] + '日';
    return value;
}
// ローカル時刻ベースで YYYY-MM-DD を生成（toISOString は UTC 変換で日付が前日にズレるため使わない）
function formatLocalYmd(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}
function shouldBlockAsHoliday(date) {
    if (!FORM_CONFIG.calendar_settings || !FORM_CONFIG.calendar_settings.holidays_as_closed) return false;
    const type = getEffectiveHolidayType(date);
    if (!type) return false;
    const excluded = FORM_CONFIG.calendar_settings.excluded_holiday_types || [];
    return !excluded.includes(type);
}
// ========== 祝日判定ロジックここまで ==========

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
            agreementAccepted: false, // 同意事項の「同意する」ボタンの状態
            selectedStaffId: '', // 選択中のスタッフID（'none' = 指名なし、'' = 未選択）
            lineUserId: null, // LINEユーザーID
            lineDisplayName: null, // LINE表示名
            linePictureUrl: null, // LINEプロフィール画像URL
            lineStatusMessage: null, // LINEステータスメッセージ
            lineEmail: null, // LINEメールアドレス
            lineLanguage: null, // LINE言語設定
            lineOs: null, // デバイスOS
            lineFriendFlag: null // 友だち追加状態 (true/false/null=不明)
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

            // 日時欄の初期表示制御（hide_datetime_until_menu_selected 対応）。
            // カレンダーモードは表示時に空き状況を取得 → renderCalendar。
            setTimeout(() => this.toggleCalendarVisibility(), 0);

            await this.initializeLIFF();

            // localStorageから名前・電話番号・メールアドレスを復元
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
                    // localStorage に保存された名前は LIFF の displayName よりも優先する
                    // （ユーザーが意図的に入力し直した名前を再表示時に復元するため）
                    if (data.customerName) {
                        this.state.name = data.customerName;
                        const nameEl = document.getElementById('customer-name');
                        if (nameEl) nameEl.value = data.customerName;
                    }
                    if (data.customerEmail) {
                        this.state.email = data.customerEmail;
                        // 確認欄も state を埋めないとバリデーションで不一致扱いになる
                        // （DOM の .value だけ書いても input イベントは発火しない）
                        this.state.emailConfirm = data.customerEmail;
                        this.state.emailMismatch = false;
                        const emailEl = document.getElementById('customer-email');
                        const emailConfirmEl = document.getElementById('customer-email-confirm');
                        if (emailEl) emailEl.value = data.customerEmail;
                        if (emailConfirmEl) emailConfirmEl.value = data.customerEmail;
                    }
                    // カスタムフィールドの復元（復元機能ONの項目のみ）
                    if (data.customFields) {
                        this.restoreCustomFields(data.customFields);
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
                // お名前欄には LINE の displayName を自動入力しない
                // （ユーザーが入力したテキストを localStorage から復元する方式。
                //   lineDisplayName は名前欄非表示時のフォールバック用に保持のみ）

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
                // 失敗時は false にせず null のまま（サーバ側で「不明」として扱い、既存値を上書きしない）。
                // LIFF チャネルのスコープ不足や API 一時失敗で false 上書きされるのを防ぐため。
                try {
                    const friendship = await liff.getFriendship();
                    this.state.lineFriendFlag = friendship.friendFlag;
                } catch (friendError) {
                    console.warn('友だち追加状態の取得に失敗しました:', friendError);
                    this.state.lineFriendFlag = null;
                }
            }
        } catch (error) {
            console.warn('LIFF init failed:', error);
        }
    }
    
    // お名前欄の入力値を localStorage に即時保存（未送信でも次回開いたときに復元される）
    persistCustomerName(value) {
        try {
            const formId = this.config.basic_info?.form_name || this.config.id || 'default';
            const key = \`booking_\${formId}\`;
            const saved = localStorage.getItem(key);
            const data = saved ? JSON.parse(saved) : {};
            data.customerName = value;
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            // プライベートモードなどで localStorage が使えない場合も継続
        }
    }

    // localStorage に保存されたカスタムフィールド値を復元（復元機能ONの項目のみ）
    restoreCustomFields(savedCustomFields) {
        if (!savedCustomFields || !this.config.custom_fields) return;
        this.config.custom_fields.forEach((field) => {
            if (field.restore_enabled !== true) return;
            const val = savedCustomFields[field.id];
            if (val === undefined || val === null || val === '') return;
            if (field.type === 'radio') {
                document.querySelectorAll('input[name="custom-field-' + field.id + '"]').forEach((radio) => {
                    if (radio.value === val) {
                        radio.checked = true;
                        this.state.customFields[field.id] = val;
                        const lbl = radio.closest ? radio.closest('.choice-label') : null;
                        if (lbl) lbl.classList.add('selected');
                    }
                });
            } else if (field.type === 'checkbox') {
                if (Array.isArray(val) && val.length > 0) {
                    const wanted = new Set(val);
                    const checkedVals = [];
                    document.querySelectorAll('input[data-field-id="' + field.id + '"][data-field-type="checkbox"]').forEach((cb) => {
                        if (wanted.has(cb.value)) {
                            cb.checked = true;
                            checkedVals.push(cb.value);
                            const lbl = cb.closest ? cb.closest('.choice-label') : null;
                            if (lbl) lbl.classList.add('selected');
                        }
                    });
                    if (checkedVals.length > 0) this.state.customFields[field.id] = checkedVals;
                }
            } else if (typeof val === 'string') {
                const el = document.getElementById('custom-field-' + field.id);
                if (el) {
                    el.value = val;
                    // select や date は値が選択肢/形式に合わないと反映されないため、反映確認後に state 更新
                    if (el.value === val) this.state.customFields[field.id] = val;
                }
            }
        });
        this.updateSummary();
    }

    // 復元機能ONのカスタムフィールドの入力値を localStorage に即時保存
    // （この端末のブラウザ内にのみ保存され、他のユーザーに共有されることはない）
    persistCustomField(field, value) {
        if (!field || field.restore_enabled !== true) return;
        try {
            const formId = this.config.basic_info?.form_name || this.config.id || 'default';
            const key = \`booking_\${formId}\`;
            const saved = localStorage.getItem(key);
            const data = saved ? JSON.parse(saved) : {};
            if (!data.customFields) data.customFields = {};
            data.customFields[field.id] = value;
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) {
            // プライベートモードなどで localStorage が使えない場合も継続
        }
    }

    attachEventListeners() {
        // 名前・電話番号（非表示設定時は要素が存在しないのでガード）
        const nameInput = document.getElementById('customer-name');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                this.state.name = e.target.value;
                this.persistCustomerName(e.target.value);
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

        // メールアドレス（show_customer_email === true のときのみ要素が存在）
        const emailInput = document.getElementById('customer-email');
        const emailConfirmInput = document.getElementById('customer-email-confirm');
        const emailMismatchHint = document.getElementById('email-mismatch-hint');
        const checkEmailMatch = () => {
            const a = (emailInput && emailInput.value || '').trim();
            const b = (emailConfirmInput && emailConfirmInput.value || '').trim();
            const mismatch = !!a && !!b && a !== b;
            if (emailMismatchHint) emailMismatchHint.style.display = mismatch ? 'block' : 'none';
            this.state.emailMismatch = mismatch;
        };
        if (emailInput) {
            emailInput.addEventListener('input', (e) => {
                this.state.email = e.target.value;
                checkEmailMatch();
                this.updateSummary();
            });
        }
        if (emailConfirmInput) {
            emailConfirmInput.addEventListener('input', (e) => {
                this.state.emailConfirm = e.target.value;
                checkEmailMatch();
            });
        }

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

        // スタッフ選択（単一選択。再タップで解除。スタッフによって空き状況が変わるためカレンダーを再取得）
        document.querySelectorAll('.staff-button').forEach(btn => {
            btn.addEventListener('click', () => {
                const staffId = btn.dataset.staffId;
                const wasSelected = this.state.selectedStaffId === staffId;
                document.querySelectorAll('.staff-button').forEach(b => b.classList.remove('selected'));
                if (wasSelected) {
                    this.state.selectedStaffId = '';
                } else {
                    this.state.selectedStaffId = staffId;
                    btn.classList.add('selected');
                }
                // スタッフごとのメニュー/オプション表示を適用（非表示対象の選択は解除される）
                this.applyStaffMenuVisibility();
                if (this.isStaffCalendarMode()) {
                    this.toggleCalendarVisibility();
                }
                this.updateSummary();
            });
        });
        
        // カスタムフィールド
        if (this.config.custom_fields && this.config.custom_fields.length > 0) {
            const self = this;
            this.config.custom_fields.forEach(function(field) {
                const el = document.getElementById('custom-field-' + field.id);
                if (el && (field.type === 'text' || field.type === 'textarea' || field.type === 'date' || field.type === 'datetime')) {
                    el.addEventListener('input', function() {
                        self.state.customFields[field.id] = el.value;
                        self.persistCustomField(field, el.value);
                        self.updateSummary();
                    });
                }
                if (el && field.type === 'select') {
                    el.addEventListener('change', function() {
                        self.state.customFields[field.id] = el.value;
                        self.persistCustomField(field, el.value);
                        self.updateSummary();
                    });
                }
                if (field.type === 'radio') {
                    document.querySelectorAll('input[name="custom-field-' + field.id + '"]').forEach(function(radio) {
                        radio.addEventListener('change', function() {
                            // ボタンデザインの選択状態をラベルに反映
                            document.querySelectorAll('input[name="custom-field-' + field.id + '"]').forEach(function(r) {
                                const lbl = r.closest('.choice-label');
                                if (lbl) lbl.classList.toggle('selected', r.checked);
                            });
                            if (radio.checked) {
                                self.state.customFields[field.id] = radio.value;
                                self.persistCustomField(field, radio.value);
                                self.updateSummary();
                            }
                        });
                    });
                }
                if (field.type === 'checkbox') {
                    document.querySelectorAll('input[data-field-id="' + field.id + '"][data-field-type="checkbox"]').forEach(function(cb) {
                        cb.addEventListener('change', function() {
                            // ボタンデザインの選択状態をラベルに反映
                            const lbl = cb.closest('.choice-label');
                            if (lbl) lbl.classList.toggle('selected', cb.checked);
                            const checked = Array.from(document.querySelectorAll('input[data-field-id="' + field.id + '"][data-field-type="checkbox"]:checked')).map(function(c) { return c.value; });
                            self.state.customFields[field.id] = checked;
                            self.persistCustomField(field, checked);
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
                
                // 選択されたメニューの詳細ポップアップ（説明/画像がある場合のみ）
                const nowSelected = allowCross
                    ? ((this.state.selectedMenus[categoryId] || []).includes(menuId))
                    : (this.state.selectedMenu && this.state.selectedMenu.id === menuId);
                if (nowSelected) this.showDetailPopup(item, menu); else this.closeDetailPopup();

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
                    item.style.color = '#1b2a4e';
                } else {
                    // 選択
                    this.state.selectedOptions[menuId] = [...currentOptions, optionId];
                    item.style.borderColor = 'var(--primary-color)';
                    item.style.backgroundColor = 'var(--primary-color)';
                    item.style.color = '#ffffff';
                }

                // 選択したオプションの詳細ポップアップ
                const popupCat = this.config.menu_structure.categories.find(c => (c.menus || []).some(m => m.id === menuId));
                const popupMenu = popupCat ? popupCat.menus.find(m => m.id === menuId) : null;
                const popupOpt = popupMenu && popupMenu.options ? popupMenu.options.find(o => o.id === optionId) : null;
                if (!isSelected) {
                    if (popupOpt) this.showDetailPopup(item, popupOpt); else this.closeDetailPopup();
                } else {
                    this.closeDetailPopup();
                }
                // 対応時間設定のあるオプションはカレンダーの〇×に影響するため再描画
                if (popupOpt && popupOpt.time_window_enabled === true) {
                    this.toggleCalendarVisibility();
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
                    item.style.color = '#1b2a4e';
                } else {
                    this.state.selectedCategoryOptions[categoryId] = [...current, optionId];
                    item.style.borderColor = 'var(--primary-color)';
                    item.style.backgroundColor = 'var(--primary-color)';
                    item.style.color = '#ffffff';
                }
                // 選択したオプションの詳細ポップアップ
                const popupCat = this.config.menu_structure.categories.find(c => c.id === categoryId);
                const popupOpt = popupCat && popupCat.options ? popupCat.options.find(o => o.id === optionId) : null;
                if (!isSelected) {
                    if (popupOpt) this.showDetailPopup(item, popupOpt); else this.closeDetailPopup();
                } else {
                    this.closeDetailPopup();
                }
                // 対応時間設定のあるオプションはカレンダーの〇×に影響するため再描画
                if (popupOpt && popupOpt.time_window_enabled === true) {
                    this.toggleCalendarVisibility();
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
        
        // 同意事項の「同意する」ボタン（タップで同意 ⇔ 解除）
        const agreementButton = document.getElementById('agreement-button');
        if (agreementButton) {
            agreementButton.addEventListener('click', () => {
                this.state.agreementAccepted = !this.state.agreementAccepted;
                if (this.state.agreementAccepted) {
                    agreementButton.classList.add('selected');
                    agreementButton.textContent = '✓ 同意しました';
                } else {
                    agreementButton.classList.remove('selected');
                    agreementButton.textContent = '同意する';
                }
            });
        }

        // カレンダー内部を少しスクロールしたらスクロールヒントを消す
        const calScrollWrapper = document.querySelector('.calendar-table-wrapper');
        if (calScrollWrapper) {
            calScrollWrapper.addEventListener('scroll', () => {
                if (calScrollWrapper.scrollTop > 30 && !this.state.calendarScrollHintDismissed) {
                    this.state.calendarScrollHintDismissed = true;
                    const hint = document.getElementById('calendar-scroll-hint');
                    if (hint) hint.style.display = 'none';
                }
            });
        }

        // 日付/日時入力: 値の有無でヒント表示を切り替え
        document.querySelectorAll('input[type="date"], input[type="datetime-local"]').forEach((el) => {
            const syncDateHint = () => el.classList.toggle('has-value', !!el.value);
            el.addEventListener('change', syncDateHint);
            el.addEventListener('input', syncDateHint);
            syncDateHint();
        });

        // 送信
        document.getElementById('submit-button').addEventListener('click', () => {
            this.handleSubmit();
        });

        // 詳細ポップアップ: 外側タップで閉じる（選択ボタン自身のタップは各処理側で制御）
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('treatment-text');
            if (!popup || popup.style.display !== 'block') return;
            if (popup.contains(e.target)) return;
            if (e.target.closest && (e.target.closest('.menu-item') || e.target.closest('.menu-option-item') || e.target.closest('.category-option-item') || e.target.closest('.submenu-item'))) return;
            popup.style.display = 'none';
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
    
    // メニュー/オプションの詳細ポップアップ（説明文または画像がある場合のみ表示）
    escapeHtmlText(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    showDetailPopup(button, item) {
        const popup = document.getElementById('treatment-text');
        if (!popup || !item) return;
        const desc = (item.description || '').trim();
        const image = item.image || item.image_url || '';
        if (!desc && !image) { this.closeDetailPopup(); return; }
        const parts = [];
        parts.push('<div class="t-title-row"><i class="fas fa-star t-icon"></i><span class="t-title">' + this.escapeHtmlText(item.name || '') + '</span></div>');
        if (image) parts.push('<div class="t-image"><img src="' + this.escapeHtmlText(image) + '" alt="" loading="lazy"></div>');
        if ((item.duration || 0) > 0 && !item.hide_duration) {
            parts.push('<div class="t-time-row"><i class="fas fa-clock t-icon"></i> 所要時間：' + item.duration + '分</div>');
        }
        if ((item.price || 0) > 0 && !item.hide_price) {
            parts.push('<div class="t-price-row"><div><div class="t-price-label">料金</div><div class="t-price-val">¥' + Number(item.price).toLocaleString() + '</div></div></div>');
        }
        if (desc) parts.push('<div class="t-detail"><i class="fas fa-list-ul t-icon"></i>' + this.escapeHtmlText(desc).replace(/\\n/g, '<br>') + '</div>');
        parts.push('<button type="button" class="t-close-bottom" onclick="window.bookingForm.closeDetailPopup()">閉じる</button>');
        popup.innerHTML = '<button type="button" class="treatment-close" onclick="window.bookingForm.closeDetailPopup()">×</button><div class="treatment-content">' + parts.join('') + '</div>';
        popup.style.display = 'block';

        // タップしたボタンの直下にカードを表示（参考デザインと同じ位置調整）
        const rect = button.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        popup.style.top = '0px';
        popup.style.left = '0px';
        const cardWidth = popup.offsetWidth || 280;
        let left = rect.left + scrollLeft;
        const maxLeft = scrollLeft + document.documentElement.clientWidth - cardWidth - 16;
        if (left > maxLeft) left = maxLeft;
        if (left < 8) left = 8;
        popup.style.left = left + 'px';
        popup.style.top = (rect.bottom + scrollTop + 8) + 'px';
    }

    closeDetailPopup() {
        const popup = document.getElementById('treatment-text');
        if (popup) popup.style.display = 'none';
    }

    // ご予約内容欄の日時表示用: '2026-07-09','12:30' → '2026年07月09日 12時30分'
    formatDateTimeJa(dateStr, timeStr) {
        let d = dateStr || '';
        const dm = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(d);
        if (dm) d = dm[1] + '年' + dm[2] + '月' + dm[3] + '日';
        let t = timeStr || '';
        const tm = /^([0-9]{1,2}):([0-9]{2})$/.exec(t);
        if (tm) t = String(tm[1]).padStart(2, '0') + '時' + tm[2] + '分';
        return (d + ' ' + t).trim();
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
                category_name: (category?.display_name || category?.name || '').trim(),
                price,
                duration,
                ...(submenu ? { submenu_id: submenu.id, submenu_name: submenu.name || '' } : {})
            });
            // ご予約内容にはメニュー名のみ表示（料金・所要時間は表示しない）
            summaryLines.push(menu.name + (submenu ? ' &gt; ' + submenu.name : ''));
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
                    summaryLines.push('+ ' + option.name);
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
                    summaryLines.push('+ ' + opt.name);
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
                <button class="submenu-item" data-submenu-index="\${idx}" style="width:100%;display:flex;justify-content:space-between;align-items:center;padding:0.5rem;border:2px solid #d1d5db;border-radius:0.375rem;background:white;cursor:pointer;margin-bottom:0.5rem;transition:all 0.15s;text-align:left;">
                    <div style="display:flex;align-items:center;">
                        <div>
                            <div style="text-align:left;font-size:0.875rem;font-weight:500;">\${sub.name}</div>
                        </div>
                    </div>
                    <div style="text-align:right;margin-left:0.5rem;">
                        \${!sub.hide_price ? \`<div style="font-weight:500;font-size:0.875rem;">¥\${sub.price.toLocaleString()}</div>\` : ''}
                        \${!sub.hide_duration ? \`<div style="font-size:0.75rem;opacity:0.7;">\${sub.duration}分</div>\` : ''}
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
                // 選択したサブメニューの詳細ポップアップ（説明/画像がある場合のみ）
                this.showDetailPopup(sub, submenu);
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
        
        // スタッフ選択モードでは選択中スタッフごとに空き状況が異なるためキーを分ける
        const staffParam = this.isStaffCalendarMode()
            ? (this.state.selectedStaffId && this.state.selectedStaffId !== 'none' ? this.state.selectedStaffId : 'all')
            : '';
        const cacheKey = startTime.toISOString() + endTime.toISOString() + ':' + staffParam;
        
        // キャッシュを確認
        if (this.availabilityCache[cacheKey]) {
            this.availabilityData = this.availabilityCache[cacheKey].availability;
            this.businessDays = this.availabilityCache[cacheKey].businessDays;
            this.renderCalendar();
            return;
        }
        
        const url = \`\${window.location.origin}/api/stores/\${STORE_ID}/calendar/availability\` +
            \`?start=\${startTime.toISOString()}&end=\${endTime.toISOString()}\` +
            (staffParam ? \`&staff_id=\${encodeURIComponent(staffParam)}&form_id=\${encodeURIComponent(FORM_ID || '')}\` : '');
        
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
    // 予約受付開始日（0 = 当日から）より前の日付は予約不可
    const minDate = new Date(today);
    minDate.setDate(today.getDate() + this.getMinAdvanceDays());

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
        // 選択中メニュー/オプションの対応時間設定（セルごとの判定用に1回だけ計算）
        const menuTimeWindows = this.getActiveTimeWindows();

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
        let headerHTML = '<thead><tr><th style="text-align:center;padding:0.5rem;background:#f9f9f9;border:1px solid #696969;font-size:0.75rem;vertical-align:middle;width:17%;box-sizing:border-box;">時間</th>';
        weekDates.forEach(date => {
            const dayOfWeek = date.getDay();
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            headerHTML += \`<th style="text-align:center;padding:0.4rem 0.3rem;background:#f9f9f9;border:1px solid #696969;font-size:0.7rem;vertical-align:middle;line-height:1.3;width:calc((100% - 17%) / 7);box-sizing:border-box;word-break:keep-all;white-space:normal;">\${date.getMonth() + 1}/\${date.getDate()}<br style="line-height:0.8;" />(\${dayNames[dayOfWeek]})</th>\`;
        });
        headerHTML += '</tr></thead>';
        
        // テーブルボディ生成
        let bodyHTML = '<tbody>';
        // 再描画で選択中の日時が予約不可になった場合に選択をリセットするためのフラグ
        let selectionWasReset = false;
        timeSlots.forEach((time, timeIndex) => {
            bodyHTML += '<tr>';
            bodyHTML += \`<td style="text-align:center;padding:0.25rem;border:1px solid #696969;font-size:0.75rem;background:#f9f9f9;font-weight:500;">\${time}</td>\`;
            
            weekDates.forEach((date, dateIndex) => {
        const dateStr = formatLocalYmd(date);
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
        
        // 予約可能期間の判定（予約受付開始日〜事前予約可能日数の範囲内）
        const withinWindow = date.getTime() <= max.getTime() && date.getTime() >= minDate.getTime();

        // メニュー/オプションの対応時間設定（すべての時間帯に収まらないスロットは✕）
        let isWithinMenuWindows = true;
        if (menuTimeWindows.length > 0) {
            const slotMin = parseInt(time.split(':')[0], 10) * 60 + parseInt(time.split(':')[1], 10);
            isWithinMenuWindows = menuTimeWindows.every(w => slotMin >= w.start && slotMin < w.end);
        }
        
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
        const totalDuration = menuDuration + optionsDuration + visitDuration;
        const slotEnd = new Date(slotStart);
        slotEnd.setMinutes(slotStart.getMinutes() + totalDuration);
        // 重なり判定用: メニュー未選択(=幅0)のときはスロット間隔ぶんの幅を持たせる
        // （幅0だとイベント開始時刻ちょうどのスロットが取りこぼされるため）
        const overlapEnd = totalDuration > 0
            ? slotEnd
            : new Date(slotStart.getTime() + timeInterval * 60000);

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

        if (isPast || isNextDay || endsAfterClose || !withinWindow || isClosed || !isWithinBusinessHours || !isWithinMenuWindows) {
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
                return slotStart < event.end && event.start < overlapEnd;
            });
            
            // 予約済みイベントの数をカウント（営業日イベントは除外）
            const count = this.availabilityData.reduce((acc, slot) => {
                const eventStart = new Date(slot.startTime);
                const eventEnd = new Date(slot.endTime);
                if (eventStart < overlapEnd && slotStart < eventEnd && slot.title !== "営業日" && slot.summary !== "営業日") {
                    return acc + 1;
                }
                return acc;
            }, 0);

            // 同時刻に何件イベントがあれば予約不可にするかの閾値（1以上、デフォルト1）
            const rawMax = this.config?.calendar_settings?.max_concurrent_events;
            const maxConcurrent = (typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= 1) ? Math.floor(rawMax) : 1;

            // 空き状況の判定ロジック（count >= maxConcurrent で予約不可）
            if (this.isStaffCalendarMode()) {
                // スタッフ選択モード: スタッフ1人につき1件でも予定が重なれば×（同時刻閾値の設定は無視）
                const busyByStaff = {};
                this.availabilityData.forEach(slot => {
                    if (!slot.staff_id) return;
                    const es = new Date(slot.startTime);
                    const ee = new Date(slot.endTime);
                    if (es < overlapEnd && slotStart < ee && slot.title !== '営業日' && slot.summary !== '営業日') {
                        busyByStaff[slot.staff_id] = true;
                    }
                });
                if (this.state.selectedStaffId && this.state.selectedStaffId !== 'none') {
                    // スタッフ指名あり: そのスタッフが空いていれば〇
                    isAvailable = !busyByStaff[this.state.selectedStaffId];
                } else {
                    // 指名なし/未選択: 誰か1人でも空いていれば〇
                    isAvailable = this.getCalendarStaff().some(m => !busyByStaff[m.id]);
                }
            } else if (isBusinessEventTime && count >= maxConcurrent) {
                // 営業日のイベント時間内で同時刻に閾値以上のイベントがある場合
                isAvailable = false;
            } else if (isBusinessEventTime) {
                // 営業日のイベント時間（閾値未満）
                isAvailable = true;
            } else if (businessEventTimes.length > 0) {
                // 営業日で、指定されている時間以外の時間は×
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

        // 祝日チェック（マスタートグル ON かつ除外リストに含まれていない祝日は ✕）
        if (isAvailable && shouldBlockAsHoliday(slotStart)) {
            isAvailable = false;
        }

        const isSelected = this.state.selectedDate === dateStr && this.state.selectedTime === time;
                // 選択中の日時がメニュー選択等で予約不可になった場合は選択をリセット
                if (isSelected && (!isAvailable || isPast)) {
                    this.state.selectedDate = '';
                    this.state.selectedTime = '';
                    selectionWasReset = true;
                }
                const showSelected = isSelected && isAvailable && !isPast;
                const bgColor = showSelected ? 'var(--primary-color)' : (isAvailable && !isPast ? '#fff' : '#a0a0a0');
                const textColor = showSelected ? '#fff' : (isAvailable && !isPast ? 'var(--primary-color)' : '#ffffff');
                const cursor = isAvailable && !isPast ? 'pointer' : 'not-allowed';
                const hoverStyle = isAvailable && !isPast ? 'onmouseover="this.style.backgroundColor=&quot;#fffbe6&quot;" onmouseout="if(!this.classList.contains(&quot;selected&quot;)){this.style.backgroundColor=&quot;#fff&quot;}"' : '';

                bodyHTML += \`<td
                    data-date="\${dateStr}"
                    data-time="\${time}"
                    class="calendar-cell\${showSelected ? ' selected' : ''}\${isAvailable && !isPast ? '' : ' unavailable'}"
                    style="text-align:center;padding:0.25rem;border:1px solid #696969;font-size:0.9rem;font-weight:bold;cursor:\${cursor};background:\${bgColor};color:\${textColor};"
                    \${hoverStyle}
                    onclick="window.bookingForm.handleDateTimeSelect('\${dateStr}', '\${time}', \${isAvailable && !isPast})"
                >\${isAvailable && !isPast ? '○' : '×'}</td>\`;
            });
            
            bodyHTML += '</tr>';
        });
        bodyHTML += '</tbody>';

        table.innerHTML = headerHTML + bodyHTML;

        // 選択中の日時が予約不可になっていた場合はサマリーを更新（無音リセット）
        if (selectionWasReset) {
            this.updateSummary();
        }

        // カレンダーが内部スクロールになる高さならスクロールヒントを表示
        this.updateCalendarScrollHint();
    }

    // カレンダー内部がスクロール可能なときだけ「下にスクロールできます」ヒントを出す
    updateCalendarScrollHint() {
        const wrapper = document.querySelector('.calendar-table-wrapper');
        const hint = document.getElementById('calendar-scroll-hint');
        if (!wrapper || !hint) return;
        const scrollable = wrapper.scrollHeight > wrapper.clientHeight + 10;
        hint.style.display = (scrollable && !this.state.calendarScrollHintDismissed) ? 'flex' : 'none';
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
            cell.style.backgroundColor = 'var(--primary-color)';
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

        if (isOpen) {
            // 開いているカテゴリを再タップしたら閉じる
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
        
        const summaryShowName = this.config.calendar_settings?.show_customer_name !== false;
        const summaryShowPhone = this.config.calendar_settings?.show_customer_phone !== false;
        if (summaryShowName && this.state.name) {
            items.push(\`<div class="summary-item"><span><strong>お名前:</strong> \${this.state.name}</span><button class="summary-edit-button" data-field="name-field">修正</button></div>\`);
        }
        if (summaryShowPhone && this.state.phone) {
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
        if (this.config.staff_selection?.enabled === true && this.state.selectedStaffId) {
            const staffLabel = this.state.selectedStaffId === 'none'
                ? '指名なし'
                : ((this.config.staff_selection.staff || []).find(m => m.id === this.state.selectedStaffId)?.name || '');
            if (staffLabel) {
                items.push(\`<div class="summary-item"><span><strong>担当スタッフ:</strong> \${staffLabel}</span><button class="summary-edit-button" data-field="staff-field">修正</button></div>\`);
            }
        }
        const hasMenuSelection = this.config.menu_structure?.allow_cross_category_selection
            ? (this.state.selectedMenus && Object.values(this.state.selectedMenus).flat().length > 0)
            : (this.state.selectedMenu || this.state.selectedSubmenu);
        if (hasMenuSelection) {
            const payload = this.buildSelectionPayload();
            items.push(\`<div class="summary-item" style="align-items:flex-start;"><div><strong>メニュー:</strong><div style="margin-top:0.25rem;">\${payload.summaryHtml}</div></div><button class="summary-edit-button" data-field="menu-field">修正</button></div>\`);
            const showTotalPrice = this.config.reservation_summary?.show_total_price === true;
            const showTotalDuration = this.config.reservation_summary?.show_total_duration === true;
            if ((showTotalPrice && payload.totalPrice > 0) || (showTotalDuration && payload.totalDuration > 0)) {
                let totalText = '';
                if (showTotalPrice && payload.totalPrice > 0) totalText += \`<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #e5e7eb;"><strong style="font-size:1rem;">合計金額: ¥\${payload.totalPrice.toLocaleString()}</strong></div>\`;
                if (showTotalDuration && payload.totalDuration > 0) totalText += \`<div style="margin-top:0.25rem;"><strong style="font-size:1rem;">合計時間: \${payload.totalDuration}分</strong></div>\`;
                if (totalText) items.push(\`<div class="summary-item" style="align-items:flex-start;"><div>\${totalText}</div></div>\`);
            }
        }
        if (this.state.selectedDate || this.state.selectedTime) {
            const bMode = this.config.calendar_settings?.booking_mode || 'calendar';
            if (bMode === 'multiple_dates') {
                let dateHtml = \`<strong>希望日時:</strong><div style="margin-top:0.25rem;font-size:0.875rem;">\`;
                dateHtml += \`第一希望: \${this.formatDateTimeJa(this.state.selectedDate, this.state.selectedTime)}\`;
                if (this.state.selectedDate2 && this.state.selectedTime2) dateHtml += \`<br>第二希望: \${this.formatDateTimeJa(this.state.selectedDate2, this.state.selectedTime2)}\`;
                if (this.state.selectedDate3 && this.state.selectedTime3) dateHtml += \`<br>第三希望: \${this.formatDateTimeJa(this.state.selectedDate3, this.state.selectedTime3)}\`;
                dateHtml += \`</div>\`;
                items.push(\`<div class="summary-item" style="align-items:flex-start;"><div>\${dateHtml}</div><button class="summary-edit-button" data-field="datetime-field-1">修正</button></div>\`);
            } else {
                items.push(\`<div class="summary-item"><span><strong>希望日時:</strong> \${this.formatDateTimeJa(this.state.selectedDate, this.state.selectedTime)}</span><button class="summary-edit-button" data-field="datetime-field">修正</button></div>\`);
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

        // バリデーション（非表示の項目はスキップし、空ならフォールバック値で埋める）
        const showNameField = this.config.calendar_settings?.show_customer_name !== false;
        const showPhoneField = this.config.calendar_settings?.show_customer_phone !== false;
        if (showNameField && !this.state.name) {
            alert('お名前を入力してください');
            resetSubmitState();
            return;
        }
        if (showPhoneField && !this.state.phone) {
            alert('電話番号を入力してください');
            resetSubmitState();
            return;
        }
        // メールアドレス（show_customer_email === true もしくは form_type === 'web' のとき必須・形式・一致をチェック）
        const showEmailField = this.config.calendar_settings?.show_customer_email === true
            || this.config.form_type === 'web';
        if (showEmailField) {
            const email = (this.state.email || '').trim();
            const emailConfirm = (this.state.emailConfirm || '').trim();
            if (!email) {
                alert('メールアドレスを入力してください');
                resetSubmitState();
                return;
            }
            if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) {
                alert('メールアドレスの形式が正しくありません');
                resetSubmitState();
                return;
            }
            if (email !== emailConfirm) {
                alert('メールアドレス（確認）が一致していません');
                resetSubmitState();
                return;
            }
        }
        // 非表示フィールドのフォールバック: 名前は LINE 表示名 → 「未記入」、電話は「未記入」
        if (!showNameField && !this.state.name) {
            this.state.name = this.state.lineDisplayName || '未記入';
        }
        if (!showPhoneField && !this.state.phone) {
            this.state.phone = '未記入';
        }
        const menuCats = this.config.menu_structure?.categories || [];
        const flatMenus = this.config.menu_structure?.menus || [];
        const totalMenuCount = flatMenus.length + menuCats.reduce((sum, c) => sum + ((c.menus || []).length), 0);
        if (totalMenuCount > 0) {
            const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
            const hasSelection = allowCross
                ? (Object.values(this.state.selectedMenus || {}).flat().length > 0)
                : (this.state.selectedMenu || this.state.selectedSubmenu);
            if (!hasSelection) {
                alert('メニューを選択してください');
                resetSubmitState();
                return;
            }
        }
        // スタッフ選択の必須チェック（スタッフボタンが表示されている場合のみ）
        const staffCfg = this.config.staff_selection;
        if (staffCfg?.enabled === true && staffCfg.required === true
            && document.getElementById('staff-field') && !this.state.selectedStaffId) {
            alert('担当スタッフを選択してください');
            const staffField = document.getElementById('staff-field');
            if (staffField) staffField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            resetSubmitState();
            return;
        }
        if ((this.config.calendar_settings?.booking_mode || 'calendar') === 'multiple_dates') {
            // 第三希望日時モード: 必須選択（required_choices）に応じてチェック
            const requiredChoices = this.getRequiredDateChoices();
            const choiceValues = {
                1: [this.state.selectedDate, this.state.selectedTime],
                2: [this.state.selectedDate2, this.state.selectedTime2],
                3: [this.state.selectedDate3, this.state.selectedTime3]
            };
            const choiceLabels = { 1: '第一希望日時', 2: '第二希望日時', 3: '第三希望日時' };
            for (const idx of requiredChoices) {
                if (!choiceValues[idx][0] || !choiceValues[idx][1]) {
                    alert(choiceLabels[idx] + 'を選択してください');
                    const field = document.getElementById('datetime-field-' + idx);
                    if (field) field.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    resetSubmitState();
                    return;
                }
            }
        } else if (!this.state.selectedDate || !this.state.selectedTime) {
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
        // 同意事項の必須チェック（「同意する」ボタンが表示されている場合のみ。
        // ボタン非表示時は同意操作ができないためチェックしない）
        const agreementCfg = this.config.reservation_summary?.agreement;
        if (agreementCfg?.enabled === true && agreementCfg.required === true
            && agreementCfg.hide_button !== true
            && (agreementCfg.text || '').trim() && !this.state.agreementAccepted) {
            alert('同意事項を確認して「同意する」ボタンをタップしてください。');
            const agreementField = document.getElementById('agreement-field');
            if (agreementField) agreementField.scrollIntoView({ behavior: 'smooth', block: 'center' });
            resetSubmitState();
            return;
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
                        if (val) {
                            const display = (field.type === 'date' || field.type === 'datetime') ? formatDateTimeForDisplay(val) : val;
                            labeledFields[field.title] = display;
                        }
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
            
            // selectedDate は既に YYYY-MM-DD（ローカル日付）。new Date() で再パースすると
            // タイムゾーンによって日付がズレるため、文字列のまま使う。
            const reservationDate = this.state.selectedDate;
            const [selYear, selMonth, selDay] = this.state.selectedDate.split('-');
            
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
                customer_email: (this.state.email || '').trim() || this.state.lineEmail || null,
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
                // null = 不明（サーバ側で既存値を上書きしない）
                line_friend_flag: this.state.lineFriendFlag, // 友だち追加状態 (true/false/null)
                source_medium: sourceMedium,
                booking_mode: this.config.calendar_settings?.booking_mode || 'calendar',
                // スタッフ選択（'none' = 指名なし → サーバー側で空きスタッフに自動割当）
                staff_id: (this.state.selectedStaffId && this.state.selectedStaffId !== 'none') ? this.state.selectedStaffId : null,
                staff_no_preference: this.state.selectedStaffId === 'none'
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
                    // 指名なしの場合、サーバーで割り当てられた担当スタッフをメッセージに反映
                    try {
                        const created = await response.json();
                        if (created && created.staff_name && this.state.selectedStaffId === 'none') {
                            messageText = messageText.replace('《担当スタッフ》\\n指名なし\\n', \`《担当スタッフ》\\n指名なし（担当: \${created.staff_name}）\\n\`);
                        }
                    } catch (parseError) {
                        // レスポンス解析失敗は無視（メッセージは「指名なし」のまま送信）
                    }
                } else {
                    const errorData = await response.json().catch(() => ({}));
                    if (response.status === 409 && errorData && errorData.code === 'concurrent_reservation_limit') {
                        blockReason = errorData.error || '既に予約があります。予約が過ぎるまで新しい予約はできません。';
                    }
                    // スタッフ選択: 送信直前の再チェックで枠が埋まっていた場合（ダブルブッキング防止）
                    if (response.status === 409 && errorData && errorData.code === 'slot_taken') {
                        blockReason = errorData.error || '申し訳ありません。選択された日時はただいま埋まってしまいました。別の日時をお選びください。';
                    }
                    console.error('予約データの保存に失敗しました:', errorData);
                    // 409 (concurrent_reservation_limit / slot_taken) 以外は LINE メッセージ送信を継続（既存挙動）
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
            
            // 日時を日本語形式に変換（LINEメッセージ用）。日付は文字列分割で組み立て TZ 非依存にする。
            const formattedDate = \`\${selYear}年\${selMonth}月\${selDay}日 \${this.state.selectedTime}\`;
            const formatDateStr = (dateStr, timeStr) => {
                if (!dateStr || !timeStr) return null;
                const [y, m, d] = dateStr.split('-');
                return \`\${y}年\${m}月\${d}日 \${timeStr}\`;
            };
            const formattedDate2 = formatDateStr(this.state.selectedDate2, this.state.selectedTime2);
            const formattedDate3 = formatDateStr(this.state.selectedDate3, this.state.selectedTime3);
            
            // メッセージ本文を構築（《ラベル》\\n値 形式）
            const formName = this.config.basic_info?.form_name || '予約フォーム';
            let messageText = '【' + formName + '】\\n';

            // お名前 / 電話番号（表示設定が有効な場合のみ LINE メッセージに含める）
            if (showNameField) {
                messageText += \`《お名前》\\n\${this.state.name || ''}\\n\`;
            }
            if (showPhoneField) {
                messageText += \`《電話番号》\\n\${this.state.phone || ''}\\n\`;
            }

            // ご来店回数（有効時のみ表示）
            if (this.config.visit_count_selection?.enabled && this.state.visitCount) {
                const visitLabel = this.config.visit_count_selection.options.find(o => o.value === this.state.visitCount)?.label;
                const visitCountText = visitLabel || this.state.visitCount || '';
                messageText += \`《ご来店回数》\\n\${visitCountText}\\n\`;
            }

            // 担当スタッフ（スタッフ選択が有効で選択されている場合）
            if (this.config.staff_selection?.enabled === true && this.state.selectedStaffId) {
                const staffMsgLabel = this.state.selectedStaffId === 'none'
                    ? '指名なし'
                    : ((this.config.staff_selection.staff || []).find(m => m.id === this.state.selectedStaffId)?.name || '');
                if (staffMsgLabel) {
                    messageText += \`《担当スタッフ》\\n\${staffMsgLabel}\\n\`;
                }
            }

            // メニュー（希望日時式はカテゴリーごとに改行表示）
            const bookingModeForMenu = this.config.calendar_settings?.booking_mode || 'calendar';
            if (bookingModeForMenu === 'multiple_dates' && menuTextGrouped) {
                messageText += \`\\n《メニュー》\\n\${menuTextGrouped}\\n\`;
            } else {
                messageText += \`\\n《メニュー》\\n\${menuTextForMessage || ''}\\n\`;
            }

            // オプション（メニュー個別 / カテゴリー共通の両方を統合表示）
            if (selectedOptions && selectedOptions.length > 0) {
                const optionLines = selectedOptions.map(opt => {
                    const name = opt.option_name || '';
                    const priceText = (opt.price || 0) > 0 ? \` ¥\${Number(opt.price).toLocaleString()}\` : '';
                    const durationText = (opt.duration || 0) > 0 ? \` (\${opt.duration}分)\` : '';
                    return \`・\${name}\${priceText}\${durationText}\`;
                }).join('\\n');
                messageText += \`\\n《オプション》\\n\${optionLines}\\n\`;
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
                        const display = (field.type === 'date' || field.type === 'datetime') ? formatDateTimeForDisplay(value) : value;
                        messageText += \`\\n\\n《\${field.title}》\\n\${display}\`;
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
                // 復元機能ONのカスタムフィールド値（customFields）を消さないようマージ保存
                let existingCustomFields = {};
                try {
                    const prev = localStorage.getItem(bookingKey);
                    if (prev) existingCustomFields = JSON.parse(prev).customFields || {};
                } catch (e) {}
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
                    customerPhone: this.state.phone,
                    customerEmail: (this.state.email || '').trim(),
                    customFields: existingCustomFields
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
                    const messages = [{ type: 'text', text: messageText }];
                    const sm = this.config.basic_info?.second_message;
                    if (sm && sm.enabled === true && typeof sm.text === 'string' && sm.text.trim()) {
                        messages.push({ type: 'text', text: sm.text.trim() });
                    }
                    liff.sendMessages(messages).then(() => {
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
    
    // 予約受付開始日: 何日後から予約可能か（0 = 当日から）
    getMinAdvanceDays() {
        const v = this.config?.calendar_settings?.min_advance_days;
        return (typeof v === 'number' && isFinite(v) && v > 0) ? Math.floor(v) : 0;
    }

    // 選択中スタッフに応じてメニュー/オプションの表示を切り替える。
    // 非表示対象がすでに選択されていた場合は選択を解除する（スタッフ切替時の整合性維持）
    applyStaffMenuVisibility() {
        const ss = this.config.staff_selection;
        if (!ss || ss.enabled !== true) return;
        const member = (ss.staff || []).find(m => m && m.id === this.state.selectedStaffId);
        const hiddenMenus = new Set(member && Array.isArray(member.hidden_menu_ids) ? member.hidden_menu_ids : []);
        const hiddenOptions = new Set(member && Array.isArray(member.hidden_option_ids) ? member.hidden_option_ids : []);
        let selectionChanged = false;

        document.querySelectorAll('.menu-item').forEach(item => {
            const menuId = item.dataset.menuId;
            const hidden = hiddenMenus.has(menuId);
            item.style.display = hidden ? 'none' : '';
            if (!hidden) return;
            // 単一選択の解除
            if (this.state.selectedMenu && this.state.selectedMenu.id === menuId) {
                item.classList.remove('selected', 'has-submenu');
                this.state.selectedMenu = null;
                this.state.selectedSubmenu = null;
                if (this.state.selectedOptions) delete this.state.selectedOptions[menuId];
                this.hideSubmenu();
                const optContainer = document.getElementById('options-' + menuId);
                if (optContainer) optContainer.style.display = 'none';
                selectionChanged = true;
            }
            // カテゴリー横断選択の解除
            if (this.state.selectedMenus) {
                Object.keys(this.state.selectedMenus).forEach(catId => {
                    const list = this.state.selectedMenus[catId] || [];
                    if (list.includes(menuId)) {
                        const next = list.filter(id => id !== menuId);
                        if (next.length > 0) this.state.selectedMenus[catId] = next;
                        else delete this.state.selectedMenus[catId];
                        if (this.state.selectedSubMenus) delete this.state.selectedSubMenus[menuId];
                        if (this.state.selectedOptions) delete this.state.selectedOptions[menuId];
                        item.classList.remove('selected', 'has-submenu');
                        const optContainer = document.getElementById('options-' + menuId);
                        if (optContainer) optContainer.style.display = 'none';
                        selectionChanged = true;
                    }
                });
            }
        });

        document.querySelectorAll('.menu-option-item').forEach(item => {
            const optionId = item.dataset.optionId;
            const menuId = item.dataset.menuId;
            const hidden = hiddenOptions.has(optionId);
            item.style.display = hidden ? 'none' : 'flex';
            if (!hidden) return;
            const current = (this.state.selectedOptions && this.state.selectedOptions[menuId]) || [];
            if (current.includes(optionId)) {
                this.state.selectedOptions[menuId] = current.filter(id => id !== optionId);
                item.style.borderColor = '#d1d5db';
                item.style.backgroundColor = 'white';
                item.style.color = '#1b2a4e';
                selectionChanged = true;
            }
        });

        document.querySelectorAll('.category-option-item').forEach(item => {
            const optionId = item.dataset.optionId;
            const categoryId = item.dataset.categoryId;
            const hidden = hiddenOptions.has(optionId);
            item.style.display = hidden ? 'none' : 'flex';
            if (!hidden) return;
            const current = (this.state.selectedCategoryOptions && this.state.selectedCategoryOptions[categoryId]) || [];
            if (current.includes(optionId)) {
                this.state.selectedCategoryOptions[categoryId] = current.filter(id => id !== optionId);
                item.style.borderColor = '#d1d5db';
                item.style.backgroundColor = 'white';
                item.style.color = '#1b2a4e';
                selectionChanged = true;
            }
        });

        if (selectionChanged) {
            this.closeDetailPopup();
        }
    }

    // 選択中のメニュー/オプションの「対応時間設定」を集める（分単位の時間帯リスト）
    // 複数指定されている場合はすべての時間帯に収まるスロットのみ〇になる
    getActiveTimeWindows() {
        const windows = [];
        const add = (item) => {
            if (!item || item.time_window_enabled !== true) return;
            const parse = (t, fallback) => {
                const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(t || '');
                return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : fallback;
            };
            const start = parse(item.time_window_start, 0);
            const end = parse(item.time_window_end, 24 * 60);
            if (end > start) windows.push({ start, end });
        };
        const cats = this.config.menu_structure?.categories || [];
        const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
        if (allowCross && this.state.selectedMenus) {
            Object.entries(this.state.selectedMenus).forEach(([catId, ids]) => {
                const cat = cats.find(c => c.id === catId);
                (ids || []).forEach(id => {
                    const menu = cat && cat.menus ? cat.menus.find(m => m.id === id) : null;
                    add(menu);
                    ((this.state.selectedOptions && this.state.selectedOptions[id]) || []).forEach(oid => {
                        add(menu && menu.options ? menu.options.find(op => op.id === oid) : null);
                    });
                });
            });
        } else if (this.state.selectedMenu) {
            add(this.state.selectedMenu);
            const mid = this.state.selectedMenu.id;
            ((this.state.selectedOptions && this.state.selectedOptions[mid]) || []).forEach(oid => {
                add(this.state.selectedMenu.options ? this.state.selectedMenu.options.find(op => op.id === oid) : null);
            });
        }
        if (this.state.selectedCategoryOptions) {
            Object.entries(this.state.selectedCategoryOptions).forEach(([catId, ids]) => {
                const cat = cats.find(c => c.id === catId);
                (ids || []).forEach(oid => {
                    add(cat && cat.options ? cat.options.find(op => op.id === oid) : null);
                });
            });
        }
        return windows;
    }

    // スタッフ選択: カレンダー連携対象のスタッフ一覧（名前とカレンダーIDが設定済みのもの）
    getCalendarStaff() {
        const ss = this.config.staff_selection;
        return ss && Array.isArray(ss.staff) ? ss.staff.filter(m => m && m.name && m.calendar_id) : [];
    }

    // スタッフ選択が空き状況・イベント作成に効くモードか（有効 + カレンダーモード + 対象スタッフあり）
    isStaffCalendarMode() {
        const ss = this.config.staff_selection;
        if (!ss || ss.enabled !== true) return false;
        if ((this.config.calendar_settings?.booking_mode || 'calendar') !== 'calendar') return false;
        return this.getCalendarStaff().length > 0;
    }

    // 第三希望日時モードの必須選択（1〜3）。未設定 = 全て必須。第一希望は常に必須
    getRequiredDateChoices() {
        const raw = this.config.calendar_settings?.multiple_dates_settings?.required_choices;
        const rc = Array.isArray(raw) ? raw.filter(n => n === 1 || n === 2 || n === 3) : [1, 2, 3];
        if (!rc.includes(1)) rc.unshift(1);
        return [...new Set(rc)].sort();
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

        // 予約受付開始日（0 = 当日から）より前の日付は選択肢に含めない
        for (let i = this.getMinAdvanceDays(); i < settings.date_range_days; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);

            // 曜日別の定休日チェック
            const hours = this.getWeekdayHours(settings, date.getDay());
            if (hours.closed) {
                continue;
            }

            // 祝日チェック（マスタートグル ON かつ除外リストに含まれていない祝日は選択肢から除外）
            if (typeof shouldBlockAsHoliday === 'function' && shouldBlockAsHoliday(date)) {
                continue;
            }

            const option = document.createElement('option');
            option.value = formatLocalYmd(date);
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
        // この関数は (1) 初回ロード時、(2) メニュー/サブメニュー選択時、(3) 前回メニュー復元時に呼ばれる。
        // hide_datetime_until_menu_selected が ON（未設定含む）の場合、メニュー選択まで希望日時エリアを非表示にする。
        const hideUntilMenu = this.config.calendar_settings?.hide_datetime_until_menu_selected !== false;
        const allowCross = this.config.menu_structure?.allow_cross_category_selection || false;
        const hasMenuSelection = allowCross
            ? (this.state.selectedMenus && Object.values(this.state.selectedMenus).flat().length > 0)
            : !!this.state.selectedMenu;
        // スタッフ選択が空き判定に効くフォームでは、スタッフの選択もカレンダー表示の条件にする
        // （メニュー選択だけではカレンダーを出さず、スタッフをタップしたら表示）
        const staffSelected = this.isStaffCalendarMode() ? !!this.state.selectedStaffId : true;
        const show = !hideUntilMenu || (hasMenuSelection && staffSelected);

        const fieldIds = bookingMode === 'multiple_dates'
            ? ['datetime-field-1', 'datetime-field-2', 'datetime-field-3']
            : ['datetime-field'];
        fieldIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = show ? '' : 'none';
        });

        if (bookingMode === 'multiple_dates') {
            // 第三希望日時モード: 選択肢は initializeMultipleDates で生成済み。表示制御のみ。
            return;
        }

        // 非表示中はカレンダーの再描画をスキップ（表示されるタイミングで再度呼ばれる）
        if (!show) return;

        // カレンダーモード: 空き状況を再取得してカレンダーを再描画
        this.fetchAvailability(this.state.currentWeekStart).then(() => {
            this.renderCalendar();
        }).catch(() => {
            // エラー時もカレンダーをレンダリング（営業時間のみで判定）
            this.renderCalendar();
        });
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
      if (field.type === 'date') {
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label" for="${id}">${label}</label>
                <div class="date-input-wrap"><input type="date" id="${id}" class="input" data-field-id="${field.id}"><span class="date-input-hint">タップしてご選択ください</span></div>
            </div>`;
      }
      if (field.type === 'datetime') {
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label" for="${id}">${label}</label>
                <div class="date-input-wrap"><input type="datetime-local" id="${id}" class="input" data-field-id="${field.id}"><span class="date-input-hint">タップしてご選択ください</span></div>
            </div>`;
      }
      if (field.type === 'select' && field.options?.length) {
        const optionsHtml = field.options.map(opt =>
          `<option value="${this.escapeHtml(opt.value)}">${this.escapeHtml(opt.label)}</option>`
        ).join('');
        return `
            <div class="field" id="custom-field-wrap-${field.id}">
                <label class="field-label" for="${id}">${label}</label>
                <select id="${id}" class="input" data-field-id="${field.id}"><option value="">選択してください</option>${optionsHtml}</select>
            </div>`;
      }
      return '';
    }).filter(Boolean).join('\n            ');
  }

  private renderMenuField(config: FormConfig): string {
    // カテゴリ + 全カテゴリ配下のメニュー + simple モードのフラットメニューが全部 0 件なら何も表示しない
    const cats = config.menu_structure?.categories || [];
    const flatMenus = config.menu_structure?.menus || [];
    const totalMenus = flatMenus.length + cats.reduce((sum, c) => sum + ((c.menus || []).length), 0);
    if (totalMenus === 0) return '';
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
                                            <div class="menu-item-name">${this.escapeHtml(menu.name)}${menu.has_submenu ? ' &#x25B6;&#xFE0E;' : ''}</div>
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
    // ON（未設定含む）の場合はメニュー選択まで非表示のため、初期HTMLも非表示で出力
    const initiallyHidden = config.calendar_settings?.hide_datetime_until_menu_selected !== false;

    if (bookingMode === 'multiple_dates') {
      return this.renderMultipleDatesField(config, initiallyHidden);
    } else {
      return this.renderDateTimeField(initiallyHidden);
    }
  }

  // 第三希望日時モードの必須選択（1〜3）。未設定 = 全て必須。第一希望は常に必須
  private getRequiredDateChoices(config: FormConfig): number[] {
    const raw = config.calendar_settings?.multiple_dates_settings?.required_choices;
    const rc = Array.isArray(raw) ? raw.filter((n) => n === 1 || n === 2 || n === 3) : [1, 2, 3];
    if (!rc.includes(1)) rc.unshift(1);
    return [...new Set(rc)].sort();
  }

  private renderDateTimeField(initiallyHidden: boolean): string {
    return `${this.renderCalendarField(initiallyHidden)}`;
  }

  private renderCalendarField(initiallyHidden: boolean): string {
    // 現在は常にカレンダーモードで生成（プレビューと同じ）
    // 静的HTML生成時はプレビューと完全一致させる
    return `
            <!-- 日時選択（hide_datetime_until_menu_selected ON 時はメニュー選択まで非表示） -->
            <div class="field" id="datetime-field"${initiallyHidden ? ' style="display:none;"' : ''}>
                <label class="field-label">希望日時 <span class="required">*</span></label>
                
                <div class="calendar-container">
                    <!-- 現在の月表示（ヘッダーバー） -->
                    <div class="calendar-header-bar">
                        <span id="current-month" class="current-month"></span>
                    </div>

                    <!-- 月・週移動ボタン -->
                    <div class="calendar-controls">
                        <div class="control-group">
                            <button type="button" onclick="window.bookingForm.navigateMonth('prev')" class="month-button">&#x25C0;&#xFE0E; 前月</button>
                            <button type="button" onclick="window.bookingForm.navigateMonth('next')" class="month-button">翌月 &#x25B6;&#xFE0E;</button>
                        </div>
                        <div class="control-group">
                            <button type="button" onclick="window.bookingForm.navigateWeek('prev')" class="week-button">&#x25C0;&#xFE0E; 前週</button>
                            <button type="button" onclick="window.bookingForm.navigateWeek('next')" class="week-button">翌週 &#x25B6;&#xFE0E;</button>
                        </div>
                    </div>

                    <!-- 凡例（〇✕の説明） -->
                    <div class="calendar-legend">
                        <div class="legend-item"><span class="legend-marker marker-ok"></span><span>予約可</span></div>
                        <div class="legend-item"><span class="legend-marker marker-ng">✕</span><span>満席</span></div>
                    </div>

                    <!-- カレンダーテーブル -->
                    <div class="calendar-table-wrapper" style="overflow-x:auto;background:#fff;border:1px solid #d1d5db;border-radius:0.25rem;box-shadow:0 1px 2px 0 rgba(0,0,0,0.05);">
                        <table id="calendar-table" style="width:100%;border-collapse:collapse;">
                            <!-- JavaScriptで動的生成 -->
                        </table>
                        <div id="calendar-scroll-hint" class="calendar-scroll-hint" style="display:none;"><span class="scroll-hint-arrow">⇩</span>下にスクロールできます</div>
                    </div>
                </div>
            </div>`;
  }
  
  private renderMultipleDatesField(config: FormConfig, initiallyHidden: boolean): string {
    const hiddenStyle = initiallyHidden ? ' style="display:none;"' : '';
    const required = this.getRequiredDateChoices(config);
    const mark = (idx: number) => required.includes(idx)
      ? '<span class="required">*</span>'
      : '<span style="color:#6b7280;font-weight:normal;font-size:0.75rem;">（任意）</span>';
    return `
            <!-- 第一希望日時 -->
            <div class="field" id="datetime-field-1"${hiddenStyle}>
                <label class="field-label">第一希望日時 ${mark(1)}</label>
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
            <div class="field" id="datetime-field-2"${hiddenStyle}>
                <label class="field-label">第二希望日時 ${mark(2)}</label>
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
            <div class="field" id="datetime-field-3"${hiddenStyle}>
                <label class="field-label">第三希望日時 ${mark(3)}</label>
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

  // 指定セクションの上/下に表示する画像・テキストブロックを描画
  private renderContentBlocksAt(config: FormConfig, anchor: string, position: 'above' | 'below'): string {
    const blocks = (config.content_blocks || []).filter(b => {
      if (!b || b.anchor !== anchor || (b.position || 'above') !== position) return false;
      if (b.type === 'text') return !!(b.text && b.text.trim());
      if (b.type === 'image') return !!(b.image_url && /^https?:/i.test(b.image_url.trim()));
      return false;
    });
    if (blocks.length === 0) return '';
    const items = blocks.map(b => {
      if (b.type === 'image') {
        return `<div class="content-block content-block-image"><img src="${this.escapeHtml((b.image_url || '').trim())}" alt="" loading="lazy"></div>`;
      }
      return `<div class="content-block content-block-text">${this.escapeHtml(b.text || '').replace(/\n/g, '<br>')}</div>`;
    }).join('');
    return items;
  }

  private renderNoticeButtons(config: FormConfig): string {
    const buttons = (config.basic_info?.notice_buttons || []).filter(b =>
      b && b.label && b.url
      // 安全なスキームのみ許可（javascript: 等のインジェクション防止）
      && /^(https?:|tel:|mailto:|sms:|line:)/i.test(b.url.trim())
    );
    if (buttons.length === 0) return '';
    const items = buttons.map(b => {
      const url = b.url.trim();
      const isWebLink = /^https?:/i.test(url);
      return `<a class="notice-link-button" href="${this.escapeHtml(url)}"${isWebLink ? ' target="_blank" rel="noopener noreferrer"' : ''}>${this.escapeHtml(b.label)}</a>`;
    }).join('\n                ');
    return `
            <!-- 注意書きリンクボタン -->
            <div class="notice-link-buttons">
                ${items}
            </div>`;
  }

  private renderStaffField(config: FormConfig): string {
    const ss = config.staff_selection;
    if (ss?.enabled !== true) return '';
    const bookingMode = config.calendar_settings?.booking_mode || 'calendar';
    // カレンダーモードではカレンダー未設定のスタッフは表示しない（空き判定・イベント作成ができないため）
    const staff = (ss.staff || []).filter(m => m.name && (bookingMode === 'multiple_dates' || m.calendar_id));
    if (staff.length === 0) return '';
    const requiredMark = ss.required ? ' <span class="required">*</span>' : '';
    const buttons = staff.map(m =>
      `<button type="button" class="choice-button staff-button" data-staff-id="${this.escapeHtml(m.id)}">${this.escapeHtml(m.name)}</button>`
    ).join('\n                    ');
    const noPrefButton = ss.allow_no_preference !== false
      ? `\n                    <button type="button" class="choice-button staff-button" data-staff-id="none">指名なし</button>`
      : '';
    return `
            <!-- スタッフ選択 -->
            <div class="field" id="staff-field">
                <label class="field-label">担当スタッフをお選びください${requiredMark}</label>
                <div class="button-group">
                    ${buttons}${noPrefButton}
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

  private renderAgreementField(config: FormConfig): string {
    const agreement = config.reservation_summary?.agreement;
    if (agreement?.enabled !== true || !(agreement.text || '').trim()) return '';
    const hideButton = agreement.hide_button === true;
    // ボタン非表示時は同意操作ができないため必須マークも付けない（テキスト表示のみ）
    const requiredMark = agreement.required && !hideButton ? ' <span class="required">*</span>' : '';
    const buttonHtml = hideButton ? '' : `
                <button type="button" id="agreement-button" class="agreement-button">同意する</button>`;
    return `
            <!-- 同意事項 -->
            <div class="field agreement-box" id="agreement-field">
                <label class="field-label">同意事項${requiredMark}</label>
                <div class="agreement-text">${this.escapeHtml((agreement.text || '').trim())}</div>${buttonHtml}
            </div>`;
  }

  // 参考デザイン（ダークネイビー×シャンパンゴールド）を既存クラスに適用する上書きCSS。
  // DOM 構造・クラス名・JS は変更せず、見た目のみ差し替える。
  private generateDesignOverridesCSS(config: FormConfig): string {
    const themeColor = config.basic_info.theme_color || '#1b2a4e';
    // アクセント色はテーマカラーの補色から自動生成（ネイビーなら従来のシャンパンゴールドと一致）
    const accentColor = computeAccentColor(themeColor);
    const themeRgb = hexToRgb(themeColor) || { r: 27, g: 42, b: 78 };
    return `
        :root {
            --primary-color: ${themeColor};
            --accent-color: ${accentColor};
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
        .form-container {
            max-width: 500px;
            margin: 0 auto;
            padding: 10px 0 40px;
        }
        .form-header {
            background: var(--primary-color) !important;
            color: var(--white);
            border-radius: 4px 4px 0 0;
            border-top: 4px solid var(--accent-color);
            box-shadow: none;
            margin-bottom: 0;
            padding: 20px 15px;
            text-align: center;
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
            padding: 8px 15px;
            font-weight: 700;
            color: #1b2a4e;
            font-size: 16px;
            background-color: transparent;
            border-bottom: 2px solid var(--primary-color);
            border-left: 6px solid var(--accent-color);
            border-radius: 0;
            line-height: 1.4;
            margin-bottom: 15px;
        }
        /* 必須マーク: 「*」を「必須」の赤バッジ表示に置き換え（テキスト自体はJSに影響しない） */
        .field-label .required {
            font-size: 0;
            margin-left: auto;
            background-color: var(--required-bg);
            color: var(--white);
            padding: 2px 6px;
            border-radius: 2px;
            line-height: 1.4;
        }
        .field-label .required::before { content: "必須"; font-size: 11px; font-weight: normal; }
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
        .choice-button, .menu-item, .submenu-item, .menu-option-item, .category-option-item {
            border-radius: 2px;
            border-color: #ccc;
            color: #1b2a4e;
        }
        /* 復元時などクラスで selected になったオプションも選択色に（クリック時はインラインスタイルが優先） */
        .menu-option-item.selected,
        .category-option-item.selected {
            background-color: var(--primary-color);
            border-color: var(--primary-color);
            color: var(--white);
        }
        .choice-button.selected,
        .menu-item.selected,
        .submenu-item.selected {
            background-color: var(--primary-color) !important;
            border-color: var(--primary-color) !important;
            color: var(--white) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .menu-item.selected .menu-item-name,
        .menu-item.selected .menu-item-price,
        .menu-item.selected .menu-item-duration,
        .menu-item.selected .menu-item-desc,
        .submenu-item.selected .menu-item-name,
        .submenu-item.selected .menu-item-price,
        .submenu-item.selected .menu-item-duration,
        .submenu-item.selected .menu-item-desc {
            color: var(--white) !important;
        }
        /* 選択中バッジ（疑似要素なので innerText・送信内容には影響しない） */
        .choice-button.selected::after,
        .menu-item.selected::after,
        .submenu-item.selected::after {
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
        .category-header {
            background: var(--primary-color);
            color: var(--white);
            border-radius: 2px;
        }
        .summary-box {
            border: 1px solid #eee;
            border-radius: 0;
            background: #fcfcfc;
            padding: 15px;
        }
        .summary-title {
            display: flex;
            align-items: center;
            padding: 8px 15px;
            font-weight: 700;
            color: #1b2a4e;
            font-size: 16px;
            border-bottom: 2px solid var(--primary-color);
            border-left: 6px solid var(--accent-color);
            margin: -5px -5px 15px -5px;
        }
        .summary-edit-button {
            background-color: transparent;
            color: var(--primary-color);
            border: 1px solid var(--primary-color);
            border-radius: 2px;
            padding: 4px 10px;
            font-size: 12px;
            flex-shrink: 0;
            white-space: nowrap;
        }
        .summary-edit-button:hover { background-color: var(--primary-color); color: var(--white); }
        .agreement-box { border-radius: 0; border-color: #eee; background: #fcfcfc; }
        .agreement-button { border-radius: 2px; }
        .agreement-button.selected {
            background-color: var(--primary-color);
            border-color: var(--primary-color);
        }
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
        /* 画像・テキスト設置ブロック */
        .content-block {
            margin-bottom: 20px;
        }
        .content-block-text {
            font-size: 14px;
            color: var(--text-dark, #333);
            line-height: 1.7;
        }
        .content-block-image img {
            display: block;
            max-width: 100%;
            margin: 0 auto;
            border-radius: 4px;
        }
        /* 注意書きの下のリンクボタン */
        .notice-link-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 20px;
        }
        .notice-link-button {
            flex: 1 1 45%;
            display: block;
            padding: 12px 10px;
            border: 2px solid var(--primary-color);
            border-radius: 2px;
            background-color: var(--white);
            color: #1b2a4e;
            text-align: center;
            text-decoration: none;
            font-size: 15px;
            font-weight: 500;
            transition: all 0.2s;
        }
        @media (hover: hover) and (pointer: fine) {
            .notice-link-button:hover { background-color: var(--bg-color); }
        }
        /* 前回と同じメニューで予約する: 実線ボーダー + フォームに合わせた背景色 */
        .repeat-booking-button {
            border: 2px solid var(--primary-color) !important;
            background-color: var(--bg-color) !important;
            color: var(--primary-color) !important;
            border-radius: 3px !important;
            font-weight: bold !important;
            box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.1);
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
        /* メニュー/オプションボタン内の画像は非表示（画像は詳細ポップアップにのみ表示） */
        .menu-item .menu-item-image,
        .submenu-item .menu-item-image { display: none !important; }
        /* メニューボタン: オプション（眉カット等）と同じ「名前が左・料金/所要時間が右」の配置 */
        .menu-item {
            flex-direction: row !important;
            justify-content: space-between !important;
            align-items: center !important;
            padding: 0.5rem !important;
        }
        .menu-item .menu-item-content { flex: 1; min-width: 0; padding: 0; }
        .menu-item .menu-item-name { font-size: 0.875rem; font-weight: 500; color: inherit; }
        .menu-item .menu-item-desc { font-size: 0.75rem; margin-top: 0.125rem; }
        .menu-item .menu-item-info {
            flex-direction: column;
            align-items: flex-end;
            gap: 0;
            padding: 0;
            margin-left: 0.5rem;
            flex-shrink: 0;
        }
        .menu-item .menu-item-price { font-weight: 500; font-size: 0.875rem; color: inherit; }
        .menu-item .menu-item-duration { font-size: 0.75rem; opacity: 0.7; }
        /* 「✓ 選択中」バッジは横並びボタンでは行内に割り込まず、下の行に折り返して中央表示 */
        .menu-item.selected,
        .submenu-item.selected { flex-wrap: wrap; }
        /* バッジの直前で改行させるための全幅ダミー要素（見えない） */
        .menu-item.selected::before,
        .submenu-item.selected::before {
            content: "";
            flex-basis: 100%;
            height: 0;
            order: 5;
        }
        /* バッジ本体はテキスト幅のまま中央寄せ */
        .menu-item.selected::after,
        .submenu-item.selected::after {
            order: 6;
            flex-basis: auto;
            width: fit-content;
            margin: 8px auto 0;
        }
        /* サブメニュー: メニューオプション（眉カット等）と同じボタン形状・配置 */
        .submenu-item {
            align-items: center !important;
            padding: 0.5rem !important;
            border: 2px solid #d1d5db !important;
            border-radius: 0.375rem !important;
            background: #fff;
        }
        .submenu-item.selected {
            border-color: var(--primary-color) !important;
        }
        .submenu-item .menu-item-content {
            flex: 1;
            min-width: 0;
            text-align: left;
        }
        .submenu-item .menu-item-info {
            flex-shrink: 0;
            margin-left: 10px;
            text-align: right;
        }
        /* カスタムフィールドの単一/複数選択: ご来店回数と同じボタンデザイン */
        .custom-field-radios,
        .custom-field-checkboxes {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 25px;
        }
        .choice-label {
            position: relative;
            flex: 1 1 45%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 14px 10px;
            border: 1px solid #ccc;
            border-radius: 2px;
            background-color: var(--white);
            color: #1b2a4e;
            cursor: pointer;
            font-size: 15px;
            font-weight: 500;
            text-align: center;
            transition: all 0.2s;
            word-break: break-word;
            line-height: 1.4;
        }
        @media (hover: hover) and (pointer: fine) {
            .choice-label:hover { border-color: var(--accent-color); background-color: #fffcf5; }
        }
        .choice-label input[type="radio"],
        .choice-label input[type="checkbox"] {
            position: absolute;
            opacity: 0;
            width: 1px;
            height: 1px;
            pointer-events: none;
        }
        .choice-label.selected {
            background-color: var(--primary-color);
            color: var(--white);
            border-color: var(--primary-color);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        .choice-label.selected::after {
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
        /* カテゴリー開閉ボタン: タップで開閉できることが分かるデザイン */
        .category-header {
            background: var(--white) !important;
            border: 1px solid #ccc !important;
            border-left: 6px solid var(--accent-color) !important;
            border-radius: 2px !important;
            color: #1b2a4e !important;
            font-size: 15px !important;
            font-weight: 700 !important;
            padding: 14px 12px !important;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .category-header::after {
            content: "タップで開く";
            font-size: 11px;
            font-weight: 500;
            margin-left: auto;
            margin-right: 10px;
            opacity: 0.75;
            white-space: nowrap;
        }
        .category-header.open::after { content: "タップで閉じる"; }
        .category-header-name { text-align: left; }
        .category-header-chevron { order: 1; border-color: #1b2a4e !important; }
        .category-header.open {
            background: var(--primary-color) !important;
            color: var(--white) !important;
            border-color: var(--primary-color) !important;
            border-left-color: var(--accent-color) !important;
        }
        .category-header.open .category-header-chevron { border-color: var(--white) !important; }
        /* カレンダー: ヘッダー・操作ボタン・凡例 */
        .calendar-header-bar {
            background: var(--primary-color);
            color: var(--white);
            padding: 15px 12px;
            border-radius: 6px 6px 0 0;
            display: flex;
            justify-content: center;
            align-items: center;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .calendar-header-bar .current-month {
            font-family: 'Poppins', 'Noto Sans JP', sans-serif;
            font-size: 20px;
            font-weight: 600;
            letter-spacing: 0.15em;
            border-bottom: 2px solid var(--accent-color);
            padding-bottom: 4px;
            color: var(--white) !important;
        }
        .calendar-controls {
            background-color: #fff;
            padding: 10px;
            border: 1px solid #696969;
            border-top: none;
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
        }
        .control-group { display: flex; gap: 5px; flex: 1; }
        .month-button, .week-button {
            padding: 8px 12px;
            background-color: #f0f0f0 !important;
            color: #333 !important;
            border: 1px solid #ccc !important;
            border-radius: 4px !important;
            font-size: 12px !important;
            font-weight: bold !important;
            flex: 1;
            white-space: nowrap;
            min-height: 36px;
            cursor: pointer;
        }
        .month-button:hover, .week-button:hover { background-color: #e0e0e0 !important; }
        .calendar-legend {
            display: flex;
            justify-content: flex-end;
            gap: 15px;
            padding: 8px 10px;
            background: #fff;
            border-left: 1px solid #696969;
            border-right: 1px solid #696969;
            font-size: 12px;
        }
        .legend-item { display: flex; align-items: center; gap: 5px; }
        .legend-marker { width: 14px; height: 14px; border-radius: 2px; display: inline-block; }
        .marker-ok { background-color: #fff; border: 1px solid var(--accent-color); position: relative; }
        .marker-ok::after {
            content: "〇";
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 10px;
            color: var(--accent-color);
            line-height: 1;
        }
        .marker-ng { background-color: #a0a0a0; color: #fff; text-align: center; line-height: 14px; font-size: 10px; }
        .calendar-table-wrapper {
            border: 1px solid #696969 !important;
            border-radius: 0 0 6px 6px !important;
            box-shadow: none !important;
            /* 縦に長いカレンダーは内部スクロールにして、日付ヘッダー行を追従表示させる */
            max-height: 65vh;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
        }
        #calendar-table thead th {
            position: sticky;
            top: 0;
            z-index: 2;
            /* border-collapse ではスクロール中にセル罫線が追従しないため box-shadow で線を描く */
            box-shadow: inset -1px 0 0 #696969, inset 0 -2px 0 #696969;
            border-top: none !important;
        }
        /* カレンダーのスクロールヒント（下部に追従表示、少しスクロールすると消える） */
        .calendar-scroll-hint {
            position: sticky;
            bottom: 0;
            z-index: 3;
            display: none;
            justify-content: center;
            align-items: center;
            gap: 6px;
            padding: 8px 0;
            font-size: 12px;
            font-weight: bold;
            letter-spacing: 1px;
            color: #ffffff;
            background: linear-gradient(to top, rgba(${themeRgb.r}, ${themeRgb.g}, ${themeRgb.b}, 0.85), rgba(${themeRgb.r}, ${themeRgb.g}, ${themeRgb.b}, 0.5));
            pointer-events: none;
        }
        .calendar-scroll-hint .scroll-hint-arrow {
            display: inline-block;
            animation: scrollHintBounce 1.2s ease-in-out infinite;
        }
        @keyframes scrollHintBounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(4px); }
        }
        /* カレンダーセル: 参考デザインのサイズ・書体 */
        #calendar-table { table-layout: fixed; min-width: 320px; }
        #calendar-table th {
            background-color: #f9f9f9 !important;
            color: #333 !important;
            font-weight: bold;
            padding: 8px 0 !important;
            font-size: 12px !important;
            border-bottom: 2px solid #696969 !important;
        }
        #calendar-table td {
            height: 40px;
            padding: 10px 0 !important;
            font-size: 14px !important;
            vertical-align: middle;
        }
        /* 予約可否の 〇× は太字で大きく表示（時間列は対象外） */
        #calendar-table td.calendar-cell {
            font-size: 19px !important;
            font-weight: bold !important;
            line-height: 1;
        }
        #calendar-table th:first-child,
        #calendar-table td:first-child {
            width: 50px !important;
            background-color: #f9f9f9 !important;
            font-weight: bold;
            font-size: 11px !important;
            color: #555 !important;
        }
        /* 満席セル: 濃グレー + 斜線パターン */
        #calendar-table td.calendar-cell.unavailable {
            background-color: #a0a0a0 !important;
            color: #ffffff !important;
            background-image: linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 50%, rgba(0, 0, 0, 0.08) 50%, rgba(0, 0, 0, 0.08) 75%, transparent 75%, transparent) !important;
            background-size: 8px 8px !important;
        }
        #calendar-table th:not(:first-child) { width: auto !important; }
        /* ご予約内容: 各項目の間に点線の区切り */
        .summary-item { padding: 8px 0 !important; margin: 0 !important; }
        .summary-item + .summary-item { border-top: 1px dashed #ccc; }
        /* メニュー/オプション詳細ポップアップ */
        #treatment-text {
            display: none;
            position: absolute;
            z-index: 1500;
            background-color: var(--white);
            width: 300px;
            max-width: 90vw;
            padding: 0;
            border-radius: 8px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
            border: 1px solid rgba(0, 0, 0, 0.05);
            border-top: 5px solid var(--accent-color);
            overflow: hidden;
            animation: fadeIn 0.3s ease;
        }
        #treatment-text .treatment-close {
            position: absolute;
            top: 5px;
            right: 5px;
            width: 30px;
            height: 30px;
            border: none;
            background: #f0f0f0;
            color: #999;
            border-radius: 50%;
            font-size: 18px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
        }
        #treatment-text .treatment-close:hover { background-color: var(--primary-color); color: var(--white); }
        .treatment-content { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
        .t-title-row {
            display: flex;
            align-items: center;
            font-size: 15px;
            font-weight: 700;
            color: #374151;
            padding-bottom: 6px;
            border-bottom: 1px solid #eee;
        }
        .t-title { letter-spacing: 0.05em; }
        .t-icon { margin-right: 6px; }
        .t-image { text-align: center; }
        .t-image img { max-width: 100%; max-height: 200px; height: auto; border-radius: 4px; display: inline-block; }
        .t-time-row {
            display: flex;
            align-items: center;
            font-size: 14px;
            font-weight: bold;
            color: #374151;
            border-bottom: 1px dashed #eee;
            padding-bottom: 8px;
        }
        .t-price-row { display: flex; justify-content: space-between; align-items: flex-end; background: #fdfdfd; }
        .t-price-label { font-size: 12px; color: #666; margin-bottom: 4px; }
        .t-price-val { font-size: 24px; font-weight: 800; color: #374151; line-height: 1; letter-spacing: 0.05em; }
        .t-detail { font-size: 12px; color: #555; line-height: 1.6; }
        .t-close-bottom {
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            background-color: var(--white);
            color: var(--text-color);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
        }
        .t-close-bottom:hover { border-color: var(--primary-color); background-color: var(--primary-color); color: var(--white); }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }
        /* 右端の追従ナビ */
        .side-nav {
            position: fixed;
            right: 0;
            top: 82%;
            transform: translateY(50%);
            background: var(--primary-color);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 8px 4px;
            border-radius: 8px 0 0 8px;
            z-index: 1000;
            width: 40px;
            box-shadow: -2px 2px 5px rgba(0, 0, 0, 0.2);
        }
        .side-nav a {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #ffffff;
            text-decoration: none;
            font-size: 10px;
            margin: 0;
            width: 100%;
            height: 40px;
            text-align: center;
        }
        .side-nav a span {
            font-size: 32px;
            font-weight: bold;
            display: block;
            line-height: 1;
            margin-bottom: 2px;
        }
        .side-nav a i { font-size: 16px; }
        @media (max-width: 600px) {
            .form-container { padding: 0 0 30px; }
            .form-header { border-radius: 0; }
            .form-content { border-radius: 0; box-shadow: none; padding: 20px 15px; }
            .form-header h1 { font-size: 20px; }
            .field-label { font-size: 15px; padding: 8px 10px; }
            .submit-button { font-size: 17px; padding: 16px; }
            #calendar-table th:first-child,
            #calendar-table td:first-child { width: 44px !important; font-size: 10px !important; }
            #calendar-table th { font-size: 11px !important; padding: 6px 0 !important; }
            #treatment-text { width: calc(100vw - 24px); max-width: 340px; }
            .side-nav { width: 35px; }
            .side-nav a span { font-size: 28px; }
        }
    `;
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
            background-color: var(--primary-color, #10b981) !important;
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

        .agreement-box {
            padding: 1rem;
            border: 2px solid #e5e7eb;
            border-radius: 0.5rem;
            background-color: #f9fafb;
        }

        .agreement-text {
            font-size: 0.875rem;
            color: #374151;
            line-height: 1.6;
            white-space: pre-wrap;
            max-height: 12rem;
            overflow-y: auto;
            background: #fff;
            border: 1px solid #e5e7eb;
            border-radius: 0.375rem;
            padding: 0.75rem;
            margin-bottom: 0.75rem;
        }

        .agreement-button {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 2px solid #d1d5db;
            border-radius: 0.375rem;
            background: #fff;
            color: #374151;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
        }

        .agreement-button.selected {
            border-color: ${themeColor};
            background-color: ${themeColor};
            color: #fff;
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
