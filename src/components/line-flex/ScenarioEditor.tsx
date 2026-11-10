'use client';

/**
 * 分岐アンケート（かんたんモード）の入力欄: 質問 → 選択肢 → 「選んだら」（次の質問 / 結果 / 保存済みの LINE メッセージ / 何もしない）
 * 上から順に入力するだけで、カード・ボタン・分岐ができる。純粋ロジックは src/lib/line-flex-scenario.ts
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import TagInput from '@/components/customers/TagInput';
import FlexLinkField, { type FlexLinkTarget } from './FlexLinkField';
import {
  describeScenario,
  newScenarioChoice,
  newScenarioQuestion,
  newScenarioResult,
  SCENARIO_CHOICES_MAX,
  SCENARIO_DEPTH_MAX,
  updateScenarioQuestion,
  updateScenarioResult,
  validateScenario,
} from '@/lib/line-flex-scenario';
import type { ScenarioChoice, ScenarioData, ScenarioNext, ScenarioQuestion, ScenarioResult } from '@/types/line-flex';

interface Props {
  storeId: string;
  data: ScenarioData;
  onChange: (data: ScenarioData) => void;
  formUrls: Array<{ name: string; url: string }>;
  targets: FlexLinkTarget[];
  uploading: string | null;
  onUpload: (slot: string, file: File, current: string | undefined, apply: (url: string) => void) => void;
  /** プレビューに出している質問・結果のキー（null = 最初の質問） */
  previewKey: string | null;
  onPreview: (key: string | null) => void;
}

const THEN_OPTIONS: Array<{ value: ScenarioNext['type']; label: string }> = [
  { value: 'question', label: '次の質問を出す' },
  { value: 'result', label: '結果を出す（文章・予約ボタン）' },
  { value: 'message', label: '保存済みの LINE メッセージを送る' },
  { value: 'none', label: '何も返さない（記録とタグ付けだけ）' },
];

function ImageRow({ slot, value, uploading, onUpload, onChange }: { slot: string; value: string | undefined; uploading: string | null; onUpload: Props['onUpload']; onChange: (url: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="h-10 w-14 rounded border object-cover" />
      ) : null}
      <label className="inline-flex cursor-pointer items-center rounded-md border px-2 py-1 hover:bg-muted">
        {uploading === slot ? 'アップロード中…' : value ? '画像を変更' : '＋ 画像（任意）'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploading === slot}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(slot, f, value, onChange);
            e.target.value = '';
          }}
        />
      </label>
      {value && <button type="button" className="text-destructive hover:underline" onClick={() => onChange('')}>画像を削除</button>}
    </div>
  );
}

