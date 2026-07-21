'use client';

// 外部予約メール連携の設定画面（店舗ごと）
// 連携ON/OFF・受信アドレス表示・デフォルト所要時間・メニュー別所要時間ルール・受信ログ

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { Copy, Plus, Trash2, ArrowUp, ArrowDown, RefreshCw, Mail, AlertTriangle } from 'lucide-react';

interface DurationRule {
  keyword: string;
  duration_minutes: number;
}

interface IntegrationSettings {
  enabled: boolean;
  inbound_address: string;
  default_duration_minutes: number;
  target_calendar_id: string;
}

interface ReceiveLog {
  id: string;
  source: string;
  status: string;
  reservation_number: string | null;
  reservation_date: string | null;
  reservation_time: string | null;
  duration_minutes: number | null;
  customer_name: string | null;
  mail_subject: string | null;
  mail_from: string | null;
  error_message: string | null;
  raw_body: string | null;
  created_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  salonboard: 'ホットペッパー',
  ekiten: 'エキテン',
  gmail_forwarding: 'Gmail転送確認',
  unknown: 'その他',
};

const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  created: { label: '登録済み', variant: 'default' },
  parse_failed: { label: '解析失敗', variant: 'destructive' },
  skipped_duplicate: { label: '重複スキップ', variant: 'secondary' },
  cancelled: { label: 'キャンセル', variant: 'secondary' },
  unknown: { label: '未処理', variant: 'outline' },
};

