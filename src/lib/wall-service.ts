/**
 * 寄せ書きウォールの業務ロジック — サーバー専用
 * 設計: docs/寄せ書きウォール_要件定義書.md
 *
 * API ルートはここを呼んで結果を JSON で返すだけ。**ここが返す値には投稿者ハッシュ・LINE ユーザー ID・表示名を含めない**
 * （toPublicPost / toAdminPost でしか付箋を外に出さない）。
 */
import { randomBytes } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { resolveLineChannelId, verifyLineIdToken } from '@/lib/line-verify';
import { computeWallAuthorHash, WallSecretMissingError } from '@/lib/wall-author-hash';
import { findNgWords } from '@/lib/wall-ng-words';
import { buildWallInsights } from '@/lib/wall-insights';
import { normalizeWallSettings, normalizeWallTheme, normalizeStoreNgWords } from '@/lib/wall-themes';
import {
  decodeWallCursor,
  encodeWallCursor,
  isWallReportReason,
  validateWallBody,
  wallRateMessage,
  WALL_ADMIN_PAGE_SIZE,
  WALL_CONSENT_TEXT,
  WALL_PAGE_SIZE,
  WALL_REPORT_THRESHOLD,
  WALL_TERMS_VERSION,
  WALL_NOTE_DECORATIONS,
  WALL_LOOKUP_MAX,
  WALL_TOPICS_MAX,
  isWallDecoration,
  isWallReaction,
  jstToday,
} from '@/lib/wall-rules';
import {
  addWallReport,
  countWallReportReasons,
  countWallStats,
  getWallBoard,
  getWallPost,
  getWallStore,
  hasWallConsent,
  insertWallPostChecked,
  listWallPosts,
  logWallModeration,
  saveWallBoard,
  saveWallConsent,
  updateWallPost,
  toggleWallEmpathy,
  getEmpathizedPostIds,
  listWallTopics,
  saveWallTopic,
  deleteWallTopic,
  listWallPostsForInsights,
  type WallStoreInfo,
} from '@/lib/wall-repository';
import type {
  WallAdminPost,
  WallBoardSettings,
  WallPostRow,
  WallPostStatus,
  WallPublicBoardResponse,
  WallPublicPost,
  WallMyPost,
  WallStats,
  WallTopic,
  WallTopicPublic,
  WallInsightsResponse,
} from '@/types/wall';

export type WallError = { ok: false; status: number; error: string; code?: string; detail?: string };

/** お客様から受け取る本人確認情報（id_token。local は line_user_id）と友だち状態 */
export interface WallViewerInput {
  id_token?: unknown;
  line_user_id?: unknown;
  line_friend_flag?: unknown;
}

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

function err(status: number, error: string, extra: Partial<WallError> = {}): WallError {
  return { ok: false, status, error, ...extra };
}

/** LINE ユーザーを確定する（local は line_user_id の申告を許容。抽選と同じ方針） */
async function resolveLineUserId(input: WallViewerInput, store: WallStoreInfo): Promise<{ ok: true; userId: string } | WallError> {
  if (getAppEnvironment() === 'local') {
    const id = typeof input.line_user_id === 'string' ? input.line_user_id.trim() : '';
    return id ? { ok: true, userId: id } : err(401, 'LINE の認証情報がありません。LINE アプリから開き直してください');
  }
  const token = typeof input.id_token === 'string' ? input.id_token : '';
  if (!token) return err(401, 'LINE の認証情報がありません。LINE アプリから開き直してください');
  const channelId = resolveLineChannelId(store.line_channel_id);
  if (!channelId) return err(500, 'LINE チャネル ID が設定されていません。お店にお問い合わせください');
  const verified = await verifyLineIdToken(token, channelId);
  if (!verified.ok) return err(verified.status, verified.error, { detail: verified.detail });
  return { ok: true, userId: verified.payload.userId };
}

function authorHashOrError(storeId: string, userId: string): { ok: true; hash: string } | WallError {
  try {
    return { ok: true, hash: computeWallAuthorHash(storeId, userId) };
  } catch (e) {
    if (e instanceof WallSecretMissingError) {
      console.error('[wall] WALL_AUTHOR_HASH_SECRET is not configured');
      return err(500, '現在ご利用いただけません（設定不備）。お店にお問い合わせください');
    }
    throw e;
  }
}

function isFriend(input: WallViewerInput): boolean {
  return input.line_friend_flag === true || input.line_friend_flag === 'true' || input.line_friend_flag === '1';
}

