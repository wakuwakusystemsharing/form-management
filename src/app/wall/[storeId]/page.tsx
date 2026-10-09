import type { Metadata, Viewport } from 'next';
import WallApp from '@/components/wall/WallApp';

/**
 * 寄せ書きウォール（お客様向け）: /wall/{storeId}
 * 公式 LINE のリッチメニュー → LIFF（Endpoint URL にこのページ）から開く。
 * ミドルウェアの保護対象外（公開ページ）。本人確認は LIFF の ID トークンを API 側で検証する
 */
export const metadata: Metadata = {
  title: 'みんなの寄せ書き',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function WallPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  return <WallApp storeId={storeId} />;
}
