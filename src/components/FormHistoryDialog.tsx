'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface AuditChange {
  key: string;
  label: string;
  before: unknown;
  after: unknown;
}

interface AuditEntry {
  id: string;
  action: string;
  form_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  source: string | null;
  summary: string | null;
  changes: AuditChange[] | null;
  created_at: string;
}

interface FormHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  formId: string | null;
  formType: 'reservation' | 'survey' | 'lottery';
  formName?: string;
}

const ACTION_LABELS: Record<string, string> = {
  create: '作成',
  update: '保存（更新）',
  deploy: '保存＆デプロイ',
  duplicate: '複製',
  delete: '削除',
};

const ACTION_CLASSES: Record<string, string> = {
  create: 'bg-green-50 text-green-700 border-green-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  deploy: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  duplicate: 'bg-purple-50 text-purple-700 border-purple-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
};

const ROLE_LABELS: Record<string, string> = {
  master: 'マスター管理者',
  system: 'システム管理者',
  store: '店舗管理者',
  local: 'ローカル',
};

const SOURCE_LABELS: Record<string, string> = {
  tenant_admin: '管理者画面',
  master_admin: 'マスター画面',
  store_admin: '店舗管理者ページ',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '（なし）';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function FormHistoryDialog({ open, onOpenChange, storeId, formId, formType, formName }: FormHistoryDialogProps) {
  // 取得結果は「どのフォームの結果か」のキー付きで保持し、キー不一致 = 読み込み中として扱う
  // （effect 内で同期的に setState しないため）
  const requestKey = formId ? `${storeId}:${formType}:${formId}` : '';
  const [result, setResult] = useState<{ key: string; logs: AuditEntry[]; error: string | null } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !formId) return;
    const key = `${storeId}:${formType}:${formId}`;
    let cancelled = false;
    fetch(`/api/stores/${storeId}/forms/${formId}/history?type=${formType}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '操作履歴の取得に失敗しました');
        if (!cancelled) {
          setResult({ key, logs: Array.isArray(data.logs) ? data.logs : [], error: null });
          setExpanded(new Set());
        }
      })
      .catch((e) => {
        if (!cancelled) setResult({ key, logs: [], error: e.message || '操作履歴の取得に失敗しました' });
      });
    return () => { cancelled = true; };
  }, [open, storeId, formId, formType]);

  const loading = !result || result.key !== requestKey;
  const error = loading ? null : result.error;
  const logs = loading ? [] : result.logs;

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>操作履歴{formName ? `: ${formName}` : ''}</DialogTitle>
          <DialogDescription>
            このフォームに対する作成・保存・デプロイ・複製・削除の記録です（新しい順・最大200件）。
            誰が・どの画面から・何を変更したかを確認できます。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">読み込み中...</p>
        ) : error ? (
          <p className="text-sm text-destructive py-6 text-center">{error}</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            まだ操作履歴がありません（履歴機能の導入後に行われた操作から記録されます）
          </p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => {
              const isOpen = expanded.has(log.id);
              const hasChanges = Array.isArray(log.changes) && log.changes.length > 0;
              return (
                <div key={log.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{formatDateTime(log.created_at)}</span>
                    <Badge variant="outline" className={ACTION_CLASSES[log.action] || ''}>
                      {ACTION_LABELS[log.action] || log.action}
                    </Badge>
                    <span className="font-medium break-all">{log.actor_email || '（不明）'}</span>
                    {log.actor_role && (
                      <Badge variant="secondary" className="text-[10px]">
                        {ROLE_LABELS[log.actor_role] || log.actor_role}
                      </Badge>
                    )}
                    {log.source && SOURCE_LABELS[log.source] && (
                      <span className="text-xs text-muted-foreground">{SOURCE_LABELS[log.source]}から</span>
                    )}
                  </div>
                  {log.summary && (
                    <p className="text-sm mt-1.5">{log.summary}</p>
                  )}
                  {hasChanges && (
                    <div className="mt-2">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggle(log.id)}>
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5 mr-1" /> : <ChevronRight className="h-3.5 w-3.5 mr-1" />}
                        変更内容の詳細（{log.changes!.length}件）
                      </Button>
                      {isOpen && (
                        <div className="mt-2 space-y-3">
                          {log.changes!.map((c, i) => (
                            <div key={`${log.id}-${c.key}-${i}`} className="rounded bg-muted/40 p-2">
                              <p className="text-xs font-semibold mb-1">{c.label}</p>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-0.5">変更前</p>
                                  <pre className="text-[11px] whitespace-pre-wrap break-all max-h-60 overflow-auto rounded border bg-background p-2">{pretty(c.before)}</pre>
                                </div>
                                <div>
                                  <p className="text-[10px] text-muted-foreground mb-0.5">変更後</p>
                                  <pre className="text-[11px] whitespace-pre-wrap break-all max-h-60 overflow-auto rounded border bg-background p-2">{pretty(c.after)}</pre>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
