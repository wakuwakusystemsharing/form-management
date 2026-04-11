import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Users, Globe, ClipboardList, ChevronRight } from "lucide-react";
import LoginSection from "./LoginSection";

export const metadata: Metadata = {
  title: "ホーム",
  description: "NAS (Need Appointment System) - LINE連携の予約フォーム管理システム",
};

const features = [
  {
    icon: CalendarDays,
    iconColor: "text-orange-500",
    slug: "line-reservation",
    title: "LINE予約フォーム管理",
    description: "LINEアプリ内で予約フォームを表示。メニュー、料金、時間帯を自由にカスタマイズ。顧客はLINEから直接予約が可能です。",
  },
  {
    icon: Globe,
    iconColor: "text-orange-500",
    slug: "web-reservation",
    title: "Web予約フォーム",
    description: "LINE不要のWeb予約フォームにも対応。WebサイトやSNSからのリンクで誰でも簡単に予約できます。",
  },
  {
    icon: ClipboardList,
    iconColor: "text-orange-500",
    slug: "survey",
    title: "アンケートフォーム",
    description: "来店後のアンケートをかんたんに作成・配信。お客様の声を集めてサービス改善に活かせます。",
  },
  {
    icon: Users,
    iconColor: "text-orange-500",
    slug: "crm",
    title: "顧客管理（CRM）",
    description: "顧客情報と来店履歴を一元管理。セグメント分析でリピーター育成を支援します。",
    badge: "Beta",
  },
];

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16 space-y-16">
      {/* Hero */}
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          NAS
        </h1>
        <p className="text-lg text-muted-foreground mb-2">
          Need Appointment System
        </p>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          LINE連携の予約フォーム管理システム。
          テンプレートからフォームを作成し、LINEアプリ内で顧客に予約を提供。
          Google Calendar連携と顧客管理で、店舗運営を効率化します。
        </p>
      </section>

      {/* Features */}
      <section>
        <h2 className="text-2xl font-semibold text-center mb-8">主な機能</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((feature) => (
            <Link key={feature.title} href={`/features/${feature.slug}`}>
              <Card className="h-full hover:border-orange-300 hover:shadow-sm transition-all cursor-pointer">
                <CardHeader className="flex flex-row items-center gap-3 pb-2">
                  <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                  {"badge" in feature && feature.badge && (
                    <Badge variant="secondary" className="text-xs">{feature.badge}</Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* Login */}
      <LoginSection />
    </div>
  );
}