function canView(board: WallBoardSettings, friend: boolean): boolean {
  return board.access_mode !== 'friend_only' || friend;
}

function canPost(board: WallBoardSettings, friend: boolean): boolean {
  return board.access_mode === 'login' || friend;
}

function newPostId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export interface PublicPostContext {
  /** 閲覧者が共感済みの付箋 ID */
  empathized?: Set<string>;
  /** お題 ID → 題名 */
  topics?: Map<string, string>;
  /** 共感の数を見せるか（false なら null） */
  showCount?: boolean;
}

/** お客様向けの形（投稿者の情報は出さない） */
export function toPublicPost(row: WallPostRow, viewerHash: string | null, ctx: PublicPostContext = {}): WallPublicPost {
  return {
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    is_mine: !!viewerHash && row.author_hash === viewerHash,
    reaction: row.reaction ?? null,
    topic_id: row.topic_id ?? null,
    topic_title: row.topic_id ? ctx.topics?.get(row.topic_id) ?? null : null,
    note_color: row.note_color ?? null,
    note_deco: row.note_deco ?? null,
    empathy_count: ctx.showCount === false ? null : Number(row.empathy_count) || 0,
    empathized: !!ctx.empathized?.has(row.id),
  };
}

function toPublicTopic(t: WallTopic): WallTopicPublic {
  return { id: t.id, title: t.title, description: t.description, ends_on: t.ends_on };
}

/** 今日（JST）開催中のお題（期間が重なる登録は保存時に弾くので最大 1 件） */
function activeTopic(topics: WallTopic[], today: string): WallTopic | null {
  return topics.find((t) => t.starts_on <= today && today <= t.ends_on) ?? null;
}

function topicTitleMap(topics: WallTopic[]): Map<string, string> {
  return new Map(topics.map((t) => [t.id, t.title]));
}

/** 店舗管理向けの形（投稿者の情報は出さない。本人削除は本文も出さない） */
export function toAdminPost(row: WallPostRow, reasons: WallAdminPost['report_reasons'], topicTitles?: Map<string, string>): WallAdminPost {
  return {
    id: row.id,
    no: row.id.slice(0, 6).toUpperCase(),
    body: row.status === 'deleted' ? null : row.body,
    status: row.status,
    pending_reason: row.pending_reason,
    ng_hits: row.ng_hits || [],
    report_count: row.report_count,
    report_reasons: reasons,
    hidden_reason: row.hidden_reason,
    reaction: row.reaction ?? null,
    topic_id: row.topic_id ?? null,
    topic_title: row.topic_id ? topicTitles?.get(row.topic_id) ?? null : null,
    empathy_count: Number(row.empathy_count) || 0,
    note_color: row.note_color ?? null,
    note_deco: row.note_deco ?? null,
    created_at: row.created_at,
  };
}

async function loadStoreAndBoard(storeId: string): Promise<{ ok: true; store: WallStoreInfo; board: WallBoardSettings } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const board = await getWallBoard(storeId);
  return { ok: true, store, board };
}

// ---------------------------------------------------------------------------
// お客様向け
// ---------------------------------------------------------------------------