export default function ScenarioEditor({ storeId, data, onChange, formUrls, targets, uploading, onUpload, previewKey, onPreview }: Props) {
  const [tagsOpen, setTagsOpen] = useState<Record<string, boolean>>({});
  const error = validateScenario(data, new Set(targets.map((t) => t.id)));

  const patchQuestion = (key: string, patch: Partial<ScenarioQuestion>) => onChange(updateScenarioQuestion(data, key, (q) => ({ ...q, ...patch })));
  const patchChoice = (qKey: string, cKey: string, patch: Partial<ScenarioChoice>) =>
    onChange(updateScenarioQuestion(data, qKey, (q) => ({ ...q, choices: q.choices.map((c) => (c.key === cKey ? { ...c, ...patch } : c)) })));
  const patchResult = (key: string, patch: Partial<ScenarioResult>) => onChange(updateScenarioResult(data, key, (r) => ({ ...r, ...patch })));
  const moveChoice = (qKey: string, index: number, dir: -1 | 1) =>
    onChange(
      updateScenarioQuestion(data, qKey, (q) => {
        const to = index + dir;
        if (to < 0 || to >= q.choices.length) return q;
        const next = [...q.choices];
        [next[index], next[to]] = [next[to], next[index]];
        return { ...q, choices: next };
      })
    );
  const changeThen = (qKey: string, choice: ScenarioChoice, type: ScenarioNext['type']) => {
    if (choice.then?.type === type) return;
    const then: ScenarioNext = type === 'question' ? { type, question: newScenarioQuestion() } : type === 'result' ? { type, result: newScenarioResult() } : type === 'message' ? { type, message_id: '' } : { type: 'none' };
    patchChoice(qKey, choice.key, { then });
  };

  const previewButton = (key: string, isRoot: boolean) => (
    <button
      type="button"
      className={`rounded px-1.5 py-0.5 text-[11px] ${(isRoot ? previewKey === null : previewKey === key) ? 'bg-blue-600 text-white' : 'text-blue-700 hover:bg-blue-50'}`}
      onClick={() => onPreview(isRoot ? null : key)}
    >
      {(isRoot ? previewKey === null : previewKey === key) ? 'プレビュー中' : 'プレビューで見る'}
    </button>
  );

  const renderResult = (result: ScenarioResult) => (
    <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-2" data-slot="scenario-result">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">結果</span>
        {previewButton(result.key, false)}
      </div>
      <Input value={result.title} maxLength={60} onChange={(e) => patchResult(result.key, { title: e.target.value })} placeholder="見出し（例: あなたへのおすすめはカットです）" className="h-8 bg-white text-xs" />
      <Textarea value={result.text ?? ''} maxLength={500} rows={2} onChange={(e) => patchResult(result.key, { text: e.target.value })} placeholder="説明（任意）" className="bg-white text-xs" />
      <ImageRow slot={`scn_${result.key}`} value={result.image_url} uploading={uploading} onUpload={onUpload} onChange={(url) => patchResult(result.key, { image_url: url })} />
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">ボタン（任意。予約フォームへの案内など）</p>
        <Input value={result.button?.label ?? ''} maxLength={40} onChange={(e) => patchResult(result.key, { button: { key: result.button?.key ?? 'b1', label: e.target.value, url: result.button?.url ?? '' } })} placeholder="ボタンの文言（例: 予約する）" className="h-8 bg-white text-xs" />
        {(result.button?.label ?? '').trim() !== '' && (
          <FlexLinkField value={result.button?.url ?? ''} onChange={(url) => patchResult(result.key, { button: { key: result.button?.key ?? 'b1', label: result.button?.label ?? '', url } })} formUrls={formUrls} targets={targets} storeId={storeId} />
        )}
      </div>
    </div>
  );

  const renderQuestion = (question: ScenarioQuestion, depth: number): React.ReactNode => {
    const isRoot = depth === 1;
    return (
      <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/30 p-2" data-slot="scenario-question">
        <div className="flex items-center gap-2">
          <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">質問 {depth === 1 ? '（最初）' : `${depth} 段目`}</span>
          {previewButton(question.key, isRoot)}
        </div>
        <Input value={question.title} maxLength={60} onChange={(e) => patchQuestion(question.key, { title: e.target.value })} placeholder="質問文（例: どのメニューに興味がありますか？）" className="h-8 bg-white text-xs" />
        <Textarea value={question.text ?? ''} maxLength={300} rows={2} onChange={(e) => patchQuestion(question.key, { text: e.target.value })} placeholder="補足（任意）" className="bg-white text-xs" />
        <ImageRow slot={`scn_${question.key}`} value={question.image_url} uploading={uploading} onUpload={onUpload} onChange={(url) => patchQuestion(question.key, { image_url: url })} />

        <div className="space-y-2">
          {question.choices.map((choice, i) => {
            const then = choice.then ?? { type: 'none' as const };
            const tagCount = choice.tags?.length ?? 0;
            return (
              <div key={choice.key} className="space-y-2 rounded-md border bg-white p-2" data-slot="scenario-choice">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold">{i + 1}</span>
                  <Input value={choice.label} maxLength={40} onChange={(e) => patchChoice(question.key, choice.key, { label: e.target.value })} placeholder="選択肢（ボタンの文言）" className="h-8 min-w-[8rem] flex-1 text-xs" />
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setTagsOpen((s) => ({ ...s, [choice.key]: !s[choice.key] }))}>
                    タグ{tagCount > 0 ? `(${tagCount})` : ''}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === 0} onClick={() => moveChoice(question.key, i, -1)}>↑</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={i === question.choices.length - 1} onClick={() => moveChoice(question.key, i, 1)}>↓</Button>
                  <button type="button" className="px-1 text-[11px] text-destructive hover:underline disabled:opacity-40" disabled={question.choices.length <= 1} onClick={() => patchQuestion(question.key, { choices: question.choices.filter((c) => c.key !== choice.key) })}>削除</button>
                </div>
                {tagsOpen[choice.key] && (
                  <div className="space-y-0.5 rounded bg-muted/50 p-2">
                    <p className="text-[11px] text-muted-foreground">この選択肢を選んだお客様に付けるタグ（顧客管理・配信の絞り込みに使えます）</p>
                    <TagInput value={choice.tags ?? []} onChange={(tags) => patchChoice(question.key, choice.key, { tags })} storeId={storeId} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">選んだら →</span>
                  <select value={then.type} className="h-8 min-w-[12rem] flex-1 rounded-md border bg-background px-1 text-xs" onChange={(e) => changeThen(question.key, choice, e.target.value as ScenarioNext['type'])}>
                    {THEN_OPTIONS.filter((o) => o.value !== 'question' || depth < SCENARIO_DEPTH_MAX || then.type === 'question').map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {then.type === 'message' &&
                  (targets.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">この店舗に保存済みの LINE メッセージがまだありません。先に送りたいメッセージを作って保存してください。</p>
                  ) : (
                    <select value={then.message_id} className="h-8 w-full rounded-md border bg-background px-1 text-xs" onChange={(e) => patchChoice(question.key, choice.key, { then: { type: 'message', message_id: e.target.value } })}>
                      <option value="">送る LINE メッセージを選ぶ…</option>
                      {then.message_id && !targets.some((t) => t.id === then.message_id) && <option value={then.message_id}>（削除されたメッセージ）</option>}
                      {targets.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  ))}
                {(then.type === 'question' || then.type === 'result') && (
                  <div className="ml-2 border-l-2 border-dashed border-muted-foreground/30 pl-2">
                    {then.type === 'question' ? renderQuestion(then.question, depth + 1) : renderResult(then.result)}
                  </div>
                )}
              </div>
            );
          })}
          {question.choices.length < SCENARIO_CHOICES_MAX && (
            <Button type="button" size="sm" variant="outline" className="h-7 bg-white text-xs" onClick={() => patchQuestion(question.key, { choices: [...question.choices, newScenarioChoice()] })}>
              ＋ 選択肢を追加（{question.choices.length}/{SCENARIO_CHOICES_MAX}）
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3" data-slot="scenario-editor">
      <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
        <p className="font-medium text-foreground">使い方（上から順に入力するだけです）</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>質問文と、選択肢（ボタンの文言）を入れる</li>
          <li>選択肢ごとに「選んだら」何を出すかを選ぶ（次の質問 / 結果 / 保存済みの LINE メッセージ）</li>
          <li>必要なら「タグ」で、その選択肢を選んだお客様に付けるタグを設定する</li>
        </ol>
        <p className="mt-1">お客様がボタンを押すたびに、次のカードが LINE に届きます。誰が何を選んだかは、一覧の「回答の集計」と顧客詳細の LINE タブで見られます。</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-muted px-2 py-0.5">{describeScenario(data)}</span>
        {error ? <span className="text-destructive">{error}</span> : <span className="text-emerald-700">入力に問題はありません</span>}
      </div>
      {renderQuestion(data.root, 1)}
      <div className="flex items-center gap-2">
        <input type="color" value={data.color || '#06C755'} onChange={(e) => onChange({ ...data, color: e.target.value })} className="h-8 w-10 cursor-pointer rounded border" />
        <Input value={data.color || ''} onChange={(e) => onChange({ ...data, color: e.target.value })} placeholder="#06C755" className="h-8 w-28 text-xs" />
        <span className="text-[11px] text-muted-foreground">ボタンの色</span>
      </div>
    </div>
  );
}
