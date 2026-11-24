/**
 * 店舗管理者ページのアクセス確認
 *
 * 店舗管理者の一覧の API を「運営だけ」にしたとき、店舗管理者ページがその API でアクセス確認をしていたため、
 * 店舗管理者が自分のページを開けなくなった（「この店舗へのアクセス権限がありません」）。その再発防止。
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  STORE_ACCESS_DENIED_MESSAGE,
  STORE_LOAD_FAILED_MESSAGE,
  STORE_NOT_FOUND_MESSAGE,
  STORE_SESSION_EXPIRED_MESSAGE,
  storeAdminAccessCheckUrl,
  storeAdminAccessError,
} from '../store-admin-access';

describe('storeAdminAccessCheckUrl', () => {
  it('店舗管理者も呼べる API（店舗情報の ?full=1）を使う', () => {
    expect(storeAdminAccessCheckUrl('08nddu')).toBe('/api/stores/08nddu?full=1');
  });

  it('運営だけが呼べる「店舗管理者の一覧」は使わない', () => {
    expect(storeAdminAccessCheckUrl('08nddu')).not.toContain('/admins');
  });
});

describe('storeAdminAccessError', () => {
  it('200 なら開いてよい', () => {
    expect(storeAdminAccessError(200)).toBeNull();
  });

  it('状態コードごとの文言', () => {
    expect(storeAdminAccessError(401)).toBe(STORE_SESSION_EXPIRED_MESSAGE);
    expect(storeAdminAccessError(403)).toBe(STORE_ACCESS_DENIED_MESSAGE);
    expect(storeAdminAccessError(404)).toBe(STORE_NOT_FOUND_MESSAGE);
    expect(storeAdminAccessError(500)).toBe(STORE_LOAD_FAILED_MESSAGE);
  });
});

describe('店舗管理者ページ', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/app/[storeId]/admin/page.tsx'), 'utf-8');

  it('アクセス確認に、運営だけが呼べる「店舗管理者の一覧」を使っていない', () => {
    expect(source).not.toMatch(/api\/stores\/\$\{storeId\}\/admins/);
  });

  it('共通のアクセス確認（storeAdminAccessCheckUrl）を使っている', () => {
    expect(source).toContain('storeAdminAccessCheckUrl(storeId)');
    expect(source).toContain('storeAdminAccessError(');
  });
});