/** ボード + 公開中の付箋（新しい順）。本人確認は任意（あれば is_mine / 同意済みを判定） */
export async function getPublicWall(
  storeId: string,
  viewer: WallViewerInput,
  opts: { cursor?: unknown; limit?: unknown } = {}
): Promise<{ ok: true; data: WallPublicBoardResponse } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const { store, board } = loaded;

  let viewerHash: string | null = null;
  const hasIdentity = typeof viewer.id_token === 'string' || typeof viewer.line_user_id === 'string';
  if (hasIdentity && board.enabled) {
    const user = await resolveLineUserId(viewer, store);
    if (user.ok) {
      const h = authorHashOrError(storeId, user.userId);
      if (h.ok) viewerHash = h.hash;
    }
  }
  const friend = isFriend(viewer);
  const viewable = board.enabled && canView(board, friend);
  const limitNum = Math.min(50, Math.max(1, Number(opts.limit) || WALL_PAGE_SIZE));
  let posts: WallPublicPost[] = [];
  let nextCursor: string | null = null;
  const topics = board.enabled ? await listWallTopics(storeId) : [];
  const topic = activeTopic(topics, jstToday());
  if (viewable) {
    const rows = await listWallPosts({ storeId, statuses: ['published'], cursor: decodeWallCursor(opts.cursor), limit: limitNum });
    const page = rows.slice(0, limitNum);
    const empathized = viewerHash && board.empathy_enabled ? await getEmpathizedPostIds(page.map((r) => r.id), viewerHash) : undefined;
    posts = page.map((r) => toPublicPost(r, viewerHash, { empathized, topics: topicTitleMap(topics), showCount: board.empathy_show_count }));
    if (rows.length > limitNum) {
      const last = page[page.length - 1];
      nextCursor = encodeWallCursor(last.created_at, last.id);
    }
  }
  const consented = viewerHash ? await hasWallConsent(storeId, viewerHash, WALL_TERMS_VERSION) : false;
  return {
    ok: true,
    data: {
      board: {
        store_id: storeId,
        store_name: store.name,
        theme_color: store.theme_color,
        enabled: board.enabled,
        liff_id: board.liff_id,
        moderation: board.moderation,
        access_mode: board.access_mode,
        daily_max: board.daily_max,
        empathy_enabled: board.empathy_enabled,
        empathy_show_count: board.empathy_show_count,
        customer_pick_enabled: board.customer_pick_enabled,
        decorations: [...WALL_NOTE_DECORATIONS],
        topic: topic ? toPublicTopic(topic) : null,
        theme: board.theme,
        terms_version: WALL_TERMS_VERSION,
        consent_text: WALL_CONSENT_TEXT,
      },
      consented,
      can_view: viewable,
      can_post: board.enabled && canPost(board, friend),
      posts,
      next_cursor: nextCursor,
    },
  };
}

export interface CreateWallPostInput extends WallViewerInput {
  body?: unknown;
  consent?: unknown;
  /** 開催中のお題に答える場合はその ID */
  topic_id?: unknown;
  /** 貼る人が選んだ色（店舗の付箋色の中から）・飾り（固定セット）。店舗が許可しているときだけ */
  note_color?: unknown;
  note_deco?: unknown;
}

export interface CreateWallPostResult {
  ok: true;
  post: WallPublicPost;
  status: 'published' | 'pending';
  message: string;
}

/** 付箋を貼る */
export async function createWallPost(storeId: string, input: CreateWallPostInput, now: Date = new Date()): Promise<CreateWallPostResult | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const { store, board } = loaded;
  if (!board.enabled) return err(403, 'この寄せ書きは現在受け付けていません');
  if (!canPost(board, isFriend(input))) return err(403, '付箋を貼るには公式LINEの友だち追加が必要です', { code: 'friend_required' });

  const user = await resolveLineUserId(input, store);
  if (!user.ok) return user;
  const h = authorHashOrError(storeId, user.userId);
  if (!h.ok) return h;

  const v = validateWallBody(input.body);
  if (!v.ok) return err(400, v.error);

  // 初回投稿時の同意（規約バージョンが変わったら再同意）
  if (!(await hasWallConsent(storeId, h.hash, WALL_TERMS_VERSION))) {
    const c = (input.consent && typeof input.consent === 'object' ? input.consent : {}) as { agreed?: unknown; terms_version?: unknown };
    if (c.agreed !== true || c.terms_version !== WALL_TERMS_VERSION) {
      return err(428, '投稿の前に同意が必要です', { code: 'consent_required' });
    }
    await saveWallConsent(storeId, h.hash, WALL_TERMS_VERSION);
  }

  // お題（開催中のものだけ受け付ける）
  let topicId: string | null = null;
  if (typeof input.topic_id === 'string' && input.topic_id) {
    const active = activeTopic(await listWallTopics(storeId), jstToday(now));
    if (!active || active.id !== input.topic_id) return err(400, 'このお題は受付を終了しました。画面を開き直してください', { code: 'topic_closed' });
    topicId = active.id;
  }
  // 色・飾り（店舗が「お客様が選べる」にしているときだけ）
  let noteColor: string | null = null;
  let noteDeco: string | null = null;
  if (board.customer_pick_enabled) {
    if (typeof input.note_color === 'string' && input.note_color) {
      const c = input.note_color.toLowerCase();
      if (!board.theme.note_colors.includes(c)) return err(400, '選べない色です');
      noteColor = c;
    }
    if (typeof input.note_deco === 'string' && input.note_deco) {
      if (!isWallDecoration(input.note_deco)) return err(400, '選べない飾りです');
      noteDeco = input.note_deco;
    }
  }

  const ngHits = findNgWords(v.body, board.ng_words);
  const status: WallPostStatus = ngHits.length > 0 || board.moderation === 'approval' ? 'pending' : 'published';
  const pendingReason = ngHits.length > 0 ? 'ng_word' : board.moderation === 'approval' ? 'approval' : null;

  const inserted = await insertWallPostChecked({
    storeId,
    authorHash: h.hash,
    now,
    dailyMax: board.daily_max,
    post: { id: newPostId(), body: v.body, status, pending_reason: pendingReason, ng_hits: ngHits, topic_id: topicId, note_color: noteColor, note_deco: noteDeco },
  });
  if (!inserted.ok) {
    if (inserted.reason === 'board_missing') return err(403, 'この寄せ書きは現在受け付けていません');
    return err(429, wallRateMessage(inserted, board.daily_max), { code: inserted.reason });
  }
  console.log(`[wall] post created store=${storeId} post=${inserted.post.id} status=${status}`);
  return {
    ok: true,
    post: toPublicPost(inserted.post, h.hash, { topics: topicId ? new Map([[topicId, (await listWallTopics(storeId)).find((t) => t.id === topicId)?.title ?? '']]) : undefined, showCount: board.empathy_show_count }),
    status: status === 'published' ? 'published' : 'pending',
    // NG ワードに当たったことは伝えない（承認制と同じ案内）
    message: status === 'published' ? '付箋を貼りました' : 'お店の確認後に表示されます',
  };
}

