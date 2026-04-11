import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ArrowLeft, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "LINE予約フォーム管理",
  description: "LINEアプリ内で予約フォームを表示。メニュー・料金・時間帯を自由にカスタマイズできます。",
};

const sections = [
  {
    title: "メニュー設定",
    items: [
      "メニュー名・料金・所要時間を自由に設定",
      "カテゴリ別にメニューを整理（例: カット、カラー、パーマ）",
      "サブメニューで料金バリエーションに対応（例: ショート / ミディアム / ロング）",
      "オプション追加（トリートメント、ヘッドスパなど）",
      "メニュー画像のアップロード",
      "料金・所要時間の表示/非表示を切り替え",
      "性別によるメニュー表示切り替え",
    ],
  },
  {
    title: "予約カレンダー設定",
    items: [
      "曜日ごとの営業時間・定休日を設定",
      "予約受付可能な期間を設定（例: 30日先まで）",
      "カレンダーモード: 日付と時間帯を選択",
      "第三希望日モード: 第1〜3希望の日時を入力",
      "時間枠の間隔を選択（15分 / 30分 / 60分）",
    ],
  },
  {
    title: "フォーム表示・デザイン",
    items: [
      "テーマカラーの変更",
      "店舗名・ロゴの表示",
      "フォーム上部にお知らせ・注意書きを表示",
      "ボタンスタイルの変更（角丸 / 四角）",
    ],
  },
  {
    title: "その他の設定",
    items: [
      "性別選択の有無",
      "来店回数の選択（初回 / リピーター）",
      "クーポン利用の有無",
      "カスタム入力項目の追加（テキスト、ラジオボタンなど）",
      "Google Calendar連携で予約を自動同期",
    ],
  },
];

export default function LineReservationPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Link
        href="/home"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        ホームに戻る
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-orange-100">
          <CalendarDays className="h-5 w-5 text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold">LINE予約フォーム管理</h1>
      </div>
      <p className="text-muted-foreground mb-10">
        LINEアプリ内で予約フォームを表示。メニュー、料金、時間帯を自由にカスタマイズ。顧客はLINEから直接予約が可能です。
      </p>

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-lg font-semibold mb-3">{section.title}</h2>
            <ul className="space-y-2">
              {section.items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
