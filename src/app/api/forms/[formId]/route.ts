import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form } from '@/types/form';

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

// すべての店舗固有フォームデータの読み込み
function readAllStoreForms(): Form[] {
  const allForms: Form[] = [];
  
  if (!fs.existsSync(DATA_DIR)) {
    return allForms;
  }
  
  const files = fs.readdirSync(DATA_DIR);
  const storeFormFiles = files.filter(file => file.startsWith('forms_st') && file.endsWith('.json'));
  
  for (const file of storeFormFiles) {
    try {
      const filePath = path.join(DATA_DIR, file);
      const data = fs.readFileSync(filePath, 'utf-8');
      const storeForms = JSON.parse(data);
      allForms.push(...storeForms);
    } catch (error) {
      console.error(`Error reading ${file}:`, error);
    }
  }
  
  return allForms;
}

// フォーム構造を正規化する関数
export function normalizeForm(form: any): Form {
  // 既にconfig構造を持っている場合はそのまま返す
  if (form.config) {
    return form;
  }
  
  // 新しい簡易形式を従来のconfig形式に変換
  const normalizedForm: Form = {
    id: form.id,
    store_id: form.store_id,
    status: form.status || 'inactive',
    draft_status: form.draft_status || 'draft',
    created_at: form.created_at,
    updated_at: form.updated_at,
    last_published_at: form.last_published_at,
    config: {
      basic_info: {
        form_name: form.form_name || 'フォーム',
        store_name: form.basic_info?.store_name || '',
        liff_id: form.basic_info?.liff_id || form.line_settings?.liff_id || '',
        theme_color: form.basic_info?.theme_color || '#3B82F6'
      },
      visit_options: [],
      gender_selection: {
        enabled: form.basic_info?.show_gender_selection || false,
        required: false,
        options: [
          { value: 'male', label: '男性' },
          { value: 'female', label: '女性' }
        ]
      },
      visit_count_selection: {
        enabled: form.ui_settings?.show_visit_count || false,
        required: false,
        options: [
          { value: 'first', label: '初回' },
          { value: 'repeat', label: '2回目以降' }
        ]
      },
      coupon_selection: {
        enabled: form.ui_settings?.show_coupon_selection || false,
        coupon_name: '',
        options: [
          { value: 'use', label: '利用する' },
          { value: 'not_use', label: '利用しない' }
        ]
      },
      menu_structure: {
        structure_type: 'category_based',
        categories: form.menu_structure?.categories || [],
        display_options: {
          show_price: true,
          show_duration: true,
          show_description: true,
          show_treatment_info: false
        }
      },
      calendar_settings: {
        business_hours: form.business_rules?.business_hours || {
          monday: { open: '09:00', close: '18:00', closed: false },
          tuesday: { open: '09:00', close: '18:00', closed: false },
          wednesday: { open: '09:00', close: '18:00', closed: false },
          thursday: { open: '09:00', close: '18:00', closed: false },
          friday: { open: '09:00', close: '18:00', closed: false },
          saturday: { open: '09:00', close: '18:00', closed: false },
          sunday: { open: '09:00', close: '18:00', closed: true }
        },
        advance_booking_days: form.business_rules?.advance_booking_days || 30
      },
      ui_settings: {
        theme_color: form.basic_info?.theme_color || form.ui_settings?.theme_color || '#3B82F6',
        button_style: form.ui_settings?.button_style || 'rounded',
        show_repeat_booking: form.ui_settings?.show_repeat_booking || false,
        show_side_nav: form.ui_settings?.show_side_nav || true
      },
      validation_rules: {
        required_fields: ['name', 'phone'],
        phone_format: 'japanese',
        name_max_length: 50
      },
      gas_endpoint: form.gas_endpoint || ''
    }
  };
  
  return normalizedForm;
}

// フォームデータの保存
function writeForms(forms: Form[]) {
  initializeDataFile();
  fs.writeFileSync(FORMS_FILE, JSON.stringify(forms, null, 2));
}

