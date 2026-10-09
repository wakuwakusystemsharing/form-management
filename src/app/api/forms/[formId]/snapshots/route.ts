import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { authorizeStoreAccess } from '@/lib/store-access';
import { getCurrentUser } from '@/lib/auth-helper';
import { normalizeForm } from '@/lib/form-normalizer';
import { createAdminClient } from '@/lib/supabase';
import { createFormSnapshot, listFormSnapshots, SNAPSHOT_REASON_LABELS, type SnapshotReason } from '@/lib/form-snapshots';
import fs from 'fs';
import path from 'path';
import type { Form } from '@/types/form';

/**
 * 予約フォーム設定のスナップショット（元に戻す用）
 *
 * GET  /api/forms/{formId}/snapshots            一覧（新しい順・config なし）
 * POST /api/forms/{formId}/snapshots            現在の config を保存 body: { reason: 'update'|'sync'|'restore', reason_label?, source_form_id? }
 *
 * 認可は店舗アクセス（authorizeStoreAccess）。local はスキップ
 */
async function loadForm(formId: string): Promise<Form | null> {
  const env = getAppEnvironment();
  if (env === 'local') {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) return null;
    for (const file of fs.readdirSync(dataDir).filter((f) => f.startsWith('forms') && f.endsWith('.json'))) {
      try {
        const arr = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf-8'));
        const found = Array.isArray(arr) ? arr.find((f: { id?: string }) => f?.id === formId) : null;
        if (found) return normalizeForm(found);
      } catch { /* ignore */ }
    }
    return null;
  }
  const client = createAdminClient();
  if (!client) return null;
  const { data } = await (client as any).from('reservation_forms').select('*').eq('id', formId).maybeSingle();
  return data ? normalizeForm(data) : null;
}

const REASONS: SnapshotReason[] = ['update', 'sync', 'restore'];

export async function GET(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const { formId } = await params;
    const form = await loadForm(formId);
    if (!form) return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;
    const snapshots = await listFormSnapshots(formId);
    return NextResponse.json({ snapshots, reason_labels: SNAPSHOT_REASON_LABELS }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] form snapshots list error:', error);
    return NextResponse.json({ error: '更新履歴の取得に失敗しました' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const { formId } = await params;
    const form = await loadForm(formId);
    if (!form) return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = REASONS.includes(body.reason as SnapshotReason) ? (body.reason as SnapshotReason) : 'update';
    const reasonLabel = typeof body.reason_label === 'string' && body.reason_label.trim() ? body.reason_label.trim().slice(0, 100) : null;
    const sourceFormId = typeof body.source_form_id === 'string' && body.source_form_id ? body.source_form_id : null;
    const user = getAppEnvironment() === 'local' ? null : await getCurrentUser(request);

    const snapshot = await createFormSnapshot({
      store_id: form.store_id,
      form_id: formId,
      config: form.config,
      reason,
      reason_label: reasonLabel,
      source_form_id: sourceFormId,
      actor_user_id: user?.id ?? null,
      actor_email: user?.email ?? null,
    });
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    console.error('[API] form snapshot create error:', error);
    return NextResponse.json({ error: 'スナップショットの保存に失敗しました' }, { status: 500 });
  }
}
