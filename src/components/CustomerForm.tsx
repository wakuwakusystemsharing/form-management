'use client';

import { useState } from 'react';
import { Customer } from '@/types/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import TagInput from '@/components/customers/TagInput';
import { CONTACT_METHODS, normalizeTags } from '@/lib/customer-chart';
import { ShieldAlert } from 'lucide-react';

export interface CustomerFormData {
  name: string;
  name_kana: string;
  phone: string;
  email: string;
  birthday: string;
  gender: string;
  customer_type: string;
  notes: string;
  // カルテ（安全のための情報・タグ）
  allergies: string;
  medical_history: string;
  preferred_contact_method: string;
  tags: string[];
}

interface CustomerFormProps {
  initialData?: Partial<CustomerFormData>;
  onSubmit: (data: CustomerFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  linePictureUrl?: string | null;
  customerName?: string;
  /** form 要素の id。外側の固定バーの submit ボタン（form 属性）から送信するため */
  formId?: string;
  /** フォーム末尾のボタン行を出さない（外側の固定バーに置く場合） */
  hideActions?: boolean;
  /** タグの候補（よく使うタグ）を取得する店舗 ID */
  storeId?: string;
}

function toFormData(customer?: Partial<CustomerFormData>): CustomerFormData {
  return {
    name: customer?.name || '',
    name_kana: customer?.name_kana || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    birthday: customer?.birthday || '',
    gender: customer?.gender || '',
    customer_type: customer?.customer_type || 'new',
    notes: customer?.notes || '',
    allergies: customer?.allergies || '',
    medical_history: customer?.medical_history || '',
    preferred_contact_method: customer?.preferred_contact_method || '',
    tags: normalizeTags(customer?.tags),
  };
}

export function customerToFormData(customer: Customer): CustomerFormData {
  return toFormData({
    name: customer.name,
    name_kana: customer.name_kana ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    birthday: customer.birthday ?? '',
    gender: customer.gender ?? '',
    customer_type: customer.customer_type ?? 'new',
    notes: customer.notes ?? '',
    allergies: customer.allergies ?? '',
    medical_history: customer.medical_history ?? '',
    preferred_contact_method: customer.preferred_contact_method ?? '',
    tags: customer.tags ?? [],
  });
}

export default function CustomerForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = '保存',
  isSubmitting = false,
  linePictureUrl,
  customerName,
  formId,
  hideActions = false,
  storeId,
}: CustomerFormProps) {
  const [form, setForm] = useState<CustomerFormData>(toFormData(initialData));
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError('顧客名は必須です');
      return;
    }
    try {
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    }
  };

  const updateField = <K extends keyof CustomerFormData>(field: K, value: CustomerFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-4">
      {/* アバター（LINE 画像があるときだけ。新規追加では出さない） */}
      {linePictureUrl && (
        <div className="flex items-center gap-3 pb-1">
          <Avatar className="h-14 w-14">
            <AvatarImage src={linePictureUrl} alt="" />
            <AvatarFallback className="text-xl">{(customerName || form.name || '?').charAt(0)}</AvatarFallback>
          </Avatar>
          <p className="text-xs text-muted-foreground">プロフィール画像は LINE 連携情報から自動取得されます</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="customer-name">顧客名 <span className="text-destructive">*</span></Label>
          <Input id="customer-name" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="山田 太郎" autoComplete="off" enterKeyHint="next" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-name-kana">フリガナ</Label>
          <Input id="customer-name-kana" value={form.name_kana} onChange={(e) => updateField('name_kana', e.target.value)} placeholder="ヤマダ タロウ" autoComplete="off" enterKeyHint="next" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="customer-phone">電話番号</Label>
          <Input id="customer-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="090-1234-5678" autoComplete="off" enterKeyHint="next" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-email">メールアドレス</Label>
          <Input id="customer-email" type="email" inputMode="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} placeholder="example@email.com" autoComplete="off" spellCheck={false} enterKeyHint="next" />
        </div>
      </div>

      {/* スマホは誕生日・性別を 2 列、顧客タイプは 1 行 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="customer-birthday">誕生日</Label>
          <Input id="customer-birthday" type="date" value={form.birthday} onChange={(e) => updateField('birthday', e.target.value)} className="min-w-0" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-gender">性別</Label>
          <Select value={form.gender || 'none'} onValueChange={(v) => updateField('gender', v === 'none' ? '' : v)}>
            <SelectTrigger id="customer-gender"><SelectValue placeholder="選択" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未選択</SelectItem>
              <SelectItem value="male">男性</SelectItem>
              <SelectItem value="female">女性</SelectItem>
              <SelectItem value="other">その他</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <Label htmlFor="customer-type">顧客タイプ（手動）</Label>
          <Select value={form.customer_type} onValueChange={(v) => updateField('customer_type', v)}>
            <SelectTrigger id="customer-type" title="一覧のセグメントバッジ（新規 / リピーター / VIP / 休眠）は来店履歴から自動判定されます。ここは店舗が手動で付ける区分です"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">新規</SelectItem>
              <SelectItem value="regular">常連</SelectItem>
              <SelectItem value="vip">VIP</SelectItem>
              <SelectItem value="inactive">休止</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-4 text-muted-foreground">一覧のバッジは来店履歴から自動判定。これは手動の区分です</p>
        </div>
      </div>

      {/* タグ・希望連絡手段 */}
      <div className="space-y-1.5">
        <Label htmlFor="customer-tags">タグ</Label>
        <TagInput id="customer-tags" value={form.tags} onChange={(tags) => updateField('tags', tags)} storeId={storeId} disabled={isSubmitting} />
      </div>
      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor="customer-contact-method">希望連絡手段</Label>
        <Select value={form.preferred_contact_method || 'none-selected'} onValueChange={(v) => updateField('preferred_contact_method', v === 'none-selected' ? '' : v)}>
          <SelectTrigger id="customer-contact-method"><SelectValue placeholder="選択" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none-selected">未選択</SelectItem>
            {CONTACT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 安全のための情報（要配慮個人情報。本人同意のうえで記録） */}
      <fieldset className="rounded-lg border border-red-200 bg-red-50/40 p-3 space-y-3" data-slot="caution">
        <legend className="px-1 text-sm font-medium inline-flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
          安全のための情報
        </legend>
        <p className="text-[11px] leading-4 text-muted-foreground -mt-1">
          施術の安全のために使う情報です。お客様の同意を得て記録してください。登録があるときだけ顧客詳細の上部に赤い帯で表示されます
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="customer-allergies">アレルギー</Label>
          <Textarea id="customer-allergies" value={form.allergies} onChange={(e) => updateField('allergies', e.target.value)} placeholder="例: ジアミン、ラテックス、金属" rows={2} maxLength={500} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="customer-medical-history">既往歴・注意事項</Label>
          <Textarea id="customer-medical-history" value={form.medical_history} onChange={(e) => updateField('medical_history', e.target.value)} placeholder="例: 頭皮が敏感。刺激の弱い薬剤で対応" rows={2} maxLength={1000} />
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="customer-notes">メモ</Label>
        <Textarea id="customer-notes" value={form.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="顧客に関するメモ…" rows={3} />
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {!hideActions && (
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>キャンセル</Button>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : submitLabel}</Button>
        </div>
      )}
    </form>
  );
}
