/**
 * リッチメニューの業務ロジック（サーバー専用）
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 7 章
 *
 * 反映の順番（新しいメニューが表示される状態になってから、古いものを消す）:
 *   1. LINE に新しいメニューを作り、画像を送る（切り替えでつながっているメニューも一緒に）
 *                                        → 失敗したら、作ったものを消して終了（何も変わらない）
 *   2. 切り替え先のメニューに名札を付ける  → 失敗したら、作ったものを消して終了
 *   3. 全員向けに設定する                  → 失敗したら、作ったものを消して終了
 *   4. このシステムの記録を「反映中」にする
 *   5. 古いメニューと名札を LINE から消す  → 失敗しても反映は成功扱い（次の反映のときに掃除）
 *
 * 名札（エイリアス）は反映のたびに新しく付ける。古い名札を書き換えないので、
 * 途中で失敗しても、いま出ているメニューのタブ切り替えは壊れない
 */
import fs from 'fs';
import path from 'path';
import { after } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { getStoreLineToken, loadAudienceSource } from '@/lib/broadcast-repository';
import { buildCustomerFacts, jstDateOf } from '@/lib/broadcast-audience';
import { getStoreLineSecret } from '@/lib/line-secret-repository';
import { listStoreForms } from '@/lib/reservation-source-repository';
import { resolveFormBaseUrl } from '@/lib/reservation-sources';
import {
  EXTERNAL_CHANGE_MESSAGES,
  RICH_MENU_ALIAS_PREFIX,
  RICH_MENU_LIMITS,
  buildRichMenuAliasId,
  buildRichMenuObject,
  canStartPublish,
  checkRichMenuImage,
  collectSwitchGroup,
  describeLineRichMenuError,
  detectExternalChange,
  menusSwitchingTo,
  normalizeRichMenuInput,
  readImageInfo,
  validateRichMenu,
  type LineRichMenu,
  type RichMenuInput,
} from '@/lib/line-rich-menu';
import {
  RICH_MENU_RULES_MAX,
  chunkUserIds,
  diffRichMenuAssignments,
  planRichMenuAssignments,
  reorderRuleMenus,
  sortRuleMenus,
  type PublishedRuleMenu,
  type RichMenuAssignment,
  type RichMenuRule,
} from '@/lib/line-rich-menu-rules';
import { createRichMenuLineApi, type RichMenuLineApi } from '@/lib/line-rich-menu-api';
import {
  RICH_MENU_LINKS_SCHEMA_MISSING_MESSAGE,
  deleteRichMenuLinks,
  deleteRichMenuRow,
  getRichMenu,
  hasRichMenuLinksTable,
  insertRichMenu,
  listRichMenuLinks,
  listRichMenus,
  listStoresWithRuleMenus,
  updateRichMenu,
  upsertRichMenuLinks,
} from '@/lib/line-rich-menu-repository';

const isLocal = () => getAppEnvironment() === 'local';

/**
 * LINE に作るメニューの名前の先頭に付ける印。
 * 消し残りの掃除は、この印の付いたメニューだけを対象にする（ほかのツールで作ったメニューは消さない）
 */
export const LINE_MENU_NAME_PREFIX = '[nas-rsv] ';

export type ServiceResult<T> = { ok: true; data: T; notice?: string; /** お客様ごとのメニューの設定の結果（1 行） */ summary?: string } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export interface RichMenuFormOption {
  id: string;
  name: string;
  /** 開く URL があるか（LINE フォームは LIFF ID、Web フォームは公開が必要） */
  openable: boolean;
}

export interface RichMenuOverview {
  menus: LineRichMenu[];
  forms: RichMenuFormOption[];
  max: number;
  /** LINE のチャネルアクセストークンが登録されているか */
  has_token: boolean;
  /** local では LINE に反映しない */
  local: boolean;
  /** ほかの場所（公式 LINE の管理画面など）で全員向けのメニューが変えられているときの文言 */
  external_notice: string | null;
  /** お客様ごとのメニューを使えないときの理由（使えるときは null） */
  rule_unavailable: string | null;
  /** お客様ごとのメニューの数の上限 */
  rules_max: number;
  /** メニュー ID → いま設定している人数 */
  link_counts: Record<string, number>;
}

async function formOptions(storeId: string, origin: string): Promise<{ options: RichMenuFormOption[]; urlOf: (id: string) => string | null }> {
  const forms = await listStoreForms(storeId).catch(() => []);
  const urls = new Map(forms.map((f) => [f.id, resolveFormBaseUrl(f, origin)]));
  return { options: forms.map((f) => ({ id: f.id, name: f.name, openable: !!urls.get(f.id) })), urlOf: (id) => urls.get(id) ?? null };
}

const inputOf = (menu: LineRichMenu): RichMenuInput => ({ name: menu.name, size: menu.size, image_url: menu.image_url, areas: menu.areas, chat_bar_text: menu.chat_bar_text, open_by_default: menu.open_by_default, rule: menu.rule });

