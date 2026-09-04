/**
 * 顧客カルテ機能の純粋ロジック（クライアント / サーバー共用。Node 専用モジュールを import しない）
 * - タグの正規化
 * - 希望連絡手段の定義
 * - 「次回への申し送り」で帯に出す 1 件の判定
 */

/** 1 タグの最大文字数 */
export const TAG_MAX_LENGTH = 30;
/** 1 顧客あたりのタグ最大数 */
export const TAGS_MAX_COUNT = 20;
/** 申し送りの最大文字数 */
export const NEXT_VISIT_NOTE_MAX_LENGTH = 1000;

/** 希望連絡手段（customers.preferred_contact_method） */
export const CONTACT_METHODS = [
  { value: 'line', label: 'LINE' },
  { value: 'phone', label: '電話' },
  { value: 'email', label: 'メール' },
  { value: 'none', label: '連絡不要' },
] as const;

export type ContactMethod = (typeof CONTACT_METHODS)[number]['value'];

export function isContactMethod(value: unknown): value is ContactMethod {
  return typeof value === 'string' && CONTACT_METHODS.some((m) => m.value === value);
}

export function contactMethodLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return CONTACT_METHODS.find((m) => m.value === value)?.label ?? value;
}

/**
 * タグ配列を正規化する。
 * - 文字列以外は捨てる
 * - 前後の空白を削除し、連続する空白（全角含む）を半角 1 つにまとめる
 * - 空文字・上限超え（TAG_MAX_LENGTH）は捨てる
 * - 重複を除去（先勝ち）し、TAGS_MAX_COUNT 件まで
 */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const tag = raw.replace(/[\s　]+/g, ' ').trim();
    if (!tag || tag.length > TAG_MAX_LENGTH) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= TAGS_MAX_COUNT) break;
  }
  return out;
}

/** 申し送りの判定に必要な最小限の来店記録 */
export interface VisitNoteSource {
  id: string;
  visit_date: string;
  created_at?: string | null;
  next_visit_note?: string | null;
  next_visit_note_by?: string | null;
  next_visit_note_acknowledged_at?: string | null;
}

/**
 * 顧客詳細の最上部に出す「前回の申し送り」を 1 件選ぶ。
 * 条件: next_visit_note があり、未確認（acknowledged_at が null）。
 * 複数あれば visit_date が新しいもの、同日なら created_at が新しいものを優先。
 */
export function pickPendingNextVisitNote<T extends VisitNoteSource>(visits: T[] | null | undefined): T | null {
  if (!visits || visits.length === 0) return null;
  let best: T | null = null;
  for (const v of visits) {
    if (!v.next_visit_note || !v.next_visit_note.trim()) continue;
    if (v.next_visit_note_acknowledged_at) continue;
    if (!best) {
      best = v;
      continue;
    }
    const byDate = String(v.visit_date).localeCompare(String(best.visit_date));
    if (byDate > 0) {
      best = v;
    } else if (byDate === 0) {
      const a = v.created_at ?? '';
      const b = best.created_at ?? '';
      if (a.localeCompare(b) > 0) best = v;
    }
  }
  return best;
}

/**
 * 顧客一覧のカードに出すタグ（最大 max 件 + 残り件数）
 */
export function summarizeTags(tags: string[] | null | undefined, max = 2): { shown: string[]; rest: number } {
  const list = Array.isArray(tags) ? tags.filter((t) => typeof t === 'string' && t) : [];
  return { shown: list.slice(0, max), rest: Math.max(0, list.length - max) };
}

export interface VisitNotePatchBody {
  next_visit_note?: unknown;
  next_visit_note_by?: unknown;
  acknowledge?: unknown;
}

export interface VisitNotePatch {
  next_visit_note: string | null;
  next_visit_note_by: string | null;
  next_visit_note_acknowledged_at: string | null;
  updated_at: string;
}

/**
 * リクエスト本文から更新内容を組み立てる。
 * - next_visit_note を変更したら「新しい申し送り」として acknowledged_at を null に戻す
 * - acknowledge: true で acknowledged_at = now
 * - 本文が空文字なら申し送りを削除（null）
 */
export function buildVisitNotePatch(
  body: VisitNotePatchBody,
  current: { next_visit_note?: string | null }
): { patch: Partial<VisitNotePatch> } | { error: string } {
  const patch: Partial<VisitNotePatch> = {};
  let noteChanged = false;

  if (body.next_visit_note !== undefined) {
    if (body.next_visit_note !== null && typeof body.next_visit_note !== 'string') {
      return { error: '申し送りは文字列で指定してください' };
    }
    const note = typeof body.next_visit_note === 'string' ? body.next_visit_note.trim() : '';
    if (note.length > NEXT_VISIT_NOTE_MAX_LENGTH) {
      return { error: `申し送りは ${NEXT_VISIT_NOTE_MAX_LENGTH} 文字以内で入力してください` };
    }
    patch.next_visit_note = note || null;
    noteChanged = (current.next_visit_note ?? null) !== patch.next_visit_note;
  }

  if (body.next_visit_note_by !== undefined) {
    if (body.next_visit_note_by !== null && typeof body.next_visit_note_by !== 'string') {
      return { error: '担当者名は文字列で指定してください' };
    }
    const by = typeof body.next_visit_note_by === 'string' ? body.next_visit_note_by.trim().slice(0, 50) : '';
    patch.next_visit_note_by = by || null;
  }

  if (noteChanged) {
    patch.next_visit_note_acknowledged_at = null;
  }
  if (body.acknowledge === true) {
    patch.next_visit_note_acknowledged_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return { error: '更新内容がありません' };
  }
  patch.updated_at = new Date().toISOString();
  return { patch };
}
