import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, MessageSquare, Calendar, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "ホーム",
  description: "NAS (Need Appointment System) - LINE連携の予約フォーム管理システム",
};

const features = [
  {
    icon: CalendarDays,
    title: "予約フォーム作成・管理",
    description: "テンプレートから簡単にフォームを作成。メニュー、料金、時間帯を自由にカスタマイズできます。",
  },
  {
    icon: MessageSquare,
    title: "LINE LIFF連携",
    description: "LINEアプリ内で予約フォームを表示。顧客はLINEから直接予約が可能です。",
  },
  {
    icon: Calendar,
    title: "Google Calendar連携",
    description: "予約をGoogleカレンダーに自動同期。ダブルブッキングの防止と空き状況の確認ができます。",
  },
  {
    icon: Users,
    title: "顧客管理（CRM）",
    description: "顧客情報と来店履歴を一元管理。セグメント分析でリピーター育成を支援します。",
    badge: "Beta",
  },
];

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      {/* Hero */}
      <section className="text-center mb-16">
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
            <Card key={feature.title}>
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <feature.icon className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{feature.title}</CardTitle>
                {"badge" in feature && feature.badge && (
                  <Badge variant="secondary" className="text-xs">{feature.badge}</Badge>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
