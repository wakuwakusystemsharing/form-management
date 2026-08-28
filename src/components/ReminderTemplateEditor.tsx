'use client';

import { useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import type { ReminderTemplate } from '@/types/store';
import {
  REMINDER_PLACEHOLDERS,
  REMINDER_DEFAULT_HEADER_COLOR,
  REMINDER_DEFAULT_TEXT_COLOR,
  REMINDER_DEFAULT_FOOTER,
  defaultBodyLabel,
  defaultHeaderTitle,
  resolveReminderContent,
  sampleReminderContext,
} from '@/lib/reminder-template';

interface ReminderTemplateEditorProps {
  storeName: string;
  daysBefore: number;
  value: ReminderTemplate | null | undefined;
  onChange: (next: ReminderTemplate) => void;
}

// 店舗情報編集ダイアログ内: LINE リマインダー文面のカスタマイズ + プレビュー
export default function ReminderTemplateEditor({ storeName, daysBefore, value, onChange }: ReminderTemplateEditorProps) {
  const t: ReminderTemplate = value || {};
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const patch = (p: Partial<ReminderTemplate>) => onChange({ ...t, ...p });

  const insertPlaceholder = (key: string) => {
    const ta = bodyRef.current;
    const current = t.body_text || '';
    if (!ta) { patch({ body_text: current + key }); return; }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    patch({ body_text: current.slice(0, start) + key + current.slice(end) });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + key.length, start + key.length); });
  };

  const ctx = sampleReminderContext(storeName, daysBefore);
  const preview = resolveReminderContent(t, ctx);
  const isCustomized = !!((t.header_title || '').trim() || (t.body_text || '').trim() || (t.footer_text || '').trim()
    || (t.header_color && t.header_color !== REMINDER_DEFAULT_HEADER_COLOR) || (t.text_color && t.text_color !== REMINDER_DEFAULT_TEXT_COLOR)
    || t.show_details === false || t.show_footer === false);

  return (
    <div className="space-y-4 rounded-md border p-3 bg-muted/20">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <Label>リマインダー文面のカスタマイズ</Label>
          <p className="text-xs text-muted-foreground">空欄の項目はデフォルトの文面で送信されます。</p>
        </div>
        {isCustomized && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({})}>デフォルトに戻す</Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 編集 */}
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">ヘッダーのタイトル</Label>
            <Input value={t.header_title || ''} onChange={(e) => patch({ header_title: e.target.value })} placeholder={defaultHeaderTitle(daysBefore)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">ヘッダーの色</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={t.header_color || REMINDER_DEFAULT_HEADER_COLOR} onChange={(e) => patch({ header_color: e.target.value })} className="h-8 w-10 p-0 border rounded cursor-pointer" />
                <Input value={t.header_color || ''} onChange={(e) => patch({ header_color: e.target.value })} placeholder={REMINDER_DEFAULT_HEADER_COLOR} className="font-mono text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">本文の文字色</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={t.text_color || REMINDER_DEFAULT_TEXT_COLOR} onChange={(e) => patch({ text_color: e.target.value })} className="h-8 w-10 p-0 border rounded cursor-pointer" />
                <Input value={t.text_color || ''} onChange={(e) => patch({ text_color: e.target.value })} placeholder={REMINDER_DEFAULT_TEXT_COLOR} className="font-mono text-xs" />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">本文</Label>
            <Textarea
              ref={bodyRef}
              rows={7}
              value={t.body_text || ''}
              onChange={(e) => patch({ body_text: e.target.value })}
              placeholder={`${defaultBodyLabel(daysBefore)}\n\n例:\n{LINE名}様\n\n明日はご予約日となっております。\nご来店を楽しみにお待ちしております☺️\n\n予約日時: {予約日時}\nメニュー: {メニュー名}\n\n明日はお気をつけてお越しください！`}
              className="text-sm"
            />
            <div className="flex flex-wrap gap-1">
              {REMINDER_PLACEHOLDERS.map((p) => (
                <button key={p.key} type="button" title={p.label} onClick={() => insertPlaceholder(p.key)} className="text-[11px] px-2 py-0.5 rounded border bg-background hover:bg-muted">
                  {p.key}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">ボタンで差し込み項目を挿入できます（カーソル位置に入ります）。改行はそのまま反映されます。</p>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={t.show_details !== false} onChange={(e) => patch({ show_details: e.target.checked })} className="h-4 w-4" />
            日時・メニュー・担当・お名前の詳細ブロックを表示する
          </label>
          <div className="space-y-1">
            <Label className="text-xs">末尾の一言</Label>
            <Input value={t.footer_text || ''} onChange={(e) => patch({ footer_text: e.target.value })} placeholder={REMINDER_DEFAULT_FOOTER} disabled={t.show_footer === false} />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={t.show_footer !== false} onChange={(e) => patch({ show_footer: e.target.checked })} className="h-4 w-4" />
              末尾の一言を表示する
            </label>
          </div>
        </div>

        {/* プレビュー */}
        <div className="space-y-1">
          <Label className="text-xs">プレビュー（サンプルの予約で表示）</Label>
          <div className="rounded-xl overflow-hidden border shadow-sm bg-white max-w-[340px] text-[13px]">
            <div className="p-4" style={{ backgroundColor: preview.headerColor }}>
              <p className="text-[11px]" style={{ color: '#ffffff99' }}>{ctx.storeName}</p>
              <p className="text-lg font-bold text-white leading-snug">{preview.headerTitle}</p>
            </div>
            <div className="p-4 space-y-3" style={{ color: preview.textColor }}>
              <p className={`whitespace-pre-wrap leading-relaxed ${preview.isCustomBody ? '' : 'text-center font-bold text-base'}`}>{preview.bodyText}</p>
              {preview.showDetails && (
                <>
                  <hr className="border-gray-300" />
                  <div className="space-y-2">
                    <div><p className="text-xs font-bold text-gray-500">📅 日時</p><p>{ctx.dateText}</p></div>
                    <div><p className="text-xs font-bold text-gray-500">📝 メニュー</p><p>{ctx.menuText}</p></div>
                    {ctx.staffName && <div><p className="text-xs font-bold text-gray-500">👤 担当</p><p>{ctx.staffName}</p></div>}
                    <div><p className="text-xs font-bold text-gray-500">👤 お名前</p><p>{ctx.customerName}様</p></div>
                  </div>
                </>
              )}
              {preview.showFooter && (
                <>
                  <hr className="border-gray-300" />
                  <p className="text-center whitespace-pre-wrap" style={{ color: '#474646' }}>{preview.footerText}</p>
                </>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">実際の LINE では画面幅に合わせて表示されます。サンプル: LINE名「はなこ」/ お名前「山田 花子」</p>
        </div>
      </div>
    </div>
  );
}
