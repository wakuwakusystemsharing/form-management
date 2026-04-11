import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Users, ArrowLeft, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "顧客管理（CRM）",
  description: "顧客情報と来店履歴を一元管理。セグメント分析でリピーター育成を支援します。",
};

const sections = [
  {
    title: "顧客一覧・検索",
    items: [
      "顧客名で検索",
      "セグメント別にフィルタ（新規 / リピーター / VIP / 休眠）",
      "来店回数・累計利用額・最終来店日を一覧表示",
      "顧客を手動で追加",
    ],
  },
  {
    title: "顧客詳細",
    items: [
      "氏名（漢字・ひらがな）、電話番号、メールアドレス、生年月日、性別",
      "LINE連携情報（表示名、プロフィール画像、友だち状態）",
      "アレルギー・既往歴メモ",
      "タグで顧客を分類",
      "予約履歴の確認",
      "来店履歴（施術内容、担当者、満足度、支払い金額）",
    ],
  },
  {
    title: "自動セグメント分類",
    items: [
      "新規: 初回来店から30日以内",
      "リピーター: 2回以上来店",
      "VIP: 10回以上来店 または 累計5万円以上",
      "休眠: 90日以上来店なし",
    ],
  },
  {
    title: "顧客分析",
    items: [
      "セグメント別の顧客分布",
      "性別・年齢層の分布",
      "LINE友だち率",
      "月別の新規顧客推移",
      "リピート率・平均来店間隔",
      "セグメント別の平均利用額",
      "売上上位の顧客ランキング",
    ],
  },
];

export default function CrmPage() {
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
          <Users className="h-5 w-5 text-orange-500" />
        </div>
        <h1 className="text-2xl font-bold">顧客管理（CRM）</h1>
        <Badge variant="secondary" className="text-xs">Beta</Badge>
      </div>
      <p className="text-muted-foreground mb-10">
        顧客情報と来店履歴を一元管理。セグメント分析でリピーター育成を支援します。
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
