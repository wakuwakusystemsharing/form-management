/**
 * 既存の reservations から customers / customer_visits を後付けで生成し、統計を再計算する。
 *
 * 想定ユースケース:
 * - seed-staging-demo.ts などで予約を直接 INSERT し、CRM レコードが作られていないケース
 * - 旧スキーマ時代の予約データを CRM に取り込みたいケース
 *
 * 動作:
 * - 指定 store の reservations を全件取得
 * - line_user_id または customer_phone を鍵に既存顧客を検索
 * - 無ければ新規作成（customer_type='new', 統計値は 0 で初期化）
 * - reservations.customer_id を更新
 * - 非キャンセル予約には customer_visits を作成（重複は skip）
 * - 顧客ごとに recalculateCustomerStats を実行して total_visits / total_spent / 来店日 / 平均間隔を確定
 *
 * 実行例:
 *   pnpm tsx scripts/backfill-customers-from-reservations.ts                       # 全店舗
 *   pnpm tsx scripts/backfill-customers-from-reservations.ts <storeId>             # 単一店舗
 *   pnpm tsx scripts/backfill-customers-from-reservations.ts --dry-run             # 件数だけ表示
 *
 * ※ NEXT_PUBLIC_APP_ENV と Supabase の接続情報を .env.local で設定しておくこと。
 *    ローカル JSON モードでは何もしない。
 */

import dotenv from 'dotenv';
import { createAdminClient } from '../src/lib/supabase';
import {
  findCustomerByLineOrPhone,
  createCustomer,
  createCustomerVisit,
  findCustomerVisitByReservation,
  recalculateCustomerStats,
  calculateTotalAmount,
} from '../src/lib/customer-utils';

dotenv.config({ path: '.env.local' });

interface ReservationRow {
  id: string;
  store_id: string;
  form_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  line_user_id: string | null;
  reservation_date: string;
  reservation_time: string | null;
  selected_menus: any;
  selected_options: any;
  customer_info: any;
  status: string;
}

interface BackfillResult {
  storeId: string;
  totalReservations: number;
  customersCreated: number;
  customersReused: number;
  visitsCreated: number;
  visitsSkipped: number;
  reservationsLinked: number;
  errors: number;
}

async function fetchReservations(
  adminClient: any,
  storeId: string | null
): Promise<ReservationRow[]> {
  let query = adminClient
    .from('reservations')
    .select(
      'id, store_id, form_id, customer_id, customer_name, customer_phone, customer_email, line_user_id, reservation_date, reservation_time, selected_menus, selected_options, customer_info, status'
    )
    .order('reservation_date', { ascending: true });

  if (storeId) {
    query = query.eq('store_id', storeId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`予約データ取得エラー: ${error.message}`);
  }
  return data as ReservationRow[];
}

