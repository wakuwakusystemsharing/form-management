/**
 * 流入経路の業務ロジック — サーバー専用（保存先に依存。クライアントから import しない）
 */
import {
  SOURCE_MAX_PER_STORE,
  buildSourceEntryUrl,
  sourceFormStatus,
  validateSourceInput,
  type ReservationSource,
  type SourceFormStatus,
} from '@/lib/reservation-sources';
import { getSourceById, insertSource, listSources, listStoreForms, updateSource, type StoreFormSummary } from '@/lib/reservation-source-repository';

/** 画面に返す経路（開く先のフォームの名前と状態を添える） */
export interface SourceView extends ReservationSource {
  entry_url: string;
  form_name: string;
  form_status: SourceFormStatus;
}

export interface SourceFormOption {
  id: string;
  name: string;
  status: SourceFormStatus;
}

export type SourceResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

function toView(source: ReservationSource, forms: StoreFormSummary[], origin: string): SourceView {
  const form = forms.find((f) => f.id === source.form_id) ?? null;
  return {
    ...source,
    entry_url: buildSourceEntryUrl(origin, source.code),
    form_name: form?.name ?? '削除されたフォーム',
    form_status: sourceFormStatus(form, origin),
  };
}

export async function getSourceOverview(storeId: string, origin: string): Promise<{ sources: SourceView[]; forms: SourceFormOption[]; max: number }> {
  const [sources, forms] = await Promise.all([listSources(storeId), listStoreForms(storeId)]);
  return {
    sources: sources.map((s) => toView(s, forms, origin)),
    forms: forms.map((f) => ({ id: f.id, name: f.name, status: sourceFormStatus(f, origin) })),
    max: SOURCE_MAX_PER_STORE,
  };
}

export async function createSource(storeId: string, input: { name?: unknown; form_id?: unknown }, origin: string): Promise<SourceResult<SourceView>> {
  const v = validateSourceInput(input, { requireAll: true });
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const [existing, forms] = await Promise.all([listSources(storeId), listStoreForms(storeId)]);
  if (existing.length >= SOURCE_MAX_PER_STORE) return { ok: false, status: 400, error: `経路は ${SOURCE_MAX_PER_STORE} 件まで作成できます` };
  // 他の店舗のフォームを指す経路を作れないよう、この店舗のフォームかを確かめる
  if (!forms.some((f) => f.id === v.form_id)) return { ok: false, status: 400, error: '選んだ予約フォームが見つかりません' };
  const created = await insertSource({ store_id: storeId, form_id: v.form_id as string, name: v.name as string });
  if ('error' in created) return { ok: false, status: 500, error: created.error };
  return { ok: true, data: toView(created.source, forms, origin) };
}

export async function editSource(storeId: string, id: string, input: { name?: unknown; form_id?: unknown; active?: unknown }, origin: string): Promise<SourceResult<SourceView>> {
  const current = await getSourceById(storeId, id);
  if (!current) return { ok: false, status: 404, error: '経路が見つかりません' };
  const v = validateSourceInput(input, { requireAll: false });
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  if (input.active !== undefined && typeof input.active !== 'boolean') return { ok: false, status: 400, error: '有効 / 停止の値が正しくありません' };
  const forms = await listStoreForms(storeId);
  if (v.form_id !== undefined && !forms.some((f) => f.id === v.form_id)) return { ok: false, status: 400, error: '選んだ予約フォームが見つかりません' };
  const updated = await updateSource(storeId, id, { name: v.name, form_id: v.form_id, active: input.active as boolean | undefined });
  if (!updated) return { ok: false, status: 404, error: '経路が見つかりません' };
  return { ok: true, data: toView(updated, forms, origin) };
}
