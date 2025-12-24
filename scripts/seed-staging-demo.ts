/**
 * Supabase Staging環境にテストデータを生成
 * - 店舗「デモ用　サロンダービー」
 * - 複数のフォーム
 * - 過去の予約も含めて1000件の予約データ
 * 
 * 実行方法:
 * NEXT_PUBLIC_APP_ENV=staging pnpm run seed:staging-demo
 */

import dotenv from 'dotenv';
import { createAdminClient } from '../src/lib/supabase';
import { FormConfig } from '../src/types/form';

// .env.local を明示的に読み込む
dotenv.config({ path: '.env.local' });

// 日本語の名前リスト
const FIRST_NAMES = [
  '太郎', '花子', '一郎', '美咲', '健太', 'さくら', '大輔', '愛美', '翔太', '麻衣',
  '直樹', '由美', '拓也', '優子', '和也', '美香', '亮太', '理恵', '雄一', '恵子',
  '智也', '真由美', '誠', '千佳', '達也', '絵美', '剛', '香織', '慎一', '美穂'
];

const LAST_NAMES = [
  '佐藤', '鈴木', '田中', '山田', '高橋', '伊藤', '渡辺', '中村', '小林', '加藤',
  '吉田', '山本', '松本', '井上', '木村', '林', '斎藤', '清水', '山崎', '森',
  '池田', '橋本', '石川', '前田', '藤田', '後藤', '長谷川', '村上', '近藤', '坂本'
];

// 電話番号の生成
function generatePhoneNumber(): string {
  const areaCode = ['090', '080', '070'][Math.floor(Math.random() * 3)];
  const num1 = String(Math.floor(Math.random() * 9000) + 1000);
  const num2 = String(Math.floor(Math.random() * 9000) + 1000);
  return `${areaCode}-${num1}-${num2}`;
}

// メールアドレスの生成
function generateEmail(firstName: string, lastName: string): string {
  const domains = ['gmail.com', 'yahoo.co.jp', 'outlook.com', 'example.com'];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  const num = Math.floor(Math.random() * 1000);
  return `${lastName.toLowerCase()}${firstName.toLowerCase()}${num}@${domain}`;
}

// 店舗IDの生成（6文字）
function generateStoreId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// フォームIDの生成（12文字）
function generateFormId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// メニュー構造の定義
function createMenuStructure(): FormConfig['menu_structure'] {
  return {
    structure_type: 'category_based',
    categories: [
      {
        id: 'cat_1',
        name: 'フェイシャル',
        display_name: '◆フェイシャルコース◆',
        menus: [
          {
            id: 'menu_1',
            name: 'ベーシックフェイシャル',
            price: 5000,
            duration: 60,
            description: '基本のフェイシャルコース',
            options: [
              { id: 'opt_1', name: 'オプションA', price: 1000, duration: 10 },
              { id: 'opt_2', name: 'オプションB', price: 1500, duration: 15 }
            ],
            has_submenu: true,
            sub_menu_items: [
              { id: 'sub_1', name: 'プレミアムコース', price: 8000, duration: 90 },
              { id: 'sub_2', name: 'デラックスコース', price: 12000, duration: 120 }
            ]
          },
          {
            id: 'menu_2',
            name: '美白フェイシャル',
            price: 7000,
            duration: 75,
            description: '美白効果のあるフェイシャル',
            options: [
              { id: 'opt_3', name: '美白オプション', price: 2000, duration: 20 }
            ]
          }
        ],
        options: [],
        selection_mode: 'single'
      },
      {
        id: 'cat_2',
        name: 'ボディケア',
        display_name: '◆ボディケアコース◆',
        menus: [
          {
            id: 'menu_3',
            name: '全身マッサージ',
            price: 8000,
            duration: 90,
            description: 'リラックスできる全身マッサージ',
            options: [
              { id: 'opt_4', name: 'アロマオプション', price: 2000, duration: 15 }
            ]
          },
          {
            id: 'menu_4',
            name: '部分マッサージ',
            price: 4000,
            duration: 45,
            description: '肩・首・背中を重点的に',
            has_submenu: true,
            sub_menu_items: [
              { id: 'sub_3', name: '肩コリ解消', price: 5000, duration: 60 },
              { id: 'sub_4', name: '腰痛改善', price: 6000, duration: 60 }
            ]
          }
        ],
        options: [],
        selection_mode: 'single'
      },
      {
        id: 'cat_3',
        name: 'エステ',
        display_name: '◆エステコース◆',
        menus: [
          {
            id: 'menu_5',
            name: 'リンパドレナージュ',
            price: 6000,
            duration: 60,
            description: 'リンパの流れを改善',
            options: [
              { id: 'opt_5', name: 'フェイシャル追加', price: 3000, duration: 30 }
            ]
          }
        ],
        options: [],
        selection_mode: 'single'
      }
    ],
    display_options: {
      show_price: true,
      show_duration: true,
      show_description: true,
      show_treatment_info: false
    }
  };
}

