'use client';

import React from 'react';
import type { OptionExtraMessage } from '@/types/form';
import { EXTRA_MESSAGE_MAX_LENGTH, LIFF_MAX_MESSAGES, resolveExtraMessage } from '@/lib/extra-messages';

interface OptionExtraMessageEditorProps {
  /** 対象の選択肢 / メニューの表示名（説明文に使う） */
  targetLabel: string;
  value: OptionExtraMessage | undefined;
  onChange: (next: OptionExtraMessage | undefined) => void;
  idPrefix: string;
  theme?: 'light' | 'dark';
}

/** 「設定」ボタンの表示用: 追加メッセージが有効なら「設定(1)」のように件数を付ける */
export function optionSettingsButtonLabel(value: OptionExtraMessage | undefined, extraCount = 0): string {
  const n = (resolveExtraMessage(value) ? 1 : 0) + extraCount;
  return n > 0 ? `設定(${n})` : '設定';
}

/**
 * 選択肢 / メニュー / オプションの「送信時に追加のメッセージを送る」設定。
 * 基本情報の「2 通目のメッセージ」と同じく ON/OFF + 文言。
 * shadcn 系・テーマクラス系どちらの画面でも使えるよう素の要素だけで組む。
 */
export default function OptionExtraMessageEditor({ targetLabel, value, onChange, idPrefix, theme = 'light' }: OptionExtraMessageEditorProps) {
  const enabled = value?.enabled === true;
  const text = typeof value?.text === 'string' ? value.text : '';
  const dark = theme === 'dark';
  const update = (next: OptionExtraMessage) => {
    // OFF かつ空文言なら設定自体を消す（保存データを増やさない）
    if (!next.enabled && !next.text) onChange(undefined);
    else onChange(next);
  };

  return (
    <div className={`rounded-md border p-3 space-y-2 ${dark ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor={`${idPrefix}-enabled`} className={`block text-sm font-medium ${dark ? 'text-gray-100' : 'text-gray-900'}`}>
            送信時に追加のメッセージを送る
          </label>
          <p className={`text-xs mt-0.5 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            「{targetLabel}」が選ばれた状態で送信されたとき、送信内容に続けてこのテキストを LINE トークに送ります。
            本文・2 通目のメッセージと合わせて 1 回の送信で最大 {LIFF_MAX_MESSAGES} 通までです。
          </p>
        </div>
        <button
          id={`${idPrefix}-enabled`}
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => update({ enabled: !enabled, text })}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${enabled ? 'bg-green-500' : dark ? 'bg-gray-600' : 'bg-gray-300'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
      <textarea
        id={`${idPrefix}-text`}
        value={text}
        disabled={!enabled}
        maxLength={EXTRA_MESSAGE_MAX_LENGTH}
        rows={3}
        onChange={(e) => update({ enabled, text: e.target.value })}
        placeholder="例: ご予約ありがとうございます。駐車場は店舗裏の 3 番をご利用ください。"
        className={`w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50 ${dark ? 'border-gray-600 bg-gray-800 text-gray-100 placeholder:text-gray-500' : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'}`}
      />
      <div className={`text-right text-xs ${dark ? 'text-gray-500' : 'text-gray-400'}`}>{text.length} / {EXTRA_MESSAGE_MAX_LENGTH}</div>
    </div>
  );
}
