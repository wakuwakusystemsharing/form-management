import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: {
    template: "%s | NAS",
    default: "NAS - Need Appointment System",
  },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/home" className="text-xl font-bold tracking-tight">
            NAS
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
              プライバシーポリシー
            </Link>
            <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
              利用規約
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <div>
              <p className="font-semibold">NAS - Need Appointment System</p>
              <p className="text-sm text-muted-foreground mt-1">[運営者名]</p>
              <p className="text-sm text-muted-foreground">[所在地]</p>
              <p className="text-sm text-muted-foreground">[連絡先メールアドレス]</p>
            </div>
            <nav className="flex flex-col gap-1 text-sm">
              <Link href="/home" className="text-muted-foreground hover:text-foreground transition-colors">
                ホーム
              </Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-foreground transition-colors">
                プライバシーポリシー
              </Link>
              <Link href="/terms" className="text-muted-foreground hover:text-foreground transition-colors">
                利用規約
              </Link>
            </nav>
          </div>
          <p className="text-xs text-muted-foreground mt-6">
            © 2026 [運営者名]. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