// フォーム設定の生成
function createFormConfig(formName: string): FormConfig {
  return {
    basic_info: {
      form_name: formName,
      store_name: 'サロンダービー',
      liff_id: '',
      theme_color: '#3B82F6'
    },
    visit_options: [],
    gender_selection: {
      enabled: true,
      required: false,
      options: [
        { value: 'male', label: '男性' },
        { value: 'female', label: '女性' }
      ]
    },
    visit_count_selection: {
      enabled: true,
      required: false,
      options: [
        { value: 'first', label: '初回' },
        { value: 'repeat', label: '2回目以降' }
      ]
    },
    coupon_selection: {
      enabled: true,
      options: [
        { value: 'use', label: '利用する' },
        { value: 'not_use', label: '利用しない' }
      ]
    },
    menu_structure: createMenuStructure(),
    calendar_settings: {
      business_hours: {
        monday: { open: '10:00', close: '20:00', closed: false },
        tuesday: { open: '10:00', close: '20:00', closed: false },
        wednesday: { open: '10:00', close: '20:00', closed: false },
        thursday: { open: '10:00', close: '20:00', closed: false },
        friday: { open: '10:00', close: '20:00', closed: false },
        saturday: { open: '10:00', close: '20:00', closed: false },
        sunday: { open: '10:00', close: '18:00', closed: false }
      },
      advance_booking_days: 30
    },
    ui_settings: {
      theme_color: '#3B82F6',
      button_style: 'rounded',
      show_repeat_booking: false,
      show_side_nav: true
    },
    validation_rules: {
      required_fields: ['name', 'phone'],
      phone_format: 'japanese',
      name_max_length: 50
    }
  };
}

