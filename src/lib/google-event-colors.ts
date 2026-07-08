// Google Calendar API で予定（イベント）に指定できる色（colorId '1'〜'11'）
// フォームの「予約イベントの色変更」と、スタッフ選択のスタッフ別イベント色で共用する
export const GOOGLE_EVENT_COLORS: Array<{ id: string; name: string; hex: string }> = [
  { id: '1', name: 'ラベンダー', hex: '#7986CB' },
  { id: '2', name: 'セージ', hex: '#33B679' },
  { id: '3', name: 'ブドウ', hex: '#8E24AA' },
  { id: '4', name: 'フラミンゴ', hex: '#E67C73' },
  { id: '5', name: 'バナナ', hex: '#F6BF26' },
  { id: '6', name: 'ミカン', hex: '#F4511E' },
  { id: '7', name: 'ピーコック', hex: '#039BE5' },
  { id: '8', name: 'グラファイト', hex: '#616161' },
  { id: '9', name: 'ブルーベリー', hex: '#3F51B5' },
  { id: '10', name: 'バジル', hex: '#0B8043' },
  { id: '11', name: 'トマト', hex: '#D50000' },
];
