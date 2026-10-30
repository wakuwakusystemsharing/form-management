// 外部予約メール連携: 設定画面の「連携の進め方」ガイド（純粋ロジック）
//
// 画面の状態から「どこまで終わっていて、次に何をすればよいか」を出すためのもの。
// 文言はここで管理し、画面のボタン名・項目名と同じ言葉を使う。

export type MailGuideStepStatus = 'done' | 'current' | 'todo';

export interface MailGuideStepInput {
  /** 店舗に Google カレンダーが設定されているか */
  hasStoreCalendar: boolean;
  /** 連携 ON で保存済み（受信アドレスが発行されている） */
  hasInboundAddress: boolean;
  /** 連携 ON のまま保存されているか（画面上のトグルではなく保存済みの値） */
  enabledSaved: boolean;
  /** 受信ログに「登録済み」が 1 件以上あるか */
  hasCreatedLog: boolean;
  /** 受信ログに Gmail の転送確認メールがあるか */
  hasGmailForwardingLog: boolean;
}

export interface MailGuideStep {
  key: 'calendar' | 'enable' | 'forward' | 'duration' | 'verify';
  title: string;
  /** 誰がやるか（弊社 = テナント管理者 / 店舗） */
  who: '弊社' | '店舗' | '弊社・店舗';
  lines: string[];
  status: MailGuideStepStatus;
}

export const MAIL_GUIDE_INTRO =
  'ホットペッパービューティー / エキテンの予約通知メールを、この店舗専用の受信用アドレスへ届くようにするだけで、Google カレンダーに予約の予定が自動で入ります。設定は上から順に進めてください。';

/** 媒体の通知先を変える方法と Gmail の自動転送、どちらを案内するかの説明 */
export const MAIL_GUIDE_FORWARD_OPTIONS = [
  {
    title: '方法 A: Gmail の自動転送（おすすめ）',
    lines: [
      '店舗の Gmail で「設定 → メール転送と POP/IMAP → 転送先アドレスを追加」から受信用アドレスを登録します。',
      'Google から「転送の確認」メールが受信用アドレス宛てに届きます。店舗には届かないので、この画面の「受信ログ」に出る「Gmail転送の確認メール」を開き、本文の確認リンク（または確認コード）で転送を完了してください。',
      '転送対象を予約通知だけに絞るには、Gmail の「フィルタ」で差出人（salonboard.com / ekiten.jp）を条件にして「転送する」を選びます。',
    ],
  },
  {
    title: '方法 B: 媒体の通知先メールアドレスに直接設定',
    lines: [
      'サロンボード / エキテンの管理画面で、予約通知の送信先に受信用アドレスを追加します（店舗のアドレスは残しておくと安心です）。',
      '確認メールの手順が無いぶん簡単ですが、媒体側で通知先を複数登録できない場合は方法 A を使ってください。',
    ],
  },
];

export const MAIL_GUIDE_NOTES = [
  '対応している媒体はホットペッパービューティー（サロンボード）とエキテンの「予約が入りました」メールです。それ以外のメールは受信ログに「未処理」として残るだけで、予定は作りません。',
  '媒体からのキャンセル・変更メールはまだ自動では反映しません。予定の削除は店舗管理者ページの予約管理から「キャンセル」してください（Google カレンダーの予定も消えます）。媒体側の予約は別途キャンセルが必要です。',
  '連携で入った予定は予約フォームの空き状況（〇✕）にも反映されるため、媒体経由の予約と LINE 予約のダブルブッキングを防げます。',
  '同じ予約番号のメールが 2 回届いても、予定は 1 つしか作りません（重複スキップ）。',
  '受信ログに「解析失敗」が出たら、詳細を開いて原文を確認し、弊社へご連絡ください。',
];