async function backfillStore(
  adminClient: any,
  storeId: string,
  reservations: ReservationRow[],
  dryRun: boolean
): Promise<BackfillResult> {
  const result: BackfillResult = {
    storeId,
    totalReservations: reservations.length,
    customersCreated: 0,
    customersReused: 0,
    visitsCreated: 0,
    visitsSkipped: 0,
    reservationsLinked: 0,
    errors: 0,
  };

  // 顧客特定キー: line_user_id 優先、無ければ customer_phone (正規化なし、seed データでは表記揺れ無しと仮定)
  // 既に customer_id が紐付いている予約はスキップ
  const touchedCustomerIds = new Set<string>();

  for (const r of reservations) {
    try {
      let customerId = r.customer_id;

      // 既に customer_id がある場合はそれを使用、無ければ作成 or 検索
      if (!customerId) {
        const existing = await findCustomerByLineOrPhone(
          storeId,
          r.line_user_id,
          r.customer_phone
        );

        if (existing) {
          customerId = existing.id;
          result.customersReused++;
        } else {
          if (!r.customer_name) {
            // 名前無しの予約は顧客化できない（スキップ）
            console.warn(`[skip] reservation=${r.id} 顧客名なしのためスキップ`);
            continue;
          }
          if (dryRun) {
            customerId = `(dry-run-new)`;
            result.customersCreated++;
          } else {
            const newCustomer = await createCustomer({
              store_id: storeId,
              line_user_id: r.line_user_id,
              name: r.customer_name,
              phone: r.customer_phone,
              email: r.customer_email,
              gender: r.customer_info?.gender || null,
              customer_type: 'new',
              first_visit_date: null,
              last_visit_date: null,
              total_visits: 0,
              total_spent: 0,
            });
            customerId = newCustomer.id;
            result.customersCreated++;
          }
        }

        // reservations.customer_id を更新
        if (!dryRun && customerId && customerId !== '(dry-run-new)') {
          const { error: linkError } = await adminClient
            .from('reservations')
            .update({ customer_id: customerId })
            .eq('id', r.id);
          if (linkError) {
            console.error(`[link] reservation=${r.id} 紐付け失敗:`, linkError.message);
            result.errors++;
            continue;
          }
          result.reservationsLinked++;
        } else if (dryRun) {
          result.reservationsLinked++;
        }
      }

      // 非キャンセル予約のみ visit を作成
      if (r.status !== 'cancelled' && customerId && customerId !== '(dry-run-new)') {
        if (dryRun) {
          result.visitsCreated++;
        } else {
          const existingVisit = await findCustomerVisitByReservation(r.id);
          if (existingVisit) {
            result.visitsSkipped++;
          } else {
            const amount = calculateTotalAmount(r.selected_menus, r.selected_options);
            await createCustomerVisit({
              customer_id: customerId,
              store_id: storeId,
              reservation_id: r.id,
              visit_date: r.reservation_date,
              visit_time: r.reservation_time,
              visit_type: 'reservation',
              treatment_menus: r.selected_menus,
              amount,
            });
            result.visitsCreated++;
            touchedCustomerIds.add(customerId);
          }
        }
      } else if (customerId && customerId !== '(dry-run-new)') {
        // キャンセル予約でも customer_id 紐付けはあるので統計更新対象に入れる
        touchedCustomerIds.add(customerId);
      }
    } catch (err) {
      console.error(`[error] reservation=${r.id}:`, err);
      result.errors++;
    }
  }

  // 統計を再計算
  if (!dryRun) {
    let recalculated = 0;
    for (const cid of touchedCustomerIds) {
      try {
        await recalculateCustomerStats(cid);
        recalculated++;
      } catch (err) {
        console.error(`[recalc] customer=${cid} 再計算失敗:`, err);
        result.errors++;
      }
    }
    console.log(`  ↳ ${recalculated} 名の顧客統計を再計算`);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetStoreId = args.find((a) => !a.startsWith('--')) || null;

  console.log('🔄 既存予約からの顧客バックフィル開始');
  console.log(`   モード: ${dryRun ? 'DRY RUN（書き込みなし）' : '本番書き込み'}`);
  console.log(`   対象店舗: ${targetStoreId || '全店舗'}\n`);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL が未設定');
    process.exit(1);
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    console.error('❌ Supabase 接続エラー');
    process.exit(1);
  }

  // 対象 reservations を取得
  const reservations = await fetchReservations(adminClient, targetStoreId);
  if (reservations.length === 0) {
    console.log('対象予約なし');
    return;
  }

  // 店舗別にグループ化
  const byStore = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    if (!byStore.has(r.store_id)) byStore.set(r.store_id, []);
    byStore.get(r.store_id)!.push(r);
  }

  const results: BackfillResult[] = [];
  for (const [storeId, list] of byStore) {
    console.log(`\n🏪 store=${storeId}: ${list.length} 件の予約`);
    const r = await backfillStore(adminClient, storeId, list, dryRun);
    results.push(r);
    console.log(
      `  ↳ 顧客 新規=${r.customersCreated} 再利用=${r.customersReused} | ` +
        `予約 紐付=${r.reservationsLinked} | ` +
        `visit 新規=${r.visitsCreated} skip=${r.visitsSkipped} | ` +
        `エラー=${r.errors}`
    );
  }

  // 集計
  console.log('\n📊 全体結果');
  const sum = results.reduce(
    (acc, r) => ({
      totalReservations: acc.totalReservations + r.totalReservations,
      customersCreated: acc.customersCreated + r.customersCreated,
      customersReused: acc.customersReused + r.customersReused,
      visitsCreated: acc.visitsCreated + r.visitsCreated,
      visitsSkipped: acc.visitsSkipped + r.visitsSkipped,
      reservationsLinked: acc.reservationsLinked + r.reservationsLinked,
      errors: acc.errors + r.errors,
    }),
    {
      totalReservations: 0,
      customersCreated: 0,
      customersReused: 0,
      visitsCreated: 0,
      visitsSkipped: 0,
      reservationsLinked: 0,
      errors: 0,
    }
  );
  console.log(`   予約総数: ${sum.totalReservations}`);
  console.log(`   顧客 新規作成: ${sum.customersCreated}`);
  console.log(`   顧客 既存利用: ${sum.customersReused}`);
  console.log(`   予約紐付け: ${sum.reservationsLinked}`);
  console.log(`   visit 新規作成: ${sum.visitsCreated}`);
  console.log(`   visit skip: ${sum.visitsSkipped}`);
  console.log(`   エラー: ${sum.errors}`);

  if (dryRun) {
    console.log('\n💡 --dry-run なので何も書き込んでいません。本番実行は --dry-run を外してください。');
  } else {
    console.log('\n✅ 完了');
  }
}

main().catch((err) => {
  console.error('💥 致命的エラー:', err);
  process.exit(1);
});
