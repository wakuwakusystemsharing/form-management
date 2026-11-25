/**
 * 1 対 1 トークの画像の置き場 — サーバー専用（fs / Supabase Storage / LINE に依存。クライアントから import しない）
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * - **お客様から届いた画像は公開しない**: 公開しないバケツ `chat-media` に置き、画面からは
 *   ログインと店舗の確認をする API（/api/stores/{storeId}/chat/media/{messageId}）を通して読む
 * - 店舗が送る画像は、LINE が取りに来るので公開の URL が要る。公開のバケツ `forms` の
 *   `chat_images/{storeId}/{推測できない 32 桁}.jpg` に置く（メニュー画像と同じ方式）
 * - local は data/chat_media/（届いた画像）と public/chat_images/（送る画像）
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';
import { CHAT_INBOUND_IMAGE_MAX_BYTES, CHAT_MEDIA_BUCKET, chatImageContentType, chatImageExt, chatOutboundImagePath } from '@/lib/chat';

const isLocal = () => getAppEnvironment() === 'local';
const localMediaDir = () => path.join(process.cwd(), 'data', 'chat_media');
/** バケツの中のパスとして安全か（上の階層へ出ない・決まった文字だけ） */
const isSafePath = (p: string) => !!p && !p.includes('..') && /^[A-Za-z0-9_\-./]+$/.test(p) && !p.startsWith('/');

function storage(): any {
  const c = createAdminClient();
  if (!c) throw new Error('Supabase 接続エラー');
  return c.storage;
}

export interface ChatImageContent {
  data: Buffer;
  contentType: string;
}

/**
 * LINE から、お客様が送った画像の中身を取得する（10 秒で打ち切り）。
 * 画像でない・大きすぎる（10MB 超）・取得できないときは null（理由を reason に）
 */
export async function fetchLineImageContent(accessToken: string, lineMessageId: string, fetchImpl: typeof fetch = fetch): Promise<{ content: ChatImageContent | null; reason?: string; retry?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetchImpl(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(lineMessageId)}/content`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
    // 202 = LINE 側でまだ準備中 / 5xx・429 = 一時的 → もう一度試す。4xx = 保存期間切れなど → 試しても同じ
    if (res.status === 202 || res.status === 429 || res.status >= 500) return { content: null, reason: `LINE の応答 ${res.status}`, retry: true };
    if (!res.ok) return { content: null, reason: `LINE の応答 ${res.status}` };
    const contentType = res.headers.get('content-type');
    if (!chatImageExt(contentType)) return { content: null, reason: `画像ではありません（${contentType ?? '種類なし'}）` };
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > CHAT_INBOUND_IMAGE_MAX_BYTES) return { content: null, reason: '画像が大きすぎます' };
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0) return { content: null, reason: '画像が空です', retry: true };
    if (data.length > CHAT_INBOUND_IMAGE_MAX_BYTES) return { content: null, reason: '画像が大きすぎます' };
    return { content: { data, contentType: (contentType ?? 'image/jpeg').split(';')[0].trim().toLowerCase() } };
  } catch (e) {
    return { content: null, reason: e instanceof Error ? e.message : '通信エラー', retry: true };
  } finally {
    clearTimeout(timer);
  }
}

/** お客様から届いた画像を、公開しないバケツに保存する。失敗は例外 */
export async function saveChatInboundImage(mediaPath: string, content: ChatImageContent): Promise<void> {
  if (!isSafePath(mediaPath)) throw new Error('保存先が正しくありません');
  if (isLocal()) {
    const file = path.join(localMediaDir(), mediaPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.data);
    return;
  }
  const upload = () => storage().from(CHAT_MEDIA_BUCKET).upload(mediaPath, content.data, { contentType: content.contentType, upsert: true, cacheControl: '3600' });
  let { error } = await upload();
  // バケツが無い（マイグレーション未適用）ときは、公開しない設定で作ってからやり直す
  if (error && /bucket.*not.*found|not found/i.test(error.message || '')) {
    const created = await storage().createBucket(CHAT_MEDIA_BUCKET, { public: false, fileSizeLimit: CHAT_INBOUND_IMAGE_MAX_BYTES });
    if (!created.error || /already exists/i.test(created.error.message || '')) ({ error } = await upload());
  }
  if (error) throw new Error(error.message || '画像の保存エラー');
}

/** お客様から届いた画像を読む（無ければ null） */
export async function readChatInboundImage(mediaPath: string): Promise<ChatImageContent | null> {
  if (!isSafePath(mediaPath)) return null;
  const contentType = chatImageContentType(mediaPath);
  if (isLocal()) {
    const file = path.join(localMediaDir(), mediaPath);
    return fs.existsSync(file) ? { data: fs.readFileSync(file), contentType } : null;
  }
  const { data, error } = await storage().from(CHAT_MEDIA_BUCKET).download(mediaPath);
  if (error || !data) return null;
  return { data: Buffer.from(await (data as Blob).arrayBuffer()), contentType: (data as Blob).type || contentType };
}

/** 店舗が送る画像を、公開の置き場に保存して URL を返す（名前は推測できない 32 桁） */
export async function saveChatOutboundImage(storeId: string, data: Buffer, ext: 'jpg' | 'png'): Promise<{ url: string; path: string }> {
  const mediaPath = chatOutboundImagePath(storeId, randomBytes(16).toString('hex'), ext);
  const url = await new SupabaseStorageDeployer().uploadImage(data, mediaPath);
  return { url, path: mediaPath };
}

/**
 * 画像のファイルを消す（保存期間を過ぎたメッセージの画像）。
 * inbound = 公開しないバケツ / outbound = 公開のバケツ。消せなかったパスを返す（空なら全部消せた）
 */
export async function removeChatMedia(kind: 'inbound' | 'outbound', paths: string[]): Promise<string[]> {
  const targets = [...new Set(paths.filter(isSafePath))];
  if (targets.length === 0) return [];
  if (isLocal()) {
    const base = kind === 'inbound' ? localMediaDir() : path.join(process.cwd(), 'public');
    const failed: string[] = [];
    for (const p of targets) {
      try {
        const file = path.join(base, p);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        failed.push(p);
      }
    }
    return failed;
  }
  const { error } = await storage()
    .from(kind === 'inbound' ? CHAT_MEDIA_BUCKET : 'forms')
    .remove(targets);
  return error ? targets : [];
}
