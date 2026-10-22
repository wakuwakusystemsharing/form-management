/**
 * ドロップダウン選択の「検索・絞り込み機能」: 静的 HTML に埋め込む描画 / CSS / JS（予約フォーム・アンケート共通）。
 *
 * 仕組み: 元の <select id="{selectId}"> はそのまま出力して非表示にし（値の入れ物として使う）、
 * その上に 名前検索 + 五十音ボタン + 絞り込みリスト + 独立した「不明」ボタン を描画する。
 * 選択するとリストが <select> の値を書き換えて change イベントを発火するので、
 * 既存の「値を読む / 保存する / 追加質問を出す」コードはそのまま動く。
 * 復元などで <select> の値を直接書き換えたときは ssSyncFromSelect(select) で表示へ反映する。
 *
 * 五十音の判定は `searchable-select.ts`（TypeScript 側）と同じロジック。両方を直すこと。
 */
import { KANA_ROWS, resolveSelectSearchSettings, type SelectSearchSettings } from './searchable-select';

export interface SearchableSelectOption {
  value: string;
  label: string;
  kana?: string;
  /** <option> に付ける追加属性（例: data-opt-index="0"） */
  attrs?: string;
  /** true = 検索・五十音で絞り込まず常にリストの末尾に出す（アンケートの「その他」など） */
  fixed?: boolean;
}

export interface RenderSearchableSelectArgs {
  selectId: string;
  options: SearchableSelectOption[];
  settings: SelectSearchSettings | undefined;
  /** <select> に付ける追加属性（例: data-field-id="cf1" onchange="..."） */
  selectAttrs?: string;
  placeholder?: string;
}

function esc(text: string | undefined | null): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 絞り込み機能が OFF のときと同じ <select>（呼び出し側の従来描画と同じ形） */
function renderPlainSelect(args: RenderSearchableSelectArgs): string {
  const opts = args.options.map((o) =>
    `<option value="${esc(o.value)}"${o.attrs ? ' ' + o.attrs : ''}>${esc(o.label)}</option>`
  ).join('');
  return `<select id="${esc(args.selectId)}" class="input"${args.selectAttrs ? ' ' + args.selectAttrs : ''}><option value="">${esc(args.placeholder || '選択してください')}</option>${opts}</select>`;
}

/**
 * 検索・絞り込み機能つきの選択 UI を描画する。設定が OFF なら通常の <select> だけを返す。
 */
export function renderSearchableSelectHtml(args: RenderSearchableSelectArgs): string {
  const settings = resolveSelectSearchSettings(args.settings);
  if (!settings.enabled) return renderPlainSelect(args);

  const unknownValue = settings.unknown_label;
  const optionsHtml = args.options.map((o) => {
    const kana = o.kana && o.kana.trim() ? ` data-kana="${esc(o.kana.trim())}"` : '';
    const fixed = o.fixed ? ' data-ss-fixed="1"' : '';
    return `<option value="${esc(o.value)}"${kana}${fixed}${o.attrs ? ' ' + o.attrs : ''}>${esc(o.label)}</option>`;
  }).join('');
  const unknownOption = settings.unknown_enabled
    ? `<option value="${esc(unknownValue)}" data-ss-unknown="1">${esc(unknownValue)}</option>`
    : '';
  const rowButtons = ['<button type="button" class="ss-row-btn active" data-row="">すべて</button>']
    .concat(KANA_ROWS.map((r) => `<button type="button" class="ss-row-btn" data-row="${r.key}">${r.key}</button>`))
    .join('');
  const unknownButton = settings.unknown_enabled
    ? `<button type="button" class="ss-unknown" data-value="${esc(unknownValue)}">${esc(unknownValue)}</button>`
    : '';

  return `<div class="ss-field" data-ss-for="${esc(args.selectId)}">`
    + `<select id="${esc(args.selectId)}" class="input ss-native"${args.selectAttrs ? ' ' + args.selectAttrs : ''}><option value="">${esc(args.placeholder || '選択してください')}</option>${optionsHtml}${unknownOption}</select>`
    + `<div class="ss-current"><span class="ss-current-prefix">選択中：</span><span class="ss-current-label"></span><button type="button" class="ss-change">変更する</button></div>`
    + `<div class="ss-picker">`
    + `<input type="text" class="input ss-search" placeholder="名前で検索（ひらがな・カタカナ・漢字）" autocomplete="off" aria-label="名前で検索">`
    + `<div class="ss-rows" role="group" aria-label="五十音で絞り込み">${rowButtons}</div>`
    + `<div class="ss-list" role="listbox"></div>`
    + `<div class="ss-empty">該当する選択肢がありません</div>`
    + unknownButton
    + `</div>`
    + `</div>`;
}

