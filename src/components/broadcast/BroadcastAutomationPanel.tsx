'use client';

/**
 * 自動配信（ステップ配信）: ルールの一覧と作成・編集
 * きっかけ（休眠 / 誕生月 / 初回来店 N 日後 / 来店 N 回目 / タグ）に当てはまったお客様へ、1 日 1 回の判定で自動的に送る
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import FlexPreview from '@/components/line-flex/FlexPreview';
import AudienceEditor, { type AudienceOptions } from './AudienceEditor';
import BroadcastItemsEditor, { type ItemJsonState } from './BroadcastItemsEditor';
import { describeAudience, normalizeAudience } from '@/lib/broadcast-audience';
import { AUTOMATION_TEMPLATES, AUTOMATION_WINDOW_DAYS, describeAutomationTrigger } from '@/lib/broadcast-automation';
import {
  CANCEL_OPENING_BUTTON_MAX,
  CANCEL_OPENING_DEFAULT_CARD,
  CANCEL_OPENING_TEXT_MAX,
  CANCEL_OPENING_TITLE_MAX,
  buildCancelOpeningFlex,
  type CancelOpeningTrigger,
} from '@/lib/broadcast-cancel-opening';
import {
  WEEKDAY_LABELS,
  WEEKLY_BUTTON_MAX,
  WEEKLY_DAYS_OPTIONS,
  WEEKLY_DEFAULT_CARD,
  WEEKLY_TEXT_MAX,
  WEEKLY_TITLE_MAX,
  buildWeeklyAvailabilityFlex,
  sampleAvailabilitySummary,
  weeklyAvailabilityDates,
  type AvailabilitySummary,
  type WeeklyAvailabilityTrigger,
} from '@/lib/broadcast-weekly-availability';
import { BROADCAST_ITEMS_MAX, BROADCAST_NAME_MAX, broadcastItemsToPreview, describeBroadcastItems, validateBroadcastItems } from '@/lib/broadcast-items';
import { payloadsToPreview } from '@/lib/line-flex-items';
import { validateFlexContents } from '@/lib/line-flex-templates';
import type { AutomationTrigger, BroadcastAudience, BroadcastAutomation, BroadcastAutomationInput, BroadcastItem, BroadcastSticker } from '@/types/broadcast';
import type { LineFlexMessage } from '@/types/line-flex';

interface Props {
  storeId: string;
  options: AudienceOptions;
  messages: LineFlexMessage[];
  stickers: BroadcastSticker[];
  /** 自動配信の実行時刻（HH:00。説明文に使う） */
  automationTime: string;
}

/** 画像アップロードの置き場所に使う ID（保存前のルール用） */
function newUploadId(): string {
  return Math.random().toString(36).slice(2, 14);
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
      {children}
    </button>
  );
}

