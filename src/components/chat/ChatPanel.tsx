'use client';

/**
 * 1 対 1 トークの画面（会話の一覧・会話・顧客の情報・返信）
 * 店舗管理者ページの「トーク」タブと、テナント側 店舗ページの「トーク」タブで共用。
 * 設計: docs/店舗管理者ページ_追加4機能_実装設計.md の 8 章
 *
 * - 左: 会話の一覧（未読が上・新しい順。名前で検索・未読だけ）
 * - 中: 会話（お客様は左・店舗は右。フォームの送信文やコマンドは小さく薄く）
 * - 右: 顧客の情報（パソコンだけ）
 * - スマホ: 一覧 → 会話 の 2 画面
 * - 新着は 15〜30 秒おきに確かめる（画面が見えているときだけ）
 * - 返信は公式 LINE の通数を 1 通使う。送信の ID（client_key）で二重送信を防ぐ
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { cn } from '@/lib/utils';
import { CHAT_POLL_MIN_MS, CHAT_TEXT_MAX, chatKindLabel, nextChatPollDelay, type ChatMessageView, type ChatThreadFilter, type ChatThreadView } from '@/lib/chat';

interface Overview {
  enabled: boolean;
  threads: ChatThreadView[];
  unread_total: number;
}

interface Detail {
  thread: ChatThreadView;
  messages: ChatMessageView[];
  has_more: boolean;
}

interface Quota {
  type: 'limited' | 'none';
  limit: number | null;
  usage: number;
}

interface CustomerInfo {
  id: string;
  name?: string | null;
  phone?: string | null;
  tags?: string[] | null;
  notes?: string | null;
  total_visits?: number | null;
  last_visit_date?: string | null;
  allergies?: string | null;
  medical_history?: string | null;
  line_friend_only?: boolean | null;
}

interface CustomerReservation {
  id: string;
  reservation_date: string;
  reservation_time?: string | null;
  menu_name?: string | null;
  status?: string | null;
}

export interface ChatPanelProps {
  storeId: string;
  /** 顧客詳細を開く URL（渡したときだけ「顧客詳細を開く」を出す） */
  customerHref?: (customerId: string) => string;
  /** 最初に開く会話（顧客 ID。顧客詳細の「トークを開く」から来たとき） */
  initialCustomerId?: string | null;
  /** 未読の合計が変わったとき（タブのバッジを更新する） */
  onUnreadChange?: (unread: number) => void;
}

const JST = 'Asia/Tokyo';
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: JST, hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: JST, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: JST });

/** 一覧の日時: 今日なら時刻、それ以外は 月/日 */
function fmtListTime(iso: string): string {
  if (dayKey(iso) === dayKey(new Date().toISOString())) return fmtTime(iso);
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: JST, month: 'numeric', day: 'numeric' });
}

/** 本文を文字として表示し、http / https で始まる所だけリンクにする */
function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

const AUTO_LABELS: Record<string, string> = { form: 'フォームの送信', command: 'ボタン・コマンド', keyword: 'キーワード', follow_up: 'フォームの送信' };

function newClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // 古いブラウザ用（UUID v4 の形）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });
}

interface PendingSend {
  key: string;
  text: string;
  status: 'sending' | 'failed';
  error: string | null;
  at: string;
}

