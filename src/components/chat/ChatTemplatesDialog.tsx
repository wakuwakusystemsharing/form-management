'use client';

/**
 * 1 対 1 トークの定型文を編集するダイアログ（よく使う返信を、名前を付けて保存しておく）
 * 保存は一覧をまるごと差し替える（PUT /api/stores/{storeId}/chat/templates）
 */
import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithAuth } from '@/lib/client-auth';
import { CHAT_TEMPLATE_MAX, CHAT_TEMPLATE_TEXT_MAX, CHAT_TEMPLATE_TITLE_MAX, type ChatReplyTemplate } from '@/lib/chat';

interface Props {
  storeId: string;
  open: boolean;
  templates: ChatReplyTemplate[];
  onClose: () => void;
  onSaved: (templates: ChatReplyTemplate[]) => void;
}

const newId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export default function ChatTemplatesDialog({ storeId, open, templates, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<ChatReplyTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  // 開いたときだけ、保存済みの内容を入れ直す
  useEffect(() => {
    if (open) setItems(templates.map((t) => ({ ...t })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (id: string, patch: Partial<ChatReplyTemplate>) => setItems((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const move = (index: number, delta: number) =>
    setItems((prev) => {
      const next = [...prev];
      const to = index + delta;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/stores/${encodeURIComponent(storeId)}/chat/templates`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templates: items }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast({ title: '保存できませんでした', description: json?.error || 'もう一度お試しください', variant: 'destructive' });
        return;
      }
      onSaved(json.templates ?? []);
      toast({ title: '定型文を保存しました' });
      onClose();
    } catch {
      toast({ title: '保存できませんでした', description: 'もう一度お試しください', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto" data-slot="chat-templates-dialog">
        <DialogHeader>
          <DialogTitle>定型文を編集</DialogTitle>
          <DialogDescription>よく使う返信を、名前を付けて保存しておけます。トークの画面で「定型文」から選ぶと、入力欄に入ります（送る前に書き換えられます）。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {items.length === 0 && <p className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">まだ定型文がありません。「定型文を追加」を押して作ってください。</p>}
          {items.map((t, i) => (
            <div key={t.id} className="space-y-2 rounded-md border p-3" data-slot="chat-template-item">
              <div className="flex items-center gap-2">
                <Input value={t.title} maxLength={CHAT_TEMPLATE_TITLE_MAX} onChange={(e) => update(t.id, { title: e.target.value })} placeholder="名前（例: 営業時間のご案内）" aria-label="定型文の名前" className="flex-1" />
                <Button type="button" variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上へ">
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="下へ">
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="text-red-600" onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))} aria-label="この定型文を消す">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <textarea
                value={t.text}
                maxLength={CHAT_TEMPLATE_TEXT_MAX}
                onChange={(e) => update(t.id, { text: e.target.value })}
                rows={3}
                placeholder="送る文"
                aria-label="定型文の文"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
              />
              <p className="text-right text-[11px] text-muted-foreground">
                {t.text.length} / {CHAT_TEMPLATE_TEXT_MAX} 文字
              </p>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setItems((prev) => [...prev, { id: newId(), title: '', text: '' }])} disabled={items.length >= CHAT_TEMPLATE_MAX} data-slot="chat-template-add">
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            定型文を追加
          </Button>
          {items.length >= CHAT_TEMPLATE_MAX && <p className="text-xs text-muted-foreground">定型文は {CHAT_TEMPLATE_MAX} 個までです。</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            やめる
          </Button>
          <Button type="button" onClick={save} disabled={saving} data-slot="chat-templates-save">
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
