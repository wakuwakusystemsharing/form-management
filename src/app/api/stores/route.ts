import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Store } from '@/types/store';

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

// GET /api/stores - 店舗一覧取得
export async function GET() {
  try {
    const stores = readStores();
    return NextResponse.json(stores);
  } catch (error) {
    console.error('Store fetch error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : String(error),
      hint: 'Failed to read stores from JSON file',
      code: 'FILE_READ_ERROR'
    });
    return NextResponse.json({ error: 'Failed to fetch stores' }, { status: 500 });
  }
}

// POST /api/stores - 新しい店舗作成
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, address, description, owner_name } = body;

    const stores = readStores();
    
    // 店舗ID生成（st0001形式）
    let newStoreId = 'st0001';
    if (stores.length > 0) {
      const lastStore = stores
        .filter((store: Store) => store.id.startsWith('st'))
        .sort((a: Store, b: Store) => b.id.localeCompare(a.id))[0];
      
      if (lastStore) {
        const lastNumber = parseInt(lastStore.id.replace('st', '')) || 0;
        newStoreId = `st${(lastNumber + 1).toString().padStart(4, '0')}`;
      }
    }

    const newStore: Store = {
      id: newStoreId,
      name,
      description: description || undefined,
      owner_name: owner_name || name,
      owner_email: email || '',
      phone: phone || undefined,
      address: address || undefined,
      website_url: undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'active'
    };

    stores.push(newStore);
    writeStores(stores);

    return NextResponse.json(newStore, { status: 201 });
  } catch (error) {
    console.error('Store creation error:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : String(error),
      hint: 'Failed to create store',
      code: 'STORE_CREATE_ERROR'
    });
    return NextResponse.json({ error: 'Failed to create store' }, { status: 500 });
  }
}
