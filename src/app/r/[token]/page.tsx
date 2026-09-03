import { redirect } from 'next/navigation';
import { findLotteryEntryByQrTokenAnyStore } from '@/lib/lottery-repository';
import { QR_TOKEN_PATTERN } from '@/lib/lottery-qr';

/**
 * /r/{token} - 当選 QR コードの読み取り先
 *
 * 店舗スタッフが通常のカメラアプリで QR を読んだときに開くページ。
 * トークンから店舗を特定し、店舗管理者ページのスキャン画面へ振り分ける（そこで認証される）。
 * お客様が自分で開いても、認証が無いためスキャン画面にはログインを求められるだけで当選情報は見えない。
 */
export default async function LotteryRedirectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const normalized = (token || '').trim();
  if (QR_TOKEN_PATTERN.test(normalized)) {
    const entry = await findLotteryEntryByQrTokenAnyStore(normalized).catch(() => null);
    if (entry) {
      redirect(`/${entry.store_id}/admin/lottery-scan?t=${encodeURIComponent(normalized)}`);
    }
  }
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-muted/30">
      <div className="max-w-sm w-full rounded-xl border bg-background p-6 text-center space-y-2">
        <h1 className="text-lg font-semibold">当選情報が見つかりません</h1>
        <p className="text-sm text-muted-foreground">QR コードが正しく読み取れなかったか、すでに取り消された当選です。店舗スタッフにお問い合わせください。</p>
      </div>
    </main>
  );
}
