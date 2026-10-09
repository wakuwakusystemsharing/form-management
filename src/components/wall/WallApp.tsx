'use client';

/**
 * 寄せ書きウォール: お客様向け画面（/wall/{storeId}）
 *
 * 流れ: ボード設定を取得 → LIFF 初期化（LINE 外は案内）→ ID トークンで一覧を取り直し（is_mine / 同意済み）→ 貼る / 見る / 通報する
 * local 環境（NEXT_PUBLIC_APP_ENV=local）は LIFF を使わず、端末ごとの仮ユーザー ID で動く
 * 追加機能: お題（topic）/ 共感（empathy）/ 色・飾りの選択（customer_pick）/ 自分の付箋 / あとで読む（端末内保存）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import WallBoardView, { WALL_CSS, reactionEmoji as reactionEmojiOf, wallRootFrameAttr, wallRootStyle } from './WallBoardView';
import { WALL_BODY_MAX, WALL_REPORT_REASONS } from '@/lib/wall-rules';
import { wallThemeVars } from '@/lib/wall-themes';
import type { WallMyPost, WallPublicBoardResponse, WallPublicPost, WallReportReason } from '@/types/wall';

 
declare global {
  interface Window { liff?: any }
}

const IS_LOCAL = process.env.NEXT_PUBLIC_APP_ENV === 'local';
const LIFF_SDK = 'https://static.line-scdn.net/liff/edge/2.1/sdk.js';

type Identity = { idToken: string | null; lineUserId: string | null; friend: boolean | null };
type Phase = 'loading' | 'gate' | 'ready';
type Gate = { title: string; body: string };

function loadLiffSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.liff) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIFF_SDK;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('LIFF SDK の読み込みに失敗しました'));
    document.head.appendChild(s);
  });
}

function localUserId(): string {
  try {
    const k = 'wall_local_user_id';
    let v = localStorage.getItem(k);
    if (!v) {
      v = `U_local_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return 'U_local_default';
  }
}

type SavedNote = { id: string; body: string; created_at: string };
const MY_POST_STATUS_LABEL: Record<WallMyPost['status'], string> = { published: '表示中', pending: 'お店の確認待ち', review: '確認中', hidden: '非公開' };

function savedKey(storeId: string): string { return `wall_saved_${storeId}`; }
function readSaved(storeId: string): SavedNote[] {
  try {
    const v = JSON.parse(localStorage.getItem(savedKey(storeId)) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : [];
  } catch { return []; }
}
function writeSaved(storeId: string, rows: SavedNote[]) {
  try { localStorage.setItem(savedKey(storeId), JSON.stringify(rows.slice(0, 50))); } catch { /* 保存できない端末は無視 */ }
}

