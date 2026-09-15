'use client';

import { buildAdminReservationRows, type AdminReservationInput } from '@/lib/reservation-detail-items';
import type { Form } from '@/types/form';

interface Props {
  formConfig: Partial<Form['config']> | null | undefined;
  reservation: AdminReservationInput;
}

/**
 * 予約詳細の基本情報カードに出す「予約内容」の行（担当スタッフ・性別・ご来店回数・クーポン・
 * カスタム項目・合計金額・合計時間・第二/第三希望日・メッセージ）。
 * 店舗管理者ページとテナント側の店舗ページで共通
 */
export default function ReservationInfoRows({ formConfig, reservation }: Props) {
  const rows = buildAdminReservationRows(formConfig, reservation);
  if (rows.length === 0) return null;
  return (
    <div className="border-t pt-3 space-y-2" data-slot="reservation-info-rows">
      {rows.map(({ label, value }, i) => (
        <div key={`${label}-${i}`} className="flex justify-between items-start gap-4">
          <span className="text-sm text-muted-foreground shrink-0">{label}</span>
          <span className="text-sm font-medium text-right whitespace-pre-wrap break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}
