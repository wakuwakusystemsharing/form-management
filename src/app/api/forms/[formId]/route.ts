import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Form } from '@/types/form';
import { normalizeForm } from '@/lib/form-normalizer';

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
