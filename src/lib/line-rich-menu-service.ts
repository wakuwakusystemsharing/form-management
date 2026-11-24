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
import { getAppEnvironment } from '@/lib/env';
import { getStoreLineToken } from '@/lib/broadcast-repository';
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
import { createRichMenuLineApi, type RichMenuLineApi } from '@/lib/line-rich-menu-api';
import { deleteRichMenuRow, getRichMenu, insertRichMenu, listRichMenus, updateRichMenu } from '@/lib/line-rich-menu-repository';

const isLocal = () => getAppEnvironment() === 'local';

/**
 * LINE に作るメニューの名前の先頭に付ける印。
 * 消し残りの掃除は、この印の付いたメニューだけを対象にする（ほかのツールで作ったメニューは消さない）
 */
export const LINE_MENU_NAME_PREFIX = '[nas-rsv] ';

export type ServiceResult<T> = { ok: true; data: T; notice?: string } | { ok: false; status: number; error: string };
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
}

async function formOptions(storeId: string, origin: string): Promise<{ options: RichMenuFormOption[]; urlOf: (id: string) => string | null }> {
  const forms = await listStoreForms(storeId).catch(() => []);
  const urls = new Map(forms.map((f) => [f.id, resolveFormBaseUrl(f, origin)]));
  return { options: forms.map((f) => ({ id: f.id, name: f.name, openable: !!urls.get(f.id) })), urlOf: (id) => urls.get(id) ?? null };
}

const inputOf = (menu: LineRichMenu): RichMenuInput => ({ name: menu.name, size: menu.size, image_url: menu.image_url, areas: menu.areas, chat_bar_text: menu.chat_bar_text, open_by_default: menu.open_by_default });

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
  return { menus, forms: forms.options, max: RICH_MENU_LIMITS.menusMax, has_token: !!token, local: isLocal(), external_notice: externalNotice };
}

export async function createRichMenu(storeId: string, body: unknown): Promise<ServiceResult<LineRichMenu>> {
  const input = normalizeRichMenuInput(body);
  const errors = validateRichMenu(input);
  if (errors.length > 0) return fail(400, errors[0]);
  const existing = await listRichMenus(storeId);
  if (existing.length >= RICH_MENU_LIMITS.menusMax) return fail(400, `リッチメニューは ${RICH_MENU_LIMITS.menusMax} 個までです。使っていないものを削除してください`);
  const res = await insertRichMenu(storeId, input);
  if (res.error !== undefined) return fail(500, res.error);
  return { ok: true, data: res.data };
}

/** 内容を保存する。反映中のメニューを変えたときは「未反映の変更あり」にする（保存しただけでは公式 LINE には出ない） */
export async function saveRichMenu(storeId: string, id: string, body: unknown): Promise<ServiceResult<LineRichMenu>> {
  const menu = await getRichMenu(storeId, id);
  if (!menu) return fail(404, 'リッチメニューが見つかりません');
  if (!canStartPublish(menu)) return fail(409, '反映の途中です。少し待ってから、もう一度お試しください');
  const input = normalizeRichMenuInput(body);
  const errors = validateRichMenu(input);
  if (errors.length > 0) return fail(400, errors[0]);
  const res = await updateRichMenu(storeId, id, { ...input, dirty: menu.status === 'published' ? true : menu.dirty });
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
export async function publishToLine(p: { api: RichMenuLineApi; items: PublishItem[] }): Promise<PublishToLineResult> {
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

  const collected = collectSwitchGroup(id, all);
  if (!collected.ok) return fail(400, collected.error);
  const group = collected.group;
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
  const others = all.filter((m) => !groupIds.has(m.id) && (m.is_default || m.line_rich_menu_id || m.status === 'published'));
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
  const oldIds = all.map((m) => m.line_rich_menu_id).filter((v): v is string => !!v);
  for (const other of others) await updateRichMenu(storeId, other.id, offPatch);
  for (const m of group.slice(1)) {
    await updateRichMenu(storeId, m.id, { status: 'published', is_default: false, line_rich_menu_id: result.ids[m.id] ?? null, dirty: false, last_error: null, published_at: publishedAt });
  }
  const saved = await updateRichMenu(storeId, id, { status: 'published', is_default: true, line_rich_menu_id: result.richMenuId, dirty: false, last_error: null, published_at: publishedAt });

  // 5. 古いメニューと名札を消す（失敗しても反映は成功）
  const cleanup = await cleanupLineRichMenus(api, { menuIds: Object.values(result.ids), aliasIds: [...aliasOf.values()] }, oldIds);
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
  if (!menu.is_default && !menu.line_rich_menu_id && menu.status !== 'published') return fail(400, 'このメニューは反映されていません');
  // 切り替え先として出ているだけのメニューは、元のメニューの反映をやめる
  const root = all.find((m) => m.is_default);
  if (!menu.is_default && root && root.id !== id) return fail(409, `このメニューは「${root.name}」の切り替え先として出ています。「${root.name}」の「反映をやめる」を押してください`);

  const patch = { is_default: false, status: 'draft' as const, line_rich_menu_id: null, dirty: false, last_error: null };
  const linked = all.filter((m) => m.id !== id && (m.status === 'published' || m.line_rich_menu_id));

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
  const oldIds = all.map((m) => m.line_rich_menu_id).filter((v): v is string => !!v);
  await cleanupLineRichMenus(api, { menuIds: [] }, oldIds).catch(() => null);
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
