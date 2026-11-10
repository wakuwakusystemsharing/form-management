'use client';

/**
 * 配信先の条件を選ぶ UI（配信の作成ダイアログで使う）
 * 「条件を追加」のチップで種類を足し、種類の違う条件は AND で組み合わせる。何も足さなければ「すべての友だち」
 */
import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BROADCAST_GENDERS, BROADCAST_SEGMENTS } from '@/lib/broadcast-audience';
import type { SurveyChoiceOption } from '@/lib/broadcast-options';
import type { BroadcastAudience } from '@/types/broadcast';

export interface AudienceOptions {
  tags: string[];
  menus: string[];
  forms: Array<{ id: string; name: string }>;
  surveys: SurveyChoiceOption[];
}

type ConditionKey = 'tags' | 'segments' | 'menus' | 'forms' | 'last_visit' | 'visits' | 'upcoming_reservation' | 'gender' | 'birth_month' | 'survey' | 'exclude_tags';

const CONDITIONS: Array<{ key: ConditionKey; label: string; hint: string }> = [
  { key: 'tags', label: 'タグ', hint: '顧客管理で付けたタグ' },
  { key: 'segments', label: 'セグメント', hint: '新規 / リピーター / VIP / 休眠' },
  { key: 'menus', label: '予約したメニュー', hint: 'そのメニューを予約・来店したことがある人' },
  { key: 'forms', label: '予約したフォーム', hint: 'その予約フォームから予約した人' },
  { key: 'last_visit', label: '最終来店', hint: '◯日以上前 / ◯日以内' },
  { key: 'visits', label: '来店回数', hint: '◯回以上 / ◯回以下' },
  { key: 'upcoming_reservation', label: '今後の予約', hint: 'ある / ない' },
  { key: 'gender', label: '性別', hint: '顧客情報の性別' },
  { key: 'birth_month', label: '誕生月', hint: '顧客情報の誕生日' },
  { key: 'survey', label: 'アンケートの回答', hint: '特定の選択肢を選んだ人' },
  { key: 'exclude_tags', label: '除外するタグ', hint: 'このタグの人には送らない' },
];

function activeKeys(a: BroadcastAudience): ConditionKey[] {
  return CONDITIONS.map((c) => c.key).filter((k) => a[k] !== undefined);
}

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
    >
      {children}
    </button>
  );
}

function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function NumberField({ value, onChange, suffix, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; suffix: string; placeholder?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const n = e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value)));
          onChange(n === undefined || Number.isNaN(n) ? undefined : n);
        }}
        className="h-8 w-20 text-xs"
      />
      <span className="text-xs text-muted-foreground">{suffix}</span>
    </span>
  );
}

