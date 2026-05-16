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
            店舗管理者が Google Calendar 連携を解除した時点で、当社サーバー（Supabase）に保管している
            Google リフレッシュトークンおよび連携先カレンダー ID は即時削除します。
            Google アカウント側のアクセス権の取り消しは、ユーザーご自身で{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              https://myaccount.google.com/permissions
            </a>
            {" "}から行うことができます。
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
          <p className="text-sm text-muted-foreground">
            本サービスは、店舗管理者が任意で行う Google Calendar 連携機能において Google API を利用します。
            本セクションでは、Google API Services User Data Policy に従い、当社が Google ユーザーデータを
            どのように取得・利用・共有・保存・削除するかを明示します。
          </p>

          <h3 className="text-base font-semibold mt-4 mb-2">10.1 アクセス・取得する Google ユーザーデータ</h3>
          <p className="text-sm text-muted-foreground mb-2">
            店舗管理者が Google アカウントで OAuth 同意を行った場合、当社は以下のスコープを通じて以下のデータにアクセスします。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>
              リクエストするスコープ:
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li><code>https://www.googleapis.com/auth/calendar</code></li>
                <li><code>https://www.googleapis.com/auth/calendar.events</code></li>
              </ul>
            </li>
            <li>取得するデータの種類:
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li>連携アカウントが所有・閲覧できる Google カレンダーの一覧（カレンダー ID、名称、アクセス権限）</li>
                <li>連携対象として選択されたカレンダー内のイベント情報（タイトル、開始・終了時刻、所要時間。出席者リストは取得しません）</li>
                <li>OAuth リフレッシュトークン（Google API への継続アクセスを維持するため）</li>
              </ul>
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-4 mb-2">10.2 Google ユーザーデータの利用目的・処理方法</h3>
          <p className="text-sm text-muted-foreground mb-2">
            取得した Google ユーザーデータは、店舗の予約管理機能を提供する目的でのみ利用します。具体的な処理は以下に限定されます。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li><code>calendarList.list</code>: 店舗管理者に対し、書き込み可能なカレンダーの一覧を提示し、予約反映先カレンダーを選択していただくため</li>
            <li><code>events.insert</code>: 顧客から入った予約をカレンダー上のイベントとして書き込むため</li>
            <li><code>events.update</code>: 予約内容の変更時にイベントを更新するため</li>
            <li><code>events.delete</code>: 予約キャンセル時にイベントを削除するため</li>
            <li><code>events.list</code>: 空き時間を計算し、二重予約を防止するため</li>
            <li>リフレッシュトークンは、上記 API 呼び出しのためのアクセストークン取得にのみ利用します</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-2">
            当社は、Google ユーザーデータについて以下を一切行いません。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>広告・マーケティング目的での利用</li>
            <li>機械学習モデルの学習・改善への利用</li>
            <li>人間（当社従業員を含む）による閲覧（ただし、法令対応・セキュリティインシデント対応・ユーザーご本人からのサポート依頼への対応のためにやむを得ず必要な場合を除きます）</li>
          </ul>

          <h3 className="text-base font-semibold mt-4 mb-2">10.3 Google ユーザーデータの第三者共有</h3>
          <p className="text-sm text-muted-foreground mb-2">
            当社は、Google ユーザーデータを以下の場合を除き、他の第三者と共有・転送・販売しません。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>
              インフラ事業者である Supabase, Inc.（米国）に対し、暗号化された状態でリフレッシュトークン・カレンダー ID
              をデータベースに保存しています（§5 の業務委託先に該当）
            </li>
            <li>
              メール送信に用いる Resend, Inc.、LINE 連携に用いる LINE ヤフー株式会社、
              ホスティング事業者である Vercel, Inc. に対しては、Google ユーザーデータを送信していません
            </li>
            <li>
              当社の他のサービスや、関連会社を含む第三者への Google ユーザーデータの転送・販売は一切行いません
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-4 mb-2">10.4 Google ユーザーデータの保存・保護</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>
              OAuth リフレッシュトークンは <strong>AES-256-GCM</strong>（認証付き暗号化）で暗号化したうえで、
              Supabase の <code>stores.google_calendar_refresh_token</code> カラムに保存しています
            </li>
            <li>
              暗号鍵はホスティング事業者の暗号化された環境変数として保管し、データベースには保存しません
            </li>
            <li>クライアントとサーバー間、当社サーバーと Google API 間の通信は、すべて TLS で暗号化されています</li>
            <li>
              Supabase の Row Level Security により、各店舗のデータは権限を持つ管理者ユーザーのみがアクセス可能となるよう制御されています
            </li>
            <li>
              当社の開発・運用担当者は、業務上必要な場合に限り管理者権限でデータベースを参照し、操作ログを管理しています
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-4 mb-2">10.5 保持期間と削除方法</h3>
          <p className="text-sm text-muted-foreground mb-2">
            ユーザーは、以下のいずれの方法でも Google ユーザーデータの削除を行うことができます。
          </p>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            <li>
              <strong>店舗管理画面からの連携解除</strong>: 店舗管理画面の「Google Calendar 連携を解除」ボタンを押すと、
              当社サーバーに保管しているリフレッシュトークンおよび連携先カレンダー ID を即時削除します
            </li>
            <li>
              <strong>Google アカウント側での取り消し</strong>:{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                https://myaccount.google.com/permissions
              </a>
              {" "}より <code>nas-rsv.com</code> のアクセス権を取り消すことで、Google 側からも当社のアクセスを完全に遮断できます
            </li>
            <li>
              <strong>削除の請求</strong>: §6 に記載の連絡先（info@wakuwaku-inc.com）へご連絡いただければ、
              当社が保有する Google ユーザーデータ一切の削除を請求できます
            </li>
            <li>
              <strong>アカウント削除時</strong>: 店舗アカウント自体を削除する場合、当社が保有する当該店舗の Google
              ユーザーデータも即時に削除します
            </li>
          </ul>

          <h3 className="text-base font-semibold mt-4 mb-2">10.6 Google API Services User Data Policy 準拠の表明</h3>
          <p className="text-sm text-muted-foreground">
            本サービスの Google API から受信した情報の使用および他のアプリへの転送は、
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Google API サービスのユーザーデータに関するポリシー
            </a>
            （Limited Use 要件を含む）に準拠します。
            当社は、Google ユーザーデータを広告に使用せず、サービス提供に必要な範囲を超えて第三者に転送せず、
            人間に閲覧させません（10.2 に記載した限定的な例外を除きます）。
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
          <p className="text-sm text-muted-foreground">
            最終改定日: 2026年5月15日
          </p>
        </section>

      </div>
    </div>
  );
}
