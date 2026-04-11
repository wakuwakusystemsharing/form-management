import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, ArrowLeft, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "アンケートフォーム",
  description: "来店後のアンケートをかんたんに作成・配信。お客様の声を集めてサービス改善に活かせます。",
};

const sections = [
  {
    title: "質問の設定",
    items: [
      "質問を自由に追加・削除・並び替え",
      "テキスト入力（1行）",
      "テキストエリア（複数行）",
      "日付選択",
      "ラジオボタン（単一選択）",
      "チェックボックス（複数選択）",
      "質問ごとに必須/任意を設定",
      "説明文・補足テキストを追加可能",
    ],
  },
  {
    title: "テンプレート",
    items: [
      "カウンセリングシート: 初回来店向けの詳細な問診票（氏名、生年月日、アレルギー、同意事項など）",
      "シンプルアンケート: 氏名・電話番号・ご要望の3問構成",
    ],
  },
  {
    title: "フォーム表示・デザイン",
    items: [
      "テーマカラーの変更",
      "店舗名の表示",
      "送信ボタンのテキストをカスタマイズ",
    ],
  },
  {
    title: "回答管理",
    items: [
      "回答をリアルタイムで確認",
      "アンケートごとに回答を一覧表示",
    ],
  },
];

export default function SurveyPage() {
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
          <ClipboardList className="h-5 w-5 text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold">アンケートフォーム</h1>
      </div>
      <p className="text-muted-foreground mb-10">
        来店後のアンケートをかんたんに作成・配信。お客様の声を集めてサービス改善に活かせます。
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
