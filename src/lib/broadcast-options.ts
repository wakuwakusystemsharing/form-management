/**
 * 配信先の条件を選ぶための選択肢（純粋ロジック）
 * 予約フォームのメニュー構成からメニュー名、アンケートから「質問 → 選択肢」を取り出す
 */

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Rec[]) : []);

function configOf(form: unknown): Rec {
  const f = form && typeof form === 'object' ? (form as Rec) : {};
  let config = f.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch {
      config = null;
    }
  }
  return config && typeof config === 'object' ? (config as Rec) : {};
}

/**
 * 予約フォームのメニュー名の一覧（重複なし・登場順）。サブメニューがあれば「メニュー > サブメニュー」も出す。
 * 配信先の判定（menuLabelsOf）と同じ表記
 */
export function menuNamesFromForms(forms: unknown[]): string[] {
  const out: string[] = [];
  const push = (name: string) => {
    if (name && !out.includes(name)) out.push(name);
  };
  for (const form of forms) {
    const structure = configOf(form).menu_structure;
    const categories = arr(structure && typeof structure === 'object' ? (structure as Rec).categories : null);
    for (const cat of categories) {
      for (const m of arr(cat.menus)) {
        const name = str(m.name);
        if (!name) continue;
        push(name);
        for (const sub of arr(m.sub_menu_items)) {
          const subName = str(sub.name);
          if (subName) push(`${name} > ${subName}`);
        }
      }
    }
  }
  return out;
}

export interface SurveyChoiceOption {
  form_id: string;
  form_name: string;
  questions: Array<{ title: string; options: string[] }>;
}

/** アンケートごとの「選択式の質問 → 選択肢」（単一 / 複数 / ドロップダウン。選択肢の無い質問は出さない） */
export function surveyChoicesFromForms(surveys: unknown[]): SurveyChoiceOption[] {
  const out: SurveyChoiceOption[] = [];
  for (const form of surveys) {
    const f = form && typeof form === 'object' ? (form as Rec) : {};
    const id = str(f.id);
    if (!id) continue;
    const config = configOf(form);
    const basic = config.basic_info && typeof config.basic_info === 'object' ? (config.basic_info as Rec) : {};
    const questions: SurveyChoiceOption['questions'] = [];
    for (const q of arr(config.questions)) {
      if (!['radio', 'checkbox', 'select'].includes(str(q.type))) continue;
      const title = str(q.title);
      const options = arr(q.options).map((o) => str(o.label) || str(o.value)).filter(Boolean);
      if (title && options.length > 0) questions.push({ title, options: [...new Set(options)] });
    }
    if (questions.length > 0) out.push({ form_id: id, form_name: str(basic.title) || str(basic.form_name) || str(f.name) || 'アンケート', questions });
  }
  return out;
}

/** 予約フォームの ID と名前 */
export function formOptionsFromForms(forms: unknown[]): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  for (const form of forms) {
    const f = form && typeof form === 'object' ? (form as Rec) : {};
    const id = str(f.id);
    if (!id) continue;
    const config = configOf(form);
    const basic = config.basic_info && typeof config.basic_info === 'object' ? (config.basic_info as Rec) : {};
    out.push({ id, name: str(basic.form_name) || str(f.form_name) || str(f.name) || '予約フォーム' });
  }
  return out;
}