/** 自分の付箋を削除する（他人の付箋・他店舗の付箋・存在しない付箋はすべて 404） */
export async function deleteWallPost(storeId: string, postId: string, input: WallViewerInput): Promise<{ ok: true } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const user = await resolveLineUserId(input, store);
  if (!user.ok) return user;
  const h = authorHashOrError(storeId, user.userId);
  if (!h.ok) return h;
  const post = await getWallPost(storeId, postId);
  if (!post || post.status === 'deleted' || post.author_hash !== h.hash) return err(404, '付箋が見つかりません');
  await updateWallPost(storeId, postId, { status: 'deleted' });
  console.log(`[wall] post deleted by author store=${storeId} post=${postId}`);
  return { ok: true };
}

/** 通報する（公開中の付箋のみ。自分の付箋は不可。同じ人の重複は 1 件扱い） */
export async function reportWallPost(storeId: string, postId: string, input: WallViewerInput & { reason?: unknown }): Promise<{ ok: true; message: string } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const { store, board } = loaded;
  if (!isWallReportReason(input.reason)) return err(400, '通報の理由を選んでください');
  if (!board.enabled || !canView(board, isFriend(input))) return err(404, '付箋が見つかりません');
  const user = await resolveLineUserId(input, store);
  if (!user.ok) return user;
  const h = authorHashOrError(storeId, user.userId);
  if (!h.ok) return h;
  const post = await getWallPost(storeId, postId);
  if (!post || post.status !== 'published') return err(404, '付箋が見つかりません');
  if (post.author_hash === h.hash) return err(400, 'ご自身の付箋は通報できません');
  const r = await addWallReport({ storeId, postId, reporterHash: h.hash, reason: input.reason, threshold: WALL_REPORT_THRESHOLD });
  if (!r.ok) return err(404, '付箋が見つかりません');
  console.log(`[wall] report store=${storeId} post=${postId} reason=${input.reason} dup=${r.duplicated} status=${r.status}`);
  return { ok: true, message: '通報を受け付けました。ご協力ありがとうございます' };
}

/** 共感を押す / 取り消す（公開中の付箋のみ。自分の付箋は不可） */
export async function toggleWallEmpathyForViewer(storeId: string, postId: string, input: WallViewerInput): Promise<{ ok: true; empathized: boolean; empathy_count: number | null } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const { store, board } = loaded;
  if (!board.enabled || !board.empathy_enabled) return err(404, '付箋が見つかりません');
  if (!canView(board, isFriend(input))) return err(404, '付箋が見つかりません');
  const user = await resolveLineUserId(input, store);
  if (!user.ok) return user;
  const h = authorHashOrError(storeId, user.userId);
  if (!h.ok) return h;
  const post = await getWallPost(storeId, postId);
  if (!post || post.status !== 'published') return err(404, '付箋が見つかりません');
  if (post.author_hash === h.hash) return err(400, 'ご自身の付箋には押せません');
  const r = await toggleWallEmpathy(storeId, postId, h.hash);
  if (!r.ok) return err(404, '付箋が見つかりません');
  return { ok: true, empathized: r.empathized, empathy_count: board.empathy_show_count ? r.count : null };
}

