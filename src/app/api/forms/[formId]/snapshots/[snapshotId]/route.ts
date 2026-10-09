import { NextResponse } from 'next/server';
import { getAppEnvironment } from '@/lib/env';
import { authorizeStoreAccess } from '@/lib/store-access';
import { normalizeForm } from '@/lib/form-normalizer';
import { createAdminClient } from '@/lib/supabase';
import { getFormSnapshot } from '@/lib/form-snapshots';
import fs from 'fs';
import path from 'path';
import type { Form } from '@/types/form';

/**
 * GET /api/forms/{formId}/snapshots/{snapshotId} - スナップショット 1 件（config 付き）
 * 復元はクライアントが この config で PUT /api/forms/{formId} → POST .../deploy を行う（通常の更新と同じ経路）
 */
async function loadForm(formId: string): Promise<Form | null> {
  if (getAppEnvironment() === 'local') {
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

export async function GET(request: Request, { params }: { params: Promise<{ formId: string; snapshotId: string }> }) {
  try {
    const { formId, snapshotId } = await params;
    const form = await loadForm(formId);
    if (!form) return NextResponse.json({ error: 'フォームが見つかりません' }, { status: 404 });
    const auth = await authorizeStoreAccess(request, form.store_id);
    if (auth.response) return auth.response;
    const snapshot = await getFormSnapshot(formId, snapshotId);
    if (!snapshot) return NextResponse.json({ error: 'スナップショットが見つかりません' }, { status: 404 });
    // 復元時にそのまま使えるよう正規化した config を返す
    const normalized = normalizeForm({ ...form, config: snapshot.config });
    return NextResponse.json({ snapshot: { ...snapshot, config: normalized.config } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] form snapshot get error:', error);
    return NextResponse.json({ error: 'スナップショットの取得に失敗しました' }, { status: 500 });
  }
}
