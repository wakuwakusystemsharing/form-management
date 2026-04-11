"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

const STORE_ID_KEY = "nas_last_store_id";

export default function LoginSection() {
  const router = useRouter();
  const [storeId, setStoreId] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORE_ID_KEY);
    if (saved) setStoreId(saved);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = storeId.trim();
    if (!trimmed) return;
    localStorage.setItem(STORE_ID_KEY, trimmed);
    router.push(`/${trimmed}/admin`);
  };

  return (
    <section id="login" className="scroll-mt-20 rounded-2xl bg-orange-50 border border-orange-200 p-8 sm:p-12">
      <div className="max-w-md mx-auto text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-orange-100 mb-4">
          <LogIn className="h-7 w-7 text-orange-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">店舗管理画面にログイン</h2>
        <p className="text-sm text-muted-foreground mb-6">
          店舗IDを入力して、管理画面にアクセスできます。
        </p>
        <form onSubmit={handleLogin} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            placeholder="店舗IDを入力"
            className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={!storeId.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-6 py-2.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <LogIn className="h-4 w-4" />
            ログイン画面へ
          </button>
        </form>
        <p className="text-xs text-muted-foreground mt-4">
          店舗IDがわからない場合は、サービス管理者にお問い合わせください。
        </p>
      </div>
    </section>
  );
}
