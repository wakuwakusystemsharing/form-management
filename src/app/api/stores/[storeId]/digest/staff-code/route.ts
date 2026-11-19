import { NextResponse } from 'next/server';
import { authorizeStoreAccess } from '@/lib/store-access';
import { reissueStaffCode } from '@/lib/store-digest-service';

// POST /api/stores/{storeId}/digest/staff-code - スタッフ登録の合言葉を出し直す（古い合言葉は使えなくなる）
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    const auth = await authorizeStoreAccess(request, storeId);
    if (auth.response) return auth.response;
    return NextResponse.json({ staff_code: await reissueStaffCode(storeId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[API] store digest staff code error:', error);
    return NextResponse.json({ error: '合言葉の出し直しに失敗しました' }, { status: 500 });
  }
}
