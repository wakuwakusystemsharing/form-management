'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, LayoutList, Link2 } from 'lucide-react';
import {
  STORE_ADMIN_TABS,
  STORE_ADMIN_OPTIONS,
  normalizeAdminVisibleOptions,
  resolveAdminVisibleOptions,
  resolveVisibleTabs,
  type StoreAdminOptionKey,
  type StoreAdminTabId,
  type StoreAdminVisibleOptions,
} from '@/lib/store-admin-tabs';

interface StoreAdminMenuSettingsProps {
  storeId: string;
}

const TAB_LABEL = new Map(STORE_ADMIN_TABS.map((t) => [t.id, t.label]));

function sameOptions(a: StoreAdminVisibleOptions, b: StoreAdminVisibleOptions): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k as StoreAdminOptionKey] !== b[k as StoreAdminOptionKey]) return false;
  }
  return true;
}

/**
 * テナント側 店舗設定: 店舗管理者に表示するメニュー（タブ）の ON/OFF と、タブ内の項目の表示 / 非表示
 * 保存先: stores.admin_visible_tabs（null = すべて表示）/ stores.admin_visible_options（未設定キー = 親タブに連動）
 */
export default function StoreAdminMenuSettings({ storeId }: StoreAdminMenuSettingsProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<StoreAdminTabId[]>([]);
  const [saved, setSaved] = useState<StoreAdminTabId[]>([]);
  const [options, setOptions] = useState<StoreAdminVisibleOptions>({});
  const [savedOptions, setSavedOptions] = useState<StoreAdminVisibleOptions>({});

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
      const opts = normalizeAdminVisibleOptions(store.admin_visible_options);
      setSelected(tabs);
      setSaved(tabs);
      setOptions(opts);
      setSavedOptions(opts);
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
      return STORE_ADMIN_TABS.map((t) => t.id).filter((t) => next.includes(t));
    });
  };

  const setOption = (key: StoreAdminOptionKey, value: boolean | undefined) => {
    setOptions((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const isDirty =
    selected.length !== saved.length ||
    selected.some((t) => !saved.includes(t)) ||
    !sameOptions(options, savedOptions);
  const allSelected = selected.length === STORE_ADMIN_TABS.length;
  // 現在の選択で実際にどう表示されるか（連動の結果を含む）
  const effective = resolveAdminVisibleOptions(allSelected ? null : selected, options);

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
        body: JSON.stringify({
          // すべて選択時は null（= 既定のすべて表示）で保存し、将来タブが増えても自動的に表示されるようにする
          admin_visible_tabs: allSelected ? null : selected,
          // 個別設定が 1 つも無ければ null（= すべて親タブに連動）
          admin_visible_options: Object.keys(options).length === 0 ? null : options,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: '保存に失敗しました', description: data.error || `エラーコード: ${res.status}`, variant: 'destructive' });
        return;
      }
      setSaved(selected);
      setSavedOptions(options);
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
              店舗管理者が店舗管理ページを開いたときに表示するメニューと、各メニュー内の項目を選びます。
              項目のチェックは未設定なら親メニューの表示に連動し、個別に変えると「個別設定」として保存されます。
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
                const subOptions = STORE_ADMIN_OPTIONS.filter((o) => o.tab === tab.id);
                return (
                  <div
                    key={tab.id}
                    className={`rounded-lg border p-3 transition-colors ${checked ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}
                  >
                    <label htmlFor={`admin-tab-${tab.id}`} className="flex items-start gap-3 cursor-pointer">
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

                    {subOptions.length > 0 && (
                      <div className="mt-3 ml-7 space-y-2 border-l pl-3">
                        {subOptions.map((opt) => {
                          const explicit = options[opt.key];
                          const isLinked = explicit === undefined;
                          const value = effective[opt.key];
                          const followsOtherTab = opt.followsTab !== tab.id;
                          return (
                            <div key={opt.key} className="space-y-1">
                              <label htmlFor={`admin-opt-${opt.key}`} className="flex items-start gap-2 cursor-pointer">
                                <Checkbox
                                  id={`admin-opt-${opt.key}`}
                                  checked={value}
                                  // 親タブが OFF の項目（自タブ連動）は表示されないためグレーアウト
                                  disabled={!checked && !followsOtherTab}
                                  onCheckedChange={(v) => setOption(opt.key, v === true)}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0">
                                  <Label htmlFor={`admin-opt-${opt.key}`} className="cursor-pointer text-sm">{opt.label}</Label>
                                  <span className="block text-[11px] leading-4 text-muted-foreground">{opt.description}</span>
                                </span>
                              </label>
                              <div className="ml-6 flex items-center gap-2 text-[11px] text-muted-foreground">
                                {isLinked ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Link2 className="h-3 w-3" aria-hidden="true" />
                                    「{TAB_LABEL.get(opt.followsTab)}」に連動（現在: {value ? '表示' : '非表示'}）
                                  </span>
                                ) : (
                                  <>
                                    <span>個別設定: {explicit ? '表示' : '非表示'}</span>
                                    <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setOption(opt.key, undefined)}>
                                      連動に戻す
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {allSelected ? 'すべてのメニューを表示します' : `${selected.length} / ${STORE_ADMIN_TABS.length} 件を表示`}
                {Object.keys(options).length > 0 && ` ・ 個別設定 ${Object.keys(options).length} 件`}
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