/** 自分の付箋一覧（削除以外。状態付き。新しい順、最大 100） */
export async function getMyWallPosts(storeId: string, input: WallViewerInput): Promise<{ ok: true; posts: WallMyPost[] } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const { store, board } = loaded;
  if (!board.enabled) return err(403, 'この寄せ書きは現在受け付けていません');
  const user = await resolveLineUserId(input, store);
  if (!user.ok) return user;
  const h = authorHashOrError(storeId, user.userId);
  if (!h.ok) return h;
  const rows = await listWallPosts({ storeId, statuses: ['published', 'pending', 'review', 'hidden'], cursor: null, limit: 100, authorHash: h.hash });
  const topics = topicTitleMap(await listWallTopics(storeId));
  const posts: WallMyPost[] = rows.slice(0, 100).map((r) => ({ ...toPublicPost(r, h.hash, { topics, showCount: board.empathy_show_count }), status: r.status as WallMyPost['status'] }));
  return { ok: true, posts };
}

/** あとで読む用の照会: 渡した ID のうち今も公開中の付箋だけ返す（他店舗の ID は返らない） */
export async function lookupWallPosts(storeId: string, ids: unknown, viewer: WallViewerInput): Promise<{ ok: true; posts: WallPublicPost[] } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const { store, board } = loaded;
  if (!board.enabled || !canView(board, isFriend(viewer))) return err(404, '付箋が見つかりません');
  const list = (Array.isArray(ids) ? ids : typeof ids === 'string' ? ids.split(',') : []).filter((x): x is string => typeof x === 'string' && /^[a-z0-9]{6,20}$/.test(x)).slice(0, WALL_LOOKUP_MAX);
  if (list.length === 0) return { ok: true, posts: [] };
  let viewerHash: string | null = null;
  if (typeof viewer.id_token === 'string' || typeof viewer.line_user_id === 'string') {
    const user = await resolveLineUserId(viewer, store);
    if (user.ok) { const h = authorHashOrError(storeId, user.userId); if (h.ok) viewerHash = h.hash; }
  }
  const rows = await listWallPosts({ storeId, statuses: ['published'], cursor: null, limit: WALL_LOOKUP_MAX, ids: list });
  const empathized = viewerHash && board.empathy_enabled ? await getEmpathizedPostIds(rows.map((r) => r.id), viewerHash) : undefined;
  const topics = topicTitleMap(await listWallTopics(storeId));
  return { ok: true, posts: rows.slice(0, WALL_LOOKUP_MAX).map((r) => toPublicPost(r, viewerHash, { empathized, topics, showCount: board.empathy_show_count })) };
}

// ---------------------------------------------------------------------------
// 店舗管理
// ---------------------------------------------------------------------------

export type WallAdminFilter = 'all' | 'published' | 'pending' | 'review' | 'hidden' | 'deleted' | 'reported';
const ALL_STATUSES: WallPostStatus[] = ['published', 'pending', 'review', 'hidden', 'deleted'];

export async function listAdminWallPosts(
  storeId: string,
  opts: { filter?: unknown; cursor?: unknown; limit?: unknown; topic?: unknown; search?: unknown } = {}
): Promise<{ ok: true; posts: WallAdminPost[]; next_cursor: string | null } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const filter = (['all', 'published', 'pending', 'review', 'hidden', 'deleted', 'reported'] as WallAdminFilter[]).includes(opts.filter as WallAdminFilter)
    ? (opts.filter as WallAdminFilter)
    : 'all';
  const statuses = filter === 'all' ? ALL_STATUSES : filter === 'reported' ? ALL_STATUSES.filter((s) => s !== 'deleted') : [filter as WallPostStatus];
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || WALL_ADMIN_PAGE_SIZE));
  const topicId = typeof opts.topic === 'string' && opts.topic ? opts.topic : undefined;
  const search = typeof opts.search === 'string' && opts.search.trim() ? opts.search.trim().slice(0, 50) : undefined;
  const rows = await listWallPosts({ storeId, statuses, cursor: decodeWallCursor(opts.cursor), limit, reportedOnly: filter === 'reported', topicId, search });
  const page = rows.slice(0, limit);
  const reasons = await countWallReportReasons(page.map((r) => r.id));
  const topics = topicTitleMap(await listWallTopics(storeId));
  const last = page[page.length - 1];
  return {
    ok: true,
    posts: page.map((r) => toAdminPost(r, reasons[r.id], topics)),
    next_cursor: rows.length > limit && last ? encodeWallCursor(last.created_at, last.id) : null,
  };
}