export default function WallApp({ storeId }: { storeId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [gate, setGate] = useState<Gate | null>(null);
  const [data, setData] = useState<WallPublicBoardResponse | null>(null);
  const [posts, setPosts] = useState<WallPublicPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [identity, setIdentity] = useState<Identity>({ idToken: null, lineUserId: null, friend: null });
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [dropping, setDropping] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  // シート
  const [composeOpen, setComposeOpen] = useState(false);
  const [body, setBody] = useState('');
  const [agree, setAgree] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<WallPublicPost | null>(null);
  const [reportReason, setReportReason] = useState<WallReportReason | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WallPublicPost | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 追加機能
  const [useTopic, setUseTopic] = useState(true);
  const [pickColor, setPickColor] = useState<string | null>(null);
  const [pickDeco, setPickDeco] = useState<string | null>(null);
  const [empathyBusyId, setEmpathyBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedNote[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedLive, setSavedLive] = useState<Map<string, WallPublicPost> | null>(null);
  const [mineOpen, setMineOpen] = useState(false);
  const [minePosts, setMinePosts] = useState<WallMyPost[] | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }, []);

  const authFields = useCallback((id: Identity) => {
    const o: Record<string, unknown> = {};
    if (id.idToken) o.id_token = id.idToken;
    if (id.lineUserId) o.line_user_id = id.lineUserId;
    if (id.friend !== null) o.line_friend_flag = id.friend;
    return o;
  }, []);

  const fetchBoard = useCallback(async (id: Identity, cursor?: string | null): Promise<WallPublicBoardResponse> => {
    const q = new URLSearchParams();
    if (id.idToken) q.set('id_token', id.idToken);
    if (id.lineUserId) q.set('line_user_id', id.lineUserId);
    if (id.friend) q.set('friend', '1');
    if (cursor) q.set('cursor', cursor);
    const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}?${q.toString()}`, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new Error((json && json.error) || '読み込みに失敗しました');
    return json as WallPublicBoardResponse;
  }, [storeId]);

  // 初期化
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const first = await fetchBoard({ idToken: null, lineUserId: null, friend: null });
        if (cancelled) return;
        setData(first);
        if (!first.board.enabled) {
          setGate({ title: '現在ご利用いただけません', body: 'この寄せ書きは現在お休み中です。' });
          setPhase('gate');
          return;
        }
        let id: Identity;
        if (IS_LOCAL) {
          id = { idToken: null, lineUserId: localUserId(), friend: true };
        } else {
          if (!first.board.liff_id) {
            setGate({ title: '準備中です', body: 'もうしばらくお待ちください。' });
            setPhase('gate');
            return;
          }
          await loadLiffSdk();
          const liff = window.liff;
          await liff.init({ liffId: first.board.liff_id });
          if (!liff.isInClient()) {
            setGate({ title: '公式LINEから開いてください', body: 'この寄せ書きは公式LINEのトーク画面（リッチメニュー）から開いたときだけご利用いただけます。' });
            setPhase('gate');
            return;
          }
          if (!liff.isLoggedIn()) {
            liff.login({ redirectUri: window.location.href });
            return;
          }
          let friend: boolean | null = null;
          try {
            const f = await liff.getFriendship();
            if (f && typeof f.friendFlag === 'boolean') friend = f.friendFlag;
          } catch { /* 不明 */ }
          id = { idToken: liff.getIDToken() || null, lineUserId: null, friend };
        }
        if (cancelled) return;
        setIdentity(id);
        const full = await fetchBoard(id);
        if (cancelled) return;
        setData(full);
        if (!full.can_view) {
          setGate({ title: '友だち追加が必要です', body: 'この寄せ書きを見るには、公式LINEの友だち追加が必要です。友だち追加してから、もう一度トークから開いてください。' });
          setPhase('gate');
          return;
        }
        setPosts(full.posts);
        setNextCursor(full.next_cursor);
        setAgree(full.consented);
        setSaved(readSaved(storeId));
        setPhase('ready');
      } catch (e) {
        if (cancelled) return;
        setGate({ title: '読み込みに失敗しました', body: e instanceof Error ? e.message : '時間をおいて開き直してください。' });
        setPhase('gate');
      }
    })();
    return () => { cancelled = true; };
  }, [fetchBoard, storeId]);

  // 下端に来たら続きを読み込む
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await fetchBoard(identity, nextCursor);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...more.posts.filter((p) => !seen.has(p.id))];
      });
      setNextCursor(more.next_cursor);
    } catch {
      showToast('続きの読み込みに失敗しました');
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, fetchBoard, identity, showToast]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, loadMore]);

  // ID トークン切れ（401）は LINE に再ログイン
  const handleAuthError = useCallback((status: number) => {
    if (status === 401 && !IS_LOCAL && window.liff) {
      showToast('LINE の認証が切れました。開き直します');
      window.setTimeout(() => window.liff.login({ redirectUri: window.location.href }), 800);
      return true;
    }
    return false;
  }, [showToast]);

  const submitPost = async () => {
    if (!data) return;
    setFormError(null);
    const text = body.trim();
    if (!text) { setFormError('本文を入力してください'); return; }
    if ([...text].length > WALL_BODY_MAX) { setFormError(`${WALL_BODY_MAX} 文字以内で入力してください`); return; }
    if (!data.consented && !agree) { setFormError('同意にチェックしてください'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...authFields(identity),
          body: text,
          consent: { agreed: data.consented || agree, terms_version: data.board.terms_version },
          ...(data.board.topic && useTopic ? { topic_id: data.board.topic.id } : {}),
          ...(data.board.customer_pick_enabled && pickColor ? { note_color: pickColor } : {}),
          ...(data.board.customer_pick_enabled && pickDeco ? { note_deco: pickDeco } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (handleAuthError(res.status)) return;
        if (json.code === 'consent_required') setData({ ...data, consented: false });
        if (json.code === 'topic_closed') setData({ ...data, board: { ...data.board, topic: null } });
        setFormError(json.error || '貼れませんでした。時間をおいて再度お試しください');
        return;
      }
      setData({ ...data, consented: true });
      setBody('');
      setPickColor(null);
      setPickDeco(null);
      setComposeOpen(false);
      if (json.status === 'published' && json.post) {
        const p = json.post as WallPublicPost;
        setPosts((prev) => [p, ...prev]);
        setDropping((prev) => new Set(prev).add(p.id));
        window.setTimeout(() => setDropping((prev) => { const n = new Set(prev); n.delete(p.id); return n; }), 700);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        showToast('付箋を貼りました');
      } else {
        showToast(json.message || 'お店の確認後に表示されます');
      }
    } catch {
      setFormError('通信に失敗しました。電波の良い場所で再度お試しください');
    } finally {
      setSending(false);
    }
  };

  const submitReport = async () => {
    if (!reportTarget || !reportReason) return;
    setSending(true);
    try {
      const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}/posts/${encodeURIComponent(reportTarget.id)}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authFields(identity), reason: reportReason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (handleAuthError(res.status)) return;
        showToast(json.error || '通報できませんでした');
      } else {
        showToast(json.message || '通報を受け付けました');
      }
      setReportTarget(null);
      setReportReason(null);
      setLiftedId(null);
    } catch {
      showToast('通信に失敗しました');
    } finally {
      setSending(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setSending(true);
    try {
      const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}/posts/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authFields(identity)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (handleAuthError(res.status)) return;
        showToast(json.error || '削除できませんでした');
      } else {
        const id = deleteTarget.id;
        setPosts((prev) => prev.filter((p) => p.id !== id));
        showToast('付箋を削除しました');
      }
      setDeleteTarget(null);
      setLiftedId(null);
    } catch {
      showToast('通信に失敗しました');
    } finally {
      setSending(false);
    }
  };

  // 共感（押す / 取り消す）。結果でその付箋だけ差し替える
  const toggleEmpathy = async (p: WallPublicPost) => {
    if (empathyBusyId) return;
    setEmpathyBusyId(p.id);
    try {
      const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}/posts/${encodeURIComponent(p.id)}/empathy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authFields(identity)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (handleAuthError(res.status)) return;
        showToast(json.error || '送れませんでした');
        return;
      }
      const apply = (x: WallPublicPost) => (x.id === p.id ? { ...x, empathized: !!json.empathized, empathy_count: json.empathy_count ?? x.empathy_count } : x);
      setPosts((prev) => prev.map(apply));
      setSavedLive((prev) => { if (!prev) return prev; const n = new Map(prev); const cur = n.get(p.id); if (cur) n.set(p.id, apply(cur)); return n; });
    } catch {
      showToast('通信に失敗しました');
    } finally {
      setEmpathyBusyId(null);
    }
  };

  // あとで読む（端末内に保存。サーバーには送らない）
  const savedIds = new Set(saved.map((x) => x.id));
  const toggleSave = (p: WallPublicPost) => {
    const next = savedIds.has(p.id) ? saved.filter((x) => x.id !== p.id) : [{ id: p.id, body: p.body, created_at: p.created_at }, ...saved];
    setSaved(next);
    writeSaved(storeId, next);
    showToast(savedIds.has(p.id) ? '保存をやめました' : 'この端末に保存しました');
    setLiftedId(null);
  };
  const openSaved = async () => {
    setSavedOpen(true);
    setSavedLive(null);
    const ids = readSaved(storeId).map((x) => x.id);
    if (ids.length === 0) { setSavedLive(new Map()); return; }
    try {
      const q = new URLSearchParams({ ids: ids.slice(0, 50).join(',') });
      if (identity.idToken) q.set('id_token', identity.idToken);
      if (identity.lineUserId) q.set('line_user_id', identity.lineUserId);
      if (identity.friend) q.set('friend', '1');
      const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}/posts/lookup?${q.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      setSavedLive(new Map(((res.ok && json.posts) || []).map((p: WallPublicPost) => [p.id, p])));
    } catch {
      setSavedLive(new Map());
    }
  };

  // 自分の付箋（状態付き）
  const openMine = async () => {
    setMineOpen(true);
    setMinePosts(null);
    try {
      const q = new URLSearchParams();
      if (identity.idToken) q.set('id_token', identity.idToken);
      if (identity.lineUserId) q.set('line_user_id', identity.lineUserId);
      if (identity.friend) q.set('friend', '1');
      const res = await fetch(`/api/walls/${encodeURIComponent(storeId)}/my-posts?${q.toString()}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { if (handleAuthError(res.status)) return; showToast(json.error || '取得できませんでした'); setMinePosts([]); return; }
      setMinePosts(json.posts || []);
    } catch {
      showToast('通信に失敗しました');
      setMinePosts([]);
    }
  };

  const theme = data?.board.theme;
  const googleFont = theme ? wallThemeVars(theme).googleFont : null;
  const remaining = WALL_BODY_MAX - [...body].length;

  return (
    <div className="wall-root" data-frame={theme ? wallRootFrameAttr(theme) : '0'} style={theme ? wallRootStyle(theme, data?.board.theme_color) : undefined}>
      <style>{WALL_CSS + APP_CSS}</style>
      {googleFont && (
         
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${googleFont}&display=swap`} />
      )}

      {phase === 'loading' && <div className="wall-center"><div className="wall-spinner" aria-label="読み込み中" /></div>}

      {phase === 'gate' && gate && (
        <div className="wall-center">
          <div className="wall-gate">
            <h1>{gate.title}</h1>
            <p>{gate.body}</p>
          </div>
        </div>
      )}

      {phase === 'ready' && data && theme && (
        <>
          <header className="wall-header">
            <h1 className="wall-title">{theme.title}</h1>
            <p className="wall-subtitle">{theme.subtitle}</p>
            {data.board.topic && (
              <div className="wall-topic" role="note">
                <span className="wall-topic-label">今のお題</span>
                <p className="wall-topic-title">{data.board.topic.title}</p>
                {data.board.topic.description && <p className="wall-topic-desc">{data.board.topic.description}</p>}
              </div>
            )}
            <div className="wall-mybar">
              <button type="button" onClick={openMine}>自分の付箋</button>
              <button type="button" onClick={openSaved}>あとで読む{saved.length > 0 ? `（${saved.length}）` : ''}</button>
            </div>
          </header>
          <WallBoardView
            theme={theme}
            posts={posts}
            liftedId={liftedId}
            onToggleLift={(id) => setLiftedId((cur) => (cur === id ? null : id))}
            onReport={(p) => { setReportTarget(p); setReportReason(null); }}
            onDelete={(p) => setDeleteTarget(p)}
            onSave={toggleSave}
            savedIds={savedIds}
            onEmpathy={data.board.empathy_enabled ? toggleEmpathy : undefined}
            empathyBusyId={empathyBusyId}
            droppingIds={dropping}
          >
            {nextCursor && (
              <div ref={sentinelRef} className="wall-more">
                <button type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? '読み込み中…' : 'もっと見る'}</button>
              </div>
            )}
          </WallBoardView>

          {data.can_post ? (
            <button type="button" className="wall-fab" onClick={() => { setComposeOpen(true); setFormError(null); }}>
              ＋ 付箋を貼る
            </button>
          ) : (
            <div className="wall-fab is-disabled" role="note">付箋を貼るには公式LINEの友だち追加が必要です</div>
          )}
        </>
      )}

      {/* 貼るシート */}
      {composeOpen && data && theme && (
        <div className="wall-sheet-backdrop" onClick={() => !sending && setComposeOpen(false)}>
          <div className="wall-sheet" role="dialog" aria-modal="true" aria-label="付箋を貼る" onClick={(e) => e.stopPropagation()}>
            <h2>付箋を貼る</h2>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={theme.placeholder}
              rows={5}
              aria-label="付箋の本文"
              disabled={sending}
            />
            <div className={`wall-count${remaining < 0 ? ' is-over' : ''}`}>残り {remaining} 文字</div>
            {data.board.topic && (
              <div className="wall-pick" role="radiogroup" aria-label="お題">
                <button type="button" className={`wall-chip${useTopic ? ' is-on' : ''}`} role="radio" aria-checked={useTopic} onClick={() => setUseTopic(true)}>お題に答える</button>
                <button type="button" className={`wall-chip${!useTopic ? ' is-on' : ''}`} role="radio" aria-checked={!useTopic} onClick={() => setUseTopic(false)}>自由に書く</button>
                {useTopic && <p className="wall-note-hint" style={{ width: '100%', margin: '4px 0 0' }}>お題: {data.board.topic.title}</p>}
              </div>
            )}
            {data.board.customer_pick_enabled && (
              <div className="wall-pick-group">
                <div className="wall-pick" role="radiogroup" aria-label="付箋の色">
                  <span className="wall-pick-label">色</span>
                  <button type="button" className={`wall-swatch is-auto${pickColor === null ? ' is-on' : ''}`} role="radio" aria-checked={pickColor === null} aria-label="おまかせ" onClick={() => setPickColor(null)}>おまかせ</button>
                  {theme.note_colors.map((c) => (
                    <button key={c} type="button" className={`wall-swatch${pickColor === c ? ' is-on' : ''}`} role="radio" aria-checked={pickColor === c} aria-label={c} style={{ background: c }} onClick={() => setPickColor(c)} />
                  ))}
                </div>
                <div className="wall-pick" role="radiogroup" aria-label="飾り">
                  <span className="wall-pick-label">飾り</span>
                  <button type="button" className={`wall-chip${pickDeco === null ? ' is-on' : ''}`} role="radio" aria-checked={pickDeco === null} onClick={() => setPickDeco(null)}>なし</button>
                  {data.board.decorations.map((d) => (
                    <button key={d} type="button" className={`wall-chip is-deco${pickDeco === d ? ' is-on' : ''}`} role="radio" aria-checked={pickDeco === d} onClick={() => setPickDeco(d)}>{d}</button>
                  ))}
                </div>
              </div>
            )}
            {data.board.moderation === 'approval' && <p className="wall-note-hint">お店が確認してから表示されます。</p>}
            {!data.consented && (
              <label className="wall-consent">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={sending} />
                <span>{data.board.consent_text}<br /><strong>上記に同意して投稿する</strong></span>
              </label>
            )}
            {formError && <p className="wall-error" role="alert">{formError}</p>}
            <div className="wall-sheet-actions">
              <button type="button" className="is-secondary" onClick={() => setComposeOpen(false)} disabled={sending}>やめる</button>
              <button type="button" className="is-primary" onClick={submitPost} disabled={sending || remaining < 0 || !body.trim() || (!data.consented && !agree)}>
                {sending ? '貼っています…' : '貼る'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通報シート */}
      {reportTarget && (
        <div className="wall-sheet-backdrop" onClick={() => !sending && setReportTarget(null)}>
          <div className="wall-sheet" role="dialog" aria-modal="true" aria-label="通報する" onClick={(e) => e.stopPropagation()}>
            <h2>この付箋を通報する</h2>
            <p className="wall-note-hint">理由を選んでください。通報した人の情報が他の人に伝わることはありません。</p>
            <div className="wall-reasons" role="radiogroup">
              {WALL_REPORT_REASONS.map((r) => (
                <label key={r.id} className={`wall-reason${reportReason === r.id ? ' is-selected' : ''}`}>
                  <input type="radio" name="wall-report" checked={reportReason === r.id} onChange={() => setReportReason(r.id)} />
                  {r.label}
                </label>
              ))}
            </div>
            <div className="wall-sheet-actions">
              <button type="button" className="is-secondary" onClick={() => setReportTarget(null)} disabled={sending}>やめる</button>
              <button type="button" className="is-primary" onClick={submitReport} disabled={sending || !reportReason}>{sending ? '送信中…' : '通報する'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 削除の確認 */}
      {deleteTarget && (
        <div className="wall-sheet-backdrop" onClick={() => !sending && setDeleteTarget(null)}>
          <div className="wall-sheet" role="dialog" aria-modal="true" aria-label="付箋を削除" onClick={(e) => e.stopPropagation()}>
            <h2>この付箋を削除しますか？</h2>
            <p className="wall-note-hint">削除すると元に戻せません。今日貼れる枚数は戻りません。</p>
            <div className="wall-sheet-actions">
              <button type="button" className="is-secondary" onClick={() => setDeleteTarget(null)} disabled={sending}>やめる</button>
              <button type="button" className="is-danger" onClick={submitDelete} disabled={sending}>{sending ? '削除中…' : '削除する'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 自分の付箋 */}
      {mineOpen && theme && (
        <div className="wall-sheet-backdrop" onClick={() => setMineOpen(false)}>
          <div className="wall-sheet" role="dialog" aria-modal="true" aria-label="自分の付箋" onClick={(e) => e.stopPropagation()}>
            <h2>自分の付箋</h2>
            {minePosts === null ? (
              <p className="wall-note-hint">読み込み中…</p>
            ) : minePosts.length === 0 ? (
              <p className="wall-note-hint">まだ付箋を貼っていません。</p>
            ) : (
              <ul className="wall-list">
                {minePosts.map((p) => (
                  <li key={p.id} className="wall-list-item">
                    <div className="wall-list-meta">
                      <span className={`wall-list-status is-${p.status}`}>{MY_POST_STATUS_LABEL[p.status]}</span>
                      <span>{new Date(p.created_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}</span>
                      {p.reaction && <span title="お店からのスタンプ">お店から {reactionEmojiOf(p.reaction)}</span>}
                      {p.empathy_count !== null && p.empathy_count > 0 && <span>わかる！ {p.empathy_count}</span>}
                    </div>
                    {p.topic_title && <div className="wall-list-topic">お題: {p.topic_title}</div>}
                    <p className="wall-list-body">{p.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="wall-sheet-actions">
              <button type="button" className="is-secondary" onClick={() => setMineOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {/* あとで読む */}
      {savedOpen && theme && (
        <div className="wall-sheet-backdrop" onClick={() => setSavedOpen(false)}>
          <div className="wall-sheet" role="dialog" aria-modal="true" aria-label="あとで読む" onClick={(e) => e.stopPropagation()}>
            <h2>あとで読む</h2>
            <p className="wall-note-hint">この端末にだけ保存されます。端末を変えたりアプリのデータを消したりすると消えます。</p>
            {saved.length === 0 ? (
              <p className="wall-note-hint">保存した付箋はありません。付箋をタップして「あとで読む」を押すと保存できます。</p>
            ) : (
              <ul className="wall-list">
                {saved.map((sv) => {
                  const live = savedLive?.get(sv.id);
                  const gone = savedLive !== null && !live;
                  return (
                    <li key={sv.id} className={`wall-list-item${gone ? ' is-gone' : ''}`}>
                      <div className="wall-list-meta">
                        <span>{new Date(sv.created_at).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })}</span>
                        {gone && <span className="wall-list-status is-hidden">表示できません</span>}
                        {live?.reaction && <span>お店から {reactionEmojiOf(live.reaction)}</span>}
                        <button type="button" className="wall-list-remove" onClick={() => { const next = saved.filter((x) => x.id !== sv.id); setSaved(next); writeSaved(storeId, next); }}>保存をやめる</button>
                      </div>
                      <p className="wall-list-body">{gone ? '（この付箋は現在表示されていません）' : (live?.body ?? sv.body)}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="wall-sheet-actions">
              <button type="button" className="is-secondary" onClick={() => setSavedOpen(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="wall-toast" role="status">{toast}</div>}
    </div>
  );
}

const APP_CSS = `
.wall-center { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; }
.wall-spinner { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.75); animation: wall-pulse 1.2s ease-in-out infinite; }
@keyframes wall-pulse { 0%,100% { transform: scale(.8); opacity: .6 } 50% { transform: scale(1); opacity: 1 } }
.wall-gate { max-width: 360px; padding: 24px 20px; background: rgba(255,255,255,.94); color: #333; border-radius: 12px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
.wall-gate h1 { margin: 0 0 8px; font-size: 18px; }
.wall-gate p { margin: 0; font-size: 14px; line-height: 1.6; }
.wall-more { grid-column: 1 / -1; text-align: center; }
.wall-more button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 22px; background: rgba(255,255,255,.85); color: #333; font: inherit; font-size: 14px; }
.wall-fab { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 10; min-height: 52px; padding: 0 26px; border: 0; border-radius: 26px; background: var(--wall-accent); color: #fff; font: inherit; font-size: 16px; font-weight: 700; box-shadow: 0 8px 20px rgba(0,0,0,.28); touch-action: manipulation; }
.wall-fab.is-disabled { display: flex; align-items: center; max-width: calc(100% - 32px); background: rgba(255,255,255,.92); color: #444; font-size: 13px; font-weight: 600; text-align: center; }
.wall-sheet-backdrop { position: fixed; inset: 0; z-index: 30; display: flex; align-items: flex-end; justify-content: center; background: rgba(0,0,0,.45); }
.wall-sheet { width: 100%; max-width: 560px; max-height: 88dvh; overflow-y: auto; padding: 18px 16px calc(16px + env(safe-area-inset-bottom)); background: #fffdf7; color: #333; border-radius: 16px 16px 0 0; box-shadow: 0 -8px 30px rgba(0,0,0,.25); }
@media (min-width: 600px) { .wall-sheet-backdrop { align-items: center; } .wall-sheet { border-radius: 16px; } }
.wall-sheet h2 { margin: 0 0 10px; font-size: 17px; }
.wall-sheet textarea { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #d6d0c4; border-radius: 8px; background: #fff; font: inherit; font-size: 16px; line-height: 1.6; resize: none; }
.wall-count { margin-top: 4px; font-size: 12px; color: #888; text-align: right; }
.wall-count.is-over { color: #b3261e; font-weight: 700; }
.wall-note-hint { margin: 8px 0 0; font-size: 12.5px; color: #666; line-height: 1.6; }
.wall-consent { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; padding: 10px 12px; background: #f4efe4; border-radius: 8px; font-size: 12.5px; line-height: 1.6; }
.wall-consent input { width: 20px; height: 20px; margin-top: 2px; flex: 0 0 auto; }
.wall-error { margin: 10px 0 0; font-size: 13px; color: #b3261e; }
.wall-sheet-actions { display: flex; gap: 10px; margin-top: 14px; }
.wall-sheet-actions button { flex: 1; min-height: 48px; border-radius: 24px; font: inherit; font-size: 15px; font-weight: 700; }
.wall-sheet-actions .is-secondary { border: 1px solid #ccc; background: #fff; color: #444; }
.wall-sheet-actions .is-primary { border: 0; background: var(--wall-accent); color: #fff; }
.wall-sheet-actions .is-danger { border: 0; background: #b3261e; color: #fff; }
.wall-sheet-actions button:disabled { opacity: .5; }
.wall-reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.wall-reason { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; border: 1px solid #d6d0c4; border-radius: 10px; background: #fff; font-size: 14px; }
.wall-reason.is-selected { border-color: var(--wall-accent); box-shadow: 0 0 0 2px var(--wall-accent) inset; }
.wall-mybar { display: flex; justify-content: center; gap: 8px; margin-top: 10px; }
.wall-mybar button { min-height: 32px; padding: 0 12px; border: 1px solid rgba(255,255,255,.5); border-radius: 16px; background: rgba(255,255,255,.3); color: var(--wall-text); font: inherit; font-size: 12px; font-weight: 700; backdrop-filter: blur(2px); }
.wall-pick-group { margin-top: 10px; }
.wall-pick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.wall-pick-label { font-size: 12px; color: #666; margin-right: 2px; }
.wall-chip { min-height: 32px; padding: 0 12px; border: 1px solid #d6d0c4; border-radius: 16px; background: #fff; color: #333; font: inherit; font-size: 13px; }
.wall-chip.is-deco { min-width: 40px; font-size: 16px; padding: 0 8px; }
.wall-chip.is-on { border-color: var(--wall-accent); box-shadow: 0 0 0 2px var(--wall-accent) inset; font-weight: 700; }
.wall-swatch { width: 30px; height: 30px; border: 2px solid rgba(0,0,0,.15); border-radius: 50%; padding: 0; }
.wall-swatch.is-auto { width: auto; border-radius: 15px; padding: 0 10px; background: #fff; font: inherit; font-size: 12px; color: #333; }
.wall-swatch.is-on { border-color: var(--wall-accent); box-shadow: 0 0 0 2px #fff inset; }
.wall-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.wall-list-item { padding: 10px 12px; border: 1px solid #e6e0d4; border-radius: 10px; background: #fff; }
.wall-list-item.is-gone { opacity: .6; }
.wall-list-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; color: #777; }
.wall-list-status { padding: 1px 8px; border-radius: 10px; background: #e8f4e8; color: #2f6b33; font-weight: 700; }
.wall-list-status.is-pending, .wall-list-status.is-review { background: #fdf1d6; color: #8a5a00; }
.wall-list-status.is-hidden { background: #eee; color: #666; }
.wall-list-topic { margin-top: 4px; font-size: 11px; color: #8a5a00; font-weight: 700; }
.wall-list-body { margin: 6px 0 0; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.wall-list-remove { margin-left: auto; border: 0; background: none; color: #b3261e; font: inherit; font-size: 11.5px; text-decoration: underline; }
.wall-toast { position: fixed; left: 50%; bottom: calc(86px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 40; max-width: calc(100% - 32px); padding: 10px 16px; border-radius: 20px; background: rgba(30,30,30,.9); color: #fff; font-size: 13px; }
`;
