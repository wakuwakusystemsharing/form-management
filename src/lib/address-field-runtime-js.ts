/**
 * 回答タイプ「住所入力」の静的 HTML 用の共通実装（予約フォーム / アンケート / 抽選フォームの 3 ジェネレータ共通）。
 *
 * マークアップ（`renderAddressFieldHtml` が出力）:
 *   <div class="address-field" data-address-for="{hiddenId}">
 *     <input type="hidden" id="{hiddenId}" ...>
 *     郵便番号 [data-part="zip"] / 案内 [data-part="status"]
 *     都道府県・市区町村・町名 [data-part="town"]（郵便番号から自動入力。手直しも可）
 *     番地・号 [data-part="street"] / 建物名・部屋番号（任意）[data-part="building"]
 *   </div>
 *
 * - 郵便番号が 7 桁になると zipcloud（日本郵便のデータを使った無料の検索 API。CORS 対応）で住所を調べ、町名までを自動入力する。
 *   見つからない / 通信できないときは案内を出すだけで、手入力で続けられる
 * - 郵便番号・町名まで・番地が揃うと hidden に「〒150-0001 東京都渋谷区神宮前1-2-3 ○○マンション 101」が入り、
 *   input / change イベントを発火する（既存の「入力欄の値を読む / 保存する / 復元する」コードがそのまま使える）。揃っていなければ空
 * - 復元などで hidden の値を直接書き換えたときは adSyncFromHidden(hidden) で 4 欄に反映する
 * - 公開プロキシ / プレビューの CSP（connect-src）に https://zipcloud.ibsnet.co.jp が必要
 * - 判定は TS 版（`address-field.ts`）と同じ実装。**直すときは両方**。埋め込み JS はバッククォート・バックスラッシュ不使用
 */

export const ADDRESS_ZIP_API_ORIGIN = 'https://zipcloud.ibsnet.co.jp';

export const ADDRESS_RUNTIME_JS = `
// ========== 住所入力（郵便番号 → 住所を自動入力）==========
var AD_ZIP_API = '${ADDRESS_ZIP_API_ORIGIN}/api/search?zipcode=';
var AD_MSG_SEARCHING = '住所を検索しています…';
var AD_MSG_NOT_FOUND = '該当する住所が見つかりませんでした。住所を入力してください。';
var AD_MSG_FAILED = '住所を自動入力できませんでした。お手数ですが住所を入力してください。';
function adToHalf(s) {
    return String(s || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
}
function adZipDigits(s) { return adToHalf(s).replace(/[^0-9]/g, ''); }
function adFormatZip(d) { return d.length === 7 ? d.slice(0, 3) + '-' + d.slice(3) : d; }
function adStrip(s) { return String(s || '').split(/[ 　]+/).join('').trim(); }
function adCollapse(s) { return String(s || '').split(/[ 　]+/).join(' ').trim(); }
// 4 欄 → 回答の文字列（郵便番号 7 桁・町名まで・番地が揃っていなければ空）
function adCompose(parts) {
    var digits = adZipDigits(parts.zip);
    var town = adStrip(parts.town);
    var street = adStrip(parts.street);
    var building = adCollapse(parts.building);
    if (digits.length !== 7 || !town || !street) return '';
    return '〒' + adFormatZip(digits) + ' ' + town + street + (building ? ' ' + building : '');
}
// 回答の文字列 → 4 欄（復元用。町名と番地は末尾の番地らしい並びで分ける）
function adParse(value) {
    var m = /^〒([0-9]{3})-([0-9]{4}) (.+)$/.exec(String(value || '').trim());
    if (!m) return null;
    var rest = m[3];
    var sp = rest.indexOf(' ');
    var head = sp === -1 ? rest : rest.slice(0, sp);
    var building = sp === -1 ? '' : rest.slice(sp + 1).trim();
    var s = /[0-9０-９][0-9０-９A-Za-z丁目番地号のノ‐－−ー-]*$/.exec(head);
    var street = (s && s.index > 0) ? s[0] : '';
    var town = street ? head.slice(0, head.length - street.length) : head;
    return { zip: m[1] + '-' + m[2], town: town, street: street, building: building };
}
function adParts(container) {
    return {
        zip: container.querySelector('[data-part="zip"]'),
        town: container.querySelector('[data-part="town"]'),
        street: container.querySelector('[data-part="street"]'),
        building: container.querySelector('[data-part="building"]'),
        status: container.querySelector('[data-part="status"]')
    };
}
function adSetStatus(container, text) {
    var p = adParts(container);
    if (!p.status) return;
    p.status.textContent = text || '';
    p.status.style.display = text ? 'block' : 'none';
}
// 4 欄から hidden の値を作り、変わったときだけ既存コード向けに input / change を発火
function adCommit(container) {
    var p = adParts(container);
    var hidden = document.getElementById(container.dataset.addressFor || '');
    if (!hidden || !p.zip || !p.town || !p.street || !p.building) return;
    var next = adCompose({ zip: p.zip.value, town: p.town.value, street: p.street.value, building: p.building.value });
    if (hidden.value === next) return;
    hidden.value = next;
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
}
// 郵便番号（7 桁）から住所を調べて町名までを入れる。同じ番号は調べ直さない
function adLookup(container) {
    var p = adParts(container);
    if (!p.zip || !p.town) return;
    var digits = adZipDigits(p.zip.value);
    if (digits.length !== 7) { container.dataset.adLastZip = ''; adSetStatus(container, ''); return; }
    if (container.dataset.adLastZip === digits) return;
    container.dataset.adLastZip = digits;
    if (typeof fetch !== 'function') return;
    adSetStatus(container, AD_MSG_SEARCHING);
    fetch(AD_ZIP_API + digits).then(function (res) { return res.json(); }).then(function (data) {
        // 調べている間に郵便番号が書き換えられていたら捨てる
        if (adZipDigits(p.zip.value) !== digits) return;
        var r = data && data.results && data.results[0];
        if (!r) { adSetStatus(container, AD_MSG_NOT_FOUND); return; }
        p.town.value = String(r.address1 || '') + String(r.address2 || '') + String(r.address3 || '');
        adSetStatus(container, '');
        // 郵便番号を打ち終えた流れのまま番地を入力できるようにする
        if (p.street && !p.street.value && document.activeElement === p.zip) p.street.focus();
        adCommit(container);
    }).catch(function () {
        if (adZipDigits(p.zip.value) !== digits) return;
        container.dataset.adLastZip = '';
        adSetStatus(container, AD_MSG_FAILED);
    });
}
function adEnsure(container) {
    if (!container || container.dataset.adReady === '1') return;
    var p = adParts(container);
    if (!p.zip || !p.town || !p.street || !p.building) return;
    p.zip.addEventListener('input', function () { adLookup(container); adCommit(container); });
    p.zip.addEventListener('blur', function () {
        var d = adZipDigits(p.zip.value);
        if (d.length === 7) p.zip.value = adFormatZip(d);
    });
    var onInput = function () { adCommit(container); };
    p.town.addEventListener('input', onInput);
    p.street.addEventListener('input', onInput);
    p.building.addEventListener('input', onInput);
    container.dataset.adReady = '1';
}
// hidden の値（復元・クリアなど）を 4 欄に反映する。住所の形でない値は空に戻す
function adSyncFromHidden(hidden) {
    if (!hidden) return;
    var container = hidden.closest ? hidden.closest('.address-field') : null;
    if (!container) return;
    adEnsure(container);
    var p = adParts(container);
    if (!p.zip || !p.town || !p.street || !p.building) return;
    var parts = adParse(hidden.value) || { zip: '', town: '', street: '', building: '' };
    p.zip.value = parts.zip;
    p.town.value = parts.town;
    p.street.value = parts.street;
    p.building.value = parts.building;
    // 復元した郵便番号では住所を調べ直さない（手直しした町名を上書きしないため）
    container.dataset.adLastZip = adZipDigits(parts.zip);
    adSetStatus(container, '');
    hidden.value = adCompose(parts);
}
function adInitAll(root) {
    var list = (root || document).querySelectorAll('.address-field');
    for (var i = 0; i < list.length; i++) adEnsure(list[i]);
}
// ========== 住所入力ここまで ==========
`;

