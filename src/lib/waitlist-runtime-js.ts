/**
 * 空き待ち（キャンセル待ち）の、予約フォーム（静的 HTML）側の部品。
 *
 * - 予約カレンダーの満席（✕）の時間をタップ → 確認ダイアログ → `POST /api/waitlist` で登録
 * - 「あなたの空き待ち（N件）」→ 一覧と取り消し（`GET /api/waitlist` / `POST /api/waitlist/cancel`）
 * - 空きのお知らせから開いたとき（URL の ?waitlist=空き待ちID）→ メニュー・スタッフ・日時を入力済みにする
 *   （`GET /api/waitlist/source`。埋まっていたら「すでに埋まりました」と案内。空き待ちは続く）
 *
 * 埋め込み JS はバッククォート・バックスラッシュを使わない（TS のテンプレート文字列に入れるため）。
 * `WAITLIST`（設定）・`FORM_ID`・`STORE_ID`・`window.bookingForm` を前提にする
 */

/** カレンダーの上に出す「あなたの空き待ち」と、ダイアログの入れ物（機能 ON のフォームだけ出力する） */
export function renderWaitlistBarHtml(): string {
  return `
                    <div id="waitlist-bar" class="waitlist-bar" style="display:none;">
                        <button type="button" class="waitlist-bar-button" onclick="wlOpenList()">🔔 あなたの空き待ち（<span id="waitlist-bar-count">0</span>件）</button>
                    </div>`;
}

export function renderWaitlistHintHtml(): string {
  return `
                    <div id="waitlist-hint" class="waitlist-hint" style="display:none;">満席（✕）の時間をタップすると、空き待ち（キャンセル待ち）に登録できます。「待」は登録済みの時間です。</div>`;
}

export function renderWaitlistModalHtml(): string {
  return `
    <div id="waitlist-modal" class="waitlist-modal" role="dialog" aria-modal="true" aria-label="空き待ち" style="display:none;" onclick="if(event.target===this){wlClose();}">
        <div class="waitlist-modal-card" id="waitlist-modal-body"></div>
    </div>`;
}

export const WAITLIST_CSS = `
        .waitlist-bar { padding: 8px 10px; background: #fff7ed; border-left: 1px solid #696969; border-right: 1px solid #696969; }
        .waitlist-bar-button { width: 100%; min-height: 40px; border: 1px solid #ea580c; border-radius: 6px; background: #fff; color: #c2410c; font-size: 14px; font-weight: 700; cursor: pointer; }
        .waitlist-hint { padding: 6px 10px; background: #fff; border-left: 1px solid #696969; border-right: 1px solid #696969; font-size: 12px; color: #9a3412; line-height: 1.5; }
        #calendar-table td.calendar-cell.waitlist { cursor: pointer !important; text-decoration: underline; }
        #calendar-table td.calendar-cell.waitlist-mine { background: #fff7ed !important; color: #ea580c !important; text-decoration: none; }
        .waitlist-modal { position: fixed; inset: 0; z-index: 2900; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
        .waitlist-modal-card { width: 100%; max-width: 420px; max-height: 86vh; overflow-y: auto; background: #fff; border-radius: 12px; padding: 20px 18px; box-sizing: border-box; font-size: 14px; line-height: 1.7; color: #111827; }
        .waitlist-modal-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; }
        .waitlist-modal-slot { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
        .waitlist-modal-slot-label { font-size: 12px; color: #9a3412; }
        .waitlist-modal-slot-value { font-weight: 700; }
        .waitlist-modal-note { font-size: 12px; color: #4b5563; margin-top: 6px; }
        .waitlist-modal-error { font-size: 13px; color: #b91c1c; margin-top: 10px; }
        .waitlist-modal-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
        .waitlist-modal-primary { min-height: 46px; border: none; border-radius: 8px; background: var(--primary-color); color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
        .waitlist-modal-primary:disabled { opacity: 0.6; cursor: default; }
        .waitlist-modal-secondary { min-height: 44px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #374151; font-size: 14px; cursor: pointer; }
        .waitlist-list-item { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin-top: 10px; }
        .waitlist-list-status { display: inline-block; font-size: 11px; padding: 1px 8px; border-radius: 10px; background: #ffedd5; color: #9a3412; margin-left: 6px; }
        .waitlist-list-cancel { margin-top: 8px; min-height: 36px; padding: 0 14px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #b91c1c; font-size: 13px; cursor: pointer; }
        .waitlist-list-cancel:disabled { opacity: 0.6; cursor: default; }
`;