// 予約データの生成
function generateReservation(
  storeId: string,
  formId: string,
  menuStructure: FormConfig['menu_structure'],
  daysAgo: number
): any {
  const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  const customerName = `${lastName} ${firstName}`;
  const phone = generatePhoneNumber();
  const email = generateEmail(firstName, lastName);

  // ランダムにカテゴリーとメニューを選択
  const category = menuStructure.categories[
    Math.floor(Math.random() * menuStructure.categories.length)
  ];
  const menu = category.menus[
    Math.floor(Math.random() * category.menus.length)
  ];

  // サブメニューの選択（50%の確率）
  let selectedSubmenu = null;
  let finalMenu = menu;
  if (menu.has_submenu && menu.sub_menu_items && Math.random() > 0.5) {
    selectedSubmenu = menu.sub_menu_items[
      Math.floor(Math.random() * menu.sub_menu_items.length)
    ];
    finalMenu = selectedSubmenu;
  }

  // オプションの選択（30%の確率）
  const selectedOptions: any[] = [];
  if (menu.options && Math.random() > 0.7) {
    const optionCount = Math.floor(Math.random() * menu.options.length) + 1;
    const shuffled = [...menu.options].sort(() => Math.random() - 0.5);
    for (let i = 0; i < optionCount && i < shuffled.length; i++) {
      selectedOptions.push({
        option_id: shuffled[i].id,
        option_name: shuffled[i].name,
        menu_id: menu.id
      });
    }
  }

  // メニュー情報の構築
  const selectedMenus = [{
    menu_id: menu.id,
    menu_name: menu.name,
    category_name: category.name,
    price: finalMenu.price || menu.price || 0,
    duration: finalMenu.duration || menu.duration || 0,
    ...(selectedSubmenu ? {
      submenu_id: selectedSubmenu.id,
      submenu_name: selectedSubmenu.name
    } : {})
  }];

  // 顧客属性情報
  const gender = Math.random() > 0.5 ? 'female' : 'male';
  const visitCount = Math.random() > 0.6 ? 'repeat' : 'first';
  const coupon = Math.random() > 0.7 ? 'use' : 'not_use';

  // 予約日時（過去から現在まで）
  const reservationDate = new Date();
  reservationDate.setDate(reservationDate.getDate() - daysAgo);
  const dateStr = reservationDate.toISOString().split('T')[0];

  // 時間帯（10:00-19:30の間で30分刻み）
  const hour = Math.floor(Math.random() * 10) + 10; // 10-19時
  const minute = Math.random() > 0.5 ? '00' : '30';
  // 19時30分を超えないようにする
  const finalHour = hour === 19 && minute === '30' ? 19 : hour;
  const finalMinute = hour === 19 && minute === '30' ? '00' : minute;
  const timeStr = `${String(finalHour).padStart(2, '0')}:${finalMinute}:00`;

  // ステータス（過去の予約は確認済み、最近の予約は保留中が多い）
  // データベースの制約: 'pending', 'confirmed', 'cancelled' のみ許可
  let status: 'pending' | 'confirmed' | 'cancelled';
  if (daysAgo > 7) {
    // 1週間以上前は確認済みが多い
    status = Math.random() > 0.1 ? 'confirmed' : 'cancelled';
  } else if (daysAgo > 3) {
    // 3-7日前は確認済みが多い
    const rand = Math.random();
    status = rand > 0.3 ? 'confirmed' : rand > 0.1 ? 'confirmed' : 'cancelled';
  } else {
    // 3日以内は保留中が多い
    const rand = Math.random();
    status = rand > 0.4 ? 'pending' : rand > 0.2 ? 'confirmed' : 'cancelled';
  }

  // 作成日時（予約日時より少し前）
  const createdAt = new Date(reservationDate);
  createdAt.setHours(createdAt.getHours() - Math.floor(Math.random() * 48));

  return {
    form_id: formId,
    store_id: storeId,
    customer_name: customerName,
    customer_phone: phone,
    customer_email: email,
    menu_name: menu.name,
    submenu_name: selectedSubmenu?.name || null,
    gender: gender,
    visit_count: visitCount,
    coupon: coupon,
    message: Math.random() > 0.8 ? 'よろしくお願いします' : null,
    selected_menus: selectedMenus,
    selected_options: selectedOptions,
    reservation_date: dateStr,
    reservation_time: timeStr,
    customer_info: {
      gender: gender,
      visit_count: visitCount,
      coupon: coupon
    },
    status: status,
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString()
  };
}