export interface WallActor { user_id: string | null; email: string | null; role: string | null }

/** 公開 / 非公開（非公開の理由は「規約違反」のみ） */
export async function moderateWallPost(
  storeId: string,
  postId: string,
  input: { action?: unknown; reason?: unknown; reaction?: unknown },
  actor: WallActor
): Promise<{ ok: true; post: WallAdminPost } | WallError> {
  const post = await getWallPost(storeId, postId);
  if (!post) return err(404, '付箋が見つかりません');
  if (post.status === 'deleted') return err(400, '投稿者が削除した付箋は操作できません');
  let updated: WallPostRow | null;
  if (input.action === 'publish') {
    updated = await updateWallPost(storeId, postId, {
      status: 'published', pending_reason: null, report_count: 0, hidden_reason: null, hidden_at: null, hidden_by: null,
    });
    await logWallModeration({ store_id: storeId, post_id: postId, action: 'publish', reason: null, actor_user_id: actor.user_id, actor_email: actor.email, actor_role: actor.role });
  } else if (input.action === 'hide') {
    if (input.reason !== 'terms_violation') return err(400, '非公開にする理由は「規約違反」のみ選べます（評価の良し悪しを理由に非公開にはできません）');
    updated = await updateWallPost(storeId, postId, {
      status: 'hidden', hidden_reason: 'terms_violation', hidden_at: new Date().toISOString(), hidden_by: actor.user_id,
    });
    await logWallModeration({ store_id: storeId, post_id: postId, action: 'hide', reason: 'terms_violation', actor_user_id: actor.user_id, actor_email: actor.email, actor_role: actor.role });
  } else if (input.action === 'react') {
    // お店からの「ありがとう」（固定セットのスタンプ 1 つ。null で解除）
    if (input.reaction !== null && input.reaction !== undefined && !isWallReaction(input.reaction)) return err(400, 'スタンプが正しくありません');
    const reaction = isWallReaction(input.reaction) ? input.reaction : null;
    updated = await updateWallPost(storeId, postId, { reaction, reaction_at: reaction ? new Date().toISOString() : null });
  } else {
    return err(400, '操作が正しくありません');
  }
  if (!updated) return err(404, '付箋が見つかりません');
  const reasons = await countWallReportReasons([postId]);
  return { ok: true, post: toAdminPost(updated, reasons[postId], topicTitleMap(await listWallTopics(storeId))) };
}

export async function getWallSettings(storeId: string): Promise<{ ok: true; settings: WallBoardSettings; store_name: string; theme_color: string | null } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  return { ok: true, settings: loaded.board, store_name: loaded.store.name, theme_color: loaded.store.theme_color };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** 設定の保存（不正な値は 400。正規化してから保存） */
export async function saveWallSettings(storeId: string, raw: unknown): Promise<{ ok: true; settings: WallBoardSettings } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const theme = (r.theme && typeof r.theme === 'object' ? r.theme : {}) as Record<string, unknown>;
  if (Array.isArray(theme.note_colors)) {
    const colors = theme.note_colors.filter((c) => typeof c === 'string');
    if (colors.some((c) => !HEX.test(c as string))) return err(400, '付箋の色は #RRGGBB の形式で指定してください');
    if (colors.length < 3 || colors.length > 8) return err(400, '付箋の色は 3〜8 色で指定してください');
  }
  if (typeof theme.background_color === 'string' && theme.background_color && !HEX.test(theme.background_color)) {
    return err(400, '背景色は #RRGGBB の形式で指定してください');
  }
  if (Array.isArray(r.ng_words) && r.ng_words.some((w) => typeof w === 'string' && w.trim().length > 30)) {
    return err(400, 'NG ワードは 1 語 30 文字以内で指定してください');
  }
  if (r.daily_max !== undefined && (typeof r.daily_max !== 'number' || !Number.isInteger(r.daily_max) || r.daily_max < 1 || r.daily_max > 10)) {
    return err(400, '1 日に貼れる枚数は 1〜10 の整数で指定してください');
  }
  if (typeof r.liff_id === 'string' && r.liff_id.trim() && !/^[0-9]{6,}-[A-Za-z0-9]{4,}$/.test(r.liff_id.trim())) {
    return err(400, 'LIFF ID の形式が正しくありません（例: 1234567890-AbCdEfGh）');
  }
  const settings = normalizeWallSettings(storeId, { ...r, theme: normalizeWallTheme(theme), ng_words: normalizeStoreNgWords(r.ng_words) });
  const saved = await saveWallBoard(settings);
  return { ok: true, settings: saved };
}