export const WAITLIST_RUNTIME_JS = `
// ---- 空き待ち（キャンセル待ち）: src/lib/waitlist-runtime-js.ts ----
var WL_NOTE_NO_GUARANTEE = '空き待ちを登録しても、ご予約をお約束するものではありません。';
var WL_NOTE_FIRST_COME = 'お知らせは登録された方全員にお送りします。ご予約は先着順のため、開いたときには埋まっている場合があります。';

function wlEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 空き待ちを使える状態か（機能 ON + LINE のユーザーが分かっている + メニュー変更フォームではない）
function wlActive(form) {
    return !!(WAITLIST && WAITLIST.enabled && form && form.state.lineUserId && !form.state.menuChangeMode);
}

// 指名中のスタッフ（指名なし・未選択は空文字）
function wlStaffId(form) {
    var id = form.state.selectedStaffId;
    return id && id !== 'none' ? id : '';
}

// その枠で空き待ちを登録できるか（満席かどうかは呼び出し側が見る）: 受付締切（開始の N 時間前）より前
function wlCanRegister(form, slotStart, now) {
    if (!wlActive(form)) return false;
    return slotStart.getTime() - (WAITLIST.deadlineHours || 0) * 3600000 > now.getTime();
}

// その日時（+ いま選んでいるスタッフ）で登録済みの自分の空き待ち
function wlFindMine(form, date, time) {
    var list = form.state.waitlistEntries || [];
    var staff = wlStaffId(form);
    for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.form_id === FORM_ID && e.date === date && e.time === time && (e.staff_id || '') === staff) return e;
    }
    return null;
}

function wlDateText(date, time) {
    var p = String(date).split('-');
    var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    var w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    return parseInt(p[1], 10) + '/' + parseInt(p[2], 10) + '（' + w + '）' + (time ? ' ' + time : '');
}

// 所要時間（カレンダーの〇✕と同じ数え方: メニュー + オプション + ご来店回数の追加時間）
function wlDuration(form) {
    var d = form.getDurations();
    var visit = 0;
    var vc = form.config.visit_count_selection;
    if (form.state.visitCount && vc && vc.enabled) {
        var opt = (vc.options || []).filter(function(o) { return o.value === form.state.visitCount; })[0];
        if (opt && opt.duration) visit = opt.duration;
    }
    return (d.menuDuration || 0) + (d.optionsDuration || 0) + visit;
}

function wlModal() { return document.getElementById('waitlist-modal'); }
function wlBody() { return document.getElementById('waitlist-modal-body'); }
function wlShow(html) {
    var m = wlModal();
    var b = wlBody();
    if (!m || !b) return;
    b.innerHTML = html;
    m.style.display = 'flex';
}
function wlClose() {
    var m = wlModal();
    if (m) m.style.display = 'none';
    if (window.bookingForm) window.bookingForm.state.waitlistPending = null;
}

function wlRenderBar(form) {
    var bar = document.getElementById('waitlist-bar');
    var hint = document.getElementById('waitlist-hint');
    var list = form.state.waitlistEntries || [];
    if (bar) {
        bar.style.display = wlActive(form) && list.length > 0 ? '' : 'none';
        var count = document.getElementById('waitlist-bar-count');
        if (count) count.textContent = String(list.length);
    }
    if (hint) hint.style.display = wlActive(form) ? '' : 'none';
}

// 自分の空き待ちを取得して、カレンダーの「待」とバーに反映する
async function wlRefresh(form) {
    if (!wlActive(form)) { wlRenderBar(form); return; }
    try {
        var url = window.location.origin + '/api/waitlist?store_id=' + encodeURIComponent(STORE_ID) + '&line_user_id=' + encodeURIComponent(form.state.lineUserId);
        var res = await fetch(url);
        var data = await res.json().catch(function() { return {}; });
        form.state.waitlistEntries = (data && Array.isArray(data.entries)) ? data.entries : [];
    } catch (e) {
        form.state.waitlistEntries = form.state.waitlistEntries || [];
    }
    wlRenderBar(form);
    try { if (document.getElementById('calendar-table') && document.getElementById('calendar-table').innerHTML) form.renderCalendar(); } catch (e) {}
}

// 満席（✕）の時間をタップしたとき
function wlOpenDialog(form, date, time) {
    if (!wlActive(form)) return;
    // 前に開いたダイアログの「登録する日時」は捨てる（登録済み・上限の案内から登録が走らないように）
    form.state.waitlistPending = null;
    var mine = wlFindMine(form, date, time);
    var when = wlDateText(date, time);
    if (mine) {
        wlShow(
            '<div class="waitlist-modal-title">空き待ちに登録済みです</div>' +
            '<div class="waitlist-modal-slot"><div class="waitlist-modal-slot-label">ご希望の日時</div><div class="waitlist-modal-slot-value">' + wlEsc(when) + '</div></div>' +
            '<div>空きが出たら LINE でお知らせします。</div>' +
            '<div class="waitlist-modal-actions">' +
            '<button type="button" class="waitlist-modal-secondary" onclick="wlCancelEntry(&quot;' + wlEsc(mine.id) + '&quot;, this)">この空き待ちを取り消す</button>' +
            '<button type="button" class="waitlist-modal-secondary" onclick="wlClose()">閉じる</button>' +
            '</div><div id="waitlist-modal-error" class="waitlist-modal-error"></div>'
        );
        return;
    }
    var payload = form.buildSelectionPayload();
    var cats = (form.config.menu_structure && form.config.menu_structure.categories) || [];
    var hasMenus = cats.some(function(c) { return (c.menus || []).length > 0; });
    if (hasMenus && form.config.calendar_settings && form.config.calendar_settings.show_menu_field !== false && payload.selectedMenus.length === 0) {
        alert('空き待ちを登録するには、先にメニューを選択してください。');
        return;
    }
    if ((form.state.waitlistEntries || []).length >= (WAITLIST.maxPerUser || 3)) {
        wlShow(
            '<div class="waitlist-modal-title">空き待ちの上限です</div>' +
            '<div>空き待ちは ' + (WAITLIST.maxPerUser || 3) + ' 件まで登録できます。不要な空き待ちを取り消してからお試しください。</div>' +
            '<div class="waitlist-modal-actions">' +
            '<button type="button" class="waitlist-modal-primary" onclick="wlOpenList()">登録中の空き待ちを見る</button>' +
            '<button type="button" class="waitlist-modal-secondary" onclick="wlClose()">閉じる</button></div>'
        );
        return;
    }
    form.state.waitlistPending = { date: date, time: time };
    var menuText = payload.selectedMenus.map(function(m) { return m.submenu_name ? (m.menu_name + ' > ' + m.submenu_name) : m.menu_name; }).join('、');
    var staffName = '';
    var staffId = wlStaffId(form);
    if (staffId) {
        var member = ((form.config.staff_selection && form.config.staff_selection.staff) || []).filter(function(s) { return s.id === staffId; })[0];
        staffName = member ? member.name : '';
    }
    wlShow(
        '<div class="waitlist-modal-title">この時間は満席です</div>' +
        '<div>空き待ち（キャンセル待ち）に登録すると、空きが出たときに LINE でお知らせします。</div>' +
        '<div class="waitlist-modal-slot">' +
        '<div class="waitlist-modal-slot-label">ご希望の日時</div><div class="waitlist-modal-slot-value">' + wlEsc(when) + '</div>' +
        (menuText ? '<div class="waitlist-modal-slot-label" style="margin-top:6px;">メニュー</div><div>' + wlEsc(menuText) + '</div>' : '') +
        (staffName ? '<div class="waitlist-modal-slot-label" style="margin-top:6px;">担当</div><div>' + wlEsc(staffName) + '</div>' : '') +
        '</div>' +
        '<div class="waitlist-modal-note">※ ' + WL_NOTE_NO_GUARANTEE + '</div>' +
        '<div class="waitlist-modal-note">※ ' + WL_NOTE_FIRST_COME + '</div>' +
        '<div class="waitlist-modal-actions">' +
        '<button type="button" class="waitlist-modal-primary" id="waitlist-submit" onclick="wlSubmit()">空き待ちに登録する</button>' +
        '<button type="button" class="waitlist-modal-secondary" onclick="wlClose()">やめる</button>' +
        '</div><div id="waitlist-modal-error" class="waitlist-modal-error"></div>'
    );
}

function wlSetError(message) {
    var el = document.getElementById('waitlist-modal-error');
    if (el) el.textContent = message || '';
}

// 登録する
async function wlSubmit() {
    var form = window.bookingForm;
    if (!form || !wlActive(form)) return;
    var p = form.state.waitlistPending;
    if (!p || form.state.waitlistBusy) return;
    form.state.waitlistBusy = true;
    var btn = document.getElementById('waitlist-submit');
    if (btn) { btn.disabled = true; btn.textContent = '登録中…'; }
    wlSetError('');
    var done = false;
    try {
        var payload = form.buildSelectionPayload();
        var res = await fetch(window.location.origin + '/api/waitlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                store_id: STORE_ID,
                form_id: FORM_ID,
                line_user_id: form.state.lineUserId,
                customer_name: form.state.name || form.state.lineDisplayName || '',
                date: p.date,
                time: p.time,
                selected_menus: payload.selectedMenus,
                selected_options: payload.selectedOptions,
                total_duration: wlDuration(form),
                staff_id: wlStaffId(form) || null
            })
        });
        var data = await res.json().catch(function() { return {}; });
        if (res.status === 201) {
            done = true;
            form.state.waitlistPending = null;
            form.state.waitlistEntries = Array.isArray(data.entries) ? data.entries : [];
            wlRenderBar(form);
            try { form.renderCalendar(); } catch (e) {}
            wlShow(
                '<div class="waitlist-modal-title">空き待ちを受け付けました</div>' +
                '<div class="waitlist-modal-slot"><div class="waitlist-modal-slot-label">ご希望の日時</div><div class="waitlist-modal-slot-value">' + wlEsc(wlDateText(p.date, p.time)) + '</div></div>' +
                '<div>空きが出たら LINE でお知らせします。</div>' +
                '<div class="waitlist-modal-note">※ ' + WL_NOTE_NO_GUARANTEE + '</div>' +
                '<div class="waitlist-modal-note">※ ' + WL_NOTE_FIRST_COME + '</div>' +
                '<div class="waitlist-modal-note">登録中の空き待ちは、カレンダーの上の「あなたの空き待ち」または LINE で「空き待ち確認」と送ると確認・取り消しができます。</div>' +
                '<div class="waitlist-modal-actions"><button type="button" class="waitlist-modal-primary" onclick="wlClose()">閉じる</button></div>'
            );
            wlSendLineMessage(form, p, payload);
        } else if (data && data.code === 'slot_open') {
            // その時間は空いていた: カレンダーを取り直して、そのまま予約してもらう
            wlSetError((data && data.error) || 'この日時は現在ご予約いただけます。');
            form.availabilityCache = {};
            try { form.fetchAvailability(form.state.currentWeekStart); } catch (e) {}
        } else {
            wlSetError((data && data.error) || '空き待ちを登録できませんでした。時間をおいてもう一度お試しください。');
        }
    } catch (e) {
        wlSetError('空き待ちを登録できませんでした。通信状況をご確認のうえ、もう一度お試しください。');
    }
    form.state.waitlistBusy = false;
    if (!done) {
        var b = document.getElementById('waitlist-submit');
        if (b) { b.disabled = false; b.textContent = '空き待ちに登録する'; }
    }
}

// 登録したことを LINE のトークにも残す（Webhook が「空き待ちを受け付けました」のカードを返す）。送れなくても登録は済んでいる
function wlSendLineMessage(form, p, payload) {
    try {
        if (typeof liff === 'undefined' || !liff.isLoggedIn || !liff.isLoggedIn()) return;
        var NL = String.fromCharCode(10);
        var dp = p.date.split('-');
        var lines = ['【空き待ち登録】', '《ご希望の日時》', dp[0] + '年' + dp[1] + '月' + dp[2] + '日 ' + p.time];
        var menuLines = payload.menuMessageText || payload.selectedMenus.map(function(m) { return '・' + m.menu_name; }).join(NL);
        if (menuLines) { lines.push('《メニュー》'); lines.push(menuLines); }
        liff.sendMessages([{ type: 'text', text: lines.join(NL) }]).catch(function(err) {
            console.warn('空き待ちのメッセージ送信に失敗しました', err);
        });
    } catch (e) {}
}

// 「あなたの空き待ち」の一覧
function wlOpenList() {
    var form = window.bookingForm;
    if (!form) return;
    var list = form.state.waitlistEntries || [];
    var items = list.map(function(e) {
        return '<div class="waitlist-list-item">' +
            '<div><strong>' + wlEsc(e.date_text) + '</strong>' + (e.status === 'notified' ? '<span class="waitlist-list-status">空きをお知らせ済み</span>' : '') + '</div>' +
            (e.menu_text ? '<div>' + wlEsc(e.menu_text) + '</div>' : '') +
            (e.staff_name ? '<div>担当：' + wlEsc(e.staff_name) + '</div>' : '') +
            '<button type="button" class="waitlist-list-cancel" onclick="wlCancelEntry(&quot;' + wlEsc(e.id) + '&quot;, this)">取り消す</button>' +
            '</div>';
    }).join('');
    wlShow(
        '<div class="waitlist-modal-title">あなたの空き待ち</div>' +
        (items || '<div>登録中の空き待ちはありません。</div>') +
        '<div class="waitlist-modal-note" style="margin-top:12px;">空きが出たら LINE でお知らせします（先着順）。</div>' +
        '<div id="waitlist-modal-error" class="waitlist-modal-error"></div>' +
        '<div class="waitlist-modal-actions"><button type="button" class="waitlist-modal-secondary" onclick="wlClose()">閉じる</button></div>'
    );
}

// 取り消す
async function wlCancelEntry(id, btn) {
    var form = window.bookingForm;
    if (!form || !form.state.lineUserId) return;
    if (!window.confirm('この空き待ちを取り消しますか？')) return;
    if (btn) btn.disabled = true;
    try {
        var res = await fetch(window.location.origin + '/api/waitlist/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entry_id: id, store_id: STORE_ID, line_user_id: form.state.lineUserId })
        });
        var data = await res.json().catch(function() { return {}; });
        if (res.ok) {
            form.state.waitlistEntries = Array.isArray(data.entries) ? data.entries : [];
            wlRenderBar(form);
            try { form.renderCalendar(); } catch (e) {}
            if (form.state.waitlistEntries.length > 0) wlOpenList(); else wlClose();
            return;
        }
        wlSetError((data && data.error) || '空き待ちを取り消せませんでした。');
    } catch (e) {
        wlSetError('空き待ちを取り消せませんでした。通信状況をご確認のうえ、もう一度お試しください。');
    }
    if (btn) btn.disabled = false;
}

// URL の ?waitlist=空き待ちID（LIFF の liff.state 経由も含む）
function wlGetSourceId() {
    try {
        var pick = function(search) {
            var v = new URLSearchParams(search || '').get('waitlist');
            return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '';
        };
        var direct = pick(window.location.search);
        if (direct) return direct;
        var st = new URLSearchParams(window.location.search || '').get('liff.state');
        if (st) {
            var q = st.indexOf('?');
            return pick(q >= 0 ? st.slice(q) : st);
        }
    } catch (e) {}
    return '';
}

// 画面いちばん上の案内
function wlBanner(title, lines, isError) {
    var formContent = document.querySelector('.form-content');
    if (!formContent) return;
    var old = document.getElementById('waitlist-banner');
    if (old) old.remove();
    var banner = document.createElement('div');
    banner.id = 'waitlist-banner';
    banner.className = isError ? 'change-banner change-banner--error' : 'change-banner';
    var t = document.createElement('div');
    t.className = 'change-banner-title';
    t.textContent = title;
    banner.appendChild(t);
    (lines || []).forEach(function(line) {
        var p = document.createElement('div');
        p.textContent = line;
        banner.appendChild(p);
    });
    formContent.insertBefore(banner, formContent.firstChild);
    try { banner.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
}

// 空きのお知らせから開いたとき: 空き待ちの内容を取得する
async function wlLoadSource(form) {
    var id = wlGetSourceId();
    if (!id || !WAITLIST || !WAITLIST.enabled) return null;
    if (!form.state.lineUserId) return null;
    try {
        var url = window.location.origin + '/api/waitlist/source?entry_id=' + encodeURIComponent(id) +
            '&store_id=' + encodeURIComponent(STORE_ID) + '&line_user_id=' + encodeURIComponent(form.state.lineUserId);
        var res = await fetch(url);
        var data = await res.json().catch(function() { return {}; });
        if (res.ok && data && data.entry) return data.entry;
    } catch (e) {}
    wlBanner('空き待ちを確認できませんでした', ['お手数ですが、下のフォームからご希望の日時をお選びください。'], true);
    return null;
}

// 空き待ちのメニュー・スタッフ・日時を入力済みにする。埋まっていたら案内だけ出す（空き待ちは続く）
function wlApplySource(form, src) {
    if (!src) return;
    var when = src.date_text || wlDateText(src.date, src.time);
    if (!src.active) {
        wlBanner('この空き待ちは終了しています', [when + ' の空き待ちは、予約済み・取り消し済み、または日時を過ぎたため終了しています。', '下のフォームからご希望の日時をお選びください。'], true);
        return;
    }
    var cats = (form.config.menu_structure && form.config.menu_structure.categories) || [];
    var sel = { selectedMenus: {}, selectedSubMenus: {}, selectedMenuOptions: {}, selectedCategoryOptions: {} };
    (src.selected_menus || []).forEach(function(m) {
        if (!m || !m.menu_id) return;
        var has = function(c) { return (c.menus || []).some(function(x) { return x.id === m.menu_id; }); };
        var cat = cats.filter(function(c) { return has(c) && (c.display_name || c.name) === m.category_name; })[0] || cats.filter(has)[0];
        if (!cat) return;
        if (!sel.selectedMenus[cat.id]) sel.selectedMenus[cat.id] = [];
        if (sel.selectedMenus[cat.id].indexOf(m.menu_id) === -1) sel.selectedMenus[cat.id].push(m.menu_id);
        if (m.submenu_id) sel.selectedSubMenus[m.menu_id] = m.submenu_id;
    });
    (src.selected_options || []).forEach(function(o) {
        if (!o || !o.option_id || !o.menu_id) return;
        if (!sel.selectedMenuOptions[o.menu_id]) sel.selectedMenuOptions[o.menu_id] = [];
        sel.selectedMenuOptions[o.menu_id].push(o.option_id);
    });
    // 担当スタッフ（指名していなければ「指名なし」）
    try {
        var buttons = Array.prototype.slice.call(document.querySelectorAll('.staff-button'));
        var wanted = src.staff_id || 'none';
        var target = buttons.filter(function(b) { return b.dataset.staffId === wanted; })[0];
        if (target) {
            buttons.forEach(function(b) { b.classList.remove('selected'); });
            target.classList.add('selected');
            form.state.selectedStaffId = wanted;
            if (form.applyStaffMenuVisibility) form.applyStaffMenuVisibility();
        }
    } catch (e) {}
    // ご来店回数を選ぶまでメニューを隠す設定でも、メニュー欄は出す
    var menuField = document.getElementById('menu-field');
    if (menuField) menuField.style.display = '';
    if (Object.keys(sel.selectedMenus).length > 0) {
        try { form.handleRepeatBooking(sel); } catch (e) {}
    }
    // メニューの復元（少し遅れて終わる）のあとで、その週を取り直して日時を選ぶ。
    // 埋まっていれば renderCalendar が選択を外すので、選択が残っていれば「予約できる」
    setTimeout(async function() {
        try {
            var p = src.date.split('-');
            var day = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
            form.state.currentWeekStart = form.getWeekStart(day);
            form.availabilityCache = {};
            form.state.selectedDate = src.date;
            form.state.selectedTime = src.time;
            await form.fetchAvailability(form.state.currentWeekStart);
            var cell = document.querySelector('.calendar-cell[data-date="' + src.date + '"][data-time="' + src.time + '"]');
            var open = !!cell && !cell.classList.contains('unavailable') && form.state.selectedDate === src.date && form.state.selectedTime === src.time;
            if (open) {
                form.updateSummary();
                wlBanner('空きが出た日時を選択しました', [when + ' を選んだ状態です。内容をご確認のうえ、いちばん下のボタンからご予約ください。', '※ ご予約は先着順です。送信した時点で埋まっている場合があります。'], false);
            } else {
                form.state.selectedDate = '';
                form.state.selectedTime = '';
                form.updateSummary();
                wlBanner('この枠はすでに埋まりました', ['申し訳ありません。' + when + ' は、ほかのお客様のご予約で埋まりました。', '空き待ちは継続しています。また空きが出たら LINE でお知らせします。', 'ほかの日時は、下のフォームからそのままご予約いただけます。'], true);
            }
        } catch (e) {}
    }, 700);
}

// 初期化（LIFF の初期化のあとに呼ぶ）
async function wlInit(form) {
    if (!WAITLIST || !WAITLIST.enabled) return;
    var srcPromise = wlLoadSource(form);
    await wlRefresh(form);
    try {
        var src = await srcPromise;
        if (src) wlApplySource(form, src);
    } catch (e) {}
}
`;
