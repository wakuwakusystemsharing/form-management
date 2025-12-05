import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SurveyForm } from '@/types/survey';
import { getAppEnvironment } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase';
import { StaticSurveyGenerator } from '@/lib/static-generator-survey';

const DATA_DIR = path.join(process.cwd(), 'data');

export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string; formId: string }> }
) {
  try {
    const { formId } = await params;
    const env = getAppEnvironment();
    let form: SurveyForm | null = null;

    // ローカル環境
    if (env === 'local') {
      if (fs.existsSync(DATA_DIR)) {
        const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('surveys_') && f.endsWith('.json'));
        
        for (const file of files) {
          const filePath = path.join(DATA_DIR, file);
          const data = fs.readFileSync(filePath, 'utf-8');
          const forms = JSON.parse(data);
          const found = forms.find((f: SurveyForm) => f.id === formId);
          
          if (found) {
            form = found;
            break;
          }
        }
      }
    } else {
      // staging/production
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data, error } = await adminClient
          .from('survey_forms')
          .select('*')
          .eq('id', formId)
          .single();

        if (!error && data) {
          form = data as SurveyForm;
        }
      }
    }

    if (!form) {
      return new NextResponse('Form not found', { status: 404 });
    }

    const generator = new StaticSurveyGenerator();
    const html = generator.generateHTML(form.config);

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
      },
    });

  } catch (error) {
    console.error('Preview error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
