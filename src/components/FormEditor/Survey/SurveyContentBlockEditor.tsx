'use client';

import React, { useRef, useState } from 'react';
import type { SurveyContentBlock } from '@/types/survey';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImagePlus, Trash2 } from 'lucide-react';
import {
  CONTENT_TEXT_COLORS,
  hasColorTags,
  renderColoredTextHtml,
  stripColorTags,
  wrapSelectionWithColor,
} from '@/lib/colored-text';

/**
 * 文字色ツールバー（テキストの選択範囲を [color=#xxxxxx]…[/color] で囲む）
 * 予約フォームの「画像orテキスト設置」と同じ操作感
 */
export function ColoredTextToolbar({
  getTextarea,
  value,
  onChange,
}: {
  /** 対象の textarea を返す（クリック時に呼ぶので描画中に ref を読まない） */
  getTextarea: () => HTMLTextAreaElement | null;
  value: string;
  onChange: (next: string) => void;
}) {
  const apply = (color: string) => {
    const ta = getTextarea();
    if (!ta) return;
    const next = wrapSelectionWithColor(value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0, color);
    if (next === null) {
      alert('色を付けたい部分をテキスト内でドラッグして選択してから、色を選んでください');
      return;
    }
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground mr-1">文字色:</span>
      {CONTENT_TEXT_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => apply(c.hex)}
          className="w-5 h-5 rounded-full hover:scale-110 transition-transform border border-black/10"
          style={{ backgroundColor: c.hex }}
        />
      ))}
      <label
        title="好きな色を選ぶ"
        onMouseDown={(e) => e.preventDefault()}
        className="w-5 h-5 rounded-full cursor-pointer overflow-hidden border border-gray-300"
        style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
      >
        <input type="color" className="opacity-0 w-full h-full cursor-pointer" onChange={(e) => apply(e.target.value)} />
      </label>
      {hasColorTags(value) && (
        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange(stripColorTags(value))}>
          色をすべて解除
        </Button>
      )}
      <span className="text-[10px] text-muted-foreground w-full">色を変えたい部分をテキスト内で選択してから色を押してください</span>
    </div>
  );
}

/** フォーム上の表示イメージ（色タグを反映） */
export function ColoredTextPreview({ text, accentColor = '#c5a059' }: { text: string; accentColor?: string }) {
  if (!text.trim()) return null;
  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-1">フォーム上の表示イメージ:</p>
      <div
        className="text-sm rounded border p-3 leading-relaxed"
        style={{ backgroundColor: '#f7f8fa', borderLeft: `3px solid ${accentColor}`, color: '#333' }}
        dangerouslySetInnerHTML={{ __html: renderColoredTextHtml(text) }}
      />
    </div>
  );
}

interface SurveyContentBlockCardProps {
  block: SurveyContentBlock;
  storeId: string;
  onChange: (patch: Partial<SurveyContentBlock>) => void;
  onDelete: () => void;
}

/** 質問間に置くテキスト / 画像ブロックの編集カード */
export function SurveyContentBlockCard({ block, storeId, onChange, onDelete }: SurveyContentBlockCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('storeId', storeId);
      formData.append('menuId', `survey_block_${block.id}`);
      if (block.image_url) formData.append('oldImageUrl', block.image_url);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: formData, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`アップロードに失敗しました: ${json.error || ''}`);
        return;
      }
      onChange({ image_url: json.url });
    } catch (e) {
      console.error('Survey content block image upload error:', e);
      alert('アップロードに失敗しました');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-amber-400/70 bg-amber-50/40 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-amber-800">🖼️ テキスト/画像表示</span>
        <Select value={block.type} onValueChange={(v) => onChange({ type: v as 'text' | 'image' })}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">テキスト</SelectItem>
            <SelectItem value="image">画像</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 text-destructive" onClick={onDelete} title="削除">
          <Trash2 className="h-4 w-4 mr-1" />削除
        </Button>
      </div>

      {block.type === 'text' ? (
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={block.text || ''}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={4}
            placeholder="表示するテキストを入力（同意書・注意事項など）"
          />
          <ColoredTextToolbar getTextarea={() => textareaRef.current} value={block.text || ''} onChange={(text) => onChange({ text })} />
          <ColoredTextPreview text={block.text || ''} />
        </div>
      ) : (
        <div className="space-y-2">
          {block.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.image_url} alt="設置画像プレビュー" className="max-h-40 rounded-md border bg-white" />
          ) : (
            <p className="text-xs text-muted-foreground">画像が未設定です</p>
          )}
          <label className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border cursor-pointer bg-white hover:bg-muted">
            <ImagePlus className="h-3.5 w-3.5" />
            {uploading ? 'アップロード中…' : block.image_url ? '画像を変更' : '画像をアップロード'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadImage(file);
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-[10px] text-muted-foreground">5MB まで。フォームでは横幅いっぱいに表示されます</p>
        </div>
      )}
    </div>
  );
}

/** 質問と質問の間に出す追加ボタン */
export function AddContentBlockButton({ onClick, label = 'テキスト/画像表示を追加' }: { onClick: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="h-px flex-1 bg-border" />
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs border-dashed" onClick={onClick}>
        ＋ {label}
      </Button>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function createSurveyContentBlock(anchor: string, position: 'above' | 'below'): SurveyContentBlock {
  return { id: `sb_${Math.random().toString(36).slice(2, 9)}`, type: 'text', text: '', image_url: '', anchor, position };
}
