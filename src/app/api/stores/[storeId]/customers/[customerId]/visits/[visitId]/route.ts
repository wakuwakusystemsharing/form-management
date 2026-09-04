import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { authorizeStoreAccess } from '@/lib/store-access';
import { buildVisitNotePatch, type VisitNotePatchBody } from '@/lib/customer-chart';
import type { CustomerVisit } from '@/types/form';

const DATA_DIR = path.join(process.cwd(), 'data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const VISITS_FILE = path.join(DATA_DIR, 'customer_visits.json');

/**
 * PATCH /api/stores/[storeId]/customers/[customerId]/visits/[visitId]
 * 来店記録の「次回への申し送り」を更新 / 確認済みにする
 * body: { next_visit_note?: string | null, next_visit_note_by?: string | null, acknowledge?: true }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ storeId: string; customerId: string; visitId: string }> }
) {
  const { storeId, customerId, visitId } = await params;
  const { response } = await authorizeStoreAccess(request, storeId);
  if (response) return response;

  let body: VisitNotePatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエスト本文が不正です' }, { status: 400 });
  }

  try {
    if (getAppEnvironment() === 'local') {
      if (!fs.existsSync(CUSTOMERS_FILE) || !fs.existsSync(VISITS_FILE)) {
        return NextResponse.json({ error: '来店記録が見つかりません' }, { status: 404 });
      }
      const customers = JSON.parse(fs.readFileSync(CUSTOMERS_FILE, 'utf-8')) as Array<{
        id: string;
        store_id: string;
      }>;
      if (!customers.some((c) => c.id === customerId && c.store_id === storeId)) {
        return NextResponse.json({ error: '顧客が見つかりません' }, { status: 404 });
      }
      const visits = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf-8')) as CustomerVisit[];
      const index = visits.findIndex(
        (v) => v.id === visitId && v.customer_id === customerId && v.store_id === storeId
      );
      if (index < 0) {
        return NextResponse.json({ error: '来店記録が見つかりません' }, { status: 404 });
      }
      const built = buildVisitNotePatch(body, visits[index]);
      if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });
      visits[index] = { ...visits[index], ...built.patch };
      fs.writeFileSync(VISITS_FILE, JSON.stringify(visits, null, 2));
      return NextResponse.json(visits[index]);
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json({ error: 'Supabase 接続エラー' }, { status: 500 });
    }

    const { data: current, error: fetchError } = await adminClient
      .from('customer_visits')
      .select('*')
      .eq('id', visitId)
      .eq('customer_id', customerId)
      .eq('store_id', storeId)
      .maybeSingle();
    if (fetchError) {
      console.error('来店記録取得エラー:', fetchError);
      return NextResponse.json({ error: '来店記録の取得に失敗しました' }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: '来店記録が見つかりません' }, { status: 404 });
    }

    const built = buildVisitNotePatch(body, current as CustomerVisit);
    if ('error' in built) return NextResponse.json({ error: built.error }, { status: 400 });

    // 型付きクライアントでは新列の Update 型が never に推論されるため any 経由で更新する（他の顧客 API と同じ）
    const { data: updated, error: updateError } = await (adminClient as any)
      .from('customer_visits')
      .update(built.patch)
      .eq('id', visitId)
      .select('*')
      .single();
    if (updateError) {
      console.error('申し送り更新エラー:', updateError);
      return NextResponse.json({ error: '申し送りの更新に失敗しました' }, { status: 500 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error('申し送り更新エラー:', error);
    return NextResponse.json({ error: '申し送りの更新に失敗しました' }, { status: 500 });
  }
}