export async function getRichMenuOverview(storeId: string, origin: string, deps: { api?: RichMenuLineApi } = {}): Promise<RichMenuOverview> {
  const [menus, forms, token] = await Promise.all([listRichMenus(storeId), formOptions(storeId, origin), getStoreLineToken(storeId).catch(() => null)]);
  let externalNotice: string | null = null;
  // LINE のいまの設定を読み、このシステムの記録と違えば知らせる（local は通信しない。読めなかったときは何も出さない）
  if (!isLocal() && token) {
    try {
      const actual = await (deps.api ?? createRichMenuLineApi(token)).getDefault();
      if (actual !== 'unknown') {
        const recorded = menus.find((m) => m.is_default)?.line_rich_menu_id ?? null;
        const change = detectExternalChange(recorded, actual);
        if (change !== 'none') externalNotice = EXTERNAL_CHANGE_MESSAGES[change];
      }
    } catch {
      /* 表示のための確認なので、失敗しても一覧は返す */
    }
  }
  const linkCounts: Record<string, number> = {};
  const hasRules = menus.some((m) => m.rule);
  if (hasRules) {
    try {
      for (const l of await listRichMenuLinks(storeId)) linkCounts[l.menu_id] = (linkCounts[l.menu_id] || 0) + 1;
    } catch {
      /* 人数は表示のためだけなので、読めなくても一覧は返す */
    }
  }
  const ruleUnavailable = await ruleUnavailableReason(storeId).catch(() => null);
  return { menus, forms: forms.options, max: RICH_MENU_LIMITS.menusMax, has_token: !!token, local: isLocal(), external_notice: externalNotice, rule_unavailable: ruleUnavailable, rules_max: RICH_MENU_RULES_MAX, link_counts: linkCounts };
}

export async function createRichMenu(storeId: string, body: unknown): Promise<ServiceResult<LineRichMenu>> {
  const input = normalizeRichMenuInput(body);
  const errors = validateRichMenu(input);
  if (errors.length > 0) return fail(400, errors[0]);
  const existing = await listRichMenus(storeId);
  if (existing.length >= RICH_MENU_LIMITS.menusMax) return fail(400, `リッチメニューは ${RICH_MENU_LIMITS.menusMax} 個までです。使っていないものを削除してください`);
  // 新しいお客様ごとのメニューは、優先順位のいちばん下に入れる
  if (input.rule) input.rule = { ...input.rule, order: nextRuleOrder(existing) };
  const res = await insertRichMenu(storeId, input);
  if (res.error !== undefined) return fail(500, res.error);
  return { ok: true, data: res.data };
}

function nextRuleOrder(menus: LineRichMenu[]): number {
  return menus.reduce((max, m) => (m.rule ? Math.max(max, m.rule.order + 1) : max), 0);
}

/** 内容を保存する。反映中のメニューを変えたときは「未反映の変更あり」にする（保存しただけでは公式 LINE には出ない） */
export async function saveRichMenu(storeId: string, id: string, body: unknown): Promise<ServiceResult<LineRichMenu>> {
  const menu = await getRichMenu(storeId, id);
  if (!menu) return fail(404, 'リッチメニューが見つかりません');
  if (!canStartPublish(menu)) return fail(409, '反映の途中です。少し待ってから、もう一度お試しください');
  const input = normalizeRichMenuInput(body);
  const errors = validateRichMenu(input);
  if (errors.length > 0) return fail(400, errors[0]);
  // 公式 LINE に出しているあいだは、「全員向け」と「お客様ごと」を入れ替えられない（出し方が違うため）
  if (menu.status === 'published' && !!input.rule !== !!menu.rule) return fail(409, '公式 LINE に出しているメニューは、「だれに出すか」の種類を変えられません。先に反映をやめてください');
  // 優先順位は並べ替えで決めるので、保存では変えない（新しくお客様ごとにしたときは、いちばん下に入れる）
  if (input.rule) input.rule = { ...input.rule, order: menu.rule ? menu.rule.order : nextRuleOrder(await listRichMenus(storeId)) };
  const res = await updateRichMenu(storeId, id, { ...input, rule: input.rule ?? null, dirty: menu.status === 'published' ? true : menu.dirty });
  if (res.error !== undefined) return fail(500, res.error);
  if (!res.data) return fail(404, 'リッチメニューが見つかりません');
  return { ok: true, data: res.data };
}

// ---------------------------------------------------------------------------
// LINE への反映（順番が大事）
// ---------------------------------------------------------------------------

/** LINE に作るメニュー 1 つ。key はこのシステムのメニュー ID、aliasId は付ける名札（切り替え先になるときだけ） */
export interface PublishItem {
  key: string;
  object: Record<string, unknown>;
  image: { bytes: Uint8Array; contentType: 'image/jpeg' | 'image/png' };
  aliasId: string | null;
}

export type PublishToLineResult = { ok: true; richMenuId: string; ids: Record<string, string> } | { ok: false; step: 'create' | 'image' | 'alias' | 'default'; error: string };

/**
 * LINE に新しいメニューを作って全員向けにする（上の 1〜3）。最初の 1 つが全員向けになる。
 * 途中で失敗したら、作ったメニューと名札を消してから失敗を返す（作りかけを残さない。いま出ているメニューは変わらない）
 */
