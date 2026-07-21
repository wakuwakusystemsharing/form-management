'use client';

// 外部予約メール連携の設定ページ（テナント管理者 → 店舗）

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import ExternalMailIntegrationSettings from '@/components/ExternalMailIntegrationSettings';

export default function MailIntegrationPage() {
  const params = useParams();
  const router = useRouter();
  const tenantSlug = params.tenantSlug as string;
  const storeId = params.storeId as string;

  const [store, setStore] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const fetchStore = async () => {
      try {
        const res = await fetch(`/api/stores/${storeId}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setStore({ id: data.id, name: data.name });
        }
      } catch (e) {
        console.error(e);
      }
    };
    fetchStore();
  }, [storeId]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/tenant/${tenantSlug}/admin/${storeId}`)}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    店舗詳細に戻る
                  </Button>
                </div>
                <CardTitle className="text-2xl">外部予約メール連携</CardTitle>
                <CardDescription className="mt-1">
                  {store ? `${store.name} (店舗ID: ${storeId})` : `店舗ID: ${storeId}`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
        </Card>

        <ExternalMailIntegrationSettings storeId={storeId} />
      </div>
    </div>
  );
}
