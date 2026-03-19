import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form, FormConfig } from '@/types/form';
import { StaticReservationGenerator } from '@/lib/static-generator-reservation';
import { SupabaseStorageDeployer } from '@/lib/supabase-storage-deployer';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth-helper';

// テンプレート型定義
type FormTemplate = {
  name?: string;
  description?: string;
  config?: {
    basic_info?: {
      show_gender_selection?: boolean;
    };
    menu_structure?: FormConfig['menu_structure'];
    ui_settings?: {
      show_visit_count?: boolean;
      show_coupon_selection?: boolean;
      show_repeat_booking?: boolean;
    };
  };
  liff_id?: string;
};

// 一時的なJSONファイルでのデータ保存（開発用）
const DATA_DIR = path.join(process.cwd(), 'data');
const FORMS_FILE = path.join(DATA_DIR, 'forms.json');

// データディレクトリとファイルの初期化
function initializeDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(FORMS_FILE)) {
    fs.writeFileSync(FORMS_FILE, JSON.stringify([], null, 2));
  }
}

// フォームデータの読み込み
function readForms(): Form[] {
  initializeDataFile();
  const data = fs.readFileSync(FORMS_FILE, 'utf-8');
  return JSON.parse(data);
}

// GET /api/stores/[storeId]/forms - 店舗のフォーム一覧取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      // 新しい形式のフォームファイルを読み込み
      const formsPath = path.join(DATA_DIR, `forms_${storeId}.json`);
      
      if (!fs.existsSync(formsPath)) {
        return NextResponse.json([]);
      }
      
      const data = fs.readFileSync(formsPath, 'utf-8');
      const storeForms = JSON.parse(data);
      
      return NextResponse.json(storeForms);
    }

    // staging/production: Supabase から取得
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { data: forms, error } = await adminClient
      .from('reservation_forms')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API] Forms fetch error:', error);
      return NextResponse.json(
        { error: 'フォームの取得に失敗しました' },
        { status: 500 }
      );
    }

    return NextResponse.json(forms || []);
  } catch (error) {
    console.error('Forms fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// ランダムなフォームID生成関数
function generateRandomFormId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// POST /api/stores/[storeId]/forms - 新しいフォーム作成
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const { form_name, form_type, liff_id, template } = body;
    const env = getAppEnvironment();
    
    // 現在のユーザーIDを取得
    const currentUserId = await getCurrentUserId(request);

    // バリデーション
    // フォーム名のみ必須
    if (!form_name || !form_name.trim()) {
      return NextResponse.json(
        { error: 'フォーム名は必須です' },
        { status: 400 }
      );
    }

    // LIFF ID はオプショナル

    // ローカル環境: JSON に保存
    if (env === 'local') {
      const forms = readForms();
      
      // ランダムなフォームID生成（重複チェック付き）
      let newFormId: string;
      do {
        newFormId = generateRandomFormId();
      } while (forms.some((form: Form) => form.id === newFormId));

    // フォームタイプを決定（後方互換性のため）
    const determinedFormType = form_type || (liff_id && liff_id.trim() ? 'line' : 'web');

    // テンプレートから基本設定を作成
    const baseConfig = template ? {
      basic_info: {
        form_name: form_name || 'フォーム',
        store_name: '', // TODO: 店舗名を取得
        liff_id: determinedFormType === 'line' 
          ? ((template as FormTemplate)?.liff_id || liff_id || '')
          : undefined,
        theme_color: '#3B82F6',
        logo_url: undefined,
        show_gender_selection: template.config?.basic_info?.show_gender_selection || false
      },
      menu_structure: template.config?.menu_structure || {
        structure_type: 'simple',
        categories: []
      },
      ui_settings: {
        theme_color: '#3B82F6',
        button_style: 'rounded' as const,
        show_repeat_booking: template.config?.ui_settings?.show_repeat_booking || false,
        show_side_nav: true,
        custom_css: undefined,
        show_visit_count: template.config?.ui_settings?.show_visit_count || false,
        show_coupon_selection: template.config?.ui_settings?.show_coupon_selection || false
      },
      form_type: determinedFormType
    } : {
      basic_info: {
        form_name: form_name || 'フォーム',
        store_name: '',
        liff_id: determinedFormType === 'line' ? (liff_id || '') : undefined,
        theme_color: '#3B82F6',
        logo_url: undefined,
        show_gender_selection: false
      },
      menu_structure: {
        structure_type: 'simple' as const,
        categories: []
      },
      ui_settings: {
        theme_color: '#3B82F6',
        button_style: 'rounded' as const,
        show_repeat_booking: false,
        show_side_nav: true,
        custom_css: undefined,
        show_visit_count: false,
        show_coupon_selection: false
      },
      form_type: determinedFormType
    };

    const newForm: Form = {
      id: newFormId,
      store_id: storeId,
      config: {
        ...baseConfig,
        calendar_settings: {
          business_hours: {
            monday: { open: '09:00', close: '18:00', closed: false },
            tuesday: { open: '09:00', close: '18:00', closed: false },
            wednesday: { open: '09:00', close: '18:00', closed: false },
            thursday: { open: '09:00', close: '18:00', closed: false },
            friday: { open: '09:00', close: '18:00', closed: false },
            saturday: { open: '09:00', close: '18:00', closed: false },
            sunday: { open: '09:00', close: '18:00', closed: true }
          },
          advance_booking_days: 30
        },
        visit_options: [],
        gender_selection: { 
          enabled: baseConfig.basic_info?.show_gender_selection || false, 
          required: false, 
          options: [
            { value: 'male' as const, label: '男性' },
            { value: 'female' as const, label: '女性' }
          ]
        },
        visit_count_selection: {
          enabled: baseConfig.ui_settings?.show_visit_count || false,
          required: false,
          options: (template?.config as FormConfig)?.visit_count_selection?.options?.length
            ? (template.config as FormConfig).visit_count_selection!.options
            : [
                { value: 'first', label: '初回' },
                { value: 'repeat', label: '2回目以降' }
              ]
        },
        coupon_selection: {
          enabled: baseConfig.ui_settings?.show_coupon_selection || false,
          coupon_name: (template?.config as FormConfig)?.coupon_selection?.coupon_name ?? '',
          options: [
            { value: 'use' as const, label: '利用する' },
            { value: 'not_use' as const, label: '利用しない' }
          ]
        },
        custom_fields: (template?.config as FormConfig)?.custom_fields ?? [],
        menu_structure: {
          ...baseConfig.menu_structure,
          display_options: {
            show_price: true,
            show_duration: true,
            show_description: true,
            show_treatment_info: (baseConfig.menu_structure as FormConfig['menu_structure'])?.display_options?.show_treatment_info ?? false
          }
        },
        ui_settings: {
          theme_color: baseConfig.ui_settings.theme_color,
          button_style: baseConfig.ui_settings.button_style as 'rounded' | 'square',
          show_repeat_booking: baseConfig.ui_settings.show_repeat_booking,
          show_side_nav: baseConfig.ui_settings.show_side_nav,
          custom_css: baseConfig.ui_settings.custom_css
        },
        validation_rules: {
          required_fields: ['name', 'phone'],
          phone_format: 'japanese',
          name_max_length: 50
        }
      },
      status: 'active',
      draft_status: 'none',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 新しいフォーム形式で保存
    const formsPath = path.join(DATA_DIR, `forms_${storeId}.json`);
    let storeForms = [];
    
    if (fs.existsSync(formsPath)) {
      const data = fs.readFileSync(formsPath, 'utf-8');
      storeForms = JSON.parse(data);
    }
    
    storeForms.push(newForm);
    fs.writeFileSync(formsPath, JSON.stringify(storeForms, null, 2));

    // 🚀 自動的にSupabase Storageに初期テンプレートHTMLをデプロイ（公開ステータス）
    try {
      const generator = new StaticReservationGenerator();
      const deployer = new SupabaseStorageDeployer();
      
      // FormConfigに正規化
      const formConfig = {
        basic_info: baseConfig.basic_info,
        visit_options: [],
        gender_selection: {
          enabled: baseConfig.basic_info.show_gender_selection || false,
          required: false,
          options: [
            { value: 'male' as const, label: '男性' },
            { value: 'female' as const, label: '女性' }
          ]
        },
        visit_count_selection: {
          enabled: baseConfig.ui_settings?.show_visit_count || false,
          required: false,
          options: [
            { value: 'first', label: '初回' },
            { value: 'repeat', label: '2回目以降' }
          ]
        },
        coupon_selection: {
          enabled: baseConfig.ui_settings?.show_coupon_selection || false,
          options: [
            { value: 'use' as const, label: '利用する' },
            { value: 'not_use' as const, label: '利用しない' }
          ]
        },
        menu_structure: {
          ...baseConfig.menu_structure,
          display_options: {
            show_price: true,
            show_duration: true,
            show_description: true,
            show_treatment_info: false
          }
        },
        calendar_settings: {
          business_hours: newForm.config.calendar_settings.business_hours,
          advance_booking_days: newForm.config.calendar_settings.advance_booking_days
        },
        ui_settings: {
          ...baseConfig.ui_settings,
          button_style: (baseConfig.ui_settings.button_style as 'rounded' | 'square') || 'rounded'
        },
        validation_rules: {
          required_fields: ['name', 'phone'],
          phone_format: 'japanese' as const,
          name_max_length: 50
        }
      };
      
      const html = generator.generateHTML(formConfig, newFormId, storeId);
      const deployResult = await deployer.deployForm(storeId, newFormId, html, 'reservation');
      
      console.log(`✅ フォーム作成と同時にStorageにデプロイ: ${deployResult.storage_url || deployResult.url}`);
      
      // デプロイ情報をフォームに追加
      newForm.static_deploy = {
        deployed_at: new Date().toISOString(),
        deploy_url: deployResult.url,
        storage_url: deployResult.storage_url,
        status: 'deployed'
      };
      
      // 更新を保存
      fs.writeFileSync(formsPath, JSON.stringify(storeForms, null, 2));
      } catch (deployError) {
        console.error('⚠️ Storageデプロイに失敗しましたが、フォーム作成は成功しました:', deployError);
        // デプロイ失敗してもフォーム作成は成功とする
      }

      return NextResponse.json(newForm, { status: 201 });
    }

    // staging/production: Supabase に保存
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    // 新形式のフォームデータを作成（Supabase用）
    const baseTemplateConfig = template?.config;
    const genderSelectionEnabled = baseTemplateConfig?.basic_info?.show_gender_selection || false;
    const visitCountEnabled = baseTemplateConfig?.ui_settings?.show_visit_count || false;
    const couponEnabled = baseTemplateConfig?.ui_settings?.show_coupon_selection || false;
    const templateLiffId = (template as FormTemplate)?.liff_id;
    
    // フォームタイプを決定（後方互換性のため）
    const determinedFormType = form_type || (liff_id && liff_id.trim() ? 'line' : 'web');
    
    const supabaseConfig: FormConfig = {
      basic_info: {
        form_name: form_name || 'フォーム',
        store_name: '',
        liff_id: determinedFormType === 'line' 
          ? (templateLiffId || liff_id || '')
          : undefined,
        theme_color: '#3B82F6',
        logo_url: undefined
      },
      visit_options: [],
      gender_selection: {
        enabled: genderSelectionEnabled,
        required: false,
        options: [
          { value: 'male' as const, label: '男性' },
          { value: 'female' as const, label: '女性' }
        ]
      },
      visit_count_selection: {
        enabled: visitCountEnabled,
        required: false,
        options: (baseTemplateConfig as FormConfig)?.visit_count_selection?.options?.length
          ? (baseTemplateConfig as FormConfig).visit_count_selection!.options
          : [
              { value: 'first', label: '初回' },
              { value: 'repeat', label: '2回目以降' }
            ]
      },
      coupon_selection: {
        enabled: couponEnabled,
        coupon_name: (baseTemplateConfig as FormConfig)?.coupon_selection?.coupon_name ?? '',
        options: [
          { value: 'use' as const, label: '利用する' },
          { value: 'not_use' as const, label: '利用しない' }
        ]
      },
      custom_fields: (baseTemplateConfig as FormConfig)?.custom_fields ?? [],
      menu_structure: {
        ...(baseTemplateConfig?.menu_structure || {
          structure_type: 'simple' as const,
          categories: []
        }),
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      calendar_settings: {
        business_hours: {
          monday: { open: '09:00', close: '18:00', closed: false },
          tuesday: { open: '09:00', close: '18:00', closed: false },
          wednesday: { open: '09:00', close: '18:00', closed: false },
          thursday: { open: '09:00', close: '18:00', closed: false },
          friday: { open: '09:00', close: '18:00', closed: false },
          saturday: { open: '09:00', close: '18:00', closed: false },
          sunday: { open: '09:00', close: '18:00', closed: true }
        },
        advance_booking_days: 30
      },
      ui_settings: {
        theme_color: '#3B82F6',
        button_style: 'rounded' as const,
        show_repeat_booking: baseTemplateConfig?.ui_settings?.show_repeat_booking || false,
        show_side_nav: true,
        custom_css: undefined
      },
      validation_rules: {
        required_fields: ['name', 'phone'],
        phone_format: 'japanese' as const,
        name_max_length: 50
      },
      form_type: determinedFormType
    };

    // 新形式のフォームデータを作成（Supabase用）
    const newFormData = {
      store_id: storeId,
      config: supabaseConfig,
      status: 'active' as const,
      draft_status: 'none' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: currentUserId,
      updated_by: currentUserId
    };

    const { data: newForm, error } = await adminClient
      .from('reservation_forms')
      // @ts-expect-error Supabase型の制限をバイパス
      .insert([newFormData as Record<string, unknown>])
      .select()
      .single();

    if (error || !newForm) {
      console.error('[API] Form creation error:', error);
      return NextResponse.json(
        { error: 'フォームの作成に失敗しました' },
        { status: 500 }
      );
    }

    // 🚀 Supabase Storageに初期テンプレートHTMLをデプロイ（staging/production）
    try {
      const generator = new StaticReservationGenerator();
      const deployer = new SupabaseStorageDeployer();

      // FormConfigをそのまま使用してHTMLを生成
      // supabaseConfig は FormConfig 型で構築済み
      const createdFormId = (newForm as Form).id;
      const html = generator.generateHTML(supabaseConfig, createdFormId, storeId);
      const deployResult = await deployer.deployForm(storeId, createdFormId, html, 'reservation');

      console.log(`✅ [${env}] フォーム作成と同時にStorageにデプロイ: ${deployResult.storage_url || deployResult.url}`);

      // デプロイ情報をフォームに反映
      const staticDeploy = {
        deployed_at: new Date().toISOString(),
        deploy_url: deployResult.url,
        storage_url: deployResult.storage_url,
        status: 'deployed' as const
      };

       
      const { error: updateError } = await (adminClient as any)
        .from('reservation_forms')
        .update({ static_deploy: staticDeploy })
        .eq('id', createdFormId);

      if (updateError) {
        console.error('⚠️ デプロイ情報の更新に失敗:', updateError);
      } else {
        // レスポンスに反映して返す
        if (newForm && typeof newForm === 'object' && 'id' in newForm) {
          (newForm as Form).static_deploy = staticDeploy;
        }
      }
    } catch (deployError) {
      console.error('⚠️ Storageデプロイに失敗しましたが、フォーム作成は成功しました:', deployError);
      // デプロイ失敗してもフォーム作成は成功とする
    }

    return NextResponse.json(newForm, { status: 201 });
  } catch (error) {
    console.error('Form creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