export const SEARCHABLE_SELECT_CSS = `
        /* ドロップダウン選択の検索・絞り込み機能 */
        .ss-field { width: 100%; }
        .ss-field .ss-native { display: none !important; }
        .ss-current { display: none; align-items: center; gap: 8px; padding: 10px 12px; border: 2px solid var(--primary-color, #3b82f6); border-radius: 8px; background: #fff; }
        .ss-field.ss-collapsed .ss-current { display: flex; }
        .ss-field.ss-collapsed .ss-picker { display: none; }
        .ss-current-prefix { flex: 0 0 auto; font-size: 13px; color: #555; }
        .ss-current-label { flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 700; color: #222; word-break: break-all; }
        .ss-change { flex: 0 0 auto; font-size: 13px; padding: 6px 10px; border: 1px solid #bbb; border-radius: 6px; background: #f7f7f7; color: #333; cursor: pointer; }
        .ss-picker .ss-search { width: 100%; margin-bottom: 8px; font-size: 16px; }
        .ss-rows { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
        .ss-row-btn { min-width: 36px; height: 36px; padding: 0 8px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #333; cursor: pointer; }
        .ss-row-btn.active { background: var(--primary-color, #3b82f6); border-color: var(--primary-color, #3b82f6); color: #fff; font-weight: 700; }
        .ss-list { max-height: 240px; overflow-y: auto; -webkit-overflow-scrolling: touch; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
        .ss-list:empty { display: none; }
        .ss-item { display: block; width: 100%; text-align: left; padding: 11px 12px; border: 0; border-bottom: 1px solid #eee; background: #fff; color: #222; font-size: 15px; line-height: 1.4; cursor: pointer; }
        .ss-item:last-child { border-bottom: 0; }
        .ss-item.selected { background: var(--primary-color, #3b82f6); color: #fff; font-weight: 700; }
        .ss-empty { display: none; padding: 12px; font-size: 13px; color: #777; text-align: center; border: 1px dashed #ddd; border-radius: 8px; }
        .ss-field.ss-no-match .ss-empty { display: block; }
        .ss-unknown { display: block; width: 100%; margin-top: 10px; padding: 12px; font-size: 15px; font-weight: 700; border: 2px dashed #999; border-radius: 8px; background: #fafafa; color: #333; cursor: pointer; }
        .ss-unknown.selected { border-style: solid; border-color: var(--primary-color, #3b82f6); background: var(--primary-color, #3b82f6); color: #fff; }
`;