export async function publishToLine(p: { api: RichMenuLineApi; items: PublishItem[]; /** false = 全員向けにしない（お客様ごとのメニュー） */ setDefault?: boolean }): Promise<PublishToLineResult> {
  const created: string[] = [];
  const aliases: string[] = [];
  const ids: Record<string, string> = {};
  const rollback = async () => {
    for (const alias of aliases) await p.api.removeAlias(alias).catch(() => null);
    for (const id of created) await p.api.remove(id).catch(() => null);
  };
  const many = p.items.length > 1;
  const label = (item: PublishItem) => (many ? `（${String(item.object.name || '').replace(LINE_MENU_NAME_PREFIX, '')}）` : '');

  // 1. メニューを作り、画像を送る
  for (const item of p.items) {
    const res = await p.api.create(item.object);
    if (!res.ok || !res.richMenuId) {
      await rollback();
      return { ok: false, step: 'create', error: `${describeLineRichMenuError(res.status, res.body)}${label(item)}` };
    }
    created.push(res.richMenuId);
    ids[item.key] = res.richMenuId;
    const upload = await p.api.uploadImage(res.richMenuId, item.image.bytes, item.image.contentType);
    if (!upload.ok) {
      await rollback();
      return { ok: false, step: 'image', error: `画像を送れませんでした${label(item)}。${describeLineRichMenuError(upload.status, upload.body)}` };
    }
  }
  // 2. 切り替え先のメニューに名札を付ける（名札は、画像を入れたメニューにしか付けられない）
  for (const item of p.items) {
    if (!item.aliasId) continue;
    const res = await p.api.createAlias(item.aliasId, ids[item.key]);
    if (!res.ok) {
      await rollback();
      return { ok: false, step: 'alias', error: `メニューの切り替えを設定できませんでした${label(item)}。${describeLineRichMenuError(res.status, res.body)}` };
    }
    aliases.push(item.aliasId);
  }
  // 3. 全員向けにする
  const rootId = ids[p.items[0].key];
  if (p.setDefault === false) return { ok: true, richMenuId: rootId, ids };
  const setDefault = await p.api.setDefault(rootId);
  if (!setDefault.ok) {
    await rollback();
    return { ok: false, step: 'default', error: `全員向けに設定できませんでした。${describeLineRichMenuError(setDefault.status, setDefault.body)}` };
  }
  return { ok: true, richMenuId: rootId, ids };
}

/**
 * 古いメニューと名札を LINE から消す（上の 5）。
 * 渡された ID に加えて、このシステムの印が付いた消し残りも消す。いま出しているもの（keep）は消さない。
 * 失敗しても例外にしない（反映は成功扱い。次の反映のときにまた掃除する）
 */
