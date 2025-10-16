import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Store } from '@/types/store';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

// 一時的なJSONファイルでのデータ保存（開発用）
const DATA_DIR = path.join(process.cwd(), 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');

// データディレクトリとファイルの初期化
function initializeDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(STORES_FILE)) {
    fs.writeFileSync(STORES_FILE, JSON.stringify([], null, 2));
  }
}

// 店舗データの読み込み
function readStores(): Store[] {
  initializeDataFile();
  const data = fs.readFileSync(STORES_FILE, 'utf-8');
  return JSON.parse(data);
}

// 店舗データの保存
function writeStores(stores: Store[]) {
  initializeDataFile();
  fs.writeFileSync(STORES_FILE, JSON.stringify(stores, null, 2));
}

// GET /api/stores/[storeId] - 個別店舗取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      const stores = readStores();
      const store = stores.find((s: Store) => s.id === storeId);
      
      if (!store) {
        return NextResponse.json(
          { error: '店舗が見つかりません' }, 
          { status: 404 }
        );
      }

      return NextResponse.json(store);
    }

    // staging/production: Supabase から取得
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: store, error } = await (adminClient as any)
      .from('stores')
      .select('*')
      .eq('id', storeId)
      .single();

    if (error || !store) {
      console.error('[API] Store fetch error:', error);
      return NextResponse.json(
        { error: '店舗が見つかりません' },
        { status: 404 }
      );
    }

    return NextResponse.json(store);
  } catch (error) {
    console.error('Store fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// PUT /api/stores/[storeId] - 店舗情報更新
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const env = getAppEnvironment();

    // ローカル環境: JSON を更新
    if (env === 'local') {
      const stores = readStores();
      const storeIndex = stores.findIndex((s: Store) => s.id === storeId);
      
      if (storeIndex === -1) {
        return NextResponse.json(
          { error: '店舗が見つかりません' }, 
          { status: 404 }
        );
      }

      // 更新データをマージ
      const updatedStore: Store = {
        ...stores[storeIndex],
        ...body,
        id: storeId, // IDは変更不可
        updated_at: new Date().toISOString()
      };

      stores[storeIndex] = updatedStore;
      writeStores(stores);

      return NextResponse.json(updatedStore);
    }

    // staging/production: Supabase を更新
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const updateData = {
      ...body,
      updated_at: new Date().toISOString()
    };

    // id, created_atは変更不可なので削除
    delete updateData.id;
    delete updateData.created_at;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedStore, error } = await (adminClient as any)
      .from('stores')
      .update(updateData)
      .eq('id', storeId)
      .select()
      .single();

    if (error || !updatedStore) {
      console.error('[API] Store update error:', error);
      return NextResponse.json(
        { error: '店舗の更新に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedStore);
  } catch (error) {
    console.error('Store update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// DELETE /api/stores/[storeId] - 店舗削除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // ローカル環境: JSON から削除
    if (env === 'local') {
      const stores = readStores();
      const storeIndex = stores.findIndex((s: Store) => s.id === storeId);
      
      if (storeIndex === -1) {
        return NextResponse.json(
          { error: '店舗が見つかりません' }, 
          { status: 404 }
        );
      }

      // 関連するフォームファイルを削除
      const formsFile = path.join(DATA_DIR, `forms_${storeId}.json`);
      if (fs.existsSync(formsFile)) {
        fs.unlinkSync(formsFile);
      }

      // 店舗データを削除
      stores.splice(storeIndex, 1);
      writeStores(stores);

      return NextResponse.json({ message: '店舗と関連フォームを削除しました' });
    }

    // staging/production: Supabase から削除
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 関連フォームと予約データは CASCADE で自動削除される（migration設定済み）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminClient as any)
      .from('stores')
      .delete()
      .eq('id', storeId);

    if (error) {
      console.error('[API] Store delete error:', error);
      return NextResponse.json(
        { error: '店舗の削除に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: '店舗と関連フォームを削除しました' });
  } catch (error) {
    console.error('Store delete error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