function NumberInput({ value, onChange, min, max, suffix }: { value: number; onChange: (n: number) => void; min: number; max: number; suffix: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(e) => { const n = Math.floor(Number(e.target.value)); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }} className="h-8 w-20 text-xs" />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </span>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** プレビューの例の表に使う基準の日時（画面を開いた時刻） */
const PREVIEW_NOW = new Date();
/** プレビューのカードに出す例の日付（画面を開いた日の 3 日後） */
const PREVIEW_SLOT_DATE = (() => {
  const d = new Date(Date.now() + 3 * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/** 「予約フォームでキャンセルが出た時」の条件 */
function CancelOpeningFields({ trigger, onChange }: { trigger: CancelOpeningTrigger; onChange: (t: AutomationTrigger) => void }) {
  const set = (patch: Partial<CancelOpeningTrigger>) => onChange({ ...trigger, ...patch });
  const q = trigger.quiet_hours;
  const hourSelect = (value: number, apply: (n: number) => void, testId: string) => (
    <select data-testid={testId} value={value} onChange={(e) => apply(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-xs">
      {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
    </select>
  );
  return (
    <div className="space-y-3 text-xs" data-slot="cancel-opening-fields">
      <p className="text-[11px] text-muted-foreground">
        お客様が公式 LINE の「予約をキャンセル」で予約を取り消したとき、<strong>キャンセルした本人以外</strong>のお客様へ「空きが出ました」のカードをすぐに送ります（キャンセルから 10 秒ほど後）。
        ほかのきっかけと違い、1 日 1 回の判定ではなくキャンセルのたびに動きます。対象は、カレンダー表示モードの予約フォームの予約です。
      </p>
      <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
        キャンセル 1 回ごとに、対象のお客様の人数ぶんの通数を使います（例: 300 人 × 1 日 3 回 = 900 通）。下の「さらに絞り込む」と回数の上限で調整してください。
      </p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4" data-testid="cancel-opening-only-open" checked={trigger.only_if_open} onChange={(e) => set({ only_if_open: e.target.checked })} />
        <span>本当に空いた時だけ送る<span className="block text-[11px] text-muted-foreground">キャンセル後に Google カレンダーを確認し、その日時が実際に予約できる状態のときだけ送ります（別の予定で埋まっている・営業時間外・受付期間外なら送りません）。</span></span>
      </label>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">予約の <NumberInput value={trigger.min_hours_before} min={0} max={72} suffix="時間前より後のキャンセルは送らない" onChange={(n) => set({ min_hours_before: n })} /></div>
        <p className="text-[11px] text-muted-foreground">直前すぎて来店できない空きで通数を使わないための設定です（0 = 直前のキャンセルでも送る）。</p>
      </div>
      <div className="space-y-1">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" data-testid="cancel-opening-quiet" checked={q.enabled} onChange={(e) => set({ quiet_hours: { ...q, enabled: e.target.checked } })} />
          夜間は送らない
        </label>
        {q.enabled && (
          <div className="flex flex-wrap items-center gap-2 pl-6">
            {hourSelect(q.start, (n) => set({ quiet_hours: { ...q, start: n } }), 'cancel-opening-quiet-start')} から
            {hourSelect(q.end, (n) => set({ quiet_hours: { ...q, end: n } }), 'cancel-opening-quiet-end')} まで{q.start > q.end ? '（翌日）' : ''}のキャンセルは送らない
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">この時間帯に出たキャンセルは配信しません（朝にまとめて送ることもしません）。</p>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">1 日に送るのは <NumberInput value={trigger.max_per_day} min={0} max={50} suffix="回まで" onChange={(n) => set({ max_per_day: n })} /></div>
        <p className="text-[11px] text-muted-foreground">キャンセルが続いた日に何度も届くのを防ぎます（0 = 上限なし）。上限に達した日のキャンセルは配信しません。</p>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5 h-4 w-4" data-testid="cancel-opening-store" checked={trigger.include_store_cancel} onChange={(e) => set({ include_store_cancel: e.target.checked })} />
        <span>店舗が管理画面で予約をキャンセルした時も送る<span className="block text-[11px] text-muted-foreground">OFF（おすすめ）= お客様の LINE キャンセルだけ。ON にすると、臨時休業などで店舗がキャンセルした枠でも配信されるので注意してください。</span></span>
      </label>
      <p className="text-[11px] text-muted-foreground">空き待ち（キャンセル待ち）を使っているフォームで、その日時に空き待ちの人がいる時は、空き待ちの人にだけお知らせします（この配信は送りません）。</p>
    </div>
  );
}

/** 「空きが出ました」カードの文言 */
function CancelOpeningCardEditor({ trigger, onChange }: { trigger: CancelOpeningTrigger; onChange: (t: AutomationTrigger) => void }) {
  const setCard = (patch: Partial<CancelOpeningTrigger['card']>) => onChange({ ...trigger, card: { ...trigger.card, ...patch } });
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3" data-slot="cancel-opening-card">
      <div>
        <p className="text-xs font-medium">1 通目: 「空きが出ました」カード（自動で作られます）</p>
        <p className="text-[11px] text-muted-foreground">空いた日時（例: 11/25（水）14:00）と「先着順」の注意書き、予約フォームを開くボタンは自動で入ります。見出し・案内文・ボタンの文言を変更できます。文中の {'{日時}'} {'{店名}'} は実際の内容に置き換わります。</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="cancel_card_title" className="text-xs">見出し</Label>
        <Input id="cancel_card_title" value={trigger.card.title} maxLength={CANCEL_OPENING_TITLE_MAX} placeholder={CANCEL_OPENING_DEFAULT_CARD.title} onChange={(e) => setCard({ title: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cancel_card_text" className="text-xs">案内文</Label>
        <textarea id="cancel_card_text" rows={4} value={trigger.card.text} maxLength={CANCEL_OPENING_TEXT_MAX} placeholder={CANCEL_OPENING_DEFAULT_CARD.text} onChange={(e) => setCard({ text: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cancel_card_button" className="text-xs">ボタンの文言</Label>
        <Input id="cancel_card_button" value={trigger.card.button_label} maxLength={CANCEL_OPENING_BUTTON_MAX} placeholder={CANCEL_OPENING_DEFAULT_CARD.button_label} onChange={(e) => setCard({ button_label: e.target.value })} className="max-w-xs" />
        <p className="text-[11px] text-muted-foreground">ボタンは、キャンセルされた予約と同じ予約フォームを開きます。</p>
      </div>
      <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => setCard({ ...CANCEL_OPENING_DEFAULT_CARD })}>文言を既定に戻す</button>
    </div>
  );
}

const selectClass = 'h-8 rounded-md border bg-background px-2 text-xs';

/** 「特定の曜日に 1 週間の空き状況」の条件 */
function WeeklyAvailabilityFields({ trigger, onChange, forms, staff, automationTime }: { trigger: WeeklyAvailabilityTrigger; onChange: (t: AutomationTrigger) => void; forms: Array<{ id: string; name: string }>; staff: Array<{ id: string; name: string }>; automationTime: string }) {
  const set = (patch: Partial<WeeklyAvailabilityTrigger>) => onChange({ ...trigger, ...patch });
  const toggleDay = (w: number) => {
    const next = trigger.weekdays.includes(w) ? trigger.weekdays.filter((x) => x !== w) : [...trigger.weekdays, w].sort((a, b) => a - b);
    set({ weekdays: next });
  };
  return (
    <div className="space-y-3 text-xs" data-slot="weekly-availability-fields">
      <p className="text-[11px] text-muted-foreground">
        選んだ曜日の {automationTime} ごろに、予約フォームの空き状況（日付 × 午前 / 午後 / 夕方の 〇△✕）をカードにして一斉に送ります。
        空きの判定は、予約フォームの希望日時の 〇✕ と同じです（営業時間・受付ルールと Google カレンダーの予定）。
      </p>
      <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
        1 回の配信で、対象のお客様の人数ぶんの通数を使います（例: 300 人 × 週 1 回 = 月に約 1,300 通）。下の「さらに絞り込む」で調整してください。
      </p>
      <div className="space-y-1">
        <span className="font-medium">送る曜日</span>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3, 4, 5, 6, 0].map((w) => (
            <Chip key={w} active={trigger.weekdays.includes(w)} onClick={() => toggleDay(w)}>{WEEKDAY_LABELS[w]}</Chip>
          ))}
        </div>
        {trigger.weekdays.length === 0 && <p className="text-[11px] text-destructive">曜日を 1 つ以上選んでください</p>}
      </div>
      <div className="space-y-1">
        <span className="font-medium">空き状況を載せる予約フォーム</span>
        <div>
          <select data-testid="weekly-form" value={trigger.form_id} onChange={(e) => set({ form_id: e.target.value, staff_id: null })} className={`${selectClass} max-w-full`}>
            <option value="">選んでください</option>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <p className="text-[11px] text-muted-foreground">日時選択モードが「Googleカレンダー連携」の予約フォームを選んでください。「予約する」ボタンもこのフォームを開きます。</p>
      </div>
      {staff.length > 0 && (
        <div className="space-y-1">
          <span className="font-medium">スタッフ</span>
          <div>
            <select data-testid="weekly-staff" value={trigger.staff_id ?? ''} onChange={(e) => set({ staff_id: e.target.value || null })} className={selectClass}>
              <option value="">誰か 1 人でも空いていれば空き（指名なしと同じ）</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name} の空きだけを載せる</option>)}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">スタッフを選ぶと、カードに担当名が入り、そのスタッフの空きだけを載せます（スタッフごとにルールを作れます）。</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select data-testid="weekly-include-today" value={trigger.include_today ? '1' : '0'} onChange={(e) => set({ include_today: e.target.value === '1' })} className={selectClass}>
          <option value="0">翌日から</option>
          <option value="1">当日から</option>
        </select>
        <select data-testid="weekly-days" value={trigger.days} onChange={(e) => set({ days: Number(e.target.value) })} className={selectClass}>
          {WEEKLY_DAYS_OPTIONS.map((d) => <option key={d} value={d}>{d} 日間</option>)}
        </select>
        の空き状況を載せる
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2"><NumberInput value={trigger.duration_minutes} min={0} max={600} suffix="分の予約が入る時間を「空き」として数える" onChange={(n) => set({ duration_minutes: n })} /></div>
        <p className="text-[11px] text-muted-foreground">予約フォームの 〇✕ はメニューの所要時間で変わります。よく出るメニューの時間（例: 60）を入れると、その長さの予約が入る時間だけを数えます（0 = フォームの時間間隔ぶん空いていれば空き）。</p>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">空きが合計 <NumberInput value={trigger.min_open_slots} min={1} max={500} suffix="枠以上ある時だけ送る" onChange={(n) => set({ min_open_slots: n })} /></div>
        <p className="text-[11px] text-muted-foreground">ほぼ満席の週に通数を使わないための設定です（1 = 空きが 1 つも無い週は送らない）。送らなかった週は配信一覧に残りません。</p>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">時間帯の空きが <NumberInput value={trigger.few_threshold} min={0} max={20} suffix="枠以下なら △（残りわずか）" onChange={(n) => set({ few_threshold: n })} /></div>
        <p className="text-[11px] text-muted-foreground">それより多ければ 〇、0 枠なら ✕ です（0 にすると △ は出ません）。時間帯は 午前 = 12 時まで / 午後 = 12〜17 時 / 夕方 = 17 時以降 です。</p>
      </div>
    </div>
  );
}

/** 「空き状況」カードの文言 */
function WeeklyAvailabilityCardEditor({ trigger, onChange }: { trigger: WeeklyAvailabilityTrigger; onChange: (t: AutomationTrigger) => void }) {
  const setCard = (patch: Partial<WeeklyAvailabilityTrigger['card']>) => onChange({ ...trigger, card: { ...trigger.card, ...patch } });
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3" data-slot="weekly-availability-card">
      <div>
        <p className="text-xs font-medium">1 通目: 空き状況のカード（自動で作られます）</p>
        <p className="text-[11px] text-muted-foreground">日付 × 時間帯の 〇△✕ の表・凡例・「配信時点の空き状況です」の注意書き・予約フォームを開くボタンは自動で入ります。見出し・案内文・ボタンの文言を変更できます。文中の {'{店名}'} {'{期間}'} は実際の内容に置き換わります。</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="weekly_card_title" className="text-xs">見出し</Label>
        <Input id="weekly_card_title" value={trigger.card.title} maxLength={WEEKLY_TITLE_MAX} placeholder={WEEKLY_DEFAULT_CARD.title} onChange={(e) => setCard({ title: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="weekly_card_text" className="text-xs">案内文</Label>
        <textarea id="weekly_card_text" rows={3} value={trigger.card.text} maxLength={WEEKLY_TEXT_MAX} placeholder={WEEKLY_DEFAULT_CARD.text} onChange={(e) => setCard({ text: e.target.value })} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="weekly_card_button" className="text-xs">ボタンの文言</Label>
        <Input id="weekly_card_button" value={trigger.card.button_label} maxLength={WEEKLY_BUTTON_MAX} placeholder={WEEKLY_DEFAULT_CARD.button_label} onChange={(e) => setCard({ button_label: e.target.value })} className="max-w-xs" />
      </div>
      <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => setCard({ ...WEEKLY_DEFAULT_CARD })}>文言を既定に戻す</button>
    </div>
  );
}

/** きっかけごとの入力欄 */
function TriggerFields({ trigger, onChange, tags, forms, staff, automationTime }: { trigger: AutomationTrigger; onChange: (t: AutomationTrigger) => void; tags: string[]; forms: Array<{ id: string; name: string }>; staff: Array<{ id: string; name: string }>; automationTime: string }) {
  switch (trigger.type) {
    case 'dormant':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">最終来店から <NumberInput value={trigger.days} min={14} max={730} suffix="日たったら送る" onChange={(days) => onChange({ type: 'dormant', days })} /></div>
          <p className="text-[11px] text-muted-foreground">その日数に達してから {AUTOMATION_WINDOW_DAYS} 日以内のお客様が対象です。すでに長く来店の無いお客様には送りません（そちらは「新しい配信」で「最終来店 ◯日以上前」を使ってください）。再来店して、また同じ日数が空いたら改めて送ります。</p>
        </div>
      );
    case 'birthday':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">誕生月の <NumberInput value={trigger.day} min={1} max={28} suffix="日に送る" onChange={(day) => onChange({ type: 'birthday', day })} /></div>
          <p className="text-[11px] text-muted-foreground">顧客情報に誕生日が登録されているお客様に、毎年 1 回送ります。月の途中で ON にした場合、その月が誕生月のお客様にも送ります。</p>
        </div>
      );
    case 'first_visit_after':
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">初めての来店から <NumberInput value={trigger.days} min={1} max={365} suffix="日後に送る" onChange={(days) => onChange({ type: 'first_visit_after', days })} /></div>
          <p className="text-[11px] text-muted-foreground">1 人 1 回だけ送ります。予約ごとに送る「フォローメッセージ」を使っている店舗では、内容が重ならないようにしてください。</p>
        </div>
      );
    case 'visits_reached': {
      const text = trigger.counts.join(', ');
      return (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            来店回数が
            <Input
              defaultValue={text}
              key={text}
              onBlur={(e) => {
                const counts = [...new Set(e.target.value.split(/[,、\s]+/).map((v) => Math.floor(Number(v))).filter((n) => Number.isFinite(n) && n >= 1 && n <= 1000))].sort((a, b) => a - b).slice(0, 10);
                onChange({ type: 'visits_reached', counts: counts.length > 0 ? counts : [5] });
              }}
              placeholder="5, 10"
              className="h-8 w-32 text-xs"
            />
            回目になった翌日に送る
          </div>
          <p className="text-[11px] text-muted-foreground">カンマ区切りで複数指定できます（例: 5, 10）。回数ごとに 1 回ずつ送ります。</p>
        </div>
      );
    }
    case 'tag_added':
      return (
        <div className="space-y-1">
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">この店舗にはまだタグがありません（顧客管理・アンケート・予約フォームの選択肢で付けられます）</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Chip key={t} active={trigger.tags.includes(t)} onClick={() => onChange({ type: 'tag_added', tags: trigger.tags.includes(t) ? trigger.tags.filter((x) => x !== t) : [...trigger.tags, t] })}>{t}</Chip>
              ))}
            </div>
          )}
          <p className="text-[11px] text-amber-700">選んだタグのどれかが付いているお客様に、タグごとに 1 回送ります。ON にした時点ですでにタグが付いているお客様にも送られるので、下の人数を確認してください。</p>
        </div>
      );
    case 'reservation_cancelled':
      return <CancelOpeningFields trigger={trigger} onChange={onChange} />;
    case 'weekly_availability':
      return <WeeklyAvailabilityFields trigger={trigger} onChange={onChange} forms={forms} staff={staff} automationTime={automationTime} />;
    default:
      return null;
  }
}

export default function BroadcastAutomationPanel({ storeId, options, messages, stickers, automationTime }: Props) {
  const { toast } = useToast();
  const base = `/api/stores/${encodeURIComponent(storeId)}/broadcast-automations`;
  const [rules, setRules] = useState<BroadcastAutomation[]>([]);
  const [recent, setRecent] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<BroadcastAutomation | null>(null);
  const [runConfirm, setRunConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  // 編集ダイアログ
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [trigger, setTrigger] = useState<AutomationTrigger>({ type: 'dormant', days: 90 });
  const [audience, setAudience] = useState<BroadcastAudience>({});
  const [items, setItems] = useState<BroadcastItem[]>([]);
  const [itemJson, setItemJson] = useState<ItemJsonState>({});
  const [resend, setResend] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; sample: string[]; availability?: AvailabilitySummary | null; availability_error?: string | null; staff?: Array<{ id: string; name: string }> } | null>(null);
  const [audienceKey, setAudienceKey] = useState(0);
  const uploadId = useRef('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: 'include', cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '自動配信の取得に失敗しました');
      setRules(Array.isArray(json.automations) ? json.automations : []);
      setRecent(json.recent_sends ?? {});
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '自動配信の取得に失敗しました', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [base, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (rule: BroadcastAutomation | null, template?: (typeof AUTOMATION_TEMPLATES)[number]) => {
    setEditingId(rule?.id ?? null);
    setName(rule?.name ?? template?.label ?? '');
    setEnabled(rule?.enabled ?? false);
    setTrigger(rule?.trigger ?? template?.trigger ?? { type: 'dormant', days: 90 });
    setAudience(rule?.audience ?? template?.audience ?? {});
    const nextItems = rule?.items ?? [];
    setItems(nextItems);
    const js: ItemJsonState = {};
    for (const it of nextItems) if (it.type === 'flex') js[it.key] = { text: it.contents ? JSON.stringify(it.contents, null, 2) : '', error: null };
    setItemJson(js);
    setResend(rule ? (rule.resend_after_days ? String(rule.resend_after_days) : '') : template?.resend_after_days ? String(template.resend_after_days) : '');
    setPreview(null);
    setAudienceKey((k) => k + 1);
    uploadId.current = rule?.id?.replace(/-/g, '').slice(0, 12) || newUploadId();
    setOpen(true);
  };

  // 次の実行で送られる人数（内容が変わるたびに少し待ってから計算）
  // （「1 週間の空き状況」はカレンダーを読みに行くので、カードの文言を変えただけでは取り直さない）
  const previewKey = JSON.stringify({ trigger: trigger.type === 'weekly_availability' ? { ...trigger, card: undefined } : trigger, audience: normalizeAudience(audience), resend });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const body = { ...JSON.parse(previewKey), resend_after_days: resend ? Number(resend) : null, preview: true, id: editingId ?? undefined, name: 'preview' };
        const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
        const json = await res.json().catch(() => null);
        if (!cancelled && res.ok && json) setPreview({ count: json.count ?? 0, sample: Array.isArray(json.sample) ? json.sample : [], availability: json.availability ?? null, availability_error: json.availability_error ?? null, staff: Array.isArray(json.staff) ? json.staff : [] });
      } catch {
        /* 見積りは補助 */
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, base, previewKey, resend, editingId]);

  // カードが自動で付くきっかけ（追加メッセージは任意）
  const isCancelOpening = trigger.type === 'reservation_cancelled' || trigger.type === 'weekly_availability';
  const isWeekly = trigger.type === 'weekly_availability';
  const availability = preview?.availability ?? null;
  // 「空きが出ました」カード（プレビュー用の例の日時）を 1 通目に置く
  const previewItems = useMemo<BroadcastItem[]>(() => {
    if (trigger.type === 'weekly_availability') {
      // 実際の空き状況（取得できたとき）。フォーム未選択・取得できないときは例の表
      const summary = availability ?? sampleAvailabilitySummary(weeklyAvailabilityDates(trigger, PREVIEW_NOW));
      const staffName = trigger.staff_id ? (preview?.staff ?? []).find((s) => s.id === trigger.staff_id)?.name ?? null : null;
      const card = buildWeeklyAvailabilityFlex(trigger.card, summary, { storeName: '', bookingUrl: 'https://liff.line.me/', staffName });
      return [{ key: 'availability', type: 'flex', alt_text: card.alt_text, contents: card.contents as never }, ...items];
    }
    if (trigger.type !== 'reservation_cancelled') return items;
    const card = buildCancelOpeningFlex(trigger.card, { storeName: '', date: PREVIEW_SLOT_DATE, time: '14:00', bookingUrl: 'https://liff.line.me/' });
    return [{ key: 'opening', type: 'flex', alt_text: card.alt_text, contents: card.contents as never }, ...items];
  }, [trigger, items, availability, preview?.staff]);

  const previewMessages = useMemo(
    () =>
      broadcastItemsToPreview(previewItems, {
        ref: (id) => {
          const m = messages.find((x) => x.id === id);
          return m ? payloadsToPreview(m.payloads && m.payloads.length > 0 ? m.payloads : m.payload ? [m.payload] : []) : null;
        },
        sticker: (id) => {
          const s = stickers.find((x) => x.id === id);
          return s ? s.preview_url || s.url : null;
        },
      }),
    [previewItems, messages, stickers]
  );

  const changeItemJson = (key: string, text: string) => {
    const setContents = (contents: Record<string, unknown> | null) => setItems((list) => list.map((x) => (x.key === key && x.type === 'flex' ? { ...x, contents } : x)));
    if (!text.trim()) {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'Flex の JSON を入力してください' } }));
      setContents(null);
      return;
    }
    try {
      let parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed && parsed.type === 'flex' && parsed.contents && typeof parsed.contents === 'object') parsed = parsed.contents as Record<string, unknown>;
      const err = validateFlexContents(parsed);
      setItemJson((s) => ({ ...s, [key]: { text, error: err } }));
      setContents(err ? null : parsed);
    } catch {
      setItemJson((s) => ({ ...s, [key]: { text, error: 'JSON として読み取れません（カンマや括弧の抜けを確認してください）' } }));
      setContents(null);
    }
  };

  const uploadImage = async (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('storeId', storeId);
      fd.append('menuId', `automation_${uploadId.current}_${slot}`);
      if (current) fd.append('oldImageUrl', current);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'アップロードに失敗しました');
      apply(json.url);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'アップロードに失敗しました', variant: 'destructive' });
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      toast({ title: '自動配信の名前を入力してください', variant: 'destructive' });
      return;
    }
    if (trigger.type === 'weekly_availability' && trigger.weekdays.length === 0) {
      toast({ title: '送る曜日を 1 つ以上選んでください', variant: 'destructive' });
      return;
    }
    if (trigger.type === 'weekly_availability' && enabled && !trigger.form_id) {
      toast({ title: 'ON にするには、空き状況を載せる予約フォームを選んでください', variant: 'destructive' });
      return;
    }
    if (trigger.type === 'tag_added' && trigger.tags.length === 0) {
      toast({ title: 'タグを 1 つ以上選んでください', variant: 'destructive' });
      return;
    }
    const jsonError = Object.entries(itemJson).find(([key, s]) => s.error && items.some((x) => x.key === key))?.[1].error;
    if (isCancelOpening && items.length > BROADCAST_ITEMS_MAX - 1) {
      toast({ title: `追加のメッセージは ${BROADCAST_ITEMS_MAX - 1} 通までです（カードと合わせて ${BROADCAST_ITEMS_MAX} 通）`, variant: 'destructive' });
      return;
    }
    const itemsError = jsonError ?? validateBroadcastItems(items, { requireContent: enabled && !isCancelOpening });
    if (itemsError) {
      toast({ title: enabled && items.length === 0 && !isCancelOpening ? 'ON にするには、送るメッセージを 1 つ以上追加してください' : itemsError, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const body: BroadcastAutomationInput = { name, enabled, trigger, audience: normalizeAudience(audience), items, resend_after_days: resend ? Number(resend) : null };
      const res = await fetch(editingId ? `${base}/${editingId}` : base, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '保存に失敗しました');
      toast({ title: enabled ? '保存しました（ON）' : '保存しました（OFF のままです）' });
      setOpen(false);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '保存に失敗しました', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rule: BroadcastAutomation) => {
    try {
      const body: BroadcastAutomationInput = { name: rule.name, enabled: !rule.enabled, trigger: rule.trigger, audience: rule.audience, items: rule.items, resend_after_days: rule.resend_after_days };
      const res = await fetch(`${base}/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '切り替えに失敗しました');
      toast({ title: rule.enabled ? 'OFF にしました' : 'ON にしました' });
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '切り替えに失敗しました', variant: 'destructive' });
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`${base}/${deleting.id}`, { method: 'DELETE', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '削除に失敗しました');
      toast({ title: '削除しました' });
      setDeleting(null);
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '削除に失敗しました', variant: 'destructive' });
    }
  };

  // 実行時刻を待たずに、今日の判定をいま行う（1 日 1 回の制限はそのまま）
  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch(`${base}/run`, { method: 'POST', credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '実行に失敗しました');
      const skipped = Array.isArray(json.skipped) ? json.skipped.length : 0;
      toast({
        title: json.checked === 0 ? '今日の判定はすでに済んでいます（ON のルールが無い場合もこの表示です）' : json.created > 0 ? `${json.recipients} 人への送信を開始しました` : '今日送る相手はいませんでした',
        description: skipped > 0 ? `見送り ${skipped} 件（配信一覧で理由を確認できます）` : undefined,
      });
      load();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : '実行に失敗しました', variant: 'destructive' });
    } finally {
      setRunning(false);
      setRunConfirm(false);
    }
  };

  const formName = (id: string) => options.forms.find((f) => f.id === id)?.name ?? id;
  const hasEnabled = rules.some((r) => r.enabled);

  return (
    <div className="space-y-3" data-slot="broadcast-automations">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">自動配信</h3>
            <p className="text-xs text-muted-foreground">
              条件に当てはまったお客様へ、毎日 {automationTime} ごろに自動で送ります（時刻は「設定」で変更できます）。作っただけでは送られず、ON にしたルールだけが動きます。
              「予約フォームでキャンセルが出た時」だけは、キャンセルが出たその場で送ります。
              送った分は配信一覧に「【自動】…」として並び、今月の配信通数に数えます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">テンプレートから作る:</span>
            {AUTOMATION_TEMPLATES.map((t) => (
              <Button key={t.id} type="button" size="sm" variant="outline" className="h-7 text-xs" title={t.description} onClick={() => openEditor(null, t)}>＋ {t.label}</Button>
            ))}
          </div>
          {hasEnabled && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => setRunConfirm(true)}>{running ? '実行中…' : '今日の判定を今すぐ実行'}</Button>
              <span className="text-[11px] text-muted-foreground">{automationTime} を待たずに、ON のルールを今すぐ判定して送ります（判定は 1 日 1 回。今日すでに済んでいれば何も起きません）</span>
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>
      ) : rules.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">自動配信のルールはまだありません。上のテンプレートから作ってください。</CardContent></Card>
      ) : (
        rules.map((r) => (
          <Card key={r.id} data-slot="list-item" className={r.enabled ? '' : 'opacity-80'}>
            <CardContent className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  <Badge variant="outline" className={r.enabled ? 'border-green-300 bg-green-50 text-green-700' : 'text-muted-foreground'} data-slot="status-chip">{r.enabled ? 'ON' : 'OFF'}</Badge>
                </div>
                {r.trigger.type === 'weekly_availability' && <p className="text-xs text-muted-foreground">予約フォーム: {r.trigger.form_id ? formName(r.trigger.form_id) : '未選択'}</p>}
                <p className="text-xs text-muted-foreground">きっかけ: {describeAutomationTrigger(r.trigger)}{r.resend_after_days ? `（次に送るまで ${r.resend_after_days} 日あける）` : ''}</p>
                {Object.keys(r.audience).length > 0 && <p className="text-xs text-muted-foreground">絞り込み: {describeAudience(r.audience, { formName })}</p>}
                <p className="text-xs text-muted-foreground">内容: {r.trigger.type === 'reservation_cancelled' || r.trigger.type === 'weekly_availability' ? `「${r.trigger.card.title}」カード${r.items.length > 0 ? ` + ${describeBroadcastItems(r.items)}` : ''}` : describeBroadcastItems(r.items)}</p>
                <p className="text-xs tabular-nums">直近 30 日の送信 {recent[r.id] ?? 0} 人{r.last_run_date ? ` ・ 最後の判定 ${r.last_run_date}` : ''}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant={r.enabled ? 'outline' : 'default'} onClick={() => toggle(r)}>{r.enabled ? 'OFF にする' : 'ON にする'}</Button>
                <Button size="sm" variant="outline" onClick={() => openEditor(r)}>編集</Button>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(r)}>削除</Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="flex max-h-[92dvh] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="border-b px-5 pb-3 pt-5">
            <DialogTitle>{editingId ? '自動配信を編集' : '自動配信を作成'}</DialogTitle>
            <DialogDescription>{isWeekly ? '選んだ曜日に、予約フォームの空き状況を自動で送ります。' : isCancelOpening ? '予約のキャンセルで空きが出たら、ほかのお客様へすぐに自動で送ります。' : 'きっかけに当てはまったお客様へ、1 日 1 回の判定で自動的に送ります。'}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
              <div className="min-w-0 space-y-5">
                <div className="space-y-1">
                  <Label htmlFor="automation_name" className="text-xs">名前（管理用） <span className="text-destructive">*</span></Label>
                  <Input id="automation_name" value={name} maxLength={BROADCAST_NAME_MAX - 4} onChange={(e) => setName(e.target.value)} placeholder="例: 休眠のお客様へ" />
                </div>

                <section className="space-y-3 rounded-lg border p-3">
                  <h4 className="text-sm font-medium">① きっかけ</h4>
                  <div className="flex flex-wrap gap-1">
                    {AUTOMATION_TEMPLATES.map((t) => (
                      <Chip key={t.id} active={trigger.type === t.id} onClick={() => { if (trigger.type !== t.id) setTrigger(t.trigger); }}>{t.label}</Chip>
                    ))}
                  </div>
                  <TriggerFields trigger={trigger} onChange={setTrigger} tags={options.tags} forms={options.forms} staff={preview?.staff ?? []} automationTime={automationTime} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    同じお客様に次に送るまで
                    <Input type="number" inputMode="numeric" min={1} value={resend} onChange={(e) => setResend(e.target.value.replace(/[^0-9]/g, ''))} placeholder="—" className="h-8 w-20 text-xs" />
                    日あける
                    <span className="text-[11px] text-muted-foreground">{isWeekly ? '（空 = 送る曜日のたびに全員へ送る。例: 14 と入れると、同じお客様には 2 週間に 1 回まで）' : isCancelOpening ? '（空 = キャンセルのたびに全員へ送る。例: 7 と入れると、同じお客様には 7 日に 1 回まで）' : '（空 = 同じきっかけでは 1 回だけ。短い間隔で何度も届くのを防ぎます）'}</span>
                  </div>
                </section>

                <section className="space-y-3 rounded-lg border p-3">
                  <h4 className="text-sm font-medium">② さらに絞り込む <span className="text-xs font-normal text-muted-foreground">任意</span></h4>
                  <AudienceEditor key={audienceKey} value={audience} onChange={setAudience} options={options} />
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-slot="automation-preview">
                    {preview && isWeekly ? (
                      <>
                        1 回の配信で、最大 <span className="font-semibold tabular-nums">{preview.count} 人</span> に送られます（= {preview.count} 通）
                        <span className="block text-[11px] text-muted-foreground">配信停止・友だちでない・LINE 未連携の方には送りません。</span>
                        {preview.availability ? (
                          <span className="block text-[11px] text-muted-foreground">いまの空きは合計 {preview.availability.totalOpen} 枠です（右のプレビューは、いまの実際の空き状況です）。</span>
                        ) : preview.availability_error ? (
                          <span className="block text-[11px] text-amber-700">{preview.availability_error}（右のプレビューは例です）</span>
                        ) : null}
                      </>
                    ) : preview && isCancelOpening ? (
                      <>
                        キャンセル 1 回につき、最大 <span className="font-semibold tabular-nums">{preview.count} 人</span> に送られます（= {preview.count} 通）
                        <span className="block text-[11px] text-muted-foreground">キャンセルした本人は除きます。配信停止・友だちでない・LINE 未連携の方にも送りません。</span>
                      </>
                    ) : preview ? (
                      <>
                        いま ON にすると、次の判定で <span className="font-semibold tabular-nums">{preview.count} 人</span> に送られます
                        {preview.sample.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">例: {preview.sample.join('、')}{preview.count > preview.sample.length ? ' ほか' : ''}</span>}
                        <span className="block text-[11px] text-muted-foreground">以後は、新しく当てはまったお客様にだけ送ります（配信停止・友だちでない・LINE 未連携の方は除きます）</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">人数を計算しています…</span>
                    )}
                  </div>
                </section>

                <section className="space-y-2 rounded-lg border p-3">
                  <h4 className="text-sm font-medium">③ メッセージ</h4>
                  {trigger.type === 'weekly_availability' && (
                    <>
                      <WeeklyAvailabilityCardEditor trigger={trigger} onChange={setTrigger} />
                      <p className="text-xs text-muted-foreground">カードのあとに続けて送るメッセージ（任意。{BROADCAST_ITEMS_MAX - 1} 通まで）</p>
                    </>
                  )}
                  {trigger.type === 'reservation_cancelled' && (
                    <>
                      <CancelOpeningCardEditor trigger={trigger} onChange={setTrigger} />
                      <p className="text-xs text-muted-foreground">カードのあとに続けて送るメッセージ（任意。{BROADCAST_ITEMS_MAX - 1} 通まで）</p>
                    </>
                  )}
                  <BroadcastItemsEditor items={items} onChange={setItems} messages={messages} stickers={stickers} uploading={uploading} onUpload={uploadImage} jsonState={itemJson} onJsonChange={changeItemJson} />
                </section>

                <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  <span>
                    このルールを ON にする
                    <span className="block text-[11px] text-muted-foreground">{isWeekly ? `ON にすると、選んだ曜日の ${automationTime} ごろに自動的に送られます。月間上限を超えるときは送らずに見送ります（配信一覧に理由が残ります）。` : isCancelOpening ? 'ON にすると、条件に合うキャンセルが出るたびに自動的に送られます。月間上限を超えるときは送らずに見送ります（配信一覧に理由が残ります）。' : `ON にすると、毎日 ${automationTime} ごろの判定で自動的に送られます。月間上限を超える日は送らずに見送ります。`}</span>
                  </span>
                </label>
              </div>
              <div className="space-y-3 self-start lg:sticky lg:top-0">
                <h4 className="text-sm font-medium">プレビュー</h4>
                <FlexPreview contents={null} messages={previewMessages.length > 0 ? previewMessages : undefined} />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
            <Button type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
            <Button type="button" variant="ghost" className="ml-auto" onClick={() => setOpen(false)}>閉じる</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={runConfirm} onOpenChange={(o) => { if (!o) setRunConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>今日の判定を今すぐ実行しますか？</AlertDialogTitle>
            <AlertDialogDescription>ON になっているルールに当てはまるお客様へ、すぐにメッセージが送られます（取り消せません）。今日の分はこれで済み、{automationTime} の自動実行では送られません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={runNow}>実行する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{deleting?.name}」を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>このルールの送信記録も消えます（同じルールを作り直すと、同じお客様にもう一度送られることがあります）。すでに送った配信の記録は残ります。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">削除する</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
