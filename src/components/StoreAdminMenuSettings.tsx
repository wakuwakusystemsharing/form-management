'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, LayoutList } from 'lucide-react';
import { STORE_ADMIN_TABS, resolveVisibleTabs, type StoreAdminTabId } from '@/lib/store-admin-tabs';

interface StoreAdminMenuSettingsProps {
  storeId: string;
}

/**
 * テナント側 店舗設定: 店舗管理者に表示するメニュー（タブ）の ON/OFF
 * 保存先: stores.admin_visible_tabs（null = すべて表示）
 */
export default function StoreAdminMenuSettings({ storeId }: StoreAdminMenuSettingsProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<StoreAdminTabId[]>([]);
  const [saved, setSaved] = useState<StoreAdminTabId[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stores/${storeId}`, { credentials: 'include' });
      if (!res.ok) {
        toast({ title: '店舗情報の取得に失敗しました', variant: 'destructive' });
        return;
      }
      const store = await res.json();
      const tabs = resolveVisibleTabs(store.admin_visible_tabs);
      setSelected(tabs);
      setSaved(tabs);
    } catch {
      toast({ title: '店舗情報の取得に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [storeId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: StoreAdminTabId, checked: boolean) => {
    setSelected((prev) => {
      const next = checked ? [...prev, id] : prev.filter((t) => t !== id);
      // 定義順に並べ替え
      return STORE_ADMIN_TABS.map((t) => t.id).filter((t) => next.includes(t));
    });
  };

  const isDirty = selected.length !== saved.length || selected.some((t) => !saved.includes(t));
  const allSelected = selected.length === STORE_ADMIN_TABS.length;

  const save = async () => {
    if (selected.length === 0) {
      toast({ title: '少なくとも 1 つのメニューを表示にしてください', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/stores/${storeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // すべて選択時は null（= 既定のすべて表示）で保存し、将来タブが増えても自動的に表示されるようにする
        body: JSON.stringify({ admin_visible_tabs: allSelected ? null : selected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: '保存に失敗しました', description: data.error || `エラーコード: ${res.status}`, variant: 'destructive' });
        return;
      }
      setSaved(selected);
      toast({ title: '店舗管理者に表示するメニューを保存しました' });
    } catch {
      toast({ title: '保存に失敗しました', description: 'ネットワークエラー', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <LayoutList className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <div>
            <CardTitle>店舗管理者に表示するメニュー</CardTitle>
            <CardDescription>
              店舗管理者が店舗管理ページを開いたときに表示するメニューを選びます。予約フォームを使わない店舗では「予約管理」を非表示にできます。
              マスター管理者・システム管理者には常にすべて表示されます。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            読み込み中…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {STORE_ADMIN_TABS.map((tab) => {
                const checked = selected.includes(tab.id);
                const lastOne = checked && selected.length === 1;
                return (
                  <label
                    key={tab.id}
                    htmlFor={`admin-tab-${tab.id}`}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${checked ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                  >
                    <Checkbox
                      id={`admin-tab-${tab.id}`}
                      checked={checked}
                      disabled={lastOne}
                      onCheckedChange={(v) => toggle(tab.id, v === true)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <Label htmlFor={`admin-tab-${tab.id}`} className="cursor-pointer font-medium">{tab.label}</Label>
                      <span className="block text-xs text-muted-foreground">{tab.description}</span>
                      {lastOne && <span className="block text-xs text-muted-foreground mt-1">最後の 1 つは非表示にできません</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {allSelected ? 'すべてのメニューを表示します' : `${selected.length} / ${STORE_ADMIN_TABS.length} 件を表示`}
              </p>
              <Button onClick={save} disabled={!isDirty || saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                保存
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
