'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import type { FormConfig } from '@/types/form';

// 予約詳細モーダル内の「予約内容を編集」フォーム。
// 予約日時（開始〜終了）・メニュー・オプション・担当スタッフを変更し、PATCH /api/reservations/{id} で
// DB + Google カレンダー + 来店履歴を同期する（Webhook の予約確認は DB を参照するため自動で追従）

interface ReservationEditFormProps {
  reservation: any;
  formConfig: FormConfig | undefined;
  onSaved: (updated: any) => void;
  onCancel: () => void;
}

interface MenuChoice {
  key: string;            // menu_id
  categoryId: string;
  categoryName: string;
  menuId: string;
  menuName: string;
  price: number;
  duration: number;
  subMenus: Array<{ id: string; name: string; price: number; duration: number }>;
  options: Array<{ id: string; name: string; price: number; duration: number }>;
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}
function toHHMM(min: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, min));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export default function ReservationEditForm({ reservation, formConfig, onSaved, onCancel }: ReservationEditFormProps) {
  const { toast } = useToast();
  const currentMenus: any[] = Array.isArray(reservation.selected_menus) ? reservation.selected_menus : [];
  const currentOptions: any[] = Array.isArray(reservation.selected_options) ? reservation.selected_options : [];
  const info = (reservation.customer_info && typeof reservation.customer_info === 'object') ? reservation.customer_info : {};
  const startInit = String(reservation.reservation_time || '').slice(0, 5) || '10:00';
  const initialDuration = (typeof info.total_duration === 'number' && info.total_duration > 0)
    ? info.total_duration
    : (currentMenus.reduce((s, m) => s + (Number(m.duration) || 0), 0) + currentOptions.reduce((s, o) => s + (Number(o.duration) || 0), 0)) || 60;

  // フォーム設定からメニュー候補を構築
  const menuChoices: MenuChoice[] = useMemo(() => {
    const out: MenuChoice[] = [];
    (formConfig?.menu_structure?.categories || []).forEach((cat) => {
      (cat.menus || []).forEach((m) => {
        out.push({
          key: m.id, categoryId: cat.id, categoryName: cat.display_name || cat.name,
          menuId: m.id, menuName: m.name, price: m.price || 0, duration: m.duration || 0,
          subMenus: (m.sub_menu_items || []).map((s) => ({ id: s.id, name: s.name, price: s.price || 0, duration: s.duration || 0 })),
          options: (m.options || []).map((o) => ({ id: o.id, name: o.name, price: o.price || 0, duration: o.duration || 0 })),
        });
      });
    });
    (formConfig?.menu_structure?.menus || []).forEach((m) => {
      out.push({
        key: m.id, categoryId: '', categoryName: '', menuId: m.id, menuName: m.name, price: m.price || 0, duration: m.duration || 0,
        subMenus: (m.sub_menu_items || []).map((s) => ({ id: s.id, name: s.name, price: s.price || 0, duration: s.duration || 0 })),
        options: (m.options || []).map((o) => ({ id: o.id, name: o.name, price: o.price || 0, duration: o.duration || 0 })),
      });
    });
    return out;
  }, [formConfig]);
  const categoryOptions = useMemo(() => {
    const out: Array<{ categoryId: string; categoryName: string; id: string; name: string; price: number; duration: number }> = [];
    (formConfig?.menu_structure?.categories || []).forEach((cat) => {
      (cat.options || []).forEach((o) => out.push({ categoryId: cat.id, categoryName: cat.display_name || cat.name, id: o.id, name: o.name, price: o.price || 0, duration: o.duration || 0 }));
    });
    return out;
  }, [formConfig]);

  // 現在の選択を候補に対応付け（menu_id が無い旧データは名前で照合）
  const initialMenuIds = new Set<string>();
  const initialSubMenu: Record<string, string> = {};
  currentMenus.forEach((m) => {
    const found = menuChoices.find((c) => c.menuId === m.menu_id) || menuChoices.find((c) => c.menuName === (m.menu_name || m.name));
    if (found) {
      initialMenuIds.add(found.menuId);
      if (m.submenu_id) initialSubMenu[found.menuId] = m.submenu_id;
      else if (m.submenu_name) {
        const sub = found.subMenus.find((s) => s.name === m.submenu_name);
        if (sub) initialSubMenu[found.menuId] = sub.id;
      }
    }
  });
  const initialOptionIds = new Set<string>();
  currentOptions.forEach((o) => {
    if (o.option_id) initialOptionIds.add(o.option_id);
    else {
      const byName = [...menuChoices.flatMap((c) => c.options), ...categoryOptions].find((x) => x.name === (o.option_name || o.name));
      if (byName) initialOptionIds.add(byName.id);
    }
  });

  const [date, setDate] = useState<string>(String(reservation.reservation_date || '').slice(0, 10));
  const [start, setStart] = useState<string>(startInit);
  const [end, setEnd] = useState<string>(toHHMM(toMin(startInit) + initialDuration));
  const [selectedMenuIds, setSelectedMenuIds] = useState<Set<string>>(initialMenuIds);
  const [subMenuSel, setSubMenuSel] = useState<Record<string, string>>(initialSubMenu);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(initialOptionIds);
  const [staffId, setStaffId] = useState<string>(reservation.staff_id || '');
  const [saving, setSaving] = useState(false);

  const staffList = formConfig?.staff_selection?.enabled === true ? (formConfig.staff_selection.staff || []) : [];
  const allowMultiple = formConfig?.menu_structure?.allow_cross_category_selection === true;

  // 選択内容から送信ペイロードと所要時間の合計を計算
  const buildSelection = () => {
    const menus: any[] = [];
    const options: any[] = [];
    menuChoices.forEach((c) => {
      if (!selectedMenuIds.has(c.menuId)) return;
      const sub = c.subMenus.find((s) => s.id === subMenuSel[c.menuId]);
      const price = sub ? sub.price : c.price;
      const duration = sub ? sub.duration : c.duration;
      menus.push({ menu_id: c.menuId, menu_name: c.menuName, category_name: c.categoryName, price, duration, ...(sub ? { submenu_id: sub.id, submenu_name: sub.name } : {}) });
      c.options.forEach((o) => {
        if (selectedOptionIds.has(o.id)) options.push({ option_id: o.id, option_name: o.name, menu_id: c.menuId, price: o.price, duration: o.duration });
      });
    });
    categoryOptions.forEach((o) => {
      if (selectedOptionIds.has(o.id)) options.push({ option_id: o.id, option_name: o.name, category_id: o.categoryId, price: o.price, duration: o.duration });
    });
    const duration = menus.reduce((s, m) => s + (m.duration || 0), 0) + options.reduce((s, o) => s + (o.duration || 0), 0);
    const price = menus.reduce((s, m) => s + (m.price || 0), 0) + options.reduce((s, o) => s + (o.price || 0), 0);
    return { menus, options, duration, price };
  };

  const toggleMenu = (c: MenuChoice) => {
    setSelectedMenuIds((prev) => {
      const next = new Set(prev);
      if (next.has(c.menuId)) {
        next.delete(c.menuId);
      } else {
        if (!allowMultiple) next.clear();
        next.add(c.menuId);
      }
      return next;
    });
  };
  const toggleOption = (id: string) => {
    setSelectedOptionIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  // メニュー/オプション変更時に終了時間を所要時間から再計算するボタン用
  const recalcEnd = () => {
    const { duration } = buildSelection();
    if (duration > 0) setEnd(toHHMM(toMin(start) + duration));
  };

  const handleSave = async () => {
    if (!date || !start || !end) { toast({ title: '予約日・開始時間・終了時間を入力してください', variant: 'destructive' }); return; }
    if (toMin(end) <= toMin(start)) { toast({ title: '終了時間は開始時間より後にしてください', variant: 'destructive' }); return; }
    const { menus, options } = buildSelection();
    const hasMenusInForm = menuChoices.length > 0;
    if (hasMenusInForm && menus.length === 0) { toast({ title: 'メニューを1つ以上選択してください', variant: 'destructive' }); return; }
    if (!confirm('予約内容を変更します。Googleカレンダーの予定も更新されます。よろしいですか？')) return;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        reservation_date: date,
        reservation_time: start,
        end_time: end,
      };
      if (hasMenusInForm) {
        payload.selected_menus = menus;
        payload.selected_options = options;
      }
      if (staffList.length > 0 && (staffId || '') !== (reservation.staff_id || '')) {
        payload.staff_id = staffId || null;
      }
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: '更新に失敗しました', description: data.error || '', variant: 'destructive' });
        return;
      }
      if (data.calendar_sync === 'failed') {
        toast({ title: '予約は更新しましたが、Googleカレンダーの更新に失敗しました', description: 'カレンダーの予定を手動でご確認ください', variant: 'destructive' });
      } else {
        toast({ title: '予約内容を更新しました', description: data.calendar_sync === 'moved' ? '担当変更に伴いカレンダーの予定を移動しました' : undefined });
      }
      onSaved(data);
    } catch {
      toast({ title: '更新に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const selection = buildSelection();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-lg">予約日時</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="edit-date">予約日</Label>
              <Input id="edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-start">開始時間</Label>
              <Input id="edit-start" type="time" step={300} value={start} onChange={(e) => {
                const newStart = e.target.value;
                // 開始をずらしたら終了も同じ幅だけずらす（所要時間を保つ）
                const dur = Math.max(5, toMin(end) - toMin(start));
                setStart(newStart);
                if (newStart) setEnd(toHHMM(toMin(newStart) + dur));
              }} />
            </div>
            <div>
              <Label htmlFor="edit-end">終了時間</Label>
              <Input id="edit-end" type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            所要時間: {Math.max(0, toMin(end) - toMin(start))}分（Googleカレンダーの予定の長さに反映されます）
            {selection.duration > 0 && selection.duration !== Math.max(0, toMin(end) - toMin(start)) && (
              <Button variant="link" size="sm" className="h-auto p-0 ml-2 text-xs" onClick={recalcEnd}>
                メニューの所要時間（{selection.duration}分）に合わせる
              </Button>
            )}
          </p>
        </CardContent>
      </Card>

      {menuChoices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">メニュー</CardTitle>
            <p className="text-xs text-muted-foreground">{allowMultiple ? '複数選択できます' : '1つ選択してください'}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {(formConfig?.menu_structure?.categories || []).map((cat) => (
              <div key={cat.id} className="border rounded-md p-3 space-y-2">
                <p className="text-sm font-semibold">{cat.display_name || cat.name}</p>
                {menuChoices.filter((c) => c.categoryId === cat.id).map((c) => (
                  <div key={c.menuId} className="ml-1 space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type={allowMultiple ? 'checkbox' : 'radio'} name="edit-menu" checked={selectedMenuIds.has(c.menuId)} onChange={() => toggleMenu(c)} className="h-4 w-4" />
                      <span className="text-sm">{c.menuName}</span>
                      {c.subMenus.length === 0 && <span className="text-xs text-muted-foreground">¥{c.price.toLocaleString()} / {c.duration}分</span>}
                    </label>
                    {selectedMenuIds.has(c.menuId) && c.subMenus.length > 0 && (
                      <select value={subMenuSel[c.menuId] || ''} onChange={(e) => setSubMenuSel((prev) => ({ ...prev, [c.menuId]: e.target.value }))} className="ml-6 text-sm border rounded px-2 py-1">
                        <option value="">サブメニューを選択</option>
                        {c.subMenus.map((s) => <option key={s.id} value={s.id}>{s.name}（¥{s.price.toLocaleString()} / {s.duration}分）</option>)}
                      </select>
                    )}
                    {selectedMenuIds.has(c.menuId) && c.options.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 cursor-pointer ml-6">
                        <input type="checkbox" checked={selectedOptionIds.has(o.id)} onChange={() => toggleOption(o.id)} className="h-4 w-4" />
                        <span className="text-xs">{o.name}（+¥{o.price.toLocaleString()} / +{o.duration}分）</span>
                      </label>
                    ))}
                  </div>
                ))}
                {categoryOptions.filter((o) => o.categoryId === cat.id).length > 0 && (
                  <div className="ml-1 pt-1 space-y-1">
                    <p className="text-xs text-muted-foreground">カテゴリー共通オプション</p>
                    {categoryOptions.filter((o) => o.categoryId === cat.id).map((o) => (
                      <label key={o.id} className="flex items-center gap-2 cursor-pointer ml-2">
                        <input type="checkbox" checked={selectedOptionIds.has(o.id)} onChange={() => toggleOption(o.id)} className="h-4 w-4" />
                        <span className="text-xs">{o.name}（+¥{o.price.toLocaleString()} / +{o.duration}分）</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {menuChoices.filter((c) => !c.categoryId).length > 0 && (
              <div className="border rounded-md p-3 space-y-2">
                {menuChoices.filter((c) => !c.categoryId).map((c) => (
                  <label key={c.menuId} className="flex items-center gap-2 cursor-pointer">
                    <input type={allowMultiple ? 'checkbox' : 'radio'} name="edit-menu" checked={selectedMenuIds.has(c.menuId)} onChange={() => toggleMenu(c)} className="h-4 w-4" />
                    <span className="text-sm">{c.menuName}</span>
                    <span className="text-xs text-muted-foreground">¥{c.price.toLocaleString()} / {c.duration}分</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">合計: ¥{selection.price.toLocaleString()} / {selection.duration}分</p>
          </CardContent>
        </Card>
      )}

      {staffList.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">担当スタッフ</CardTitle></CardHeader>
          <CardContent>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="text-sm border rounded px-2 py-1.5 w-full sm:w-auto">
              <option value="">担当なし（店舗カレンダー）</option>
              {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">担当を変えるとカレンダーの予定はそのスタッフのカレンダーへ移動します</p>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 justify-end pt-2 border-t">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>キャンセル</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '変更を保存'}</Button>
      </div>
    </div>
  );
}
