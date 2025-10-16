import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form } from '@/types/form';
import { StaticFormGenerator } from '@/lib/static-generator';
import { VercelBlobDeployer } from '@/lib/vercel-blob-deployer';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: forms, error } = await (adminClient as any)
      .from('forms')
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
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const { form_name, liff_id, gas_endpoint, template } = body;
    const env = getAppEnvironment();

    // ローカル環境: JSON に保存
    if (env === 'local') {
      const forms = readForms();
      
      // ランダムなフォームID生成（重複チェック付き）
      let newFormId: string;
      do {
        newFormId = generateRandomFormId();
      } while (forms.some((form: Form) => form.id === newFormId));

    // テンプレートから基本設定を作成
    const baseConfig = template ? {
      basic_info: {
        form_name: form_name || 'フォーム',
        store_name: '', // TODO: 店舗名を取得
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
        custom_css: undefined
      },
      gas_endpoint: gas_endpoint || ''
    } : {
      basic_info: {
        form_name: form_name || 'フォーム',
        store_name: '', // TODO: 店舗名を取得
        theme_color: '#3B82F6',
        logo_url: undefined,
        show_gender_selection: false
      },
      menu_structure: {
        structure_type: 'simple',
        categories: []
      },
      ui_settings: {
        theme_color: '#3B82F6',
        button_style: 'rounded' as const,
        show_repeat_booking: false,
        show_side_nav: true,
        custom_css: undefined
      },
      gas_endpoint: gas_endpoint || ''
    };

    const newForm: Form = {
      id: newFormId,
      store_id: storeId,
      form_name: form_name || 'フォーム',
      line_settings: {
        liff_id: liff_id || ''
      },
      gas_endpoint: gas_endpoint || '',
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
        gender_selection: { enabled: false, required: false, options: [] },
        visit_count_selection: { enabled: false, required: false, options: [] },
        coupon_selection: { enabled: false, options: [] },
        menu_structure: {
          ...baseConfig.menu_structure,
          display_options: {
            show_price: true,
            show_duration: true,
            show_description: true,
            show_treatment_info: false
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
      status: 'inactive',
      draft_status: 'none',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as any;

    // 新しいフォーム形式で保存
    const formsPath = path.join(DATA_DIR, `forms_${storeId}.json`);
    let storeForms = [];
    
    if (fs.existsSync(formsPath)) {
      const data = fs.readFileSync(formsPath, 'utf-8');
      storeForms = JSON.parse(data);
    }
    
    storeForms.push(newForm);
    fs.writeFileSync(formsPath, JSON.stringify(storeForms, null, 2));

    // 🚀 自動的にVercel Blobに初期テンプレートHTMLをデプロイ（公開ステータス）
    try {
      const generator = new StaticFormGenerator();
      const deployer = new VercelBlobDeployer();
      
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
          enabled: false,
          required: false,
          options: [
            { value: 'first', label: '初回' },
            { value: 'repeat', label: '2回目以降' }
          ]
        },
        coupon_selection: {
          enabled: false,
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
        },
        gas_endpoint: baseConfig.gas_endpoint
      };
      
      const html = generator.generateHTML(formConfig);
      const deployResult = await deployer.deployForm(storeId, newFormId, html);
      
      console.log(`✅ フォーム作成と同時にBlobにデプロイ: ${deployResult.blob_url || deployResult.url}`);
      
      // デプロイ情報をフォームに追加
      newForm.static_deploy = {
        deployed_at: new Date().toISOString(),
        deploy_url: deployResult.url,
        status: 'deployed'
      };
      
      // 更新を保存
      fs.writeFileSync(formsPath, JSON.stringify(storeForms, null, 2));
      } catch (deployError) {
        console.error('⚠️ Blobデプロイに失敗しましたが、フォーム作成は成功しました:', deployError);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newFormData: any = {
      store_id: storeId,
      form_name: form_name || 'フォーム',
      line_settings: {
        liff_id: liff_id || ''
      },
      gas_endpoint: gas_endpoint || '',
      config: template?.config || {
        basic_info: {
          show_gender_selection: false
        },
        menu_structure: {
          structure_type: 'simple',
          categories: []
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
        }
      },
      ui_settings: template?.config?.ui_settings || {
        theme_color: '#3B82F6',
        button_style: 'rounded',
        show_repeat_booking: false,
        show_side_nav: true
      },
      status: 'inactive',
      draft_status: 'none'
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newForm, error } = await (adminClient as any)
      .from('forms')
      .insert([newFormData])
      .select()
      .single();

    if (error || !newForm) {
      console.error('[API] Form creation error:', error);
      return NextResponse.json(
        { error: 'フォームの作成に失敗しました' },
        { status: 500 }
      );
    }

    // TODO: Vercel Blobデプロイも staging/production で対応する場合はここに追加

    return NextResponse.json(newForm, { status: 201 });
  } catch (error) {
    console.error('Form creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
