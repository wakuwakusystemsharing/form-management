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
  type WallStoreInfo,
} from '@/lib/wall-repository';
import type {
  WallAdminPost,
  WallBoardSettings,
  WallPostRow,
  WallPostStatus,
  WallPublicBoardResponse,
  WallPublicPost,
  WallStats,
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

/** お客様向けの形（投稿者の情報は出さない） */
export function toPublicPost(row: WallPostRow, viewerHash: string | null): WallPublicPost {
  return { id: row.id, body: row.body, created_at: row.created_at, is_mine: !!viewerHash && row.author_hash === viewerHash };
}

/** 店舗管理向けの形（投稿者の情報は出さない。本人削除は本文も出さない） */
export function toAdminPost(row: WallPostRow, reasons: WallAdminPost['report_reasons']): WallAdminPost {
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
  if (viewable) {
    const rows = await listWallPosts({ storeId, statuses: ['published'], cursor: decodeWallCursor(opts.cursor), limit: limitNum });
    const page = rows.slice(0, limitNum);
    posts = page.map((r) => toPublicPost(r, viewerHash));
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

  const ngHits = findNgWords(v.body, board.ng_words);
  const status: WallPostStatus = ngHits.length > 0 || board.moderation === 'approval' ? 'pending' : 'published';
  const pendingReason = ngHits.length > 0 ? 'ng_word' : board.moderation === 'approval' ? 'approval' : null;

  const inserted = await insertWallPostChecked({
    storeId,
    authorHash: h.hash,
    now,
    post: { id: newPostId(), body: v.body, status, pending_reason: pendingReason, ng_hits: ngHits },
  });
  if (!inserted.ok) {
    if (inserted.reason === 'board_missing') return err(403, 'この寄せ書きは現在受け付けていません');
    return err(429, wallRateMessage(inserted), { code: inserted.reason });
  }
  console.log(`[wall] post created store=${storeId} post=${inserted.post.id} status=${status}`);
  return {
    ok: true,
    post: toPublicPost(inserted.post, h.hash),
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

// ---------------------------------------------------------------------------
// 店舗管理
// ---------------------------------------------------------------------------

export type WallAdminFilter = 'all' | 'published' | 'pending' | 'review' | 'hidden' | 'deleted' | 'reported';
const ALL_STATUSES: WallPostStatus[] = ['published', 'pending', 'review', 'hidden', 'deleted'];

export async function listAdminWallPosts(
  storeId: string,
  opts: { filter?: unknown; cursor?: unknown; limit?: unknown } = {}
): Promise<{ ok: true; posts: WallAdminPost[]; next_cursor: string | null } | WallError> {
  const store = await getWallStore(storeId);
  if (!store) return err(404, 'お店が見つかりません');
  const filter = (['all', 'published', 'pending', 'review', 'hidden', 'deleted', 'reported'] as WallAdminFilter[]).includes(opts.filter as WallAdminFilter)
    ? (opts.filter as WallAdminFilter)
    : 'all';
  const statuses = filter === 'all' ? ALL_STATUSES : filter === 'reported' ? ALL_STATUSES.filter((s) => s !== 'deleted') : [filter as WallPostStatus];
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || WALL_ADMIN_PAGE_SIZE));
  const rows = await listWallPosts({ storeId, statuses, cursor: decodeWallCursor(opts.cursor), limit, reportedOnly: filter === 'reported' });
  const page = rows.slice(0, limit);
  const reasons = await countWallReportReasons(page.map((r) => r.id));
  const last = page[page.length - 1];
  return {
    ok: true,
    posts: page.map((r) => toAdminPost(r, reasons[r.id])),
    next_cursor: rows.length > limit && last ? encodeWallCursor(last.created_at, last.id) : null,
  };
}

export interface WallActor { user_id: string | null; email: string | null; role: string | null }

/** 公開 / 非公開（非公開の理由は「規約違反」のみ） */
export async function moderateWallPost(
  storeId: string,
  postId: string,
  input: { action?: unknown; reason?: unknown },
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
  } else {
    return err(400, '操作が正しくありません');
  }
  if (!updated) return err(404, '付箋が見つかりません');
  const reasons = await countWallReportReasons([postId]);
  return { ok: true, post: toAdminPost(updated, reasons[postId]) };
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
