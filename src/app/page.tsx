import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">
            LINE予約フォーム管理システム
          </h1>
          <p className="text-xl text-gray-600 mb-12">
            LINE LIFFを活用したマルチテナント予約フォーム管理システム
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-16">
            {/* サービス管理者 */}
            <div className="bg-white rounded-lg shadow-lg p-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  サービス管理者
                </h2>
                <p className="text-gray-600 mb-6">
                  全店舗の管理、フォームの追加・削除を行います
                </p>
                <Link 
                  href="/admin"
                  className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  管理画面へ
                </Link>
              </div>
            </div>

            {/* 店舗管理者 */}
            <div className="bg-white rounded-lg shadow-lg p-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                  店舗管理者
                </h2>
                <p className="text-gray-600 mb-6">
                  自店舗のフォーム内容の編集・管理を行います
                </p>
                <div className="text-sm text-gray-500">
                  店舗IDを入力してアクセス<br/>
                  例: /st0001/admin
                </div>
              </div>
            </div>
          </div>

          {/* システム情報 */}
          <div className="mt-16 bg-gray-50 rounded-lg p-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">システム概要</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm text-gray-600">
              <div>
                <h4 className="font-medium text-gray-900 mb-2">技術スタック</h4>
                <ul className="space-y-1">
                  <li>Next.js 15 + TypeScript</li>
                  <li>Supabase (PostgreSQL)</li>
                  <li>Tailwind CSS</li>
                  <li>Vercel Hosting</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-2">主要機能</h4>
                <ul className="space-y-1">
                  <li>店舗・フォーム管理</li>
                  <li>メニュー・カテゴリ設定</li>
                  <li>予約データ蓄積</li>
                  <li>LINE連携対応</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-gray-900 mb-2">対応規模</h4>
                <ul className="space-y-1">
                  <li>1000店舗対応</li>
                  <li>店舗あたり10フォーム</li>
                  <li>月間100,000件予約</li>
                  <li>99.9%稼働率</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
