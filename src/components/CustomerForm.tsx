'use client';

import { useState } from 'react';
import { Customer } from '@/types/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface CustomerFormData {
  name: string;
  name_kana: string;
  phone: string;
  email: string;
  birthday: string;
  gender: string;
  customer_type: string;
  notes: string;
  allergies: string;
  medical_history: string;
}

interface CustomerFormProps {
  initialData?: Partial<CustomerFormData>;
  onSubmit: (data: CustomerFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
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
  });
}

export default function CustomerForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = '保存',
  isSubmitting = false,
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

  const updateField = (field: keyof CustomerFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 基本情報 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="customer-name">
            顧客名 <span className="text-destructive">*</span>
          </Label>
          <Input
            id="customer-name"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="山田 太郎"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-name-kana">フリガナ</Label>
          <Input
            id="customer-name-kana"
            value={form.name_kana}
            onChange={(e) => updateField('name_kana', e.target.value)}
            placeholder="ヤマダ タロウ"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="customer-phone">電話番号</Label>
          <Input
            id="customer-phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => updateField('phone', e.target.value)}
            placeholder="090-1234-5678"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-email">メールアドレス</Label>
          <Input
            id="customer-email"
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="example@email.com"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="customer-birthday">誕生日</Label>
          <Input
            id="customer-birthday"
            type="date"
            value={form.birthday}
            onChange={(e) => updateField('birthday', e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-gender">性別</Label>
          <Select value={form.gender || 'none'} onValueChange={(v) => updateField('gender', v === 'none' ? '' : v)}>
            <SelectTrigger id="customer-gender">
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未選択</SelectItem>
              <SelectItem value="male">男性</SelectItem>
              <SelectItem value="female">女性</SelectItem>
              <SelectItem value="other">その他</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-type">顧客タイプ</Label>
          <Select value={form.customer_type} onValueChange={(v) => updateField('customer_type', v)}>
            <SelectTrigger id="customer-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">新規</SelectItem>
              <SelectItem value="regular">常連</SelectItem>
              <SelectItem value="vip">VIP</SelectItem>
              <SelectItem value="inactive">休止</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 医療・アレルギー情報 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="customer-allergies">アレルギー</Label>
          <Input
            id="customer-allergies"
            value={form.allergies}
            onChange={(e) => updateField('allergies', e.target.value)}
            placeholder="例: 金属アレルギー"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-medical">既往歴</Label>
          <Input
            id="customer-medical"
            value={form.medical_history}
            onChange={(e) => updateField('medical_history', e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      {/* メモ */}
      <div className="space-y-2">
        <Label htmlFor="customer-notes">メモ</Label>
        <Textarea
          id="customer-notes"
          value={form.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="顧客に関するメモ…"
          rows={3}
        />
      </div>

      {/* エラー表示 */}
      {error && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}

      {/* ボタン */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? '保存中…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