export default function ChatPanel({ storeId, customerHref, initialCustomerId, onUnreadChange }: ChatPanelProps) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/chat`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChatThreadFilter>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [customer, setCustomer] = useState<{ customer: CustomerInfo; reservations: CustomerReservation[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  // 送信ボタンの連打対策: 1 通を送り終わるまで、次の送信を始めない（画面の状態が変わる前の連打も止める）
  const sendLock = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const detailRef = useRef<Detail | null>(null);
  const unreadCallback = useRef(onUnreadChange);
  selectedRef.current = selectedId;
  detailRef.current = detail;
  unreadCallback.current = onUnreadChange;

  // 検索は入力が止まってから 0.3 秒後に反映
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadThreads = useCallback(async (): Promise<Overview | null> => {
    try {
      const params = new URLSearchParams({ filter });
      if (query) params.set('search', query);
      const res = await fetchWithAuth(`${base}/threads?${params}`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error || '会話の一覧の取得に失敗しました');
        return null;
      }
      setOverview(json);
      setLoadError(null);
      unreadCallback.current?.(json.unread_total ?? 0);
      return json as Overview;
    } catch {
      setLoadError('会話の一覧の取得に失敗しました');
      return null;
    }
  }, [base, filter, query]);

  /** 開いている会話の新着を取りにいく（届いていたら足す）。戻り値 = 新着があったか */
  const loadNewMessages = useCallback(async (): Promise<boolean> => {
    const id = selectedRef.current;
    const current = detailRef.current;
    if (!id || !current || current.thread.id !== id) return false;
    const lastId = [...current.messages].reverse().find((m) => /^\d+$/.test(m.id))?.id;
    try {
      const res = await fetchWithAuth(`${base}/threads/${id}${lastId ? `?after=${lastId}` : ''}`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return false;
      const json = (await res.json()) as Detail;
      if (selectedRef.current !== id) return false;
      const known = new Set(current.messages.map((m) => m.id));
      const added = lastId ? json.messages.filter((m) => !known.has(m.id)) : [];
      setDetail((prev) => {
        if (!prev || prev.thread.id !== id) return prev;
        if (!lastId) return json;
        const have = new Set(prev.messages.map((m) => m.id));
        return { ...prev, thread: json.thread, messages: [...prev.messages, ...json.messages.filter((m) => !have.has(m.id))] };
      });
      return added.length > 0;
    } catch {
      return false;
    }
  }, [base]);

  // 最初の読み込み + 絞り込みが変わったとき
  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // 今月の通数（入力欄の近くに出す）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`${base}/unread?quota=1`, { credentials: 'include', cache: 'no-store' });
        const json = res.ok ? await res.json() : null;
        if (!cancelled && json?.line_quota) setQuota(json.line_quota);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  // 新着の確認: 15 秒おき。新着が無い間は 30 秒まで延ばす。画面が見えていないときは確かめない
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = CHAT_POLL_MIN_MS;
    let stopped = false;
    let lastSignature = '';
    const tick = async () => {
      if (stopped) return;
      let changed = false;
      if (document.visibilityState === 'visible') {
        const [ov, added] = await Promise.all([loadThreads(), loadNewMessages()]);
        const signature = ov ? `${ov.unread_total}:${ov.threads[0]?.last_message_at ?? ''}:${ov.threads.length}` : lastSignature;
        changed = added || (lastSignature !== '' && signature !== lastSignature);
        lastSignature = signature;
      }
      delay = nextChatPollDelay(delay, changed);
      if (!stopped) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return;
      if (timer) clearTimeout(timer);
      delay = CHAT_POLL_MIN_MS;
      void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadThreads, loadNewMessages]);

  const openThread = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setCustomer(null);
      setPending([]);
      setDraft('');
      setDetailLoading(true);
      stickToBottom.current = true;
      try {
        const res = await fetchWithAuth(`${base}/threads/${id}`, { credentials: 'include', cache: 'no-store' });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          toast({ title: '会話を開けませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
          setSelectedId(null);
          return;
        }
        if (selectedRef.current !== id) return;
        setDetail(json);
        // 開いた = 既読。一覧の未読の数もすぐに合わせる
        setOverview((prev) => {
          if (!prev) return prev;
          const before = prev.threads.find((t) => t.id === id)?.unread_count ?? 0;
          const next = { ...prev, threads: prev.threads.map((t) => (t.id === id ? { ...t, unread_count: 0 } : t)), unread_total: Math.max(0, prev.unread_total - before) };
          unreadCallback.current?.(next.unread_total);
          return next;
        });
      } catch {
        toast({ title: '会話を開けませんでした', description: 'もう一度お試しください', variant: 'destructive' });
        setSelectedId(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [base, toast],
  );

  // 顧客詳細の「トークを開く」から来たとき: その顧客の会話を開く（最初の 1 回だけ）
  const initialDone = useRef(false);
  const [initialMissing, setInitialMissing] = useState(false);
  useEffect(() => {
    if (initialDone.current || !initialCustomerId || !overview) return;
    initialDone.current = true;
    const hit = overview.threads.find((t) => t.customer_id === initialCustomerId);
    if (hit) void openThread(hit.id);
    else setInitialMissing(true);
  }, [initialCustomerId, overview, openThread]);

  // 顧客の情報（右の欄）
  const customerId = detail?.thread.customer_id ?? null;
  useEffect(() => {
    if (!customerId) {
      setCustomer(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/stores/${encodeURIComponent(storeId)}/customers/${encodeURIComponent(customerId)}`, { credentials: 'include', cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.customer) setCustomer({ customer: json.customer, reservations: Array.isArray(json.reservations) ? json.reservations : [] });
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, storeId]);

  // 新しいメッセージが足されたら、いちばん下にいるときだけ下へ送る
  const messageCount = (detail?.messages.length ?? 0) + pending.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messageCount, detail?.thread.id]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    const id = selectedId;
    const first = detail?.messages.find((m) => /^\d+$/.test(m.id))?.id;
    if (!id || !first || loadingOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await fetchWithAuth(`${base}/threads/${id}?before=${first}&read=0`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as Detail;
      stickToBottom.current = false;
      setDetail((prev) => (prev && prev.thread.id === id ? { ...prev, messages: [...json.messages, ...prev.messages], has_more: json.has_more } : prev));
      // 読み込む前に見ていた位置を保つ
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
    } finally {
      setLoadingOlder(false);
    }
  };

  /** 送る（key を渡したときは、同じ ID で送り直す） */
  const send = async (text: string, key: string = newClientKey()) => {
    const id = selectedId;
    const body = text.trim();
    if (!id || !body || sendLock.current) return;
    sendLock.current = true;
    stickToBottom.current = true;
    setPending((prev) => [...prev.filter((p) => p.key !== key), { key, text: body, status: 'sending', error: null, at: new Date().toISOString() }]);
    try {
      const res = await fetchWithAuth(`${base}/threads/${id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body, client_key: key }),
      });
      const json = await res.json().catch(() => null);
      if (selectedRef.current !== id) return;
      if (!res.ok) {
        setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: 'failed', error: json?.error || '送信できませんでした' } : p)));
        return;
      }
      const message = json.message as ChatMessageView;
      setPending((prev) => prev.filter((p) => p.key !== key));
      setDetail((prev) => (prev && prev.thread.id === id && !prev.messages.some((m) => m.id === message.id) ? { ...prev, messages: [...prev.messages, message] } : prev));
      if (json.notice) toast({ title: '記録を更新しました', description: json.notice });
      setQuota((q) => (q ? { ...q, usage: q.usage + 1 } : q));
      void loadThreads();
    } catch {
      setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: 'failed', error: '通信できませんでした。もう一度送ってください' } : p)));
    } finally {
      sendLock.current = false;
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || text.length > CHAT_TEXT_MAX || !overview?.enabled || sendLock.current) return;
    setDraft('');
    void send(text);
  };

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadThreads(), loadNewMessages()]);
    setRefreshing(false);
  };

  const threads = overview?.threads ?? [];
  const selectedThread = detail?.thread ?? threads.find((t) => t.id === selectedId) ?? null;
  const sendingNow = pending.some((p) => p.status === 'sending');
  const tooLong = draft.trim().length > CHAT_TEXT_MAX;

  const upcoming = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    return (customer?.reservations ?? [])
      .filter((r) => r.status !== 'cancelled' && r.reservation_date >= today)
      .sort((a, b) => (a.reservation_date + (a.reservation_time ?? '') < b.reservation_date + (b.reservation_time ?? '') ? -1 : 1))
      .slice(0, 3);
  }, [customer]);

  // ---------------------------------------------------------------- 描画

  const renderMessage = (m: ChatMessageView, prev: ChatMessageView | undefined) => {
    const showDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
    const body = m.kind === 'text' ? <LinkedText text={m.text ?? ''} /> : null;
    let bubble: React.ReactNode;
    if (m.direction === 'system') {
      bubble = <p className="mx-auto max-w-[90%] rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">{m.text}</p>;
    } else if (m.auto) {
      // フォームの送信文・コマンド: 小さく薄く
      bubble = (
        <div className="max-w-[85%] rounded-lg border border-dashed bg-muted/40 px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground" data-auto="1">
          <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px]">自動・{AUTO_LABELS[m.auto_kind ?? ''] ?? '自動'}</span>
          <span className="whitespace-pre-wrap break-words">{(m.text ?? '').length > 160 ? `${(m.text ?? '').slice(0, 160)}…` : m.text}</span>
          <span className="ml-2 text-[10px]">{fmtTime(m.created_at)}</span>
        </div>
      );
    } else {
      const mine = m.direction === 'out';
      bubble = (
        <div className={cn('flex max-w-[85%] flex-col gap-0.5', mine ? 'items-end' : 'items-start')}>
          <div className={cn('rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words', mine ? 'bg-primary text-primary-foreground' : 'border bg-white text-foreground')}>
            {m.kind === 'text' ? (
              body
            ) : m.kind === 'sticker' && m.sticker_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.sticker_url} alt="スタンプ" className="h-24 w-24 object-contain" loading="lazy" />
            ) : (
              <span className={mine ? '' : 'text-muted-foreground'}>
                {chatKindLabel(m.kind)}が送られました
                {m.kind !== 'sticker' && <span className="block text-[11px]">内容は、公式 LINE のアプリで確認してください</span>}
              </span>
            )}
          </div>
          <span className="px-1 text-[10px] text-muted-foreground">
            {fmtTime(m.created_at)}
            {mine && m.sent_by_name ? ` ・ ${m.sent_by_name}` : ''}
            {mine && m.send_status === 'failed' ? ' ・ 送信できませんでした' : ''}
            {mine && m.send_status === 'sending' ? ' ・ 送信中…' : ''}
          </span>
          {mine && m.send_status === 'failed' && m.send_error && <span className="px-1 text-[11px] text-red-600">{m.send_error}</span>}
        </div>
      );
    }
    return (
      <React.Fragment key={m.id}>
        {showDay && <p className="my-2 text-center text-[11px] text-muted-foreground">{fmtDay(m.created_at)}</p>}
        <div className={cn('flex', m.direction === 'out' ? 'justify-end' : m.direction === 'system' ? 'justify-center' : 'justify-start')} data-slot="chat-message" data-direction={m.direction}>
          {bubble}
        </div>
      </React.Fragment>
    );
  };

  const listPane = (
    <div className={cn('flex min-h-0 flex-col border-r bg-white', selectedId ? 'hidden lg:flex' : 'flex')} data-slot="chat-thread-list">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前で検索" className="pl-8" aria-label="名前で検索" />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn('rounded-full border px-3 py-1 text-xs', filter === f ? 'border-primary bg-primary text-primary-foreground' : 'bg-white text-muted-foreground')}
              aria-pressed={filter === f}
            >
              {f === 'all' ? 'すべて' : `未読${overview && overview.unread_total > 0 ? `（${overview.unread_total}）` : ''}`}
            </button>
          ))}
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 px-2" onClick={refresh} disabled={refreshing} aria-label="新着を確認">
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {overview && threads.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {query || filter === 'unread' ? '条件に合う会話はありません' : 'まだ会話がありません。お客様が公式 LINE にメッセージを送ると、ここに出ます。'}
          </p>
        )}
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => openThread(t.id)}
            className={cn('flex w-full items-start gap-2 border-b px-3 py-3 text-left hover:bg-muted/50', selectedId === t.id && 'bg-muted')}
            data-slot="chat-thread"
            data-unread={t.unread_count > 0 ? '1' : '0'}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('truncate text-sm', t.unread_count > 0 ? 'font-bold' : 'font-medium')}>{t.name}</span>
                {t.blocked && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    ブロック中
                  </Badge>
                )}
              </div>
              <p className={cn('mt-0.5 truncate text-xs', t.unread_count > 0 ? 'text-foreground' : 'text-muted-foreground')}>{t.preview || '（メッセージなし）'}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[10px] text-muted-foreground">{fmtListTime(t.last_message_at)}</span>
              {t.unread_count > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" data-slot="chat-unread-badge">
                  {t.unread_count > 99 ? '99+' : t.unread_count}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const conversationPane = (
    <div className={cn('min-h-0 min-w-0 flex-col bg-[rgb(247,248,250)]', selectedId ? 'flex' : 'hidden lg:flex')} data-slot="chat-conversation">
      {!selectedId ? (
        <p className="m-auto p-6 text-center text-sm text-muted-foreground">左の一覧から会話を選んでください</p>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b bg-white px-3 py-2">
            <Button type="button" variant="ghost" size="icon" className="lg:hidden" onClick={() => setSelectedId(null)} aria-label="一覧に戻る">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{selectedThread?.name ?? ''}</p>
              {selectedThread?.blocked && <p className="text-[11px] text-red-600">このお客様にブロックされています。返信しても届きません。</p>}
            </div>
            {customerHref && selectedThread?.customer_id && (
              <a href={customerHref(selectedThread.customer_id)} className="shrink-0 text-xs text-primary underline xl:hidden">
                顧客詳細
              </a>
            )}
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3" data-slot="chat-messages">
            {detailLoading && <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>}
            {detail?.has_more && (
              <div className="pb-2 text-center">
                <Button type="button" variant="outline" size="sm" onClick={loadOlder} disabled={loadingOlder}>
                  {loadingOlder ? '読み込み中…' : '以前のメッセージを読み込む'}
                </Button>
              </div>
            )}
            {detail?.messages.map((m, i) => renderMessage(m, detail.messages[i - 1]))}
            {pending.map((p) => (
              <div key={p.key} className="flex justify-end" data-slot="chat-pending" data-status={p.status}>
                <div className="flex max-w-[85%] flex-col items-end gap-0.5">
                  <div className={cn('rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words', p.status === 'failed' ? 'border border-red-300 bg-red-50 text-red-900' : 'bg-primary/70 text-primary-foreground')}>{p.text}</div>
                  {p.status === 'sending' ? (
                    <span className="px-1 text-[10px] text-muted-foreground">送信中…</span>
                  ) : (
                    <span className="flex flex-wrap items-center justify-end gap-2 px-1 text-[11px] text-red-600">
                      {p.error}
                      <button type="button" className="rounded border border-red-300 bg-white px-2 py-0.5 text-red-700" onClick={() => send(p.text, p.key)}>
                        もう一度送る
                      </button>
                      <button type="button" className="text-muted-foreground underline" onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))}>
                        取り消す
                      </button>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t bg-white p-3" data-slot="chat-input-area">
            {overview && !overview.enabled ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">トーク機能が OFF のため、返信できません。保存済みの会話は読めます。</p>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    rows={2}
                    placeholder="メッセージを入力"
                    className="max-h-40 min-h-[44px] flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                    aria-label="メッセージを入力"
                    data-slot="chat-input"
                  />
                  <Button type="button" onClick={submit} disabled={!draft.trim() || tooLong || sendingNow || !detail} data-slot="chat-send">
                    <Send className="mr-1 h-4 w-4" aria-hidden="true" />
                    送信
                  </Button>
                </div>
                <p className={cn('mt-1 text-[11px]', tooLong ? 'text-red-600' : 'text-muted-foreground')} data-slot="chat-input-note">
                  {tooLong
                    ? `${CHAT_TEXT_MAX} 文字までです（いま ${draft.trim().length} 文字）`
                    : `返信 1 通につき、公式 LINE の通数を 1 通使います${quota ? `（今月 ${quota.usage.toLocaleString()} 通${quota.limit !== null ? ` / 上限 ${quota.limit.toLocaleString()} 通` : ''}）` : ''}。Ctrl + Enter でも送信できます。`}
                </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  const c = customer?.customer;
  const customerPane = (
    <div className="hidden min-h-0 flex-col overflow-y-auto border-l bg-white p-4 text-sm xl:flex" data-slot="chat-customer">
      {!selectedId ? null : !selectedThread?.customer_id ? (
        <p className="text-xs text-muted-foreground">このお客様は、まだ顧客として登録されていません（LINE の表示名が分かると、自動で登録されます）。</p>
      ) : !c ? (
        <p className="text-xs text-muted-foreground">読み込み中…</p>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-base font-bold">{c.name || selectedThread.name}</p>
            {c.line_friend_only && <p className="text-[11px] text-muted-foreground">友だち登録だけのお客様（予約はまだありません）</p>}
            {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
          </div>
          {(c.allergies || c.medical_history) && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">安全のための情報が登録されています。顧客詳細で確認してください。</p>}
          {Array.isArray(c.tags) && c.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {c.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[11px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">来店回数</dt>
              <dd>{c.total_visits ?? 0} 回</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">最後の来店</dt>
              <dd>{c.last_visit_date || '—'}</dd>
            </div>
          </dl>
          <div>
            <p className="text-xs font-medium">これからの予約</p>
            {upcoming.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">ありません</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {upcoming.map((r) => (
                  <li key={r.id} className="rounded border bg-muted/30 px-2 py-1">
                    {r.reservation_date} {(r.reservation_time ?? '').slice(0, 5)}
                    {r.menu_name ? <span className="block truncate text-muted-foreground">{r.menu_name}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {c.notes && (
            <div>
              <p className="text-xs font-medium">メモ</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{c.notes}</p>
            </div>
          )}
          {customerHref && (
            <a href={customerHref(c.id)} className="inline-block text-xs text-primary underline">
              顧客詳細を開く
            </a>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3" data-slot="chat-panel">
      {loadError && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
      {initialMissing && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground" data-slot="chat-no-thread">
          このお客様との会話は、まだありません。お客様が公式 LINE にメッセージを送ると、ここに出ます（こちらから先に送ることはできません）。
        </p>
      )}
      {overview && !overview.enabled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-slot="chat-disabled">
          この店舗では、トーク機能が OFF になっています。新しいメッセージは保存されず、返信もできません。使うときは、運営にお問い合わせください。
        </p>
      )}
      <div className="grid h-[calc(100dvh-240px)] min-h-[460px] grid-cols-1 overflow-hidden rounded-lg border lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_260px]">
        {listPane}
        {conversationPane}
        {customerPane}
      </div>
      <p className="text-xs text-muted-foreground">公式 LINE の管理画面やアプリから返信した内容は、ここには表示されません（LINE の仕様です）。返信は、この画面にまとめてください。</p>
    </div>
  );
}
