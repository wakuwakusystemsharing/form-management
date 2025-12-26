import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getAppEnvironment } from '@/lib/env';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

// DELETE /api/stores/[storeId]/admins/[userId] - 店舗管理者削除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storeId: string; userId: string }> }
) {
  try {
    const { storeId, userId } = await params;

    const env = getAppEnvironment();
    
    // ローカル環境: JSON から削除
    if (env === 'local') {
      const adminsPath = path.join(DATA_DIR, `store_admins_${storeId}.json`);
      
      if (!fs.existsSync(adminsPath)) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }
      
      const data = fs.readFileSync(adminsPath, 'utf-8');
      const admins = JSON.parse(data);
      
      const filteredAdmins = admins.filter((a: any) => a.user_id !== userId);
      
      if (filteredAdmins.length === admins.length) {
        return NextResponse.json(
          { error: '店舗管理者が見つかりません' },
          { status: 404 }
        );
      }
      
      fs.writeFileSync(adminsPath, JSON.stringify(filteredAdmins, null, 2));
      
      return NextResponse.json({ success: true });
    }

    // staging/production: Supabase から削除
    const adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 店舗管理者を削除
    const { error: deleteError } = await adminClient
      .from('store_admins')
      .delete()
      .eq('user_id', userId)
      .eq('store_id', storeId);

    if (deleteError) {
      console.error('[API] Store Admin delete error:', deleteError);
      return NextResponse.json(
        { error: '店舗管理者の削除に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Store Admin delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

