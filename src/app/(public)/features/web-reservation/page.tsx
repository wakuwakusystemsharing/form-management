import type { Metadata } from "next";
import Link from "next/link";
import { Globe, ArrowLeft, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "Web予約フォーム",
  description: "LINE不要のWeb予約フォーム。WebサイトやSNSからのリンクで誰でも簡単に予約できます。",
};

const sections = [
  {
    title: "LINE版との違い",
    items: [
      "LINEアプリ不要 — URLをシェアするだけで予約受付",
      "WebサイトやSNS（Instagram、Xなど）にリンクを設置可能",
      "お客様は名前・電話番号を手入力で予約",
      "流入経路を自動トラッキング（Google検索、Instagram、Facebookなど）",
    ],
  },
  {
    title: "メニュー設定",
    items: [
      "メニュー名・料金・所要時間を自由に設定",
      "カテゴリ別にメニューを整理",
      "サブメニュー・オプション追加",
      "メニュー画像のアップロード",
      "料金・所要時間の表示/非表示を切り替え",
    ],
  },
  {
    title: "予約カレンダー設定",
    items: [
      "曜日ごとの営業時間・定休日を設定",
      "予約受付可能な期間を設定",
      "カレンダーモード / 第三希望日モードを選択",
      "時間枠の間隔を選択（15分 / 30分 / 60分）",
    ],
  },
  {
    title: "フォーム表示・デザイン",
    items: [
      "テーマカラーの変更",
      "店舗名・ロゴの表示",
      "フォーム上部にお知らせ・注意書きを表示",
      "ボタンスタイルの変更",
    ],
  },
];

export default function WebReservationPage() {
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
          <Globe className="h-5 w-5 text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold">Web予約フォーム</h1>
      </div>
      <p className="text-muted-foreground mb-10">
        LINE不要のWeb予約フォームにも対応。WebサイトやSNSからのリンクで誰でも簡単に予約できます。
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
