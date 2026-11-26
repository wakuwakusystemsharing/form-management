'use client';

import React from 'react';
import type { SurveyQuestion } from '@/types/survey';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  SURVEY_CUSTOMER_FIELD_OPTIONS,
  autoCustomerFieldTarget,
  customerFieldLabel,
  customerFieldTargetsFor,
  isSensitiveCustomerField,
  resolveCustomerFieldLink,
  sanitizeCustomerFieldLink,
  type SurveyCustomerFieldTarget,
} from '@/lib/survey-customer-fields';

interface Props {
  question: SurveyQuestion;
  index: number;
  onChange: (patch: Partial<SurveyQuestion>) => void;
}

const AUTO = '__auto__';
const NONE = 'none';

/**
 * 質問ごとの「顧客情報に反映」の設定（アンケートのみ。純粋ロジックは src/lib/survey-customer-fields.ts）
 * - 誕生日選択・住所入力は、何も選ばなくても自動で 誕生日 / 住所 に入る
 * - 送信のたびにサーバーが設定を読むので、変更したあとは「更新」で保存するだけでよい
 */
export default function SurveyCustomerFieldSettings({ question: q, index, onChange }: Props) {
  const targets = customerFieldTargetsFor(q.type);
  if (targets.length === 0) return null;

  const auto = autoCustomerFieldTarget(q.type);
  const link = resolveCustomerFieldLink(q);
  // 画面の値: 自動で入る質問は「自動」、それ以外は「反映しない」が初期値
  const value = link && !link.auto ? link.target : q.customer_field?.target === 'none' || !auto ? NONE : AUTO;
  const options = SURVEY_CUSTOMER_FIELD_OPTIONS.filter((o) => targets.includes(o.value) && o.value !== auto);

  const setTarget = (next: string) => {
    if (next === AUTO) return onChange({ customer_field: undefined });
    if (next === NONE) return onChange({ customer_field: sanitizeCustomerFieldLink(q.type, { target: 'none' }) });
    onChange({ customer_field: sanitizeCustomerFieldLink(q.type, { target: next as SurveyCustomerFieldTarget, overwrite: q.customer_field?.overwrite }) });
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3" data-slot="survey-customer-field">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Label htmlFor={`customer-field-${index}`} className="shrink-0">顧客情報に反映</Label>
        <Select value={value} onValueChange={setTarget}>
          <SelectTrigger id={`customer-field-${index}`} className="sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {auto && <SelectItem value={AUTO}>{customerFieldLabel(auto)}に入れる（自動）</SelectItem>}
            <SelectItem value={NONE}>反映しない</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {link && (
        <>
          {link.target === 'notes' ? (
            <p className="text-xs text-muted-foreground">顧客のメモに「質問名: 回答」を 1 行足します。すでにあるメモは消しません。</p>
          ) : (
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`customer-field-overwrite-${index}`}
                checked={link.overwrite}
                onCheckedChange={(checked) => onChange({ customer_field: sanitizeCustomerFieldLink(q.type, { target: link.target, overwrite: checked === true }) })}
              />
              <Label htmlFor={`customer-field-overwrite-${index}`} className="cursor-pointer text-sm">
                すでに入っていても、回答のたびに上書きする
              </Label>
            </div>
          )}
          {link.target !== 'notes' && !link.overwrite && (
            <p className="text-xs text-muted-foreground">
              顧客の「{customerFieldLabel(link.target)}」が空のときだけ入れます。{link.target === 'name' ? 'LINE の表示名のまま・未記入のお名前は、空として扱います。' : ''}
            </p>
          )}
          {isSensitiveCustomerField(link.target) && (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-900" data-slot="survey-customer-field-caution">
              アレルギー・既往歴は、特に慎重に扱う情報です。お客様の同意が必要なので、この質問の説明文などに「回答は店舗の顧客情報に保存します」と書いてください。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            LINE で開いて回答したお客様が対象です。顧客として登録されていない方は、この回答をきっかけに顧客として登録します。
          </p>
        </>
      )}
    </div>
  );
}
