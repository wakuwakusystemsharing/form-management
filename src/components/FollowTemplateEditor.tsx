'use client';

import type { FollowTemplate } from '@/types/store';
import {
  FOLLOW_DEFAULT_BODY,
  FOLLOW_DEFAULT_FOOTER,
  FOLLOW_DEFAULT_HEADER_TITLE,
  resolveFollowContent,
  sampleFollowContext,
} from '@/lib/follow-template';
import MessageTemplateEditor from '@/components/MessageTemplateEditor';

interface FollowTemplateEditorProps {
  storeName: string;
  value: FollowTemplate | null | undefined;
  onChange: (next: FollowTemplate) => void;
}

// 店舗情報編集ダイアログ内: LINE フォローメッセージ文面のカスタマイズ + プレビュー
export default function FollowTemplateEditor({ storeName, value, onChange }: FollowTemplateEditorProps) {
  return (
    <MessageTemplateEditor
      title="フォロー文面のカスタマイズ"
      defaults={{
        headerTitle: FOLLOW_DEFAULT_HEADER_TITLE,
        bodyText: FOLLOW_DEFAULT_BODY,
        footerText: FOLLOW_DEFAULT_FOOTER,
      }}
      bodyExample={'{LINE名}様\n\n先日はご来店いただきありがとうございました。\nその後の調子はいかがでしょうか？\n\n次回のご予約はこちらからどうぞ。\nまたお会いできるのを楽しみにしております☺️'}
      sampleContext={sampleFollowContext(storeName)}
      resolve={resolveFollowContent}
      previewNote="詳細ブロックには前回のご予約内容が入ります。"
      value={value}
      onChange={onChange}
    />
  );
}
