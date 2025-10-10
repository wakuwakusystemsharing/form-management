// 一時的なメモリ内データストレージ
// 本来はデータベースを使用

export interface Store {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  phone?: string;
  address?: string;
  website_url?: string;
  description?: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

// メモリ内ストレージ
const stores = new Map<string, Store>();

export const storeStorage = {
  // 全店舗取得
  getAll(): Store[] {
    return Array.from(stores.values()).sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  },

  // 個別店舗取得
  getById(id: string): Store | undefined {
    return stores.get(id);
  },

  // 店舗作成
  create(store: Store): Store {
    stores.set(store.id, store);
    return store;
  },

  // 店舗更新
  update(id: string, data: Partial<Store>): Store | null {
    const existing = stores.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...data,
      id, // IDは変更不可
      updated_at: new Date().toISOString()
    };

    stores.set(id, updated);
    return updated;
  },

  // 店舗削除
  delete(id: string): boolean {
    return stores.delete(id);
  },

  // 次のID生成
  getNextId(): string {
    const existingIds = Array.from(stores.keys())
      .filter(id => id.startsWith('st'))
      .map(id => parseInt(id.replace('st', '')) || 0)
      .sort((a, b) => b - a);

    const lastNumber = existingIds.length > 0 ? existingIds[0] : 0;
    return `st${(lastNumber + 1).toString().padStart(4, '0')}`;
  }
};
