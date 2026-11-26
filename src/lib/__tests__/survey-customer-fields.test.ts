import { describe, expect, it } from 'vitest';
import {
  buildCustomerFieldPatch,
  buildCustomerRowFromSurvey,
  collectSurveyCustomerFieldValues,
  convertAnswerForCustomerField,
  customerFieldTargetsFor,
  resolveCustomerFieldLink,
  sanitizeCustomerFieldLink,
  type SurveyCustomerFieldValue,
} from '@/lib/survey-customer-fields';
import type { SurveyQuestion } from '@/types/survey';

const NOW = new Date('2026-11-26T03:00:00Z');
const q = (patch: Partial<SurveyQuestion>): SurveyQuestion => ({ id: 'q', type: 'text', title: '質問', required: false, ...patch });
const val = (target: SurveyCustomerFieldValue['target'], value: string, overwrite = false, title = '質問'): SurveyCustomerFieldValue => ({ target, value, overwrite, title });

describe('入れ先の決まり方', () => {
  it('誕生日選択・住所入力は、何も設定しなくても自動で入る', () => {
    expect(resolveCustomerFieldLink(q({ type: 'birthday' }))).toEqual({ target: 'birthday', overwrite: false, auto: true });
    expect(resolveCustomerFieldLink(q({ type: 'address' }))).toEqual({ target: 'address', overwrite: false, auto: true });
    expect(resolveCustomerFieldLink(q({ type: 'text' }))).toBeNull();
  });

  it('「反映しない」を選ぶと、自動の反映も止まる', () => {
    expect(resolveCustomerFieldLink(q({ type: 'birthday', customer_field: { target: 'none' } }))).toBeNull();
  });

  it('選んだ入れ先と上書きの設定を使う。メモは上書きにならない', () => {
    expect(resolveCustomerFieldLink(q({ customer_field: { target: 'phone', overwrite: true } }))).toEqual({ target: 'phone', overwrite: true, auto: false });
    expect(resolveCustomerFieldLink(q({ customer_field: { target: 'notes', overwrite: true } }))).toEqual({ target: 'notes', overwrite: false, auto: false });
  });

  it('回答タイプに合わない入れ先は使わない（回答タイプを変えたあとの残り）', () => {
    expect(resolveCustomerFieldLink(q({ type: 'checkbox', customer_field: { target: 'phone' } }))).toBeNull();
    expect(resolveCustomerFieldLink(q({ type: 'birthday', customer_field: { target: 'name' } }))).toEqual({ target: 'birthday', overwrite: false, auto: true });
    expect(customerFieldTargetsFor('multiple_dates')).toEqual([]);
    expect(customerFieldTargetsFor('radio')).toContain('gender');
  });

  it('保存する形: 未設定・おかしな値はキーを持たない', () => {
    expect(sanitizeCustomerFieldLink('text', undefined)).toBeUndefined();
    expect(sanitizeCustomerFieldLink('text', { target: 'x' })).toBeUndefined();
    expect(sanitizeCustomerFieldLink('text', { target: 'none' })).toBeUndefined();
    expect(sanitizeCustomerFieldLink('address', { target: 'none' })).toEqual({ target: 'none' });
    expect(sanitizeCustomerFieldLink('text', { target: 'name', overwrite: true, extra: 1 })).toEqual({ target: 'name', overwrite: true });
    expect(sanitizeCustomerFieldLink('text', { target: 'notes', overwrite: true })).toEqual({ target: 'notes' });
    expect(sanitizeCustomerFieldLink('checkbox', { target: 'name' })).toBeUndefined();
  });
});

