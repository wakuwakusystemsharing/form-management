import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form } from '@/types/form';
import { StaticFormGenerator } from '@/lib/static-generator';
import { VercelBlobDeployer } from '@/lib/vercel-blob-deployer';

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

// フォームデータの保存
function writeForms(forms: Form[]) {
  initializeDataFile();
  fs.writeFileSync(FORMS_FILE, JSON.stringify(forms, null, 2));
}

// GET /api/stores/[storeId]/forms - 店舗のフォーム一覧取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    
    // 新しい形式のフォームファイルを読み込み
    const formsPath = path.join(DATA_DIR, `forms_${storeId}.json`);
    
    if (!fs.existsSync(formsPath)) {
      return NextResponse.json([]);
    }
    
    const data = fs.readFileSync(formsPath, 'utf-8');
    const storeForms = JSON.parse(data);
    
    return NextResponse.json(storeForms);
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
        liff_id: liff_id || '',
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
        button_style: 'rounded',
        show_repeat_booking: template.config?.ui_settings?.show_repeat_booking || false,
        show_side_nav: true,
        show_visit_count: template.config?.ui_settings?.show_visit_count || false,
        show_coupon_selection: template.config?.ui_settings?.show_coupon_selection || false,
        custom_css: undefined
      },
      gas_endpoint: gas_endpoint || ''
    } : {
      basic_info: {
        form_name: form_name || 'フォーム',
        store_name: '', // TODO: 店舗名を取得
        liff_id: liff_id || '',
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
        button_style: 'rounded',
        show_repeat_booking: false,
        show_side_nav: true,
        show_visit_count: false,
        show_coupon_selection: false,
        custom_css: undefined
      },
      gas_endpoint: gas_endpoint || ''
    };

    const newForm = {
      id: newFormId,
      store_id: storeId,
      form_name: form_name || 'フォーム',
      ...baseConfig,
      line_settings: {
        liff_id: liff_id || ''
      },
      business_rules: {
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
      status: 'inactive',
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
          enabled: baseConfig.ui_settings.show_visit_count || false,
          required: false,
          options: [
            { value: 'first', label: '初回' },
            { value: 'repeat', label: '2回目以降' }
          ]
        },
        coupon_selection: {
          enabled: baseConfig.ui_settings.show_coupon_selection || false,
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
          business_hours: newForm.business_rules.business_hours,
          advance_booking_days: newForm.business_rules.advance_booking_days
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
      (newForm as any).static_deploy = {
        deployed_at: new Date().toISOString(),
        deploy_url: deployResult.url,
        blob_url: deployResult.blob_url,
        status: 'deployed',
        environment: deployResult.environment
      };
      
      // 更新を保存
      fs.writeFileSync(formsPath, JSON.stringify(storeForms, null, 2));
    } catch (deployError) {
      console.error('⚠️ Blobデプロイに失敗しましたが、フォーム作成は成功しました:', deployError);
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
