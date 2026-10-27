/**
 * 宿泊モード（booking_mode = 'stay'）の静的 HTML 用: 埋め込み JS / CSS / 日時欄の HTML
 *
 * - STAY_RUNTIME_JS: 料金・空き・範囲選択の純粋ロジック（TS 版 src/lib/stay-pricing.ts / stay-availability.ts と同じ規則。
 *   Vitest で一致を検証）+ 画面の描画と操作（stayUi*。BookingForm のインスタンスを受け取る）
 * - 空き状況と料金は GET /api/stores/{storeId}/stay/availability から取る（料金変更を再デプロイなしで反映）。
 *   取得できないとき（プレビュー / 通信失敗）は FORM_CONFIG の設定で料金だけ計算し、全日「空き」として描く
 * - 祝日判定は先に埋め込まれる HOLIDAY_RUNTIME_JS の getEffectiveHolidayType を使う
 * - 埋め込み JS はバッククォート不使用（生成側のテンプレートリテラルと衝突しないため）
 */
import type { FormConfig, StaySettings } from '@/types/form';
import { createDefaultStaySettings, sanitizeStaySettings } from './stay-pricing';

export const STAY_RUNTIME_JS = `
// ========== 宿泊モード: 共通ロジック（TS 版: src/lib/stay-pricing.ts / stay-availability.ts）==========
function stayPad2(n) { return (n < 10 ? '0' : '') + n; }
function stayDateToUtc(d) { var p = String(d).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function stayMsToDate(ms) { var x = new Date(ms); return x.getUTCFullYear() + '-' + stayPad2(x.getUTCMonth() + 1) + '-' + stayPad2(x.getUTCDate()); }
function stayAddDays(d, n) { return stayMsToDate(stayDateToUtc(d) + n * 86400000); }
function stayDiffDays(a, b) { return Math.round((stayDateToUtc(b) - stayDateToUtc(a)) / 86400000); }
function stayDow(d) { return new Date(stayDateToUtc(d)).getUTCDay(); }
function stayIsDate(v) { return typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(v); }
function stayIsHoliday(d) {
    if (typeof getEffectiveHolidayType !== 'function' || !stayIsDate(d)) return false;
    var p = d.split('-').map(Number);
    return !!getEffectiveHolidayType(new Date(p[0], p[1] - 1, p[2]));
}
function stayNightsBetween(ci, co) {
    if (!stayIsDate(ci) || !stayIsDate(co)) return [];
    var n = stayDiffDays(ci, co);
    if (n < 1) return [];
    var out = [];
    for (var i = 0; i < n; i++) out.push(stayAddDays(ci, i));
    return out;
}
function stayPaidGuestCount(categories, counts) {
    var sum = 0;
    (categories || []).forEach(function (c) { if (c.charge === 'adult') sum += Math.max(0, Number(counts[c.id]) || 0); });
    return sum;
}
function stayCapacityCount(categories, counts) {
    var sum = 0;
    (categories || []).forEach(function (c) { if (c.counts_toward_capacity !== false) sum += Math.max(0, Number(counts[c.id]) || 0); });
    return sum;
}
function stayTableById(pricing, id) {
    if (!id) return null;
    var t = (pricing.rate_tables || []).filter(function (x) { return x.id === id; });
    return t.length ? t[0] : null;
}
// その夜に使う料金表（特定日 > 季節 > 祝日 > 祝前日 > 曜日 > 基本）
function stayResolveRateTable(pricing, date) {
    var fallback = stayTableById(pricing, pricing.default_rate_table_id) || (pricing.rate_tables || [])[0] || null;
    var specific = (pricing.date_rate_table_ids || []).filter(function (x) { return x.date === date; })[0];
    if (specific) return stayTableById(pricing, specific.rate_table_id) || fallback;
    var season = (pricing.seasons || []).filter(function (s) { return s.start <= date && date <= s.end; })[0];
    if (season) return stayTableById(pricing, season.rate_table_id) || fallback;
    if (stayIsHoliday(date)) { var h = stayTableById(pricing, pricing.holiday_rate_table_id); if (h) return h; }
    if (stayIsHoliday(stayAddDays(date, 1))) { var e = stayTableById(pricing, pricing.holiday_eve_rate_table_id); if (e) return e; }
    var w = stayTableById(pricing, (pricing.weekday_rate_table_ids || {})[String(stayDow(date))]);
    if (w) return w;
    return fallback;
}
function stayRateTablePrice(table, paid) {
    if (!table || !(paid >= 1) || Math.floor(paid) !== paid) return null;
    if (table.mode === 'per_person') return typeof table.per_person_price === 'number' ? table.per_person_price * paid : null;
    var prices = table.prices || {};
    var exact = prices[String(paid)];
    if (typeof exact === 'number') return exact;
    var keys = Object.keys(prices).map(Number).filter(function (n) { return isFinite(n) && n >= 1; });
    if (!keys.length) return null;
    var maxKey = Math.max.apply(null, keys);
    if (paid > maxKey && typeof table.extra_person_price === 'number') return prices[String(maxKey)] + table.extra_person_price * (paid - maxKey);
    return null;
}
function stayResolveNightPrice(settings, date, counts) {
    var table = stayResolveRateTable(settings.pricing || {}, date);
    var base = stayRateTablePrice(table, stayPaidGuestCount(settings.guest_categories, counts));
    if (base === null) return null;
    var extra = 0;
    (settings.guest_categories || []).forEach(function (c) {
        if (c.charge === 'fixed_per_night') extra += (Number(c.price) || 0) * Math.max(0, Number(counts[c.id]) || 0);
    });
    return base + extra;
}
function stayResolveDiscount(discounts, nights, subtotal) {
    if (!discounts || !discounts.length || nights < 1) return null;
    var best = null;
    discounts.forEach(function (d) { if (nights >= d.min_nights && (!best || d.min_nights > best.min_nights)) best = d; });
    if (!best) return null;
    var amount = 0;
    if (best.type === 'percent') amount = Math.floor(subtotal * best.value / 100);
    else if (best.type === 'per_night') amount = best.value * nights;
    else amount = best.value;
    amount = Math.max(0, Math.min(subtotal, amount));
    return { min_nights: best.min_nights, type: best.type, value: best.value, amount: amount };
}
var STAY_DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
function stayFormatDateJa(d, withYear) {
    var p = d.split('-');
    return (withYear === false ? '' : p[0] + '年') + p[1] + '月' + p[2] + '日（' + STAY_DOW_JA[stayDow(d)] + '）';
}
function stayFormatRangeJa(ci, co, nights) {
    var sameYear = ci.slice(0, 4) === co.slice(0, 4);
    return stayFormatDateJa(ci) + '〜' + stayFormatDateJa(co, !sameYear) + ' ' + nights + '泊';
}
function stayIsNightClosed(settings, date) {
    if ((settings.closed_weekdays || []).indexOf(stayDow(date)) !== -1) return true;
    if ((settings.closed_dates || []).indexOf(date) !== -1) return true;
    return (settings.closed_ranges || []).some(function (r) { return r.start <= date && date <= r.end; });
}
function staySelectableCheckouts(status, ci, settings) {
    var out = [];
    var minN = Math.max(1, settings.min_nights || 1);
    var maxN = settings.max_nights > 0 ? settings.max_nights : 365;
    for (var n = 1; n <= maxN; n++) {
        var night = stayAddDays(ci, n - 1);
        var st = status[night];
        if (!st || !st.available) break;
        if (n >= minN) out.push(stayAddDays(ci, n));
    }
    return out;
}
function stayRangeBookable(status, ci, co, settings) {
    var nights = stayNightsBetween(ci, co);
    if (!nights.length) return { ok: false, reason: 'チェックアウト日はチェックイン日より後にしてください' };
    if (nights.length < Math.max(1, settings.min_nights || 1)) return { ok: false, reason: settings.min_nights + '泊以上でご予約ください' };
    if (settings.max_nights > 0 && nights.length > settings.max_nights) return { ok: false, reason: '最大' + settings.max_nights + '泊までご予約いただけます' };
    for (var i = 0; i < nights.length; i++) {
        var st = status[nights[i]];
        if (!st || !st.available) return { ok: false, reason: nights[i] + ' は空きがありません' };
    }
    return { ok: true };
}
// API が使えないとき（プレビュー / 通信失敗）の代替: 休業・受付期間だけ見て全日「空き」、料金は埋め込み設定で計算
function stayLocalNightStatus(settings, cs, dates, counts, today) {
    var advDays = (cs && typeof cs.min_advance_days === 'number' && cs.min_advance_days > 0) ? Math.floor(cs.min_advance_days) : 0;
    var earliest = stayAddDays(today, advDays);
    var adv = cs && cs.advance_booking_days;
    var latest = stayAddDays(today, (typeof adv === 'number' && adv > 0) ? Math.floor(adv) : 30);
    var out = {};
    dates.forEach(function (d) {
        var price = stayResolveNightPrice(settings, d, counts);
        var reason = null;
        if (d < earliest || d > latest) reason = 'out_of_range';
        else if (stayIsNightClosed(settings, d)) reason = 'closed';
        else if (price === null) reason = 'no_price';
        out[d] = reason ? { available: false, remaining: 0, price: reason === 'no_price' ? null : price, reason: reason } : { available: true, remaining: settings.room_count || 1, price: price };
    });
    return out;
}
function stayYen(n) { return '¥' + Number(n || 0).toLocaleString(); }
function stayEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

// ========== 宿泊モード: 画面（form = BookingForm のインスタンス）==========
function stayUiSettings(form) {
    var cs = form.config.calendar_settings || {};
    var s = cs.stay_settings || {};
    var api = form.state.stayApiSettings || {};
    return {
        check_in_time: api.check_in_time || s.check_in_time || '15:00',
        check_out_time: api.check_out_time || s.check_out_time || '10:00',
        check_in_time_options: api.check_in_time_options || s.check_in_time_options || [],
        min_nights: (api.min_nights != null ? api.min_nights : s.min_nights) || 1,
        max_nights: (api.max_nights != null ? api.max_nights : s.max_nights) || 0,
        room_count: s.room_count || 1,
        show_price_on_calendar: api.show_price_on_calendar != null ? api.show_price_on_calendar : s.show_price_on_calendar !== false,
        price_note: api.price_note != null ? api.price_note : (s.price_note || ''),
        guest_categories: s.guest_categories || [],
        pricing: s.pricing || { rate_tables: [] },
        long_stay_discounts: api.long_stay_discounts || (s.pricing && s.pricing.long_stay_discounts) || [],
        closed_weekdays: s.closed_weekdays || [], closed_dates: s.closed_dates || [], closed_ranges: s.closed_ranges || []
    };
}
function stayUiGuestCounts(form) {
    var counts = {};
    var s = stayUiSettings(form);
    s.guest_categories.forEach(function (c) {
        var el = document.getElementById('stay-guest-' + c.id);
        var v = el ? parseInt(el.value, 10) : NaN;
        counts[c.id] = isFinite(v) ? v : (c.min || 0);
    });
    return counts;
}
function stayUiGuestText(form) {
    var s = stayUiSettings(form);
    var counts = stayUiGuestCounts(form);
    return s.guest_categories.filter(function (c) { return (counts[c.id] || 0) > 0; }).map(function (c) { return c.label + ' ' + counts[c.id] + '名'; }).join(' / ');
}
function stayUiCheckInTime(form) {
    var el = document.getElementById('stay-checkin-time');
    var s = stayUiSettings(form);
    if (el && el.value && s.check_in_time_options.indexOf(el.value) !== -1) return el.value;
    return s.check_in_time;
}
function stayUiToday() {
    var d = new Date(Date.now() + 9 * 3600000);
    return d.getUTCFullYear() + '-' + stayPad2(d.getUTCMonth() + 1) + '-' + stayPad2(d.getUTCDate());
}
// 2 か月並べるのはカレンダー欄の幅が十分あるときだけ（フォームのカードは最大 500px 程度なので通常は 1 か月）
function stayUiMonthsShown() {
    var wrap = typeof document !== 'undefined' ? document.getElementById('stay-calendars') : null;
    var w = wrap ? wrap.clientWidth : 0;
    return w >= 640 ? 2 : 1;
}
function stayUiMonthStart(ym) { return ym + '-01'; }
function stayUiMonthAdd(ym, n) {
    var p = ym.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    return d.getUTCFullYear() + '-' + stayPad2(d.getUTCMonth() + 1);
}
function stayUiMonthEnd(ym) { return stayAddDays(stayUiMonthStart(stayUiMonthAdd(ym, 1)), -1); }
function stayUiRange(form) {
    var first = stayUiMonthStart(form.state.stayMonth);
    var last = stayUiMonthEnd(stayUiMonthAdd(form.state.stayMonth, stayUiMonthsShown() - 1));
    return { from: first, to: stayAddDays(last, 1) };
}
function stayUiInit(form) {
    var st = form.state;
    st.stayCheckin = '';
    st.stayCheckout = '';
    st.stayStatus = {};
    st.stayApiSettings = null;
    st.stayDegraded = false;
    st.stayMonth = stayUiToday().slice(0, 7);
    st.stayFetchKey = '';
    var s = stayUiSettings(form);
    s.guest_categories.forEach(function (c) {
        var el = document.getElementById('stay-guest-' + c.id);
        if (el) el.addEventListener('change', function () { stayUiOnGuestChange(form); });
    });
    var ci = document.getElementById('stay-checkin-time');
    if (ci) ci.addEventListener('change', function () { form.updateSummary(); stayUiRenderQuote(form); });
    var prev = document.getElementById('stay-prev-month');
    var next = document.getElementById('stay-next-month');
    if (prev) prev.addEventListener('click', function () { stayUiNavigate(form, -1); });
    if (next) next.addEventListener('click', function () { stayUiNavigate(form, 1); });
    var toggle = document.getElementById('stay-quote-toggle');
    if (toggle) toggle.addEventListener('click', function () {
        var box = document.getElementById('stay-quote-detail');
        if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
    });
    if (typeof window !== 'undefined') {
        var lastShown = stayUiMonthsShown();
        window.addEventListener('resize', function () {
            var now = stayUiMonthsShown();
            if (now !== lastShown) { lastShown = now; stayUiRefresh(form); }
        });
    }
    var wrap = document.getElementById('stay-calendars');
    if (wrap) wrap.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.stay-day') : null;
        if (!btn || !btn.dataset || !btn.dataset.date) return;
        stayUiOnDayClick(form, btn.dataset.date);
    });
}
function stayUiNavigate(form, delta) {
    var today = stayUiToday().slice(0, 7);
    var next = stayUiMonthAdd(form.state.stayMonth, delta);
    if (next < today) next = today;
    form.state.stayMonth = next;
    stayUiRefresh(form);
}
function stayUiOnGuestChange(form) {
    form.state.stayStatus = {};
    form.state.stayFetchKey = '';
    stayUiRefresh(form).then(function () {
        // 人数を変えると料金が変わる。選択済みの範囲が取れなくなっていれば外す
        if (form.state.stayCheckin && form.state.stayCheckout) {
            var r = stayRangeBookable(form.state.stayStatus, form.state.stayCheckin, form.state.stayCheckout, stayUiSettings(form));
            if (!r.ok) { form.state.stayCheckin = ''; form.state.stayCheckout = ''; stayUiSyncSelected(form); stayUiRender(form); }
        }
    });
}
// 空き状況の取得 → 描画。force = キャッシュを使わない
function stayUiRefresh(form, force) {
    var range = stayUiRange(form);
    var counts = stayUiGuestCounts(form);
    var key = range.from + '|' + range.to + '|' + JSON.stringify(counts);
    if (!force && key === form.state.stayFetchKey) { stayUiRender(form); return Promise.resolve(); }
    stayUiRender(form, true);
    var done = function (status, apiSettings, degraded) {
        form.state.stayFetchKey = key;
        form.state.stayStatus = Object.assign({}, form.state.stayStatus, status);
        if (apiSettings) form.state.stayApiSettings = apiSettings;
        form.state.stayDegraded = !!degraded;
        stayUiRender(form);
    };
    var fallback = function () {
        var dates = [];
        for (var d = range.from; d <= range.to; d = stayAddDays(d, 1)) dates.push(d);
        done(stayLocalNightStatus(stayUiSettings(form), form.config.calendar_settings, dates, counts, stayUiToday()), null, true);
    };
    if ((typeof PREVIEW_MODE !== 'undefined' && PREVIEW_MODE) || typeof fetch !== 'function') { fallback(); return Promise.resolve(); }
    var url = window.location.origin + '/api/stores/' + encodeURIComponent(STORE_ID) + '/stay/availability'
        + '?form_id=' + encodeURIComponent(FORM_ID) + '&from=' + range.from + '&to=' + range.to + '&guests=' + encodeURIComponent(JSON.stringify(counts));
    return fetch(url, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('availability ' + res.status);
        return res.json();
    }).then(function (json) {
        done(json.nights || {}, json.settings || null, json.calendar_degraded);
    }).catch(function (err) {
        console.error('[stay] availability fetch error:', err);
        fallback();
    });
}
// 送信直前: 最新の空きで選択範囲を確認する
function stayUiVerifyBeforeSubmit(form) {
    var st = form.state;
    if (!st.stayCheckin || !st.stayCheckout) return Promise.resolve({ ok: false, reason: 'チェックイン日とチェックアウト日を選択してください' });
    return stayUiRefresh(form, true).then(function () {
        var r = stayRangeBookable(st.stayStatus, st.stayCheckin, st.stayCheckout, stayUiSettings(form));
        if (!r.ok) return { ok: false, reason: '申し訳ありません。選択された日程はただいま埋まってしまいました。別の日程をお選びください。' };
        var q = stayUiQuote(form);
        if (!q) return { ok: false, reason: 'この人数の料金が設定されていません。人数をご確認ください' };
        return { ok: true, quote: q };
    });
}
function stayUiOnDayClick(form, date) {
    var st = form.state;
    var s = stayUiSettings(form);
    var status = st.stayStatus[date];
    if (st.stayCheckin && !st.stayCheckout) {
        var outs = staySelectableCheckouts(st.stayStatus, st.stayCheckin, s);
        if (outs.indexOf(date) !== -1) {
            st.stayCheckout = date;
        } else if (status && status.available) {
            st.stayCheckin = date;
            st.stayCheckout = '';
        } else {
            return;
        }
    } else {
        if (!status || !status.available) return;
        st.stayCheckin = date;
        st.stayCheckout = '';
    }
    stayUiSyncSelected(form);
    stayUiRender(form);
    if (st.stayCheckin && !st.stayCheckout) {
        // 次の月にまたがるチェックアウトを選びやすいよう、月末のチェックインなら翌月も見えるようにする
        var lastVisible = stayUiMonthEnd(stayUiMonthAdd(st.stayMonth, stayUiMonthsShown() - 1));
        if (st.stayCheckin === lastVisible) stayUiNavigate(form, 1);
    }
}
// 既存の送信処理が使う selectedDate / selectedTime に反映する
function stayUiSyncSelected(form) {
    var st = form.state;
    if (st.stayCheckin && st.stayCheckout) {
        st.selectedDate = st.stayCheckin;
        st.selectedTime = stayUiCheckInTime(form);
    } else {
        st.selectedDate = '';
        st.selectedTime = '';
    }
    if (typeof form.updateSummary === 'function') form.updateSummary();
}
// 選択範囲の見積もり（夜ごとの料金は API の値。割引は設定）。料金が引けない夜があれば null
function stayUiQuote(form) {
    var st = form.state;
    if (!st.stayCheckin || !st.stayCheckout) return null;
    var nights = stayNightsBetween(st.stayCheckin, st.stayCheckout);
    if (!nights.length) return null;
    var perNight = [];
    var subtotal = 0;
    for (var i = 0; i < nights.length; i++) {
        var ns = st.stayStatus[nights[i]];
        if (!ns || typeof ns.price !== 'number') return null;
        perNight.push({ date: nights[i], price: ns.price });
        subtotal += ns.price;
    }
    var discount = stayResolveDiscount(stayUiSettings(form).long_stay_discounts, nights.length, subtotal);
    return { nights: nights.length, per_night: perNight, subtotal: subtotal, discount: discount, total: subtotal - (discount ? discount.amount : 0) };
}
function stayUiRenderQuote(form) {
    var box = document.getElementById('stay-quote');
    if (!box) return;
    var st = form.state;
    var s = stayUiSettings(form);
    if (!st.stayCheckin) { box.style.display = 'none'; return; }
    box.style.display = '';
    var head = document.getElementById('stay-quote-head');
    var detail = document.getElementById('stay-quote-detail');
    if (!st.stayCheckout) {
        if (head) head.innerHTML = '<div class="stay-quote-range">チェックイン: ' + stayEsc(stayFormatDateJa(st.stayCheckin)) + ' ' + stayEsc(stayUiCheckInTime(form)) + '</div><div class="stay-quote-sub">チェックアウト日をタップしてください</div>';
        if (detail) detail.style.display = 'none';
        return;
    }
    var q = stayUiQuote(form);
    var lines = '<div class="stay-quote-range">' + stayEsc(stayFormatDateJa(st.stayCheckin)) + ' ' + stayEsc(stayUiCheckInTime(form)) + ' チェックイン → '
        + stayEsc(stayFormatDateJa(st.stayCheckout, st.stayCheckin.slice(0, 4) !== st.stayCheckout.slice(0, 4))) + ' ' + stayEsc(s.check_out_time) + ' チェックアウト</div>';
    var guestText = stayUiGuestText(form);
    lines += '<div class="stay-quote-sub">' + stayNightsBetween(st.stayCheckin, st.stayCheckout).length + '泊' + (guestText ? ' / ' + stayEsc(guestText) : '') + '</div>';
    if (!q) {
        lines += '<div class="stay-quote-error">この人数の料金が設定されていません。人数をご確認ください。</div>';
        if (head) head.innerHTML = lines;
        if (detail) detail.style.display = 'none';
        return;
    }
    if (q.discount && q.discount.amount > 0) {
        lines += '<div class="stay-quote-price"><span class="stay-quote-strike">' + stayYen(q.subtotal) + '</span> → 連泊割引 −' + stayYen(q.discount.amount) + ' = <strong>' + stayYen(q.total) + '</strong></div>';
    } else {
        lines += '<div class="stay-quote-price"><strong>' + stayYen(q.total) + '</strong></div>';
    }
    if (s.price_note) lines += '<div class="stay-quote-note">' + stayEsc(s.price_note) + '</div>';
    lines += '<button type="button" class="stay-quote-toggle" id="stay-quote-toggle">内訳を見る</button>';
    if (head) head.innerHTML = lines;
    var toggle = document.getElementById('stay-quote-toggle');
    if (toggle && detail) toggle.addEventListener('click', function () { detail.style.display = detail.style.display === 'none' ? '' : 'none'; });
    if (detail) {
        detail.innerHTML = q.per_night.map(function (n) { return '<div class="stay-quote-line"><span>' + stayEsc(stayFormatDateJa(n.date, false)) + ' の夜</span><span>' + stayYen(n.price) + '</span></div>'; }).join('')
            + (q.discount && q.discount.amount > 0 ? '<div class="stay-quote-line stay-quote-discount"><span>連泊割引（' + q.discount.min_nights + '泊以上）</span><span>−' + stayYen(q.discount.amount) + '</span></div>' : '')
            + '<div class="stay-quote-line stay-quote-total"><span>合計</span><span>' + stayYen(q.total) + '</span></div>';
        detail.style.display = 'none';
    }
}
function stayUiRender(form, loading) {
    var wrap = document.getElementById('stay-calendars');
    if (!wrap) return;
    var st = form.state;
    var s = stayUiSettings(form);
    var months = stayUiMonthsShown();
    var outs = (st.stayCheckin && !st.stayCheckout) ? staySelectableCheckouts(st.stayStatus, st.stayCheckin, s) : [];
    var rangeNights = (st.stayCheckin && st.stayCheckout) ? stayNightsBetween(st.stayCheckin, st.stayCheckout) : [];
    var html = '';
    for (var m = 0; m < months; m++) {
        var ym = stayUiMonthAdd(st.stayMonth, m);
        var p = ym.split('-').map(Number);
        html += '<div class="stay-month">' + (months > 1 ? '<div class="stay-month-title">' + p[0] + '年' + p[1] + '月</div>' : '') + '<div class="stay-grid">';
        STAY_DOW_JA.forEach(function (w, i) { html += '<div class="stay-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>'; });
        var first = stayUiMonthStart(ym);
        var lead = stayDow(first);
        for (var b = 0; b < lead; b++) html += '<div class="stay-day stay-day-blank"></div>';
        var last = stayUiMonthEnd(ym);
        for (var d = first; d <= last; d = stayAddDays(d, 1)) {
            var ns = st.stayStatus[d];
            var dow = stayDow(d);
            var cls = ['stay-day'];
            if (dow === 0) cls.push('sun');
            if (dow === 6) cls.push('sat');
            var label = '';
            var disabled = false;
            if (loading && !ns) { cls.push('stay-day-loading'); label = '…'; disabled = true; }
            else if (!ns) { cls.push('stay-day-out'); label = 'ー'; disabled = true; }
            else if (ns.available) { cls.push('stay-day-ok'); label = s.show_price_on_calendar && typeof ns.price === 'number' ? stayYen(ns.price) : '◯'; }
            else if (ns.reason === 'full') { cls.push('stay-day-full'); label = '空室なし'; }
            else if (ns.reason === 'no_price') { cls.push('stay-day-full'); label = '料金なし'; }
            else { cls.push('stay-day-out'); label = 'ー'; }
            var canOut = outs.indexOf(d) !== -1;
            if (canOut) cls.push('stay-day-can-out');
            if (d === st.stayCheckin) cls.push('stay-day-in');
            if (d === st.stayCheckout) cls.push('stay-day-outsel');
            if (rangeNights.indexOf(d) !== -1 && d !== st.stayCheckin) cls.push('stay-day-range');
            if (!canOut && !(ns && ns.available)) disabled = true;
            html += '<button type="button" class="' + cls.join(' ') + '" data-date="' + d + '"' + (disabled ? ' disabled' : '') + '>'
                + '<span class="stay-day-num">' + Number(d.slice(8)) + '</span><span class="stay-day-label">' + label + '</span></button>';
        }
        html += '</div></div>';
    }
    wrap.innerHTML = html;
    var title = document.getElementById('stay-month-label');
    if (title) {
        var p1 = st.stayMonth.split('-').map(Number);
        var p2 = stayUiMonthAdd(st.stayMonth, months - 1).split('-').map(Number);
        title.textContent = months > 1 ? (p1[0] + '年' + p1[1] + '月 〜 ' + p2[0] + '年' + p2[1] + '月') : (p1[0] + '年' + p1[1] + '月');
    }
    var prev = document.getElementById('stay-prev-month');
    if (prev) prev.disabled = st.stayMonth <= stayUiToday().slice(0, 7);
    var hint = document.getElementById('stay-hint');
    if (hint) {
        hint.textContent = !st.stayCheckin ? 'チェックインする日をタップしてください'
            : (!st.stayCheckout ? 'チェックアウトする日をタップしてください（選べる日に印が付きます）' : '日程を変えるには別の日をタップしてください');
    }
    stayUiRenderQuote(form);
}
`;