export async function getWallStats(storeId: string, now: Date = new Date()): Promise<{ ok: true; stats: WallStats } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const since = new Date(now.getTime() - 7 * 24 * 3600000);
  const c = await countWallStats(storeId, since);
  return { ok: true, stats: { enabled: loaded.board.enabled, ...c } };
}

// ---------------------------------------------------------------------------
// お題（店舗管理）
// ---------------------------------------------------------------------------

export type WallTopicStatus = 'active' | 'upcoming' | 'ended';

export function topicStatus(t: WallTopic, today: string): WallTopicStatus {
  if (today < t.starts_on) return 'upcoming';
  if (today > t.ends_on) return 'ended';
  return 'active';
}

export async function listWallTopicsAdmin(storeId: string, now: Date = new Date()): Promise<{ ok: true; topics: Array<WallTopic & { status: WallTopicStatus }> } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const today = jstToday(now);
  const topics = await listWallTopics(storeId);
  return { ok: true, topics: topics.map((t) => ({ ...t, status: topicStatus(t, today) })) };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** お題の作成 / 更新（期間の重なりは不可 = 開催中のお題は常に 1 つ） */
export async function saveWallTopicAdmin(storeId: string, topicId: string | null, raw: unknown): Promise<{ ok: true; topic: WallTopic } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const description = typeof r.description === 'string' ? r.description.trim() : '';
  const startsOn = typeof r.starts_on === 'string' ? r.starts_on.trim() : '';
  const endsOn = typeof r.ends_on === 'string' ? r.ends_on.trim() : '';
  if (!title || [...title].length > 40) return err(400, 'お題は 1〜40 文字で入力してください');
  if ([...description].length > 120) return err(400, '説明は 120 文字以内で入力してください');
  if (!YMD.test(startsOn) || !YMD.test(endsOn) || Number.isNaN(Date.parse(startsOn)) || Number.isNaN(Date.parse(endsOn))) return err(400, '開始日・終了日を入力してください');
  if (endsOn < startsOn) return err(400, '終了日は開始日以降にしてください');
  const existing = await listWallTopics(storeId);
  if (topicId && !existing.some((t) => t.id === topicId)) return err(404, 'お題が見つかりません');
  if (!topicId && existing.length >= WALL_TOPICS_MAX) return err(400, `お題は ${WALL_TOPICS_MAX} 件までです。古いものを削除してください`);
  const overlap = existing.find((t) => t.id !== topicId && t.starts_on <= endsOn && startsOn <= t.ends_on);
  if (overlap) return err(400, `「${overlap.title}」（${overlap.starts_on}〜${overlap.ends_on}）と期間が重なっています。お題は同じ期間に 1 つだけ出せます`);
  const now = new Date().toISOString();
  const prev = topicId ? existing.find((t) => t.id === topicId) : undefined;
  const topic: WallTopic = {
    id: topicId ?? newPostId(),
    store_id: storeId,
    title,
    description,
    starts_on: startsOn,
    ends_on: endsOn,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  };
  const saved = await saveWallTopic(topic);
  return { ok: true, topic: saved };
}

export async function deleteWallTopicAdmin(storeId: string, topicId: string): Promise<{ ok: true } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const deleted = await deleteWallTopic(storeId, topicId);
  if (!deleted) return err(404, 'お題が見つかりません');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 見どころ（店舗管理）
// ---------------------------------------------------------------------------

export async function getWallInsights(storeId: string, now: Date = new Date()): Promise<{ ok: true; insights: WallInsightsResponse } | WallError> {
  const loaded = await loadStoreAndBoard(storeId);
  if (!loaded.ok) return loaded;
  const since = new Date(now.getTime() - 8 * 7 * 24 * 3600000);
  const rows = await listWallPostsForInsights(storeId, since);
  return { ok: true, insights: buildWallInsights(rows, now, { ngWords: loaded.board.ng_words }) };
}
