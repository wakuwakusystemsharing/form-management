/**
 * 予約フォームの表示名
 *
 * フォーム名の正本は `config.basic_info.form_name`（編集画面で変更・保存される値）。
 * 旧フラット形式（最上位 `form_name`。ローカル JSON の古いデータや複製で引き継がれたもの）は
 * config に名前が無いときだけ使う。以前は最上位を優先していたため、名前を変えても
 * 古い最上位の値が一部の画面に残ることがあった。
 */
export interface FormNameSource {
  form_name?: string | null;
  config?: { basic_info?: { form_name?: string | null } | null } | null;
}

export function getReservationFormName(form: FormNameSource | null | undefined, fallback = 'フォーム'): string {
  if (!form) return fallback;
  const fromConfig = form.config?.basic_info?.form_name;
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  const legacy = form.form_name;
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  return fallback;
}