export default function ExternalMailIntegrationSettings({ storeId }: { storeId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [hasStoreCalendar, setHasStoreCalendar] = useState(true);

  const [enabled, setEnabled] = useState(false);
  const [inboundAddress, setInboundAddress] = useState<string | null>(null);
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [targetCalendarId, setTargetCalendarId] = useState('');
  const [rules, setRules] = useState<DurationRule[]>([]);

  const [logs, setLogs] = useState<ReceiveLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${storeId}/mail-integration`, { credentials: 'include' });
      if (!res.ok) throw new Error('取得に失敗しました');
      const data = await res.json();
      if (data.available === false) {
        setAvailable(false);
        return;
      }
      setHasStoreCalendar(data.has_store_calendar !== false);
      const integ: IntegrationSettings | null = data.integration;
      if (integ) {
        setEnabled(integ.enabled);
        setInboundAddress(integ.inbound_address);
        setDefaultDuration(integ.default_duration_minutes);
        setTargetCalendarId(integ.target_calendar_id || '');
      }
      setRules(data.rules || []);
    } catch (e) {
      console.error(e);
      toast({ title: '設定の取得に失敗しました', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/mail-integration/logs`, { credentials: 'include' });
      if (!res.ok) throw new Error('取得に失敗しました');
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLogsLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    fetchSettings();
    fetchLogs();
  }, [fetchSettings, fetchLogs]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/mail-integration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enabled,
          default_duration_minutes: defaultDuration,
          target_calendar_id: targetCalendarId,
          rules,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || '保存に失敗しました');
      }
      const data = await res.json();
      setInboundAddress(data.integration?.inbound_address || inboundAddress);
      toast({ title: '設定を保存しました' });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const copyAddress = async () => {
    if (!inboundAddress) return;
    try {
      await navigator.clipboard.writeText(inboundAddress);
      toast({ title: '受信アドレスをコピーしました' });
    } catch {
      toast({ title: 'コピーに失敗しました', variant: 'destructive' });
    }
  };

  const moveRule = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    setRules(next);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  if (!available) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          外部予約メール連携は local 環境では利用できません（staging / 本番で利用可能です）
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 連携設定 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                外部予約メール連携
              </CardTitle>
              <CardDescription className="mt-1">
                ホットペッパービューティー・エキテンなどの予約通知メールを転送すると、Googleカレンダーに予約イベントを自動作成します
              </CardDescription>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`}></div>
              </div>
            </label>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasStoreCalendar && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>この店舗にはGoogleカレンダーが設定されていません。先に店舗のカレンダー設定（カレンダー作成 / 連携）を行ってください。</span>
            </div>
          )}

          {/* 受信アドレス */}
          <div className="space-y-2">
            <Label>あなたの受信用アドレス</Label>
            {inboundAddress ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 px-3 py-2 rounded-md bg-muted text-sm break-all">{inboundAddress}</code>
                <Button variant="outline" size="sm" onClick={copyAddress} className="shrink-0">
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  コピー
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                連携をONにして「保存」すると、この店舗専用の受信アドレスが発行されます
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              予約媒体の通知先メールアドレス、またはメールの自動転送先にこのアドレスを設定してください。
              Gmailの自動転送を設定した場合、Googleからの確認メールは下の「受信ログ」に表示されます。
            </p>
          </div>

          {/* デフォルト所要時間 */}
          <div className="space-y-2">
            <Label htmlFor="default-duration">デフォルト所要時間（分）</Label>
            <Input
              id="default-duration"
              type="number"
              min={5}
              max={600}
              step={5}
              value={defaultDuration}
              onChange={(e) => setDefaultDuration(parseInt(e.target.value) || 60)}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              メールに所要時間の記載がなく、下のルールにも一致しない場合に使われます
            </p>
          </div>

          {/* メニュー別所要時間ルール */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>メニュー別所要時間ルール</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRules([...rules, { keyword: '', duration_minutes: 60 }])}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                ルールを追加
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              メニュー名にキーワードが含まれる場合の所要時間を指定します（上から順に最初に一致したルールを使用）。
              メール本文に所要時間の記載がある場合はそちらが優先されます。
            </p>
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">ルールはまだありません</p>
            ) : (
              <div className="space-y-2">
                {rules.map((rule, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={rule.keyword}
                      onChange={(e) => {
                        const next = [...rules];
                        next[index] = { ...next[index], keyword: e.target.value };
                        setRules(next);
                      }}
                      placeholder="キーワード（例: カット）"
                      className="flex-1 min-w-0"
                    />
                    <Input
                      type="number"
                      min={5}
                      max={600}
                      step={5}
                      value={rule.duration_minutes}
                      onChange={(e) => {
                        const next = [...rules];
                        next[index] = { ...next[index], duration_minutes: parseInt(e.target.value) || 60 };
                        setRules(next);
                      }}
                      className="w-24 shrink-0"
                    />
                    <span className="text-sm text-muted-foreground shrink-0">分</span>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveRule(index, 'up')} className="h-8 w-8 p-0">
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={index === rules.length - 1} onClick={() => moveRule(index, 'down')} className="h-8 w-8 p-0">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRules(rules.filter((_, i) => i !== index))}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 受信ログ */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>受信ログ</CardTitle>
              <CardDescription className="mt-1">直近30件の受信メールと処理結果</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchLogs} disabled={logsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${logsLoading ? 'animate-spin' : ''}`} />
              更新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              まだ受信がありません。受信アドレスへメールを転送するとここに表示されます
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>受信日時</TableHead>
                    <TableHead>媒体</TableHead>
                    <TableHead>状態</TableHead>
                    <TableHead>お客様</TableHead>
                    <TableHead>予約日時</TableHead>
                    <TableHead>詳細</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} className={log.source === 'gmail_forwarding' ? 'bg-amber-50' : ''}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {new Date(log.created_at).toLocaleString('ja-JP')}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{SOURCE_LABELS[log.source] || log.source}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGES[log.status]?.variant || 'outline'}>
                          {STATUS_BADGES[log.status]?.label || log.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{log.customer_name || '-'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {log.reservation_date
                          ? `${log.reservation_date} ${log.reservation_time || ''}${log.duration_minutes ? `（${log.duration_minutes}分）` : ''}`
                          : '-'}
                      </TableCell>
                      <TableCell className="max-w-[320px]">
                        {log.source === 'gmail_forwarding' && log.raw_body ? (
                          <details>
                            <summary className="cursor-pointer text-amber-700 font-medium text-sm">
                              📩 Gmail転送の確認メール（開いて確認リンクへ）
                            </summary>
                            <pre className="mt-2 p-2 bg-white border rounded text-xs whitespace-pre-wrap break-all max-h-64 overflow-y-auto">{log.raw_body}</pre>
                          </details>
                        ) : log.error_message ? (
                          <details>
                            <summary className="cursor-pointer text-sm text-muted-foreground">{log.error_message.slice(0, 40)}…</summary>
                            <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{log.error_message}</p>
                            {log.raw_body && (
                              <pre className="mt-2 p-2 bg-muted border rounded text-xs whitespace-pre-wrap break-all max-h-64 overflow-y-auto">{log.raw_body}</pre>
                            )}
                          </details>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {log.reservation_number ? `予約番号: ${log.reservation_number}` : '-'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