async function main() {
  console.log('🚀 Supabase Staging環境にテストデータを生成します...\n');

  // 環境変数の確認
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error('❌ NEXT_PUBLIC_SUPABASE_URL が設定されていません');
    process.exit(1);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY が設定されていません');
    process.exit(1);
  }

  console.log(`📡 Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`);

  const adminClient = createAdminClient();
  if (!adminClient) {
    console.error('❌ Supabase接続エラー: 環境変数を確認してください');
    process.exit(1);
  }

  try {
    // 1. 既存の「デモ用　サロンダービー」を確認
    console.log('📦 店舗を確認中...');
    const { data: existingStores } = await (adminClient as any)
      .from('stores')
      .select('id, name')
      .eq('name', 'デモ用　サロンダービー');

    let storeId: string;
    let store: any;

    if (existingStores && existingStores.length > 0) {
      // 既存の店舗を使用
      storeId = existingStores[0].id;
      store = existingStores[0];
      console.log(`✅ 既存の店舗を使用: ${store.name} (ID: ${storeId})\n`);
    } else {
      // 新しい店舗を作成
      storeId = generateStoreId();
      const { data: newStore, error: storeError } = await (adminClient as any)
        .from('stores')
        .insert([{
          id: storeId,
          name: 'デモ用　サロンダービー',
          owner_name: 'デモオーナー',
          owner_email: 'demo@salondarby.com',
          phone: '03-1234-5678',
          address: '東京都渋谷区デモ1-2-3',
          description: 'デモ用のサロンです'
        }])
        .select()
        .single();

      if (storeError) {
        console.error('❌ 店舗作成エラー:', storeError);
        process.exit(1);
      }
      store = newStore;
      console.log(`✅ 店舗作成完了: ${store.name} (ID: ${storeId})\n`);
    }

    // 2. 既存のフォームを確認または作成（3つ）
    console.log('📝 フォームを確認中...');
    const { data: existingForms } = await (adminClient as any)
      .from('forms')
      .select('id, config')
      .eq('store_id', storeId);

    const formNames = ['基本予約フォーム', 'プレミアム予約フォーム', 'エステ予約フォーム'];
    const formIds: string[] = [];

    // 既存のフォームIDを取得
    if (existingForms && existingForms.length > 0) {
      console.log(`✅ 既存のフォーム ${existingForms.length}個を確認しました`);
      for (const form of existingForms) {
        formIds.push(form.id);
      }
    }

    // 不足しているフォームを作成
    const formsToCreate = formNames.length - formIds.length;
    if (formsToCreate > 0) {
      console.log(`📝 ${formsToCreate}個のフォームを作成中...`);
      for (let i = formIds.length; i < formNames.length; i++) {
        const formName = formNames[i];
        const formId = generateFormId();
        const formConfig = createFormConfig(formName);

        const { data: form, error: formError } = await (adminClient as any)
          .from('forms')
          .insert([{
            id: formId,
            store_id: storeId,
            status: 'active',
            draft_status: 'ready_to_publish',
            config: formConfig
          }])
          .select()
          .single();

        if (formError) {
          console.error(`❌ フォーム作成エラー (${formName}):`, formError);
          continue;
        }

        formIds.push(formId);
        console.log(`✅ フォーム作成完了: ${formName} (ID: ${formId})`);
      }
    }
    console.log(`\n✅ 合計 ${formIds.length}個のフォームを使用します\n`);

    // 3. 既存の予約数を確認
    const { count: existingCount } = await (adminClient as any)
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    const existingReservations = existingCount || 0;
    console.log(`📊 既存の予約数: ${existingReservations}件`);

    // 4. 予約データを生成（1000件まで）
    const TARGET_RESERVATIONS = 1000;
    const RESERVATIONS_TO_CREATE = Math.max(0, TARGET_RESERVATIONS - existingReservations);

    if (RESERVATIONS_TO_CREATE === 0) {
      console.log('✅ 既に1000件の予約データが存在します\n');
    } else {
      console.log(`📅 ${RESERVATIONS_TO_CREATE}件の予約データを生成中...`);
      const BATCH_SIZE = 100;
      const menuStructure = createMenuStructure();

      for (let i = 0; i < RESERVATIONS_TO_CREATE; i += BATCH_SIZE) {
        const batch: any[] = [];
        const batchSize = Math.min(BATCH_SIZE, RESERVATIONS_TO_CREATE - i);

        for (let j = 0; j < batchSize; j++) {
          const formId = formIds[Math.floor(Math.random() * formIds.length)];
          const daysAgo = Math.floor(Math.random() * 180); // 過去180日間
          const reservation = generateReservation(storeId, formId, menuStructure, daysAgo);
          batch.push(reservation);
        }

        const { error: reservationError } = await (adminClient as any)
          .from('reservations')
          .insert(batch);

        if (reservationError) {
          console.error(`❌ 予約データ挿入エラー (バッチ ${Math.floor(i / BATCH_SIZE) + 1}):`, reservationError);
          continue;
        }

        console.log(`✅ ${i + batchSize}/${RESERVATIONS_TO_CREATE} 件の予約データを生成しました`);
      }
    }

    // 最終的な予約数を確認
    const { count: finalCount } = await (adminClient as any)
      .from('reservations')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);

    console.log(`\n🎉 完了！`);
    console.log(`\n📊 データ状況:`);
    console.log(`  - 店舗: ${store.name} (ID: ${storeId})`);
    console.log(`  - フォーム: ${formIds.length}個`);
    console.log(`  - 予約データ: ${finalCount || 0}件`);
    console.log(`\n🔗 管理画面: /admin/${storeId}`);

  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

main();