describe('回答 → 顧客の項目の値', () => {
  it('誕生日: いろいろな書き方を YYYY-MM-DD にする。ありえない日・未来の日は入れない', () => {
    expect(convertAnswerForCustomerField('birthday', '1990-04-05', NOW)).toBe('1990-04-05');
    expect(convertAnswerForCustomerField('birthday', '1990年4月5日', NOW)).toBe('1990-04-05');
    expect(convertAnswerForCustomerField('birthday', '１９９０/４/５', NOW)).toBe('1990-04-05');
    expect(convertAnswerForCustomerField('birthday', '1990-02-30', NOW)).toBeNull();
    expect(convertAnswerForCustomerField('birthday', '2027-01-01', NOW)).toBeNull();
    expect(convertAnswerForCustomerField('birthday', '4月5日', NOW)).toBeNull();
  });

  it('性別: 男性 / 女性 / その他 だけを入れる', () => {
    expect(convertAnswerForCustomerField('gender', '男性')).toBe('male');
    expect(convertAnswerForCustomerField('gender', '女')).toBe('female');
    expect(convertAnswerForCustomerField('gender', 'その他（回答しない）')).toBe('other');
    expect(convertAnswerForCustomerField('gender', '回答しない')).toBeNull();
  });

  it('電話番号・メール: 形のおかしいものは入れない', () => {
    expect(convertAnswerForCustomerField('phone', '０９０－１２３４－５６７８')).toBe('090-1234-5678');
    expect(convertAnswerForCustomerField('phone', '090 1234 5678')).toBe('09012345678');
    expect(convertAnswerForCustomerField('phone', 'なし')).toBeNull();
    expect(convertAnswerForCustomerField('phone', '12345')).toBeNull();
    expect(convertAnswerForCustomerField('email', 'a@example.com')).toBe('a@example.com');
    expect(convertAnswerForCustomerField('email', 'aあ')).toBeNull();
  });

  it('空・未記入は入れない。複数選択は ", " でつなぐ。長すぎる文は切る', () => {
    expect(convertAnswerForCustomerField('name', '  ')).toBeNull();
    expect(convertAnswerForCustomerField('name', '未記入')).toBeNull();
    expect(convertAnswerForCustomerField('allergies', ['卵', '小麦'])).toBe('卵, 小麦');
    expect(convertAnswerForCustomerField('allergies', 'あ'.repeat(600))).toHaveLength(500);
  });
});

describe('回答から値を集める', () => {
  const config = {
    questions: [
      q({ id: 'a', title: 'お名前', customer_field: { target: 'name' } }),
      q({ id: 'b', type: 'birthday', title: 'お誕生日' }),
      q({ id: 'c', type: 'address', title: 'ご住所' }),
      q({ id: 'd', type: 'birthday', title: 'お子様のお誕生日', customer_field: { target: 'none' } }),
      q({ id: 'e', type: 'checkbox', title: 'アレルギー', customer_field: { target: 'allergies', overwrite: true } }),
      q({ id: 'f', type: 'textarea', title: 'ご要望', customer_field: { target: 'notes' } }),
      q({ id: 'g', title: '感想' }),
    ],
  };

  it('設定した質問と、誕生日選択・住所入力の回答だけを集める', () => {
    const values = collectSurveyCustomerFieldValues(config, { お名前: '山田 花子', お誕生日: '1990-04-05', ご住所: '〒150-0001 東京都渋谷区神宮前1-2-3', お子様のお誕生日: '2020-01-01', アレルギー: '卵, 小麦', ご要望: '静かな席', 感想: 'よかった' }, NOW);
    expect(values).toEqual([
      val('name', '山田 花子', false, 'お名前'),
      val('birthday', '1990-04-05', false, 'お誕生日'),
      val('address', '〒150-0001 東京都渋谷区神宮前1-2-3', false, 'ご住所'),
      val('allergies', '卵, 小麦', true, 'アレルギー'),
      val('notes', '静かな席', false, 'ご要望'),
    ]);
  });

  it('回答に無い質問（非表示だった・未回答）は集めない', () => {
    expect(collectSurveyCustomerFieldValues(config, { お名前: '' }, NOW)).toEqual([]);
    expect(collectSurveyCustomerFieldValues(config, null, NOW)).toEqual([]);
    expect(collectSurveyCustomerFieldValues(null, { お名前: 'x' }, NOW)).toEqual([]);
  });

  it('同じ入れ先の質問が 2 つあるときは、上の質問の入れられる回答を使う', () => {
    const two = { questions: [q({ id: 'a', type: 'birthday', title: '誕生日1' }), q({ id: 'b', type: 'birthday', title: '誕生日2' })] };
    expect(collectSurveyCustomerFieldValues(two, { 誕生日1: '', 誕生日2: '1985-01-02' }, NOW).map((v) => v.value)).toEqual(['1985-01-02']);
    expect(collectSurveyCustomerFieldValues(two, { 誕生日1: '1980-01-01', 誕生日2: '1985-01-02' }, NOW).map((v) => v.value)).toEqual(['1980-01-01']);
  });
});

