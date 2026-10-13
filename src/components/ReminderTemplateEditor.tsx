'use client';

import type { ReminderTemplate } from '@/types/store';
import {
  REMINDER_DEFAULT_FOOTER,
  defaultBodyLabel,
  defaultHeaderTitle,
  resolveReminderContent,
  sampleReminderContext,
} from '@/lib/reminder-template';
import MessageTemplateEditor from '@/components/MessageTemplateEditor';

interface ReminderTemplateEditorProps {
  storeName: string;
  daysBefore: number;
  /** 直前リマインダーだけ ON のときのプレビュー用（何分前）。指定があれば既定文言は直前用になる */
  beforeMinutes?: number;
  value: ReminderTemplate | null | undefined;
  onChange: (next: ReminderTemplate) => void;
}

// 店舗情報編集ダイアログ内: LINE リマインダー文面のカスタマイズ + プレビュー
export default function ReminderTemplateEditor({ storeName, daysBefore, beforeMinutes, value, onChange }: ReminderTemplateEditorProps) {
  return (
    <MessageTemplateEditor
      title="リマインダー文面のカスタマイズ"
      defaults={{
        headerTitle: defaultHeaderTitle(daysBefore, beforeMinutes),
        bodyText: defaultBodyLabel(daysBefore, beforeMinutes),
        footerText: REMINDER_DEFAULT_FOOTER,
      }}
      bodyExample={'{LINE名}様\n\n明日はご予約日となっております。\nご来店を楽しみにお待ちしております☺️\n\n予約日時: {予約日時}\nメニュー: {メニュー名}\n\n明日はお気をつけてお越しください！'}
      sampleContext={{ ...sampleReminderContext(storeName, daysBefore), beforeMinutes }}
      resolve={resolveReminderContent}
      value={value}
      onChange={onChange}
    />
  );
}
