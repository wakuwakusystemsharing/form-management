/**
 * 静的 HTML に埋め込む共通 JavaScript（vanilla JS の文字列）
 *
 * - HOLIDAY_RUNTIME_JS: 日本の祝日判定（1980-2099 年）と YYYY-MM-DD 整形
 * - MULTIPLE_DATES_RUNTIME_JS: 第三希望日時選択（曜日別受付時間 / 祝日 / 臨時営業日 / ✕時間帯 / 追加の時間帯）
 *
 * 予約フォーム（StaticReservationGenerator）とアンケート（StaticSurveyGenerator）の両方が
 * この文字列をそのまま <script> に埋め込み、同じ判定ロジックを共有する。
 * LINE LIFF 互換のため ES5 寄りの記法・バッククォート不使用。
 */

export const HOLIDAY_RUNTIME_JS = `
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
// ローカル時刻ベースで YYYY-MM-DD を生成（toISOString は UTC 変換で日付が前日にズレるため使わない）
function formatLocalYmd(d) {
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}
// ========== 祝日判定ロジックここまで ==========
`;

export const MULTIPLE_DATES_RUNTIME_JS = `
// ========== 第三希望日時選択（共通ロジック）==========
// 臨時営業日: 設定リストから当日分（YYYY-MM-DD 一致）を返す。無ければ null
function mdFindSpecialBusinessDay(list, date) {
    if (!Array.isArray(list) || !date) return null;
    const ymd = formatLocalYmd(date);
    for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e && typeof e === 'object' && e.date === ymd && typeof e.open === 'string' && typeof e.close === 'string') return e;
    }
    return null;
}
// 当日の受付時間: 臨時営業日 > 祝日の受付時間 > 曜日別 > レガシー（exclude_weekdays + start/end）
function mdGetWeekdayHours(settings, dayOfWeek, date) {
    settings = settings || {};
    const sp = date ? mdFindSpecialBusinessDay(settings.special_business_days, date) : null;
    if (sp) {
        return { open: sp.open, close: sp.close, closed: false, custom: false, custom_slots: [], extra_slots: [], special: true };
    }
    const hh = settings.holiday_hours;
    if (date && hh && hh.enabled === true && getEffectiveHolidayType(date)) {
        return {
            open: hh.open || '09:00',
            close: hh.close || '18:00',
            closed: false,
            custom: hh.custom === true,
            custom_slots: Array.isArray(hh.custom_slots) ? hh.custom_slots : [],
            extra_slots: Array.isArray(hh.extra_slots) ? hh.extra_slots : []
        };
    }
    if (settings.weekday_hours && settings.weekday_hours[String(dayOfWeek)]) {
        const wh = settings.weekday_hours[String(dayOfWeek)];
        return {
            open: wh.open,
            close: wh.close,
            closed: wh.closed,
            custom: wh.custom === true,
            custom_slots: Array.isArray(wh.custom_slots) ? wh.custom_slots : [],
            extra_slots: Array.isArray(wh.extra_slots) ? wh.extra_slots : []
        };
    }
    return {
        open: settings.start_time || '09:00',
        close: settings.end_time || '18:00',
        closed: (settings.exclude_weekdays || []).indexOf(dayOfWeek) !== -1,
        custom: false,
        custom_slots: [],
        extra_slots: []
    };
}
// 日付を選択肢に出せるか: 定休曜日は ✕（祝日の受付時間 ON の祝日は受付）、
// isHolidayBlocked(date) が true の祝日は ✕。臨時営業日はどちらにも優先して受付
function mdIsDateSelectable(settings, date, isHolidayBlocked) {
    const hours = mdGetWeekdayHours(settings, date.getDay(), date);
    if (hours.closed) return false;
    if (hours.special) return true;
    if (typeof isHolidayBlocked === 'function' && isHolidayBlocked(date)) return false;
    return true;
}
// 日付の選択肢を作る。opts: { minAdvanceDays, isHolidayBlocked, placeholder }
function mdPopulateDateOptions(select, settings, opts) {
    if (!select) return;
    opts = opts || {};
    select.innerHTML = '';
    const today = new Date();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = opts.placeholder || '日付を選択';
    select.appendChild(defaultOption);
    const start = (typeof opts.minAdvanceDays === 'number' && opts.minAdvanceDays > 0) ? Math.floor(opts.minAdvanceDays) : 0;
    const rangeDays = (typeof settings.date_range_days === 'number' && settings.date_range_days > 0) ? settings.date_range_days : 30;
    for (let i = start; i < rangeDays; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        if (!mdIsDateSelectable(settings, date, opts.isHolidayBlocked)) continue;
        const option = document.createElement('option');
        option.value = formatLocalYmd(date);
        option.textContent = date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' });
        select.appendChild(option);
    }
}
// 時間の選択肢を作る。opts: { minAdvanceHours, placeholder }
function mdPopulateTimeOptions(select, settings, selectedDateStr, opts) {
    if (!select) return;
    opts = opts || {};
    select.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = opts.placeholder || '時間を選択';
    select.appendChild(defaultOption);

    let startTime = settings.start_time || '09:00';
    let endTime = settings.end_time || '18:00';
    let extraSlots = [];
    if (selectedDateStr) {
        const selectedDate = new Date(selectedDateStr + 'T00:00:00');
        const hours = mdGetWeekdayHours(settings, selectedDate.getDay(), selectedDate);
        startTime = hours.open;
        endTime = hours.close;
        extraSlots = hours.extra_slots || [];
        // カスタム受付時間: 自由入力の時間帯テキストをそのまま選択肢にする
        if (hours.custom && hours.custom_slots.length > 0) {
            hours.custom_slots
                .map(t => String(t).trim())
                .filter(Boolean)
                .forEach(text => {
                    const option = document.createElement('option');
                    option.value = text;
                    option.textContent = text;
                    select.appendChild(option);
                });
            return;
        }
    }
    const timeSlots = mdGenerateTimeSlots(startTime, endTime, settings.time_interval, settings.extra_minutes);

    const normalizeBlocked = (t) => { const m = /^([0-9]{1,2}):([0-9]{2})/.exec(t || ''); return m ? String(parseInt(m[1], 10)).padStart(2, '0') + ':' + m[2] : ''; };
    const blockedTimes = new Set((settings.blocked_times || []).map(normalizeBlocked).filter(Boolean));
    const blockedWeekdaysMap = {};
    Object.entries(settings.blocked_time_weekdays || {}).forEach(([t, days]) => {
        const key = normalizeBlocked(t);
        if (key && Array.isArray(days) && days.length > 0) blockedWeekdaysMap[key] = days;
    });
    const selectedDayOfWeek = selectedDateStr ? new Date(selectedDateStr + 'T00:00:00').getDay() : null;
    const isBlockedForSelectedDay = (time) => {
        if (!blockedTimes.has(time)) return false;
        const days = blockedWeekdaysMap[time];
        if (!days) return true;
        return selectedDayOfWeek !== null && days.indexOf(selectedDayOfWeek) !== -1;
    };
    const minAdvThreshold = (typeof opts.minAdvanceHours === 'number' && opts.minAdvanceHours > 0)
        ? Date.now() + opts.minAdvanceHours * 3600000
        : 0;
    const visibleSlots = timeSlots.filter(time => {
        if (isBlockedForSelectedDay(time)) return false;
        if (minAdvThreshold && selectedDateStr) {
            const slotMs = new Date(selectedDateStr + 'T' + time + ':00').getTime();
            if (Number.isFinite(slotMs) && slotMs < minAdvThreshold) return false;
        }
        return true;
    });
    mdInsertExtraSlots(visibleSlots, timeSlots, extraSlots).forEach(time => {
        const option = document.createElement('option');
        option.value = time;
        option.textContent = time;
        select.appendChild(option);
    });
}
// 追加の時間帯（午前中 など）を指定位置に差し込む。'HH:MM' 指定はその時刻の直後
// （その時刻が✕などで消えている場合は、それより後の最初の時刻の前）
function mdInsertExtraSlots(visibleSlots, allSlots, extraSlots) {
    const result = visibleSlots.slice();
    const labels = (extraSlots || [])
        .map(s => ({ label: String((s && s.label) || '').trim(), after: String((s && s.after) || 'end') }))
        .filter(s => s.label && result.indexOf(s.label) === -1);
    labels.filter(s => s.after === 'start').forEach((s, i) => result.splice(i, 0, s.label));
    labels.filter(s => s.after !== 'start' && s.after !== 'end').forEach(s => {
        const idx = result.indexOf(s.after);
        if (idx !== -1) { result.splice(idx + 1, 0, s.label); return; }
        const order = allSlots.indexOf(s.after);
        let insertAt = result.length;
        for (let i = 0; i < result.length; i++) {
            const pos = allSlots.indexOf(result[i]);
            if (pos !== -1 && (order === -1 ? result[i] > s.after : pos > order)) { insertAt = i; break; }
        }
        result.splice(insertAt, 0, s.label);
    });
    labels.filter(s => s.after === 'end').forEach(s => result.push(s.label));
    return result;
}
// 「追加で表示する分」: 営業時間内の毎時 extraMinutes の分を時間間隔の行に加える（昇順・重複なし）
function mdAddExtraMinuteSlots(baseMinutes, startMin, endMin, extraMinutes) {
    const set = new Set(baseMinutes);
    const extras = Array.isArray(extraMinutes) ? extraMinutes.filter(n => Number.isInteger(n) && n >= 0 && n <= 59) : [];
    if (extras.length > 0) {
        for (let h = Math.floor(startMin / 60); h * 60 < endMin; h++) {
            extras.forEach(mm => {
                const m = h * 60 + mm;
                if (m >= startMin && m < endMin) set.add(m);
            });
        }
    }
    return Array.from(set).sort((a, b) => a - b);
}
function mdGenerateTimeSlots(startTime, endTime, interval, extraMinutes) {
    const [startHour, startMin] = String(startTime || '09:00').split(':').map(Number);
    const [endHour, endMin] = String(endTime || '18:00').split(':').map(Number);
    const start = startHour * 60 + startMin;
    const end = endHour * 60 + endMin;
    const step = (typeof interval === 'number' && interval > 0) ? interval : 30;
    const base = [];
    for (let m = start; m < end; m += step) base.push(m);
    return mdAddExtraMinuteSlots(base, start, end, extraMinutes)
        .map(m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
}
// "2026-10-01" + "10:00" → "2026年10月01日（木） 10:00"（時間はカスタム文言の場合もそのまま付ける）
function mdFormatDateTimeJa(dateStr, timeStr) {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateStr || '');
    if (!m) return (dateStr || '') + (timeStr ? ' ' + timeStr : '');
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const dow = isNaN(d.getTime()) ? '' : '（' + ['日', '月', '火', '水', '木', '金', '土'][d.getDay()] + '）';
    return m[1] + '年' + m[2] + '月' + m[3] + '日' + dow + (timeStr ? ' ' + timeStr : '');
}
// ========== 第三希望日時選択ここまで ==========
`;

