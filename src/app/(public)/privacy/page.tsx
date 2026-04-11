import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "NAS (Need Appointment System) のプライバシーポリシー",
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">プライバシーポリシー</h1>

      <div className="max-w-none space-y-8 text-foreground">

        <section>
          <h2 className="text-xl font-semibold mb-3">1. 個人情報取扱事業者</h2>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>事業者名: 合同会社わくわく</p>
            <p>所在地: 京都府京都市山科区川田土仏５−５</p>
            <p>連絡先: info@wakuwaku-inc.com</p>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">2. 取得する個人情報の種類と取得方法</h2>
          <p className="text-sm text-muted-foreground mb-2">
            当サービス「NAS（Need Appointment System）」（以下「本サービス」）は、以下の個人情報を取得します。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>氏名、電話番号、メールアドレス — 予約フォーム送信時にご本人から直接取得</li>
            <li>LINE ユーザーID — LINE LIFF SDK を通じて自動的に取得</li>
            <li>予約情報（メニュー、日時等） — 予約フォーム送信時にご本人から直接取得</li>
            <li>Google Calendar データ — OAuth同意に基づき Google Calendar API を通じて取得</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">3. 利用目的</h2>
          <p className="text-sm text-muted-foreground mb-2">取得した個人情報は、以下の目的で利用します。</p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>予約の受付・管理およびサービスの提供</li>
            <li>予約確認・変更等に関するご連絡</li>
            <li>サービスの改善および利用状況の分析</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">4. 第三者提供</h2>
          <p className="text-sm text-muted-foreground">
            当社は、以下の場合を除き、ご本人の同意なく個人情報を第三者に提供しません。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1 mt-2">
            <li>法令に基づく場合</li>
            <li>人の生命、身体または財産の保護のために必要がある場合</li>
            <li>ご本人の同意がある場合（Google Calendar 連携等）</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">5. 業務委託・外国にある第三者への提供</h2>
          <p className="text-sm text-muted-foreground mb-2">
            本サービスの運営にあたり、以下の事業者にデータの取扱いを委託しています。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>Supabase, Inc.（米国） — データベースホスティング</li>
            <li>Vercel, Inc.（米国） — Webアプリケーションホスティング</li>
            <li>LINEヤフー株式会社（日本） — メッセージング基盤</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            米国は、個人情報保護法（APPI）上「個人の権利利益を保護する上で我が国と同等の水準にあると認められる
            個人情報の保護に関する制度を有している国」として認定されていません。
            各委託先は、契約上の義務として適切なデータ保護措置を講じています。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">6. 保有個人データに関する権利</h2>
          <p className="text-sm text-muted-foreground mb-2">
            ご本人は、保有個人データについて以下の請求を行うことができます。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>開示の請求</li>
            <li>内容の訂正の請求</li>
            <li>内容の追加の請求</li>
            <li>削除の請求</li>
            <li>利用停止または消去の請求</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            請求は、上記連絡先メールアドレスまでご連絡ください。ご本人確認の上、合理的な期間内に対応いたします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">7. 個人データの保存期間</h2>
          <p className="text-sm text-muted-foreground">
            アカウント削除後、個人データは1年間保持した後に削除します。
            Google Calendar データは、連携解除時に即時削除します。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">8. 安全管理措置</h2>
          <p className="text-sm text-muted-foreground mb-2">
            当社は、個人データの漏洩等を防止するため、以下の安全管理措置を講じています。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>組織的措置: 個人情報管理責任者の設置、アクセス権限の管理</li>
            <li>技術的措置: SSL/TLS による通信の暗号化、Row Level Security によるデータベースアクセス制御</li>
            <li>物理的措置: クラウドサービス事業者（Supabase / Vercel）のデータセンターにおけるセキュリティ対策に依拠</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">9. Cookie・アクセスログ</h2>
          <p className="text-sm text-muted-foreground">
            本サービスでは、サービス改善のため Vercel Speed Insights を使用してアクセスログを収集しています。
            これらは個人を特定するものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">10. Google API サービスの利用</h2>
          <p className="text-sm text-muted-foreground mb-2">
            本サービスは、Google Calendar API を使用して、店舗の予約情報をカレンダーと同期します。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>取得する情報: Google Calendar のイベント情報（読み取り・書き込み）</li>
            <li>利用目的: 予約のカレンダー同期のみ</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            本サービスの Google API から受信した情報の使用および他のアプリへの転送は、
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Google API サービスのユーザーデータに関するポリシー
            </a>
            （制限付き使用の要件を含む）に準拠します。
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            当社は、Google ユーザーデータを広告目的に使用せず、
            サービス提供に必要な場合を除き第三者に転送しません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">11. プライバシーポリシーの改定</h2>
          <p className="text-sm text-muted-foreground">
            本ポリシーの内容は、法令の変更やサービスの変更に伴い改定することがあります。
            重要な変更がある場合は、本サービス上でお知らせします。
          </p>
        </section>

        <section>
          <p className="text-sm text-muted-foreground">
            制定日: 2026年3月19日
          </p>
        </section>

      </div>
    </div>
  );
}
