'use client';

// 予約フォーム メニュー構成: カテゴリーごとの「テキスト・画像」ブロックの編集
// メニュー欄 / カテゴリー共通オプション欄それぞれの一覧の下に出す。
// 詳細設定の「画像orテキスト設置」と同じ中身（テキストか画像）で、表示位置だけを
// 「一覧の一番上 / 一番下 / 特定の項目のすぐ下」から選ぶ。保存先は MenuCategory.content_blocks

import React, { useState } from 'react';
import type { MenuCategory } from '@/types/form';
import { getThemeClasses, ThemeType } from '../FormEditorTheme';
import { ColoredTextToolbar } from '@/components/FormEditor/Survey/SurveyContentBlockEditor';
import { renderColoredTextHtml } from '@/lib/colored-text';
import {
  CATEGORY_BLOCK_TEXT_MAX,
  categoryBlockPositionKey,
  categoryBlockPositionOptions,
  createCategoryContentBlock,
  parseCategoryBlockPositionKey,
  sanitizeCategoryContentBlocks,
  type CategoryBlockTarget,
  type CategoryContentBlock,
} from '@/lib/category-content-blocks';

interface Props {
  category: MenuCategory;
  target: CategoryBlockTarget;
  storeId: string;
  theme: ThemeType;
  onChange: (blocks: CategoryContentBlock[]) => void;
}

export default function CategoryContentBlocksEditor({ category, target, storeId, theme, onChange }: Props) {
  const themeClasses = getThemeClasses(theme);
  const textareaRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const all = sanitizeCategoryContentBlocks(category.content_blocks);
  const mine = all.filter((b) => b.target === target);
  const positionOptions = categoryBlockPositionOptions(category, target);
  const noun = target === 'options' ? 'オプション' : 'メニュー';

  const replaceMine = (nextMine: CategoryContentBlock[]) => {
    // 他方の欄（menus / options）のブロックは触らず、自分の欄だけ差し替える（元の並びを保つ）
    const others = all.filter((b) => b.target !== target);
    onChange([...others, ...nextMine]);
  };
  const updateBlock = (id: string, patch: Partial<CategoryContentBlock>) => {
    replaceMine(mine.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };
  const moveBlock = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= mine.length) return;
    const next = [...mine];
    [next[index], next[target]] = [next[target], next[index]];
    replaceMine(next);
  };
  const removeBlock = (id: string) => replaceMine(mine.filter((b) => b.id !== id));
  const addBlock = () => replaceMine([...mine, createCategoryContentBlock(target)]);

  const uploadImage = async (block: CategoryContentBlock, file: File) => {
    setUploadingId(block.id);
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('storeId', storeId);
      formData.append('menuId', block.id);
      if (block.image_url) formData.append('oldImageUrl', block.image_url);
      const res = await fetch('/api/upload/menu-image', { method: 'POST', body: formData, credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`アップロードに失敗しました: ${json.error || ''}`);
        return;
      }
      updateBlock(block.id, { image_url: json.url });
    } catch (e) {
      console.error('Category content block image upload error:', e);
      alert('アップロードに失敗しました');
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <div className="mt-3" data-slot="category-content-blocks">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs ${themeClasses.text.secondary}`}>
          {noun}一覧の上下や、特定の{noun}のすぐ下にテキスト・画像を表示できます（詳細設定の「画像orテキスト設置」と同じ機能）
        </p>
        <button
          type="button"
          onClick={addBlock}
          className={`px-2 py-1 text-xs rounded-md shrink-0 ${themeClasses.button.secondary}`}
        >
          ＋ テキスト・画像を追加
        </button>
      </div>

      {mine.length > 0 && (
        <div className="mt-2 space-y-2">
          {mine.map((block, index) => (
            <div key={block.id} className={`p-3 rounded-md ${themeClasses.highlight}`}>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={block.type}
                  onChange={(e) => updateBlock(block.id, { type: e.target.value as 'text' | 'image' })}
                  className={`${themeClasses.input} text-sm`}
                >
                  <option value="text">テキスト</option>
                  <option value="image">画像</option>
                </select>
                <span className={`text-xs ${themeClasses.text.secondary}`}>表示位置:</span>
                <select
                  value={categoryBlockPositionKey(block)}
                  onChange={(e) => {
                    const parsed = parseCategoryBlockPositionKey(e.target.value);
                    updateBlock(block.id, { position: parsed.position, after_id: parsed.after_id });
                  }}
                  className={`${themeClasses.input} text-sm`}
                >
                  {(positionOptions.some((o) => o.value === categoryBlockPositionKey(block))
                    ? positionOptions
                    : [{ value: categoryBlockPositionKey(block), label: `（削除された${noun}のすぐ下 → 一番下に表示）` }, ...positionOptions]
                  ).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <div className="flex space-x-1 ml-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => moveBlock(index, 'up')}
                    disabled={index === 0}
                    title="上へ"
                    className={`p-1.5 rounded ${index === 0 ? 'opacity-30 cursor-not-allowed' : ''} ${themeClasses.text.secondary} ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlock(index, 'down')}
                    disabled={index === mine.length - 1}
                    title="下へ"
                    className={`p-1.5 rounded ${index === mine.length - 1 ? 'opacity-30 cursor-not-allowed' : ''} ${themeClasses.text.secondary} ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(block.id)}
                    title="削除"
                    className={`p-1.5 rounded text-red-400 hover:text-red-300 ${theme === 'light' ? 'hover:bg-white' : 'hover:bg-gray-700'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>

              {block.type === 'text' ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    ref={(el) => { textareaRefs.current[block.id] = el; }}
                    value={block.text || ''}
                    maxLength={CATEGORY_BLOCK_TEXT_MAX}
                    onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                    placeholder="表示するテキストを入力してください"
                    rows={3}
                    className={`w-full text-sm rounded-md border px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-500 ${
                      theme === 'light'
                        ? 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
                        : 'bg-gray-700 border-gray-600 text-white placeholder-gray-500'
                    }`}
                  />
                  <ColoredTextToolbar
                    getTextarea={() => textareaRefs.current[block.id]}
                    value={block.text || ''}
                    onChange={(next) => updateBlock(block.id, { text: next })}
                  />
                  {(block.text || '').trim() && (
                    <div>
                      <p className={`text-[10px] ${themeClasses.text.tertiary} mb-1`}>フォーム上の表示イメージ:</p>
                      <div
                        className="text-sm rounded border p-3 leading-relaxed"
                        style={{ backgroundColor: '#f7f8fa', color: '#333', borderLeft: '3px solid #f49031' }}
                        dangerouslySetInnerHTML={{ __html: renderColoredTextHtml(block.text || '') }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {block.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={block.image_url} alt="" className="max-h-24 rounded-md border" />
                  ) : (
                    <span className={`text-xs ${themeClasses.text.tertiary}`}>画像は未設定です</span>
                  )}
                  <label className={`inline-block px-2 py-1 text-xs rounded-md cursor-pointer ${themeClasses.button.secondary}`}>
                    {uploadingId === block.id ? 'アップロード中…' : (block.image_url ? '画像を変更' : '画像をアップロード')}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingId === block.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) uploadImage(block, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {block.image_url && (
                    <button type="button" onClick={() => updateBlock(block.id, { image_url: '' })} className="px-2 py-1 text-xs rounded-md text-red-500 hover:text-red-400">
                      画像を削除
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