/** 住所入力のマークアップ（3 ジェネレータ共通）。hiddenAttrs は hidden input に付ける追加属性（data-field-id 等） */
export function renderAddressFieldHtml(hiddenId: string, hiddenAttrs = ''): string {
  const row = (label: string, part: string, attrs: string) =>
    `<div class="address-row"><span class="address-sub-label">${label}</span>`
    + `<input type="text" class="input address-input" data-part="${part}" aria-label="${label}" ${attrs}></div>`;
  return `<div class="address-field" data-address-for="${hiddenId}">`
    + `<input type="hidden" id="${hiddenId}"${hiddenAttrs ? ' ' + hiddenAttrs : ''}>`
    + row('郵便番号', 'zip', 'inputmode="numeric" autocomplete="postal-code" maxlength="8" placeholder="例: 1500001"')
    + `<div class="address-status" data-part="status" aria-live="polite" style="display:none;"></div>`
    + row('都道府県・市区町村・町名', 'town', 'autocomplete="off" placeholder="郵便番号を入力すると自動で入ります"')
    + row('番地・号', 'street', 'autocomplete="off" placeholder="例: 1-2-3"')
    + row('建物名・部屋番号（任意）', 'building', 'autocomplete="off" placeholder="例: ○○マンション 101"')
    + `</div>`;
}

/** 住所入力の見た目（3 ジェネレータ共通。各フォームの .input のデザインをそのまま使い、縦に並べる） */
export const ADDRESS_CSS = `
        .address-field { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 100%; }
        .address-field .address-row { display: flex; flex-direction: column; gap: 4px; }
        .address-field .address-sub-label { font-size: 13px; color: #555; font-weight: normal; }
        .address-field .address-input { width: 100%; }
        .address-field .address-input[data-part="zip"] { max-width: 16em; }
        .address-field .address-status { font-size: 13px; color: #b45309; margin-top: -4px; }
`;