/** 現在の状態から各ステップの進み具合を出す */
export function buildMailGuideSteps(input: MailGuideStepInput): MailGuideStep[] {
  const calendarDone = input.hasStoreCalendar;
  const enableDone = input.hasInboundAddress && input.enabledSaved;
  // 転送設定は本システムからは見えないので、受信ログに登録済みが出た時点で完了扱い
  const forwardDone = input.hasCreatedLog;
  const verifyDone = input.hasCreatedLog;

  const flags = [calendarDone, enableDone, forwardDone, true, verifyDone];
  let currentAssigned = false;
  const statusOf = (index: number): MailGuideStepStatus => {
    if (flags[index]) return 'done';
    if (!currentAssigned) {
      currentAssigned = true;
      return 'current';
    }
    return 'todo';
  };

  const forwardLines = [
    '予約通知メールが受信用アドレスへ届くようにします（下の「方法 A / B」のどちらか）。',
  ];
  if (input.hasGmailForwardingLog && !forwardDone) {
    forwardLines.push('受信ログに「Gmail転送の確認メール」が届いています。開いて確認リンク（またはコード）で転送を完了してください。');
  }

  return [
    {
      key: 'calendar',
      title: '店舗の Google カレンダーを設定する',
      who: '弊社',
      lines: [
        '店舗詳細の「カレンダー設定」で、カレンダーを作成するか店舗の Google アカウントと連携します。',
        '予定はこのカレンダーに入ります。未設定だと受信しても予定を作れません。',
      ],
      status: statusOf(0),
    },
    {
      key: 'enable',
      title: '連携を ON にして「保存」する',
      who: '弊社',
      lines: [
        '右上のスイッチを ON にして「保存」を押すと、この店舗専用の「受信用アドレス」が発行されます。',
        '発行されたアドレスは「コピー」で控え、店舗へ伝えます（下の「店舗への案内文」が使えます）。',
      ],
      status: statusOf(1),
    },
    {
      key: 'forward',
      title: '予約通知メールを受信用アドレスへ転送する',
      who: '店舗',
      lines: forwardLines,
      status: statusOf(2),
    },
    {
      key: 'duration',
      title: '所要時間を決める（任意）',
      who: '弊社・店舗',
      lines: [
        '予定の長さは「メール本文の所要時間 → メニュー別所要時間ルール → デフォルト所要時間」の順で決まります。',
        'ホットペッパーは本文に所要時間があることが多く、エキテンは無いことが多いので、メニュー名のキーワード（例: カット = 60 分）をルールに登録しておくと正確になります。',
      ],
      status: statusOf(3),
    },
    {
      key: 'verify',
      title: '受信ログで「登録済み」を確認する',
      who: '弊社・店舗',
      lines: [
        '転送設定後、実際の予約通知（またはテスト予約）が届くと「受信ログ」に行が増え、状態が「登録済み」なら Google カレンダーにも予定が入っています。',
        '「解析失敗」「未処理」のときは詳細を開いて原因を確認してください。「連携がOFF」と出る場合は手順 2 を見直します。',
      ],
      status: statusOf(4),
    },
  ];
}

/** 店舗へそのまま送れる案内文（受信アドレス入り） */
export function buildStoreGuideText(storeName: string, inboundAddress: string | null): string {
  const address = inboundAddress || '（連携を ON にして保存すると発行されます）';
  const name = storeName ? `${storeName} ご担当者様` : 'ご担当者様';
  return [
    name,
    '',
    'ホットペッパービューティー / エキテンの予約通知メールを、以下の受信用アドレスへ転送していただくと、Google カレンダーに予約の予定が自動で登録されるようになります。',
    '',
    `■ 受信用アドレス`,
    address,
    '',
    '■ 設定方法（Gmail をお使いの場合）',
    '1. Gmail の右上の歯車 → 「すべての設定を表示」→「メール転送と POP/IMAP」を開く',
    '2. 「転送先アドレスを追加」で上記の受信用アドレスを入力して「次へ」→「続行」→「OK」',
    '3. Google から確認メールが送られますが、そのメールは弊社側に届きます。弊社で確認コードを確認してご連絡しますので、そのまま少々お待ちください',
    '4. 確認が完了したら、同じ画面で「受信メールを（受信用アドレス）に転送して Gmail のメールを受信トレイに残す」を選んで「変更を保存」',
    '   ※ 予約通知だけを転送したい場合は「フィルタとブロック中のアドレス」→「新しいフィルタを作成」で差出人を指定し、「転送する」にチェックしてください',
    '',
    '■ 媒体の管理画面で通知先を追加できる場合',
    'サロンボード / エキテンの「予約通知メールの送信先」に上記の受信用アドレスを追加していただく方法でも構いません。',
    '',
    '設定後に予約が入ると、Google カレンダーに「HPB予約, お名前」「エキテン予約, お名前」という予定が自動で入ります。',
    'キャンセル・変更は自動では反映されませんので、カレンダーの予定はお手数ですが手動で直してください。',
    '',
    'ご不明な点があればお気軽にご連絡ください。',
  ].join('\n');
}