export async function cleanupLineRichMenus(api: RichMenuLineApi, keep: { menuIds: string[]; aliasIds?: string[] }, oldIds: string[]): Promise<{ removed: string[]; failed: string[] }> {
  const keepMenus = new Set(keep.menuIds);
  const keepAliases = new Set(keep.aliasIds || []);
  const removed: string[] = [];
  const failed: string[] = [];

  // 名札: このシステムの印が付いていて、いま使っていないもの
  try {
    for (const a of (await api.listAliases()) || []) {
      if (!a.richMenuAliasId.startsWith(RICH_MENU_ALIAS_PREFIX) || keepAliases.has(a.richMenuAliasId)) continue;
      const res = await api.removeAlias(a.richMenuAliasId);
      if (!res.ok && res.status !== 404) failed.push(a.richMenuAliasId);
    }
  } catch {
    /* 名札の掃除に失敗しても、メニューの掃除は続ける */
  }

  const targets = new Set(oldIds.filter((id) => id && !keepMenus.has(id)));
  try {
    for (const m of (await api.list()) || []) {
      if (!keepMenus.has(m.richMenuId) && m.name.startsWith(LINE_MENU_NAME_PREFIX)) targets.add(m.richMenuId);
    }
  } catch {
    /* 一覧を読めなくても、分かっている ID は消す */
  }
  for (const id of targets) {
    try {
      const res = await api.remove(id);
      // 404 = もう無い（消えているのと同じ）
      if (res.ok || res.status === 404) removed.push(id);
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { removed, failed };
}

/** 画像を読む（https の URL はそのまま、local の / で始まるパスは public/ から） */
async function loadImageBytes(imageUrl: string): Promise<Uint8Array | null> {
  try {
    if (imageUrl.startsWith('/')) {
      const file = path.join(process.cwd(), 'public', imageUrl.replace(/^\/+/, ''));
      // public の外は読まない
      if (!path.resolve(file).startsWith(path.resolve(process.cwd(), 'public'))) return null;
      return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null;
    }
    if (!/^https:\/\//i.test(imageUrl)) return null;
    const res = await fetch(imageUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export interface PublishDeps {
  api?: RichMenuLineApi;
  loadImage?: (imageUrl: string) => Promise<Uint8Array | null>;
  now?: Date;
}

/**
 * 全員向けのメニューとして公式 LINE に反映する。
 * 切り替えのボタンでつながっているメニューも、一緒に LINE に作る（全員向けになるのは、このメニューだけ）
 */
export async function publishRichMenu(storeId: string, id: string, origin: string, deps: PublishDeps = {}): Promise<ServiceResult<LineRichMenu>> {
  const all = await listRichMenus(storeId);
  const menu = all.find((m) => m.id === id);
  if (!menu) return fail(404, 'リッチメニューが見つかりません');
  if (!canStartPublish(menu, deps.now)) return fail(409, '反映の途中です。少し待ってから、もう一度お試しください');
  // お客様ごとのメニューは、全員向けにはせず、条件に合うお客様にだけ設定する
  if (menu.rule) return publishRuleMenu(storeId, menu, all, origin, deps);

  const collected = collectSwitchGroup(id, all);
  if (!collected.ok) return fail(400, collected.error);
  const group = collected.group;
  const ruleTarget = group.find((m) => m.rule);
  if (ruleTarget) return fail(400, `「${ruleTarget.name}」はお客様ごとのメニューなので、切り替え先にできません。切り替え先を選び直してください`);
  // お客様ごとのメニューは、全員向けの反映では触らない（下書きに戻さない・LINE から消さない）
  const ruleMenuIds = all.filter((m) => m.rule).map((m) => m.line_rich_menu_id).filter((v): v is string => !!v);
  const many = group.length > 1;
  const now = deps.now ?? new Date();
  const stamp = now.getTime().toString(36);
  // 切り替えでつながっているときは、全部のメニューに名札を付ける（最初のメニューへ戻るボタンもあるため）
  const aliasOf = new Map(many ? group.map((m) => [m.id, buildRichMenuAliasId(m.id, stamp)]) : []);

  const forms = await formOptions(storeId, origin);
  const formIds = forms.options.map((f) => f.id);
  const menuIds = all.map((m) => m.id);
  const objects: Array<{ menu: LineRichMenu; object: Record<string, unknown> }> = [];
  for (const m of group) {
    const input = inputOf(m);
    const prefix = many ? `「${m.name}」— ` : '';
    const errors = validateRichMenu(input, { forPublish: true, formIds, menuIds, selfId: m.id });
    if (errors.length > 0) return fail(400, `${prefix}${errors[0]}`);
    const built = buildRichMenuObject({ ...input, name: `${LINE_MENU_NAME_PREFIX}${input.name}` }, forms.urlOf, (menuId) => aliasOf.get(menuId) ?? null);
    if (!built.ok) return fail(400, `${prefix}${built.error}`);
    objects.push({ menu: m, object: built.object });
  }

  const groupIds = new Set(group.map((m) => m.id));
  const others = all.filter((m) => !groupIds.has(m.id) && !m.rule && (m.is_default || m.line_rich_menu_id || m.status === 'published'));
  const publishedAt = now.toISOString();
  const offPatch = { is_default: false, status: 'draft' as const, line_rich_menu_id: null, dirty: false };

  // local: LINE とは通信せず、記録だけ更新する
  if (isLocal()) {
    for (const other of others) await updateRichMenu(storeId, other.id, offPatch);
    for (const m of group.slice(1)) await updateRichMenu(storeId, m.id, { status: 'published', is_default: false, dirty: false, last_error: null, published_at: publishedAt });
    const res = await updateRichMenu(storeId, id, { status: 'published', is_default: true, dirty: false, last_error: null, published_at: publishedAt });
    if (res.error !== undefined || !res.data) return fail(500, res.error || '保存に失敗しました');
    return { ok: true, data: res.data, notice: 'local では LINE に反映しません（記録だけ更新しました）' };
  }

  const token = await getStoreLineToken(storeId);
  if (!token) return fail(400, 'LINE のチャネルアクセストークンが登録されていません。店舗の設定で登録してください');

  const items: PublishItem[] = [];
  for (const { menu: m, object } of objects) {
    const prefix = many ? `「${m.name}」— ` : '';
    const bytes = await (deps.loadImage ?? loadImageBytes)(m.image_url);
    if (!bytes) return fail(400, `${prefix}画像を読み込めませんでした。画像を選び直してください`);
    const imageError = checkRichMenuImage(bytes, m.size);
    if (imageError) return fail(400, `${prefix}${imageError}`);
    items.push({ key: m.id, object, image: { bytes, contentType: readImageInfo(bytes)?.type === 'png' ? 'image/png' : 'image/jpeg' }, aliasId: aliasOf.get(m.id) ?? null });
  }

  // 反映ボタンを 2 回押してもメニューが 2 つできないように、先に「反映の途中」にして確保する
  const claimed = await updateRichMenu(storeId, id, { status: 'publishing' }, { onlyIfStatus: [menu.status], onlyIfUpdatedAt: menu.updated_at });
  if (claimed.error !== undefined) return fail(500, claimed.error);
  if (!claimed.data) return fail(409, '反映の途中です。少し待ってから、もう一度お試しください');

  const api = deps.api ?? createRichMenuLineApi(token);
  const wasPublished = menu.status === 'published';
  let result: PublishToLineResult;
  try {
    result = await publishToLine({ api, items });
  } catch (e) {
    result = { ok: false, step: 'create', error: `LINE と通信できませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
  if (!result.ok) {
    // 失敗: 元の状態に戻す（反映中だったメニューは、古いものがそのまま公式 LINE に出ている）
    const reverted = await updateRichMenu(storeId, id, { status: wasPublished ? 'published' : 'failed', last_error: result.error });
    return fail(502, reverted.error === undefined && wasPublished ? `${result.error}（公式 LINE には、前に反映したメニューがそのまま出ています）` : result.error);
  }

  // 4. 記録を更新する。全員向けは 1 店舗に 1 つなので、先にほかのメニューの印を外す
  const oldIds = all.filter((m) => !m.rule).map((m) => m.line_rich_menu_id).filter((v): v is string => !!v);
  for (const other of others) await updateRichMenu(storeId, other.id, offPatch);
  for (const m of group.slice(1)) {
    await updateRichMenu(storeId, m.id, { status: 'published', is_default: false, line_rich_menu_id: result.ids[m.id] ?? null, dirty: false, last_error: null, published_at: publishedAt });
  }
  const saved = await updateRichMenu(storeId, id, { status: 'published', is_default: true, line_rich_menu_id: result.richMenuId, dirty: false, last_error: null, published_at: publishedAt });

  // 5. 古いメニューと名札を消す（失敗しても反映は成功）
  const cleanup = await cleanupLineRichMenus(api, { menuIds: [...Object.values(result.ids), ...ruleMenuIds], aliasIds: [...aliasOf.values()] }, oldIds);
  if (cleanup.failed.length > 0) console.warn('[rich-menu] 古いメニュー・名札を消せませんでした（次の反映のときに掃除します）:', cleanup.failed.join(', '));

  if (saved.error !== undefined || !saved.data) {
    // LINE には出ているが記録に失敗した。次に開いたとき「ほかの場所で変更されています」と出るので、もう一度反映すれば直る
    return fail(500, `公式 LINE には反映されましたが、記録の保存に失敗しました。もう一度「反映する」を押してください（${saved.error || '保存に失敗しました'}）`);
  }
  return { ok: true, data: saved.data };
}

/**
 * 反映をやめる（全員向けの設定を外す。公式 LINE の管理画面で設定したメニューに戻る）。
 * 切り替え先として一緒に出していたメニューも、下書きに戻す
 */
export async function unpublishRichMenu(storeId: string, id: string, deps: { api?: RichMenuLineApi } = {}): Promise<ServiceResult<LineRichMenu>> {
  const all = await listRichMenus(storeId);
  const menu = all.find((m) => m.id === id);
  if (!menu) return fail(404, 'リッチメニューが見つかりません');
  if (!canStartPublish(menu)) return fail(409, '反映の途中です。少し待ってから、もう一度お試しください');
  if (menu.rule) return stopRuleMenu(storeId, menu, deps);
  if (!menu.is_default && !menu.line_rich_menu_id && menu.status !== 'published') return fail(400, 'このメニューは反映されていません');
  // 切り替え先として出ているだけのメニューは、元のメニューの反映をやめる
  const root = all.find((m) => m.is_default && !m.rule);
  if (!menu.is_default && root && root.id !== id) return fail(409, `このメニューは「${root.name}」の切り替え先として出ています。「${root.name}」の「反映をやめる」を押してください`);

  const patch = { is_default: false, status: 'draft' as const, line_rich_menu_id: null, dirty: false, last_error: null };
  // お客様ごとのメニューは、全員向けの反映をやめても出したままにする
  const linked = all.filter((m) => m.id !== id && !m.rule && (m.status === 'published' || m.line_rich_menu_id));
  const keepRuleIds = all.filter((m) => m.rule).map((m) => m.line_rich_menu_id).filter((v): v is string => !!v);

  if (isLocal()) {
    for (const m of linked) await updateRichMenu(storeId, m.id, patch);
    const res = await updateRichMenu(storeId, id, patch);
    if (res.error !== undefined || !res.data) return fail(500, res.error || '保存に失敗しました');
    return { ok: true, data: res.data, notice: 'local では LINE に反映しません（記録だけ更新しました）' };
  }

  const token = await getStoreLineToken(storeId);
  if (!token) return fail(400, 'LINE のチャネルアクセストークンが登録されていません。店舗の設定で登録してください');
  const api = deps.api ?? createRichMenuLineApi(token);
  if (menu.is_default) {
    // ほかの場所で別のメニューに変えられていたら、全員向けの設定は外さない（そのメニューを消してしまうため）
    const actual = await api.getDefault();
    if (actual === 'unknown' || actual === menu.line_rich_menu_id) {
      const cleared = await api.clearDefault();
      if (!cleared.ok && cleared.status !== 404) return fail(502, `反映をやめられませんでした。${describeLineRichMenuError(cleared.status, cleared.body)}`);
    }
  }
  for (const m of linked) await updateRichMenu(storeId, m.id, patch);
  const res = await updateRichMenu(storeId, id, patch);
  const oldIds = all.filter((m) => !m.rule).map((m) => m.line_rich_menu_id).filter((v): v is string => !!v);
  await cleanupLineRichMenus(api, { menuIds: keepRuleIds }, oldIds).catch(() => null);
  if (res.error !== undefined || !res.data) return fail(500, res.error || '保存に失敗しました');
  return { ok: true, data: res.data };
}

/** 削除する（反映中のメニューは、先に反映をやめてから） */
export async function removeRichMenu(storeId: string, id: string): Promise<ServiceResult<{ id: string }>> {
  const all = await listRichMenus(storeId);
  const menu = all.find((m) => m.id === id);
  if (!menu) return fail(404, 'リッチメニューが見つかりません');
  if (menu.is_default || menu.status === 'published' || menu.status === 'publishing') return fail(409, '反映中のメニューは削除できません。先に「反映をやめる」を押してください');
  // ほかのメニューの切り替え先になっているときは、先にそのボタンを直してもらう（消すと、そのメニューが反映できなくなる）
  const sources = menusSwitchingTo(id, all);
  if (sources.length > 0) return fail(409, `このメニューは「${sources[0].name}」の切り替え先になっています。先に「${sources[0].name}」のボタンの動きを変えてください`);
  const res = await deleteRichMenuRow(storeId, id);
  if (res.error !== undefined) return fail(500, res.error);
  return { ok: true, data: { id } };
}

// ---------------------------------------------------------------------------
// お客様ごとの切り替え（③-3）
// 条件に合うお客様にだけ出すメニュー。LINE には「この人にはこのメニュー」と 1 人ずつ（500 人ずつまとめて）設定する。
// 全員向けのメニューより優先して表示される。条件に合わなくなった人は、設定を外して全員向けに戻す
// ---------------------------------------------------------------------------

export interface RichMenuSyncSummary {
  /** メニューを設定した人数 */
  linked: number;
  /** 設定を外した人数（全員向けに戻した） */
  unlinked: number;
  /** 変わらなかった人数 */
  unchanged: number;
  /** LINE に断られて設定できなかった人数（次の見直しでもう一度試す） */
  failed: number;
  /** 時間切れで次の回に回した人数 */
  deferred: number;
  /** 公式 LINE に出している、お客様ごとのメニューの数 */
  menus: number;
}

const emptySummary = (): RichMenuSyncSummary => ({ linked: 0, unlinked: 0, unchanged: 0, failed: 0, deferred: 0, menus: 0 });

/** お客様ごとのメニューを使えるか（使えないときは理由） */
async function ruleUnavailableReason(storeId: string): Promise<string | null> {
  if (!(await hasRichMenuLinksTable())) return RICH_MENU_LINKS_SCHEMA_MISSING_MESSAGE;
  if (isLocal()) return null;
  // 設計の決まり: LINE からの通知が本物かを確かめられる店舗（チャネルシークレットを登録した店舗）だけで使う
  const secret = await getStoreLineSecret(storeId).catch(() => null);
  if (!secret || secret.status !== 'set') return 'お客様ごとの切り替えは、チャネルシークレットを登録した店舗だけで使えます（運営が、テナント側の店舗ページ → 設定 →「LINE 通知の署名チェック」で登録します）';
  return null;
}

/**
 * お客様ごとのメニューの設定を、いまの条件に合わせる（見直し）。
 * - 条件に合うようになった人・別のメニューに変わる人 → 設定する
 * - どの条件にも合わなくなった人 → 設定を外す（全員向けのメニューに戻る）
 * LINE に送れたぶんだけ記録を更新するので、途中で止まっても、次の見直しで続きから合わせられる
 */
export async function syncRichMenuAssignments(storeId: string, deps: { api?: RichMenuLineApi; now?: Date; deadlineMs?: number } = {}): Promise<RichMenuSyncSummary> {
  const summary = emptySummary();
  const all = await listRichMenus(storeId);
  const published: PublishedRuleMenu[] = sortRuleMenus(all.filter((m) => m.rule && m.status === 'published' && (isLocal() || m.line_rich_menu_id))).map((m) => ({
    id: m.id,
    // local は LINE に作らないので、記録用の仮の ID を使う
    line_rich_menu_id: m.line_rich_menu_id || `local-${m.id}`,
    rule: m.rule as RichMenuRule,
  }));
  summary.menus = published.length;
  const current = await listRichMenuLinks(storeId);
  if (published.length === 0 && current.length === 0) return summary;

  const now = deps.now ?? new Date();
  let desired = new Map<string, RichMenuAssignment>();
  if (published.length > 0) {
    const source = await loadAudienceSource(storeId);
    const facts = buildCustomerFacts({ customers: source.customers, reservations: source.reservations, visits: source.visits, surveys: source.surveys, today: jstDateOf(now) });
    desired = planRichMenuAssignments({ menus: published, customers: source.customers, facts, now });
  }
  const diff = diffRichMenuAssignments(current, desired);
  summary.unchanged = diff.unchanged;

  let api: RichMenuLineApi | null = null;
  if (!isLocal()) {
    if (deps.api) api = deps.api;
    else {
      const token = await getStoreLineToken(storeId);
      if (!token) {
        summary.failed = diff.unlink.length + diff.link.reduce((n, g) => n + g.user_ids.length, 0);
        return summary;
      }
      api = createRichMenuLineApi(token);
    }
  }
  const timeUp = () => deps.deadlineMs !== undefined && Date.now() > deps.deadlineMs;

  // 外す（全員向けに戻す）
  for (const ids of chunkUserIds(diff.unlink)) {
    if (timeUp()) {
      summary.deferred += ids.length;
      continue;
    }
    const res = api ? await api.bulkUnlink(ids) : { ok: true };
    if (!res.ok) {
      summary.failed += ids.length;
      continue;
    }
    await deleteRichMenuLinks(storeId, ids);
    summary.unlinked += ids.length;
  }
  // 設定する（メニューごとに 500 人ずつ）
  for (const group of diff.link) {
    for (const ids of chunkUserIds(group.user_ids)) {
      if (timeUp()) {
        summary.deferred += ids.length;
        continue;
      }
      const res = api ? await api.bulkLink(group.line_rich_menu_id, ids) : { ok: true };
      if (!res.ok) {
        summary.failed += ids.length;
        continue;
      }
      const error = await upsertRichMenuLinks(storeId, ids.map((line_user_id) => ({ line_user_id, menu_id: group.menu_id, line_rich_menu_id: group.line_rich_menu_id })));
      if (error) {
        console.warn('[rich-menu] 設定の記録に失敗:', error);
        summary.failed += ids.length;
        continue;
      }
      summary.linked += ids.length;
    }
  }
  return summary;
}

/** 見直しの結果を 1 行で（画面のお知らせ用） */
export function describeSyncSummary(s: RichMenuSyncSummary): string {
  const parts = [`設定 ${s.linked} 人`, `解除 ${s.unlinked} 人`, `変更なし ${s.unchanged} 人`];
  if (s.failed > 0) parts.push(`失敗 ${s.failed} 人（次の見直しでもう一度試します）`);
  if (s.deferred > 0) parts.push(`残り ${s.deferred} 人（次の見直しで続きを行います）`);
  return parts.join(' / ');
}

/** お客様ごとのメニューを公式 LINE に出す（条件に合うお客様にだけ表示される） */
async function publishRuleMenu(storeId: string, menu: LineRichMenu, all: LineRichMenu[], origin: string, deps: PublishDeps): Promise<ServiceResult<LineRichMenu>> {
  const reason = await ruleUnavailableReason(storeId);
  if (reason) return fail(400, reason);
  if (menusSwitchingTo(menu.id, all).length > 0) return fail(400, 'ほかのメニューの切り替え先になっているメニューは、お客様ごとのメニューにできません');
  const publishedRules = all.filter((m) => m.id !== menu.id && m.rule && m.status === 'published');
  if (publishedRules.length >= RICH_MENU_RULES_MAX) return fail(400, `お客様ごとのメニューを出せるのは ${RICH_MENU_RULES_MAX} 個までです`);

  const forms = await formOptions(storeId, origin);
  const input = inputOf(menu);
  const errors = validateRichMenu(input, { forPublish: true, formIds: forms.options.map((f) => f.id), menuIds: all.map((m) => m.id), selfId: menu.id });
  if (errors.length > 0) return fail(400, errors[0]);
  const built = buildRichMenuObject({ ...input, name: `${LINE_MENU_NAME_PREFIX}${input.name}` }, forms.urlOf);
  if (!built.ok) return fail(400, built.error);

  const now = deps.now ?? new Date();
  const publishedAt = now.toISOString();
  const deadlineMs = Date.now() + RULE_SYNC_BUDGET_MS;

  if (isLocal()) {
    const res = await updateRichMenu(storeId, menu.id, { status: 'published', is_default: false, dirty: false, last_error: null, published_at: publishedAt });
    if (res.error !== undefined || !res.data) return fail(500, res.error || '保存に失敗しました');
    const sync = await syncRichMenuAssignments(storeId, { now, deadlineMs });
    return { ok: true, data: res.data, notice: `local では LINE に反映しません（記録だけ更新しました。${describeSyncSummary(sync)}）` };
  }

  const token = await getStoreLineToken(storeId);
  if (!token) return fail(400, 'LINE のチャネルアクセストークンが登録されていません。店舗の設定で登録してください');
  const bytes = await (deps.loadImage ?? loadImageBytes)(menu.image_url);
  if (!bytes) return fail(400, '画像を読み込めませんでした。画像を選び直してください');
  const imageError = checkRichMenuImage(bytes, menu.size);
  if (imageError) return fail(400, imageError);

  const claimed = await updateRichMenu(storeId, menu.id, { status: 'publishing' }, { onlyIfStatus: [menu.status], onlyIfUpdatedAt: menu.updated_at });
  if (claimed.error !== undefined) return fail(500, claimed.error);
  if (!claimed.data) return fail(409, '反映の途中です。少し待ってから、もう一度お試しください');

  const api = deps.api ?? createRichMenuLineApi(token);
  const wasPublished = menu.status === 'published';
  let result: PublishToLineResult;
  try {
    // 全員向けにはしない（条件に合うお客様にだけ、あとで 1 人ずつ設定する）
    result = await publishToLine({ api, items: [{ key: menu.id, object: built.object, image: { bytes, contentType: readImageInfo(bytes)?.type === 'png' ? 'image/png' : 'image/jpeg' }, aliasId: null }], setDefault: false });
  } catch (e) {
    result = { ok: false, step: 'create', error: `LINE と通信できませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
  if (!result.ok) {
    await updateRichMenu(storeId, menu.id, { status: wasPublished ? 'published' : 'failed', last_error: result.error });
    return fail(502, wasPublished ? `${result.error}（公式 LINE には、前に出したメニューがそのまま出ています）` : result.error);
  }
  const saved = await updateRichMenu(storeId, menu.id, { status: 'published', is_default: false, line_rich_menu_id: result.richMenuId, dirty: false, last_error: null, published_at: publishedAt });
  if (saved.error !== undefined || !saved.data) {
    await api.remove(result.richMenuId).catch(() => null);
    return fail(500, saved.error || '保存に失敗しました');
  }
  // 条件に合うお客様に設定する（作り直したときは、いまの人を新しいメニューへ付け替える）。そのあとで古いメニューを消す
  const sync = await syncRichMenuAssignments(storeId, { api, now, deadlineMs });
  if (menu.line_rich_menu_id && menu.line_rich_menu_id !== result.richMenuId && sync.deferred === 0 && sync.failed === 0) {
    await api.remove(menu.line_rich_menu_id).catch(() => null);
  }
  return { ok: true, data: saved.data, summary: describeSyncSummary(sync) };
}

/** お客様ごとのメニューを出すのをやめる（設定していた人は、次に条件が合うメニューか、全員向けのメニューに戻る） */
async function stopRuleMenu(storeId: string, menu: LineRichMenu, deps: { api?: RichMenuLineApi }): Promise<ServiceResult<LineRichMenu>> {
  if (menu.status !== 'published' && !menu.line_rich_menu_id) return fail(400, 'このメニューは反映されていません');
  const oldId = menu.line_rich_menu_id;
  // 先に記録を下書きにする（見直しの対象から外れ、このメニューの人の設定が外れる）
  const res = await updateRichMenu(storeId, menu.id, { is_default: false, status: 'draft', line_rich_menu_id: null, dirty: false, last_error: null });
  if (res.error !== undefined || !res.data) return fail(500, res.error || '保存に失敗しました');
  const deadlineMs = Date.now() + RULE_SYNC_BUDGET_MS;
  if (isLocal()) {
    const sync = await syncRichMenuAssignments(storeId, { deadlineMs });
    return { ok: true, data: res.data, notice: `local では LINE に反映しません（記録だけ更新しました。${describeSyncSummary(sync)}）` };
  }
  const token = await getStoreLineToken(storeId);
  if (!token) return { ok: true, data: res.data, summary: 'LINE のチャネルアクセストークンが登録されていないため、LINE 側の設定は外せませんでした' };
  const api = deps.api ?? createRichMenuLineApi(token);
  const sync = await syncRichMenuAssignments(storeId, { api, deadlineMs });
  // 設定を外し終えてから、メニューを消す（残っている人がいるあいだは消さない。次の見直しで外したあと、次の反映の掃除で消える）
  if (oldId && sync.deferred === 0 && sync.failed === 0) await api.remove(oldId).catch(() => null);
  return { ok: true, data: res.data, summary: describeSyncSummary(sync) };
}

/** お客様ごとのメニューの優先順位を変える（上にあるメニューが勝つ）。変えたあと、設定を見直す */
export async function reorderRuleMenuOrder(storeId: string, ids: unknown): Promise<ServiceResult<{ order: string[] }>> {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return fail(400, '並び順の指定が正しくありません');
  const all = await listRichMenus(storeId);
  const next = reorderRuleMenus(all, ids as string[]);
  for (const { id, order } of next) {
    const menu = all.find((m) => m.id === id);
    if (!menu?.rule || menu.rule.order === order) continue;
    const res = await updateRichMenu(storeId, id, { rule: { ...menu.rule, order } });
    if (res.error !== undefined) return fail(500, res.error);
  }
  scheduleRichMenuSync(storeId, 0);
  return { ok: true, data: { order: next.map((n) => n.id) } };
}

/** 見直しに使える時間（反映・並べ替えなど、画面の操作の中で行うとき） */
const RULE_SYNC_BUDGET_MS = 15 * 1000;
/** 予約・顧客情報の変更のあと、見直すまでに待つ時間（続けて行われる保存が終わるのを待つ） */
const RULE_SYNC_DELAY_MS = 10 * 1000;

/**
 * 予約が入った・顧客情報（タグなど）が変わったあとに、お客様ごとのメニューを見直す。
 * レスポンスを返したあとに動かす。お客様ごとのメニューを出していない店舗では何もしない
 */
export function scheduleRichMenuSync(storeId: string | null | undefined, delayMs: number = RULE_SYNC_DELAY_MS): void {
  if (!storeId) return;
  const run = async () => {
    try {
      const menus = await listRichMenus(storeId);
      if (!menus.some((m) => m.rule && m.status === 'published')) return;
      if (delayMs > 0 && !isLocal()) await new Promise((r) => setTimeout(r, delayMs));
      const s = await syncRichMenuAssignments(storeId, { deadlineMs: Date.now() + RULE_SYNC_BUDGET_MS });
      if (s.linked || s.unlinked || s.failed) console.log(`[rich-menu] store=${storeId} ${describeSyncSummary(s)}`);
    } catch (e) {
      console.error('[rich-menu] sync error:', e);
    }
  };
  try {
    after(run);
  } catch {
    // リクエストの外（テストなど）から呼ばれたとき
    void run();
  }
}

/** 1 日 1 回の見直し（cron）。お客様ごとのメニューを出している店舗を順に見る */
export async function runRichMenuSyncForAllStores(deadlineMs: number): Promise<{ stores: number; done: number } & RichMenuSyncSummary> {
  const storeIds = await listStoresWithRuleMenus();
  const total = { stores: storeIds.length, done: 0, ...emptySummary() };
  for (const storeId of storeIds) {
    if (Date.now() > deadlineMs) break;
    try {
      const s = await syncRichMenuAssignments(storeId, { deadlineMs });
      total.done++;
      total.linked += s.linked;
      total.unlinked += s.unlinked;
      total.unchanged += s.unchanged;
      total.failed += s.failed;
      total.deferred += s.deferred;
      total.menus += s.menus;
    } catch (e) {
      console.error(`[rich-menu] store=${storeId} sync error:`, e);
    }
  }
  return total;
}

/** 「いま見直す」（画面のボタン） */
export async function syncRichMenuNow(storeId: string): Promise<ServiceResult<RichMenuSyncSummary>> {
  const reason = await ruleUnavailableReason(storeId);
  if (reason) return fail(400, reason);
  const s = await syncRichMenuAssignments(storeId, { deadlineMs: Date.now() + RULE_SYNC_BUDGET_MS });
  return { ok: true, data: s, summary: describeSyncSummary(s) };
}