// GET /api/forms/[formId] - 個別フォーム取得（お客様向け）
export async function GET(
  request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    
    // まずグローバルフォームから検索
    const globalForms = readForms();
    let form = globalForms.find((f: Form) => f.id === formId);
    
    // グローバルフォームに見つからない場合は、店舗固有フォームから検索
    if (!form) {
      const storeForms = readAllStoreForms();
      form = storeForms.find((f: Form) => f.id === formId);
    }
    
    if (!form) {
      return NextResponse.json(
        { error: 'フォームが見つかりません' }, 
        { status: 404 }
      );
    }

    // フォーム構造を正規化してから返す
    const normalizedForm = normalizeForm(form);
    return NextResponse.json(normalizedForm);
  } catch (error) {
    console.error('Form fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// PUT /api/forms/[formId] - フォーム更新
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    const updatedFormData = await request.json();
    
    // まずグローバルフォームから検索・更新
    const globalForms = readForms();
    const formIndex = globalForms.findIndex((f: Form) => f.id === formId);
    
    if (formIndex !== -1) {
      // グローバルフォームの更新
      const updatedForm: Form = {
        ...globalForms[formIndex],
        ...updatedFormData,
        updated_at: new Date().toISOString()
      };
      
      globalForms[formIndex] = updatedForm;
      writeForms(globalForms);
      
      return NextResponse.json(updatedForm);
    }
    
    // グローバルフォームに見つからない場合は、店舗固有フォームから検索・更新
    const storeForms = readAllStoreForms();
    const storeForm = storeForms.find((f: Form) => f.id === formId);
    
    if (!storeForm) {
      return NextResponse.json(
        { error: 'Form not found' }, 
        { status: 404 }
      );
    }
    
    // 店舗固有フォームの更新
    const storeFormFile = path.join(DATA_DIR, `forms_${storeForm.store_id}.json`);
    if (fs.existsSync(storeFormFile)) {
      const storeFormsData = JSON.parse(fs.readFileSync(storeFormFile, 'utf-8'));
      const storeFormIndex = storeFormsData.findIndex((f: Form) => f.id === formId);
      
      if (storeFormIndex !== -1) {
        const updatedForm: Form = {
          ...storeFormsData[storeFormIndex],
          ...updatedFormData,
          updated_at: new Date().toISOString()
        };
        
        storeFormsData[storeFormIndex] = updatedForm;
        fs.writeFileSync(storeFormFile, JSON.stringify(storeFormsData, null, 2));
        
        return NextResponse.json(updatedForm);
      }
    }
    
    return NextResponse.json(
      { error: 'Form not found' }, 
      { status: 404 }
    );
  } catch (error) {
    console.error('Form update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}

// DELETE /api/forms/[formId] - フォーム削除
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ formId: string }> }
) {
  try {
    const { formId } = await params;
    
    // まずグローバルフォームから検索・削除
    const globalForms = readForms();
    const globalFormIndex = globalForms.findIndex((f: Form) => f.id === formId);
    
    if (globalFormIndex !== -1) {
      // グローバルフォームの削除
      const deletedForm = globalForms[globalFormIndex];
      globalForms.splice(globalFormIndex, 1);
      writeForms(globalForms);
      
      return NextResponse.json({ 
        success: true, 
        message: 'フォームを削除しました',
        deletedForm: {
          id: deletedForm.id,
          name: (deletedForm as any).form_name || deletedForm.config?.basic_info?.form_name || 'フォーム'
        }
      });
    }
    
    // グローバルフォームに見つからない場合は、店舗固有フォームから検索・削除
    const storeForms = readAllStoreForms();
    const storeForm = storeForms.find((f: Form) => f.id === formId);
    
    if (!storeForm) {
      return NextResponse.json(
        { error: 'フォームが見つかりません' }, 
        { status: 404 }
      );
    }
    
    // 店舗固有フォームの削除
    const storeFormFile = path.join(DATA_DIR, `forms_${storeForm.store_id}.json`);
    if (fs.existsSync(storeFormFile)) {
      const storeFormsData = JSON.parse(fs.readFileSync(storeFormFile, 'utf-8'));
      const storeFormIndex = storeFormsData.findIndex((f: Form) => f.id === formId);
      
      if (storeFormIndex !== -1) {
        const deletedForm = storeFormsData[storeFormIndex];
        storeFormsData.splice(storeFormIndex, 1);
        fs.writeFileSync(storeFormFile, JSON.stringify(storeFormsData, null, 2));
        
        return NextResponse.json({ 
          success: true, 
          message: 'フォームを削除しました',
          deletedForm: {
            id: deletedForm.id,
            name: (deletedForm as any).form_name || deletedForm.config?.basic_info?.form_name || 'フォーム'
          }
        });
      }
    }
    
    return NextResponse.json(
      { error: 'フォームが見つかりません' }, 
      { status: 404 }
    );
  } catch (error) {
    console.error('Form deletion error:', error);
    return NextResponse.json(
      { error: 'フォームの削除に失敗しました' }, 
      { status: 500 }
    );
  }
}