/**
 * 誕生日選択（年 / 月 / 日を別々のプルダウンで選ぶ）
 *
 * マークアップ（各ジェネレータが出力）:
 *   <div class="birthday-field" data-birthday-for="{hiddenId}">
 *     <input type="hidden" id="{hiddenId}" ...>
 *     <select class="input birthday-select" data-part="y"></select><span class="birthday-unit">年</span>
 *     <select class="input birthday-select" data-part="m"></select><span class="birthday-unit">月</span>
 *     <select class="input birthday-select" data-part="d"></select><span class="birthday-unit">日</span>
 *   </div>
 * 3 つとも選ぶと hidden に "YYYY-MM-DD" が入り、input / change イベントを発火する
 * （既存の「入力欄の値を読む / 保存する / 復元する」コードがそのまま使える）。
 * 復元などで hidden の値を直接書き換えたときは bdSyncFromHidden(hidden) でプルダウンに反映する
 */
export const BIRTHDAY_RUNTIME_JS = `
// ========== 誕生日選択（年 / 月 / 日プルダウン）==========
var BD_YEAR_SPAN = 100;
function bdPad(n) { return String(n).padStart(2, '0'); }
function bdDaysInMonth(y, m) {
    if (!y || !m) return 31;
    return new Date(Number(y), Number(m), 0).getDate();
}
function bdFill(select, values, placeholder, current) {
    var prev = current !== undefined ? current : select.value;
    select.innerHTML = '';
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    select.appendChild(ph);
    for (var i = 0; i < values.length; i++) {
        var o = document.createElement('option');
        o.value = String(values[i]);
        o.textContent = String(values[i]);
        select.appendChild(o);
    }
    if (prev && values.map(String).indexOf(String(prev)) !== -1) select.value = String(prev);
}
function bdParts(container) {
    return {
        y: container.querySelector('select[data-part="y"]'),
        m: container.querySelector('select[data-part="m"]'),
        d: container.querySelector('select[data-part="d"]')
    };
}
// 年（今年 → 100 年前）・月・日の選択肢を作る（何度呼んでも安全）
function bdEnsure(container) {
    if (!container || container.dataset.bdReady === '1') return;
    var p = bdParts(container);
    if (!p.y || !p.m || !p.d) return;
    var thisYear = new Date().getFullYear();
    var years = [];
    for (var y = thisYear; y >= thisYear - BD_YEAR_SPAN; y--) years.push(y);
    var months = [];
    for (var m = 1; m <= 12; m++) months.push(m);
    var days = [];
    for (var d = 1; d <= 31; d++) days.push(d);
    bdFill(p.y, years, '----');
    bdFill(p.m, months, '--');
    bdFill(p.d, days, '--');
    var onChange = function () { bdCommit(container); };
    p.y.addEventListener('change', onChange);
    p.m.addEventListener('change', onChange);
    p.d.addEventListener('change', onChange);
    container.dataset.bdReady = '1';
}
// 3 つの選択から hidden の値（YYYY-MM-DD）を作り、既存コード向けに input / change を発火
function bdCommit(container) {
    var p = bdParts(container);
    if (!p.y || !p.m || !p.d) return;
    // 月・年に合わせて日の選択肢を作り直す（2 月 → 28 / 29 日まで）
    var maxDay = bdDaysInMonth(p.y.value, p.m.value);
    var days = [];
    for (var d = 1; d <= maxDay; d++) days.push(d);
    bdFill(p.d, days, '--');
    var hidden = document.getElementById(container.dataset.birthdayFor || '');
    if (!hidden) return;
    var next = (p.y.value && p.m.value && p.d.value) ? p.y.value + '-' + bdPad(p.m.value) + '-' + bdPad(p.d.value) : '';
    if (hidden.value === next) return;
    hidden.value = next;
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
}
// hidden の値（復元など）をプルダウンに反映する
function bdSyncFromHidden(hidden) {
    if (!hidden) return;
    var container = hidden.closest ? hidden.closest('.birthday-field') : null;
    if (!container) return;
    bdEnsure(container);
    var p = bdParts(container);
    var m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(hidden.value || '');
    if (!m) { p.y.value = ''; p.m.value = ''; p.d.value = ''; bdCommit(container); return; }
    p.y.value = String(Number(m[1]));
    p.m.value = String(Number(m[2]));
    var maxDay = bdDaysInMonth(p.y.value, p.m.value);
    var days = [];
    for (var d = 1; d <= maxDay; d++) days.push(d);
    bdFill(p.d, days, '--');
    p.d.value = String(Number(m[3]));
    // 選択肢に無い値（未来の年など）は反映されないので hidden も空に戻す
    if (!p.y.value || !p.m.value || !p.d.value) { hidden.value = ''; }
}
function bdInitAll(root) {
    var list = (root || document).querySelectorAll('.birthday-field');
    for (var i = 0; i < list.length; i++) bdEnsure(list[i]);
}
// ========== 誕生日選択ここまで ==========
`;

