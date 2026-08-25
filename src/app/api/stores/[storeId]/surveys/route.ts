import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { SurveyForm, SurveyConfig, SurveyQuestion } from '@/types/survey';
import { getAppEnvironment } from '@/lib/env';
import { logFormAudit } from '@/lib/form-audit';
import { createAdminClient } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth-helper';

const DATA_DIR = path.join(process.cwd(), 'data');

// GET /api/stores/[storeId]/surveys - 店舗のアンケート一覧取得
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const env = getAppEnvironment();

    // ローカル環境: JSON から読み込み
    if (env === 'local') {
      const formsPath = path.join(DATA_DIR, `surveys_${storeId}.json`);
      
      if (!fs.existsSync(formsPath)) {
        return NextResponse.json([]);
      }
      
      const data = fs.readFileSync(formsPath, 'utf-8');
      const storeForms = JSON.parse(data);
      
      // ui_settingsが存在しない場合はデフォルト値を設定
      const normalizedForms = storeForms.map((form: SurveyForm) => {
        if (form.config && !form.config.ui_settings) {
          return {
            ...form,
            config: {
              ...form.config,
              ui_settings: {
                submit_button_text: '送信',
                theme_color: form.config.basic_info?.theme_color || '#13ca5e'
              }
            }
          };
        }
        return form;
      });
      
      return NextResponse.json(normalizedForms);
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
      .from('survey_forms')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API] Survey Forms fetch error:', error);
      return NextResponse.json(
        { error: 'アンケートフォームの取得に失敗しました' },
        { status: 500 }
      );
    }

    // ui_settingsが存在しない場合はデフォルト値を設定
    const normalizedForms = (forms || []).map((form: any) => {
      if (form.config && !form.config.ui_settings) {
        return {
          ...form,
          config: {
            ...form.config,
            ui_settings: {
              submit_button_text: '送信',
              theme_color: form.config.basic_info?.theme_color || '#13ca5e'
            }
          }
        };
      }
      return form;
    });

    return NextResponse.json(normalizedForms);
  } catch (error) {
    console.error('Survey Forms fetch error:', error);
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

// POST /api/stores/[storeId]/surveys - 新しいアンケートフォーム作成
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ storeId: string }> }
) {
  try {
    const { storeId } = await params;
    const body = await request.json();
    const { form_name, liff_id, template_config } = body;
    const env = getAppEnvironment();
    
    // 現在のユーザーIDを取得
    const currentUserId = await getCurrentUserId(request);

    // デフォルトの質問テンプレート（要件に基づく）
    const defaultQuestions = [
      { id: 'q1', type: 'text', title: 'ご来店日(例:西暦記載 ○年○月○日)', required: true },
      { id: 'q2', type: 'text', title: 'お名前(漢字フルネーム/ふりがな)', required: true },
      { id: 'q3', type: 'date', title: 'ご来店日(例:西暦記載 ○年○月○日)', required: true },
      { id: 'q4', type: 'date', title: '生年月日(例:西暦記載 ○年○月○日)', required: true },
      { id: 'q5', type: 'text', title: '電話番号', required: true },
      { id: 'q6', type: 'text', title: 'お住まい(都道府県/市区町村まで)', required: true },
      { id: 'q7', type: 'radio', title: 'ご職業', required: true, options: [
        { label: '会社員', value: '会社員' },
        { label: 'パート・アルバイト', value: 'パート・アルバイト' },
        { label: '学生', value: '学生' },
        { label: '専業主婦', value: '専業主婦' },
        { label: 'その他', value: 'その他' }
      ]},
      { id: 'q8', type: 'radio', title: '来店動機', required: true, options: [
        { label: 'HP', value: 'HP' },
        { label: 'Instagram', value: 'Instagram' },
        { label: 'Google等での検索', value: 'Google等での検索' },
        { label: 'ホットペッパービューティー', value: 'ホットペッパービューティー' },
        { label: '知人の紹介', value: '知人の紹介' },
        { label: '通りすがり', value: '通りすがり' },
        { label: 'その他', value: 'その他' }
      ]},
      { id: 'q9', type: 'text', title: '"知人の紹介"を選択された方は、紹介者のお名前をご記入ください。', required: false },
      { id: 'q10', type: 'radio', title: '来店頻度(ネイルサロンにどのくらいの頻度で通っているか)', required: true, options: [
        { label: '2週間に1度', value: '2週間に1度' },
        { label: '3週間に1度', value: '3週間に1度' },
        { label: '1ヵ月に1度', value: '1ヵ月に1度' },
        { label: '2〜3カ月に1度', value: '2〜3カ月に1度' }
      ]},
      { id: 'q11', type: 'radio', title: '薬品/ネイルでのアレルギー', required: true, options: [
        { label: '薬品アレルギー有り', value: '薬品アレルギー有り' },
        { label: '薬品アレルギー無し', value: '薬品アレルギー無し' }
      ]},
      { id: 'q12', type: 'radio', title: '重要項目の同意', required: true, 
        description: `①トークでのご予約の受付・変更・キャンセルについては承っておりません。全てTELにてお願いいたします😊✨ 
\n②当店では施術後の返金対応は致しかねます。気になる箇所がございましたら、お直しは施術後１週間以内のご来店ですと無料(※１週間超えてのご来店ですと本数分計算の有料)で承っておりますのでお気軽にご相談ください。
お問い合わせに関しましては、トークに詳細と合わせ状態のお写真なども添えていただけるとスムーズなやり取りとご案内ができます。
また、TELでも承っており、その場でのご案内が可能です。
※トークの場合、施術対応中などでご返信が遅くなることがございます。
\n③お持ち込みネイルのお問い合わせに関しましては、リピーター様のみ受付ており、全てこちらのLINEにてご対応させて頂きます。 ご予約される前にこちらのLINEに持ち込みデザイン画像とご要望の送信をお願い致します。持ち込みデザインについてのご相談をさせていただきます。また、施術にかかるお時間、料金、ご予約時選択するメニュー等なども合わせてご連絡させていただきます。 
\n④LINEお問い合わせのご対応時間について 営業時間中の10:00〜20:00とさせていただきます。 それ以外の時間のご返信は致しかねますことご了承を願います。 また、営業時間中につきましても施術対応中などにより返信が遅くなる場合がありますことも重ねてご了承を願います。`,
        options: [
          { label: '同意する', value: '同意する' },
          { label: '同意しない', value: '同意しない' }
        ]
      }
    ];

    const newConfig: SurveyConfig = {
      basic_info: {
        title: form_name || 'アンケートフォーム',
        liff_id: liff_id || '',
        theme_color: '#13ca5e'
      },
      questions: (template_config?.questions || defaultQuestions) as SurveyQuestion[],
      ui_settings: {
        submit_button_text: '送信',
        theme_color: '#13ca5e'
      }
    };

    // ローカル環境: JSON に保存
    if (env === 'local') {
      const formsPath = path.join(DATA_DIR, `surveys_${storeId}.json`);
      let storeForms = [];
      
      if (fs.existsSync(formsPath)) {
        const data = fs.readFileSync(formsPath, 'utf-8');
        storeForms = JSON.parse(data);
      }
      
      // ランダムなフォームID生成
      let newFormId: string;
      do {
        newFormId = generateRandomFormId();
      } while (storeForms.some((form: SurveyForm) => form.id === newFormId));

      const newForm: SurveyForm = {
        id: newFormId,
        store_id: storeId,
        config: newConfig,
        status: 'active',
        draft_status: 'none',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      storeForms.push(newForm);
      fs.writeFileSync(formsPath, JSON.stringify(storeForms, null, 2));
      
      return NextResponse.json(newForm);
    }

    // staging/production: Supabase に保存
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Supabase 接続エラー' },
        { status: 500 }
      );
    }

    const { data: newForm, error } = await adminClient
      .from('survey_forms')
      // @ts-expect-error Supabase型定義不足のため
      .insert({
        store_id: storeId,
        name: form_name || 'アンケートフォーム',
        config: newConfig,
        status: 'active',
        draft_status: 'none',
        created_by: currentUserId,
        updated_by: currentUserId
      })
      .select()
      .single();

    if (error) {
      console.error('[API] Survey Form create error:', error);
      return NextResponse.json(
        { error: 'アンケートフォームの作成に失敗しました' },
        { status: 500 }
      );
    }

    await logFormAudit(request, {
      storeId,
      formId: (newForm as unknown as { id: string }).id,
      formType: 'survey',
      action: 'create',
      formName: form_name || 'アンケートフォーム',
    });

    return NextResponse.json(newForm);

  } catch (error) {
    console.error('Survey Form create error:', error);
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