export default function AudienceEditor({ value, onChange, options, disabled }: { value: BroadcastAudience; onChange: (a: BroadcastAudience) => void; options: AudienceOptions; disabled?: boolean }) {
  // 追加したがまだ値が空の条件も行として出しておく
  const [opened, setOpened] = useState<ConditionKey[]>(() => activeKeys(value));
  const [surveyDraft, setSurveyDraft] = useState<{ form_id: string; question: string }>({ form_id: value.survey?.form_id ?? '', question: value.survey?.question ?? '' });
  const shown = CONDITIONS.filter((c) => opened.includes(c.key) || value[c.key] !== undefined);

  const patch = (p: Partial<BroadcastAudience>) => {
    const next = { ...value, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(next as BroadcastAudience);
  };
  const add = (key: ConditionKey) => {
    setOpened((o) => (o.includes(key) ? o : [...o, key]));
    // 値が 1 つで決まる条件は、足した時点で既定値を入れる
    if (key === 'upcoming_reservation' && value.upcoming_reservation === undefined) patch({ upcoming_reservation: false });
    if (key === 'last_visit' && !value.last_visit) patch({ last_visit: { min_days_ago: 60 } });
    if (key === 'visits' && !value.visits) patch({ visits: { min: 2 } });
  };
  const remove = (key: ConditionKey) => {
    setOpened((o) => o.filter((k) => k !== key));
    patch({ [key]: undefined } as Partial<BroadcastAudience>);
  };

  const tagValues = value.tags?.values ?? [];
  const survey = value.survey;
  // アンケートは「フォーム → 質問 → 選択肢」の順に選ぶので、選択肢を選ぶ前の途中の状態を持つ
  const draftForm = options.surveys.find((s) => s.form_id === (survey?.form_id ?? surveyDraft.form_id));
  const draftQuestion = draftForm?.questions.find((q) => q.title === (survey?.question ?? surveyDraft.question));

  const renderBody = (key: ConditionKey) => {
    switch (key) {
      case 'tags':
        return (
          <div className="space-y-2">
            {options.tags.length === 0 ? (
              <p className="text-xs text-muted-foreground">この店舗にはまだタグがありません（顧客管理・アンケート・予約フォームの選択肢で付けられます）</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {options.tags.map((t) => (
                  <Chip key={t} active={tagValues.includes(t)} disabled={disabled} onClick={() => { const v = toggleIn(tagValues, t); patch({ tags: v.length ? { mode: value.tags?.mode ?? 'any', values: v } : undefined }); }}>{t}</Chip>
                ))}
              </div>
            )}
            {tagValues.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">複数のタグ:</span>
                <Chip active={(value.tags?.mode ?? 'any') === 'any'} disabled={disabled} onClick={() => patch({ tags: { mode: 'any', values: tagValues } })}>いずれかが付いている</Chip>
                <Chip active={value.tags?.mode === 'all'} disabled={disabled} onClick={() => patch({ tags: { mode: 'all', values: tagValues } })}>すべて付いている</Chip>
              </div>
            )}
          </div>
        );
      case 'exclude_tags': {
        const ex = value.exclude_tags ?? [];
        return options.tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">この店舗にはまだタグがありません</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {options.tags.map((t) => (
              <Chip key={t} active={ex.includes(t)} disabled={disabled} onClick={() => { const v = toggleIn(ex, t); patch({ exclude_tags: v.length ? v : undefined }); }}>{t}</Chip>
            ))}
          </div>
        );
      }
      case 'segments': {
        const seg = value.segments ?? [];
        return (
          <div className="flex flex-wrap gap-1">
            {BROADCAST_SEGMENTS.map((s) => (
              <Chip key={s.id} active={seg.includes(s.id)} disabled={disabled} onClick={() => { const v = toggleIn(seg, s.id); patch({ segments: v.length ? v : undefined }); }}>{s.label}</Chip>
            ))}
            <span className="w-full text-[11px] text-muted-foreground">休眠 = 最終来店から 90 日以上 / VIP = 5 万円以上か 10 回以上 / 新規 = 初回来店から 30 日以内 / リピーター = 2 回以上（顧客管理と同じ）</span>
          </div>
        );
      }
      case 'menus': {
        const names = value.menus?.names ?? [];
        return (
          <div className="space-y-2">
            {options.menus.length === 0 ? (
              <p className="text-xs text-muted-foreground">予約フォームにメニューがありません</p>
            ) : (
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {options.menus.map((m) => (
                  <Chip key={m} active={names.includes(m)} disabled={disabled} onClick={() => { const v = toggleIn(names, m); patch({ menus: v.length ? { names: v, within_days: value.menus?.within_days } : undefined }); }}>{m}</Chip>
                ))}
              </div>
            )}
            {names.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">期間:</span>
                <Chip active={!value.menus?.within_days} disabled={disabled} onClick={() => patch({ menus: { names } })}>すべての期間</Chip>
                {[30, 90, 180, 365].map((d) => (
                  <Chip key={d} active={value.menus?.within_days === d} disabled={disabled} onClick={() => patch({ menus: { names, within_days: d } })}>直近 {d} 日</Chip>
                ))}
              </div>
            )}
          </div>
        );
      }
      case 'forms': {
        const ids = value.forms ?? [];
        return options.forms.length === 0 ? (
          <p className="text-xs text-muted-foreground">予約フォームがありません</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {options.forms.map((f) => (
              <Chip key={f.id} active={ids.includes(f.id)} disabled={disabled} onClick={() => { const v = toggleIn(ids, f.id); patch({ forms: v.length ? v : undefined }); }}>{f.name}</Chip>
            ))}
          </div>
        );
      }
      case 'last_visit': {
        const lv = value.last_visit ?? {};
        const set = (p: { min_days_ago?: number; max_days_ago?: number }) => {
          const next = { ...lv, ...p };
          patch({ last_visit: next.min_days_ago === undefined && next.max_days_ago === undefined ? undefined : next });
        };
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <NumberField value={lv.min_days_ago} onChange={(v) => set({ min_days_ago: v })} suffix="日以上前" placeholder="60" />
            <NumberField value={lv.max_days_ago} onChange={(v) => set({ max_days_ago: v })} suffix="日以内" placeholder="—" />
            <span className="text-[11px] text-muted-foreground">片方だけでも可。来店の記録が無い人は対象外</span>
          </div>
        );
      }
      case 'visits': {
        const vs = value.visits ?? {};
        const set = (p: { min?: number; max?: number }) => {
          const next = { ...vs, ...p };
          patch({ visits: next.min === undefined && next.max === undefined ? undefined : next });
        };
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <NumberField value={vs.min} onChange={(v) => set({ min: v })} suffix="回以上" placeholder="2" />
            <NumberField value={vs.max} onChange={(v) => set({ max: v })} suffix="回以下" placeholder="—" />
          </div>
        );
      }
      case 'upcoming_reservation':
        return (
          <div className="flex flex-wrap gap-1">
            <Chip active={value.upcoming_reservation === false} disabled={disabled} onClick={() => patch({ upcoming_reservation: false })}>今後の予約がない人</Chip>
            <Chip active={value.upcoming_reservation === true} disabled={disabled} onClick={() => patch({ upcoming_reservation: true })}>今後の予約がある人</Chip>
          </div>
        );
      case 'gender': {
        const g = value.gender ?? [];
        return (
          <div className="flex flex-wrap gap-1">
            {BROADCAST_GENDERS.map((x) => (
              <Chip key={x.id} active={g.includes(x.id)} disabled={disabled} onClick={() => { const v = toggleIn(g, x.id); patch({ gender: v.length ? v : undefined }); }}>{x.label}</Chip>
            ))}
            <span className="w-full text-[11px] text-muted-foreground">顧客情報に性別が登録されている人だけが対象です</span>
          </div>
        );
      }
      case 'birth_month': {
        const months = value.birth_month ?? [];
        return (
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <Chip key={m} active={months.includes(m)} disabled={disabled} onClick={() => { const v = toggleIn(months, m).sort((a, b) => a - b); patch({ birth_month: v.length ? v : undefined }); }}>{m}月</Chip>
            ))}
            <span className="w-full text-[11px] text-muted-foreground">顧客情報に誕生日が登録されている人だけが対象です</span>
          </div>
        );
      }
      case 'survey':
        return options.surveys.length === 0 ? (
          <p className="text-xs text-muted-foreground">選択式の質問があるアンケートがありません</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={survey?.form_id ?? ''}
                disabled={disabled}
                onValueChange={(formId) => {
                  const f = options.surveys.find((s) => s.form_id === formId);
                  setSurveyDraft({ form_id: formId, question: f?.questions[0]?.title ?? '' });
                  patch({ survey: undefined });
                }}
              >
                <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder={surveyDraft.form_id ? options.surveys.find((s) => s.form_id === surveyDraft.form_id)?.form_name : 'アンケートを選ぶ'} /></SelectTrigger>
                <SelectContent>
                  {options.surveys.map((s) => (
                    <SelectItem key={s.form_id} value={s.form_id} className="text-xs">{s.form_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draftForm && (
                <Select value={draftQuestion?.title ?? ''} disabled={disabled} onValueChange={(q) => { setSurveyDraft({ form_id: draftForm.form_id, question: q }); patch({ survey: undefined }); }}>
                  <SelectTrigger className="h-8 w-64 text-xs"><SelectValue placeholder="質問を選ぶ" /></SelectTrigger>
                  <SelectContent>
                    {draftForm.questions.map((q) => (
                      <SelectItem key={q.title} value={q.title} className="text-xs">{q.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {draftForm && draftQuestion && (
              <div className="flex flex-wrap gap-1">
                {draftQuestion.options.map((o) => {
                  const selected = survey?.form_id === draftForm.form_id && survey.question === draftQuestion.title ? survey.options : [];
                  return (
                    <Chip key={o} active={selected.includes(o)} disabled={disabled} onClick={() => { const v = toggleIn(selected, o); patch({ survey: v.length ? { form_id: draftForm.form_id, question: draftQuestion.title, options: v } : undefined }); }}>{o}</Chip>
                  );
                })}
                <span className="w-full text-[11px] text-muted-foreground">選んだ選択肢のどれかを回答した人（LINE から回答した人のみ）</span>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3" data-slot="audience-editor">
      {shown.length === 0 ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs">
          条件なし = <span className="font-medium">LINE 連携済みのすべての友だち</span>に送ります。絞り込むには下の「条件を追加」から選んでください。
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((c, i) => (
            <div key={c.key} className="rounded border p-2" data-slot="audience-condition">
              <div className="mb-1.5 flex items-center gap-2">
                {i > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">かつ</span>}
                <span className="text-xs font-medium">{c.label}</span>
                <span className="text-[11px] text-muted-foreground">{c.hint}</span>
                <button type="button" disabled={disabled} className="ml-auto text-xs text-destructive hover:underline disabled:opacity-50" onClick={() => remove(c.key)}>削除</button>
              </div>
              {renderBody(c.key)}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">条件を追加:</span>
        {CONDITIONS.filter((c) => !shown.some((s) => s.key === c.key)).map((c) => (
          <Chip key={c.key} active={false} disabled={disabled} onClick={() => add(c.key)}>＋ {c.label}</Chip>
        ))}
      </div>
    </div>
  );
}
