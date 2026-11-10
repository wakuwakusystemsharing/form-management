/**
 * 「友だち登録だけの人」を顧客台帳に入れる（配信タブで送れるようにするため）
 *
 * 予約もアンケートもしていない LINE 友だちは、このシステムが LINE ユーザー ID を知らないので配信できない。
 * そこで次のタイミングで、LINE の表示名を名前にした顧客（`customers.line_friend_only = true`）を自動で作る:
 *   - 友だち追加されたとき（Webhook の follow）
 *   - 公式 LINE に何か送ってきた / リッチメニューを押したとき（Webhook の message / postback）
 *   - 「友だちを取り込む」ボタン（認証済みアカウントだけ。Messaging API の followers 一覧）
 * 予約すると `line_friend_only` を false に戻し、予約時の名前・電話番号を入れる（promoteFriendOnlyPatch）。
 * 顧客一覧・顧客分析・全店舗ランキングでは既定で除外する（配信先の判定には含める）。
 */

export const FRIEND_ONLY_DEFAULT_NAME = 'LINE 友だち';
const LINE_API = 'https://api.line.me/v2/bot';
const LINE_TIMEOUT_MS = 8000;

export interface LineProfile {
  displayName: string | null;
  pictureUrl: string | null;
  statusMessage: string | null;
  language: string | null;
}