export const STAY_CSS = `
        /* ===== 宿泊モード（チェックイン〜チェックアウト）===== */
        .stay-guests { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-bottom: 12px; }
        .stay-guests label, .stay-checkin-time label { display: flex; align-items: center; gap: 8px; font-size: 14px; color: #374151; }
        .stay-guests select, .stay-checkin-time select { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; background: #fff; }
        .stay-checkin-time { margin-bottom: 12px; }
        .stay-hint { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
        .stay-cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .stay-cal-nav button { padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; font-size: 14px; cursor: pointer; }
        .stay-cal-nav button:disabled { opacity: 0.4; cursor: default; }
        .stay-month-label { font-weight: 600; font-size: 15px; }
        .stay-cal-wrap { display: flex; gap: 16px; }
        .stay-month { flex: 1; min-width: 0; }
        .stay-month-title { text-align: center; font-weight: 600; margin-bottom: 6px; font-size: 15px; }
        .stay-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
        .stay-dow { text-align: center; font-size: 12px; color: #6b7280; padding: 4px 0; }
        .stay-dow.sun, .stay-day.sun .stay-day-num { color: #dc2626; }
        .stay-dow.sat, .stay-day.sat .stay-day-num { color: #2563eb; }
        .stay-day { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; overflow: hidden; min-height: 52px; padding: 4px 1px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; font-size: 12px; line-height: 1.2; touch-action: manipulation; }
        .stay-day-blank { border: none; background: transparent; cursor: default; }
        .stay-day-num { font-weight: 600; font-size: 14px; }
        .stay-day-label { font-size: 10px; margin-top: 2px; color: #1d4ed8; font-weight: 600; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
        .stay-day-full .stay-day-label, .stay-day-out .stay-day-label, .stay-day-loading .stay-day-label { color: #9ca3af; font-weight: 400; }
        .stay-day-full, .stay-day-out, .stay-day-loading { background: #f9fafb; }
        .stay-day-full .stay-day-num, .stay-day-out .stay-day-num { color: #9ca3af !important; }
        .stay-day:disabled { cursor: default; }
        .stay-day-can-out { border-color: var(--primary-color, #3B82F6); box-shadow: inset 0 0 0 1px var(--primary-color, #3B82F6); cursor: pointer; }
        .stay-day-can-out.stay-day-full .stay-day-label { color: var(--primary-color, #3B82F6); }
        .stay-day-can-out.stay-day-full .stay-day-label::after { content: '→OK'; font-size: 9px; }
        .stay-day-range { background: color-mix(in srgb, var(--primary-color, #3B82F6) 15%, #fff); }
        .stay-day-in, .stay-day-outsel { background: var(--primary-color, #3B82F6); border-color: var(--primary-color, #3B82F6); }
        .stay-day-in .stay-day-num, .stay-day-in .stay-day-label, .stay-day-outsel .stay-day-num, .stay-day-outsel .stay-day-label { color: #fff !important; }
        .stay-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 12px; color: #6b7280; margin-top: 8px; }
        .stay-legend span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; border: 1px solid #d1d5db; }
        .stay-legend .lg-ok::before { background: #fff; }
        .stay-legend .lg-full::before { background: #f3f4f6; }
        .stay-legend .lg-sel::before { background: var(--primary-color, #3B82F6); border-color: var(--primary-color, #3B82F6); }
        .stay-quote { margin-top: 12px; padding: 12px 14px; border: 1px solid #d1d5db; border-radius: 8px; background: #f8fafc; font-size: 14px; }
        .stay-quote-range { font-weight: 600; }
        .stay-quote-sub { color: #6b7280; font-size: 13px; margin-top: 2px; }
        .stay-quote-price { margin-top: 6px; font-size: 16px; }
        .stay-quote-price strong { font-size: 20px; }
        .stay-quote-strike { text-decoration: line-through; color: #9ca3af; }
        .stay-quote-note { font-size: 12px; color: #6b7280; margin-top: 2px; }
        .stay-quote-error { color: #b91c1c; margin-top: 6px; }
        .stay-quote-toggle { margin-top: 6px; background: none; border: none; color: var(--primary-color, #3B82F6); font-size: 13px; cursor: pointer; padding: 0; text-decoration: underline; }
        .stay-quote-detail { margin-top: 8px; border-top: 1px dashed #d1d5db; padding-top: 8px; }
        .stay-quote-line { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
        .stay-quote-discount { color: #047857; }
        .stay-quote-total { font-weight: 700; border-top: 1px solid #e5e7eb; margin-top: 4px; padding-top: 6px; }
        @media (max-width: 719px) { .stay-cal-wrap { display: block; } .stay-day { min-height: 48px; } }
`;

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** 宿泊モードの日時欄（id は従来と同じ datetime-field。表示 / 非表示の切替や「修正」ボタンがそのまま効く） */
export function renderStayFieldHtml(config: FormConfig, initiallyHidden: boolean): string {
  const settings: StaySettings = config.calendar_settings?.stay_settings
    ? sanitizeStaySettings(config.calendar_settings.stay_settings)
    : createDefaultStaySettings();
  const guests = settings.guest_categories.map((c) => {
    const options: string[] = [];
    for (let n = c.min; n <= c.max; n++) options.push(`<option value="${n}"${n === c.min ? ' selected' : ''}>${n}名</option>`);
    return `<label>${escapeHtml(c.label)}<select id="stay-guest-${escapeHtml(c.id)}" class="input">${options.join('')}</select></label>`;
  }).join('');
  const timeOptions = settings.check_in_time_options && settings.check_in_time_options.length > 0
    ? `<div class="stay-checkin-time"><label>チェックイン時刻<select id="stay-checkin-time" class="input">${settings.check_in_time_options.map((t) => `<option value="${escapeHtml(t)}"${t === settings.check_in_time ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label></div>`
    : `<div class="stay-checkin-time stay-hint">チェックイン ${escapeHtml(settings.check_in_time)} 以降 ／ チェックアウト ${escapeHtml(settings.check_out_time)} まで</div>`;
  return `
            <!-- 宿泊（チェックイン〜チェックアウト）。hide_datetime_until_menu_selected ON 時はメニュー選択まで非表示 -->
            <div class="field" id="datetime-field"${initiallyHidden ? ' style="display:none;"' : ''}>
                <label class="field-label">ご宿泊日 <span class="required">*</span></label>
                <div class="stay-guests" id="stay-guests">${guests}</div>
                ${timeOptions}
                <div class="stay-hint" id="stay-hint">チェックインする日をタップしてください</div>
                <div class="stay-cal-nav">
                    <button type="button" id="stay-prev-month">&#x25C0;&#xFE0E; 前月</button>
                    <span class="stay-month-label" id="stay-month-label"></span>
                    <button type="button" id="stay-next-month">翌月 &#x25B6;&#xFE0E;</button>
                </div>
                <div class="stay-cal-wrap" id="stay-calendars"></div>
                <div class="stay-legend"><span class="lg-ok">料金 = 空きあり</span><span class="lg-full">空室なし</span><span class="lg-sel">選択中</span></div>
                <div class="stay-quote" id="stay-quote" style="display:none;"><div id="stay-quote-head"></div><div class="stay-quote-detail" id="stay-quote-detail" style="display:none;"></div></div>
            </div>`;
}