export const SEARCHABLE_SELECT_RUNTIME_JS = `
// ========== ドロップダウン選択の検索・絞り込み機能（searchable-select.ts と同じ判定） ==========
var SS_ROWS = [['あ','あいうえお'],['か','かきくけこ'],['さ','さしすせそ'],['た','たちつてと'],['な','なにぬねの'],['は','はひふへほ'],['ま','まみむめも'],['や','やゆよ'],['ら','らりるれろ'],['わ','わをん']];
var SS_SMALL = { 'ぁ':'あ','ぃ':'い','ぅ':'う','ぇ':'え','ぉ':'お','っ':'つ','ゃ':'や','ゅ':'ゆ','ょ':'よ','ゎ':'わ' };
function ssNormalize(s) {
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFKC'); } catch (e) {}
    s = s.toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
        var c = s.charCodeAt(i);
        out += (c >= 0x30A1 && c <= 0x30F6) ? String.fromCharCode(c - 0x60) : s.charAt(i);
    }
    return out.trim();
}
function ssHeadChar(s) {
    var n = ssNormalize(s);
    if (!n) return '';
    var ch = n.charAt(0);
    try { ch = ch.normalize('NFD').replace(/[\\u3099\\u309A]/g, ''); } catch (e) {}
    return SS_SMALL[ch] || ch;
}
function ssRowOf(label, kana) {
    var head = ssHeadChar(kana) || ssHeadChar(label);
    if (!head) return '';
    for (var i = 0; i < SS_ROWS.length; i++) { if (SS_ROWS[i][1].indexOf(head) >= 0) return SS_ROWS[i][0]; }
    return '';
}
function ssMatches(o, q, row) {
    if (row && ssRowOf(o.label, o.kana) !== row) return false;
    if (!q) return true;
    return ssNormalize(o.label).indexOf(q) >= 0 || ssNormalize(o.kana).indexOf(q) >= 0;
}
function ssSelectOf(wrap) { return document.getElementById(wrap.getAttribute('data-ss-for')); }
function ssOptions(select) {
    var list = [];
    for (var i = 0; i < select.options.length; i++) {
        var o = select.options[i];
        if (o.value === '' || o.getAttribute('data-ss-unknown') === '1') continue;
        list.push({ value: o.value, label: o.textContent || '', kana: o.getAttribute('data-kana') || '', fixed: o.getAttribute('data-ss-fixed') === '1' });
    }
    return list;
}
function ssRenderList(wrap) {
    var select = ssSelectOf(wrap);
    var list = wrap.querySelector('.ss-list');
    if (!select || !list) return;
    var search = wrap.querySelector('.ss-search');
    var q = ssNormalize(search ? search.value : '');
    var row = wrap.getAttribute('data-ss-row') || '';
    var btns = wrap.querySelectorAll('.ss-row-btn');
    for (var b = 0; b < btns.length; b++) { btns[b].classList.toggle('active', (btns[b].getAttribute('data-row') || '') === row); }
    list.innerHTML = '';
    var opts = ssOptions(select);
    var count = 0;
    var append = function (o) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'ss-item' + (select.value !== '' && select.value === o.value ? ' selected' : '');
        item.setAttribute('role', 'option');
        item.setAttribute('data-value', o.value);
        item.textContent = o.label;
        item.addEventListener('click', function () { ssChoose(wrap, o.value); });
        list.appendChild(item);
    };
    for (var i = 0; i < opts.length; i++) { if (!opts[i].fixed && ssMatches(opts[i], q, row)) { append(opts[i]); count++; } }
    for (var j = 0; j < opts.length; j++) { if (opts[j].fixed) append(opts[j]); }
    wrap.classList.toggle('ss-no-match', count === 0);
}
function ssChoose(wrap, value) {
    var select = ssSelectOf(wrap);
    if (!select) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    ssSyncFromSelect(select);
}
// <select> の現在値を表示（選択中の表示・リストのハイライト・「不明」のハイライト）へ反映する
function ssSyncFromSelect(select) {
    if (!select) return;
    var wrap = select.closest ? select.closest('.ss-field') : null;
    if (!wrap) return;
    var opt = select.options[select.selectedIndex];
    var has = !!(opt && opt.value !== '');
    var label = wrap.querySelector('.ss-current-label');
    if (label) label.textContent = has ? (opt.textContent || '') : '';
    wrap.classList.toggle('ss-collapsed', has);
    var items = wrap.querySelectorAll('.ss-item');
    for (var i = 0; i < items.length; i++) { items[i].classList.toggle('selected', has && items[i].getAttribute('data-value') === select.value); }
    var ub = wrap.querySelector('.ss-unknown');
    if (ub) ub.classList.toggle('selected', has && ub.getAttribute('data-value') === select.value);
}
function ssInit(wrap) {
    if (wrap.getAttribute('data-ss-ready') === '1') return;
    wrap.setAttribute('data-ss-ready', '1');
    var select = ssSelectOf(wrap);
    if (!select) return;
    var search = wrap.querySelector('.ss-search');
    if (search) search.addEventListener('input', function () { ssRenderList(wrap); });
    var btns = wrap.querySelectorAll('.ss-row-btn');
    for (var b = 0; b < btns.length; b++) {
        (function (btn) {
            btn.addEventListener('click', function () { wrap.setAttribute('data-ss-row', btn.getAttribute('data-row') || ''); ssRenderList(wrap); });
        })(btns[b]);
    }
    var ub = wrap.querySelector('.ss-unknown');
    if (ub) ub.addEventListener('click', function () { ssChoose(wrap, ub.getAttribute('data-value') || ''); });
    var change = wrap.querySelector('.ss-change');
    if (change) change.addEventListener('click', function () { wrap.classList.remove('ss-collapsed'); if (search) search.focus(); });
    ssRenderList(wrap);
    ssSyncFromSelect(select);
}
function ssInitAll() {
    var wraps = document.querySelectorAll('.ss-field[data-ss-for]');
    for (var i = 0; i < wraps.length; i++) ssInit(wraps[i]);
}
`;