async function lineGet(path: string, token: string, fetchImpl: typeof fetch): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${LINE_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** LINE のプロフィール（取得できなければ null。ブロック中のユーザーは 404） */
export async function fetchLineProfile(token: string, userId: string, fetchImpl: typeof fetch = fetch): Promise<LineProfile | null> {
  const r = await lineGet(`/profile/${encodeURIComponent(userId)}`, token, fetchImpl);
  if (!r.ok || !r.json) return null;
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return { displayName: s(r.json.displayName), pictureUrl: s(r.json.pictureUrl), statusMessage: s(r.json.statusMessage), language: s(r.json.language) };
}

/** 友だちだけの顧客として登録する行（純粋関数） */
export function buildFriendCustomerRow(storeId: string, lineUserId: string, profile: LineProfile | null, opts: { friend?: boolean; addedAt?: string } = {}): Record<string, unknown> {
  const friend = opts.friend !== false;
  return {
    store_id: storeId,
    line_user_id: lineUserId,
    name: profile?.displayName || FRIEND_ONLY_DEFAULT_NAME,
    line_display_name: profile?.displayName ?? null,
    line_picture_url: profile?.pictureUrl ?? null,
    line_status_message: profile?.statusMessage ?? null,
    line_language: profile?.language ?? null,
    line_friend_flag: friend,
    line_friend_added_at: friend ? opts.addedAt ?? new Date().toISOString() : null,
    line_friend_only: true,
    customer_type: 'new',
    tags: [],
  };
}

/**
 * 友だちだけの顧客が予約したときに足す更新内容（純粋関数）。
 * 「予約なしの友だち」の印を外し、名前（LINE 表示名のまま）を予約時の名前に、空の電話番号・メールを予約時の値にする。
 * 友だちだけの顧客でなければ {}（既存の顧客の名前などは変えない）
 */
export function promoteFriendOnlyPatch(
  existing: { line_friend_only?: boolean | null; name?: string | null; phone?: string | null; email?: string | null },
  booking: { name?: unknown; phone?: unknown; email?: unknown }
): Record<string, unknown> {
  if (existing.line_friend_only !== true) return {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const patch: Record<string, unknown> = { line_friend_only: false };
  const name = str(booking.name);
  if (name && name !== '未記入') patch.name = name;
  const phone = str(booking.phone);
  if (!existing.phone && phone && phone !== '未記入') patch.phone = phone;
  const email = str(booking.email);
  if (!existing.email && email) patch.email = email;
  return patch;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * その店舗に、この LINE ユーザーの顧客が無ければ「友だちだけの顧客」を作る。あれば何もしない。
 * created = 作った / exists = 既にある / failed = 作れなかった（列が未適用など。呼び出し元は処理を止めない）
 */
export async function ensureFriendCustomer(adminClient: any, storeId: string, lineUserId: string, token: string, opts: { timestampMs?: number; fetchImpl?: typeof fetch } = {}): Promise<'created' | 'exists' | 'failed'> {
  try {
    const { data: existing, error: selError } = await adminClient.from('customers').select('id').eq('store_id', storeId).eq('line_user_id', lineUserId).limit(1);
    if (selError) return 'failed';
    if (existing && existing.length > 0) return 'exists';
    const profile = await fetchLineProfile(token, lineUserId, opts.fetchImpl ?? fetch);
    const row = buildFriendCustomerRow(storeId, lineUserId, profile, { friend: true, addedAt: opts.timestampMs ? new Date(opts.timestampMs).toISOString() : undefined });
    // プロフィール取得の間に予約などで作られていたら作らない（同じ LINE ユーザーの二重登録を避ける）
    const { data: again } = await adminClient.from('customers').select('id').eq('store_id', storeId).eq('line_user_id', lineUserId).limit(1);
    if (again && again.length > 0) return 'exists';
    const { error } = await adminClient.from('customers').insert(row);
    if (error) {
      console.warn('[line-friend] 友だちの顧客登録に失敗:', error.message);
      return 'failed';
    }
    return 'created';
  } catch (e) {
    console.warn('[line-friend] 友だちの顧客登録エラー:', e);
    return 'failed';
  }
}

export interface FriendImportResult {
  /** この回で新しく登録した人数 */
  imported: number;
  /** すでに顧客台帳にいた人数（この回で確認できた分） */
  existing: number;
  /** まだ確認していない友だちがいる（時間切れ。もう一度押すと続きから） */
  remaining: boolean;
  error?: string;
  status?: number;
}

/**
 * LINE の友だち一覧（followers）から、顧客台帳にいない人を「友だちだけの顧客」として取り込む。
 * followers 一覧は認証済みアカウント（プレミアム含む）だけが使える（未認証は 403）。
 * `deadline`（ms）まで処理し、残りがあれば remaining = true。すでにいる人は飛ばすので、何度押しても二重登録しない
 */
export async function importLineFriends(adminClient: any, storeId: string, token: string, deadline: number, fetchImpl: typeof fetch = fetch): Promise<FriendImportResult> {
  const result: FriendImportResult = { imported: 0, existing: 0, remaining: false };

  // 既に顧客台帳にある LINE ユーザー ID
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await adminClient.from('customers').select('line_user_id').eq('store_id', storeId).not('line_user_id', 'is', null).order('id').range(from, from + 999);
    if (error) return { ...result, error: `顧客の取得に失敗しました: ${error.message}`, status: 500 };
    for (const r of data ?? []) if (r.line_user_id) known.add(r.line_user_id);
    if (!data || data.length < 1000) break;
  }

  let start: string | null = null;
  for (;;) {
    const r = await lineGet(`/followers/ids?limit=1000${start ? `&start=${encodeURIComponent(start)}` : ''}`, token, fetchImpl);
    if (!r.ok || !r.json) {
      if (r.status === 403) return { ...result, error: '友だちの一覧は、LINE の認証済みアカウント（プレミアムアカウント含む）だけが取得できます。未認証アカウントでは、友だち追加されたとき・お客様が公式 LINE に何か送ってきたときに自動で登録されます', status: 400 };
      if (r.status === 401) return { ...result, error: 'LINE のチャネルアクセストークンが無効です（店舗編集で設定を確認してください）', status: 400 };
      return { ...result, error: `LINE から友だちの一覧を取得できませんでした（${r.status || '通信エラー'}）`, status: 502 };
    }
    const ids = Array.isArray(r.json.userIds) ? (r.json.userIds as unknown[]).filter((v): v is string => typeof v === 'string') : [];
    const fresh = ids.filter((id) => !known.has(id));
    result.existing += ids.length - fresh.length;

    // プロフィールを 10 件ずつ並列で取り、まとめて登録
    for (let i = 0; i < fresh.length; i += 10) {
      if (Date.now() >= deadline) {
        result.remaining = true;
        return result;
      }
      const group = fresh.slice(i, i + 10);
      const rows = await Promise.all(group.map(async (id) => buildFriendCustomerRow(storeId, id, await fetchLineProfile(token, id, fetchImpl), { friend: true })));
      const { error } = await adminClient.from('customers').insert(rows);
      if (error) {
        // まとめて入れられないとき（同じ LINE ユーザーが同時に予約などで登録された = 一意制約違反）は 1 件ずつ入れ、重複は飛ばす
        let inserted = 0;
        for (const row of rows) {
          const one = await adminClient.from('customers').insert(row);
          if (!one.error) inserted += 1;
          else if (one.error.code !== '23505') return { ...result, imported: result.imported + inserted, error: `顧客の登録に失敗しました: ${one.error.message}`, status: 500 };
        }
        result.imported += inserted;
        result.existing += group.length - inserted;
      } else {
        result.imported += group.length;
      }
      for (const id of group) known.add(id);
    }

    start = typeof r.json.next === 'string' && r.json.next ? r.json.next : null;
    if (!start) break;
    if (Date.now() >= deadline) {
      result.remaining = true;
      break;
    }
  }
  return result;
}