/** 誕生日選択のマークアップ（3 ジェネレータ共通）。hiddenAttrs は hidden input に付ける追加属性（data-field-id 等） */
export function renderBirthdayFieldHtml(hiddenId: string, hiddenAttrs = ''): string {
  return `<div class="birthday-field" data-birthday-for="${hiddenId}">`
    + `<input type="hidden" id="${hiddenId}"${hiddenAttrs ? ' ' + hiddenAttrs : ''}>`
    + `<select class="input birthday-select" data-part="y" aria-label="年"></select><span class="birthday-unit">年</span>`
    + `<select class="input birthday-select" data-part="m" aria-label="月"></select><span class="birthday-unit">月</span>`
    + `<select class="input birthday-select" data-part="d" aria-label="日"></select><span class="birthday-unit">日</span>`
    + `</div>`;
}

/** 誕生日選択の見た目（3 ジェネレータ共通。各フォームの .input のデザインに合わせて横並びにする） */
export const BIRTHDAY_CSS = `
        .birthday-field { display: flex; align-items: center; gap: 6px; width: 100%; max-width: 100%; }
        .birthday-field .birthday-select { flex: 1 1 0; min-width: 0; width: auto; min-height: 48px; padding-left: 10px; padding-right: 26px; -webkit-appearance: none; appearance: none;
            background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23666' stroke-width='1.6'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: right 8px center; }
        .birthday-field .birthday-select[data-part="y"] { flex: 1.7 1 0; }
        .birthday-field .birthday-unit { flex: 0 0 auto; font-size: 14px; color: #555; }
`;