describe('顧客に入れる内容', () => {
  it('空の項目にだけ入れる。入っている項目は変えない', () => {
    const patch = buildCustomerFieldPatch({ name: '山田 花子', birthday: '1990-04-05', phone: null, address: '' }, [val('birthday', '1991-01-01'), val('phone', '090-1234-5678'), val('address', '東京都')]);
    expect(patch).toEqual({ phone: '090-1234-5678', address: '東京都' });
  });

  it('「毎回上書きする」の質問は、入っていても書き換える。同じ値なら何もしない', () => {
    expect(buildCustomerFieldPatch({ name: 'x', allergies: '卵' }, [val('allergies', '卵, 小麦', true)])).toEqual({ allergies: '卵, 小麦' });
    expect(buildCustomerFieldPatch({ name: 'x', allergies: '卵' }, [val('allergies', '卵', true)])).toEqual({});
  });

  it('お名前: 未記入・LINE の表示名のままなら入れる。店舗が入れた名前は変えない', () => {
    expect(buildCustomerFieldPatch({ name: '未記入' }, [val('name', '山田 花子')])).toEqual({ name: '山田 花子' });
    expect(buildCustomerFieldPatch({ name: 'はなこ🌸', line_display_name: 'はなこ🌸' }, [val('name', '山田 花子')])).toEqual({ name: '山田 花子' });
    expect(buildCustomerFieldPatch({ name: '山田 花子', line_display_name: 'はなこ🌸' }, [val('name', '別の名前')])).toEqual({});
  });

  it('性別の unknown・電話番号の 未記入 は空として扱う', () => {
    expect(buildCustomerFieldPatch({ name: 'x', gender: 'unknown', phone: '未記入' }, [val('gender', 'female'), val('phone', '09012345678')])).toEqual({ gender: 'female', phone: '09012345678' });
  });

  it('メモは上書きせず「質問名: 回答」を 1 行足す。同じ行は 2 回足さない', () => {
    expect(buildCustomerFieldPatch({ name: 'x', notes: '店舗のメモ' }, [val('notes', '静かな席', false, 'ご要望')])).toEqual({ notes: '店舗のメモ\nご要望: 静かな席' });
    expect(buildCustomerFieldPatch({ name: 'x', notes: '店舗のメモ\nご要望: 静かな席' }, [val('notes', '静かな席', false, 'ご要望')])).toEqual({});
    expect(buildCustomerFieldPatch({ name: 'x', notes: null }, [val('notes', 'A', false, 'Q1'), val('notes', 'B', false, 'Q2')])).toEqual({ notes: 'Q1: A\nQ2: B' });
    expect(buildCustomerFieldPatch({ name: 'x', notes: 'あ'.repeat(4995) }, [val('notes', '長い文', false, 'Q')])).toEqual({});
  });

  it('友だちだけの顧客は、何か入ったら通常の顧客にする（お名前も入る）', () => {
    expect(buildCustomerFieldPatch({ name: 'はなこ', line_friend_only: true }, [val('name', '山田 花子'), val('birthday', '1990-04-05')])).toEqual({ name: '山田 花子', birthday: '1990-04-05', line_friend_only: false });
    expect(buildCustomerFieldPatch({ name: 'はなこ', line_friend_only: true }, [])).toEqual({});
  });

  it('顧客がまだ居ない回答者の行: お名前は 回答 → LINE の表示名 → 「LINE 友だち」', () => {
    expect(buildCustomerRowFromSurvey({ storeId: 's1', lineUserId: 'U1', lineDisplayName: 'はなこ', lineFriend: true, values: [val('name', '山田 花子'), val('birthday', '1990-04-05')] })).toEqual({
      store_id: 's1',
      line_user_id: 'U1',
      name: '山田 花子',
      line_display_name: 'はなこ',
      line_friend_flag: true,
      customer_type: 'new',
      tags: [],
      birthday: '1990-04-05',
    });
    expect(buildCustomerRowFromSurvey({ storeId: 's1', lineUserId: 'U1', values: [val('birthday', '1990-04-05')] })).toMatchObject({ name: 'LINE 友だち', line_friend_flag: false, birthday: '1990-04-05' });
    expect(buildCustomerRowFromSurvey({ storeId: 's1', lineUserId: 'U1', lineDisplayName: 'はなこ', values: [val('notes', 'A', false, 'Q')] })).toMatchObject({ name: 'はなこ', notes: 'Q: A' });
  });
});
