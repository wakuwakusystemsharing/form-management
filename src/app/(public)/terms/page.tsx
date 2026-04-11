import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "利用規約",
  description: "NAS (Need Appointment System) の利用規約",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">利用規約</h1>

      <div className="max-w-none space-y-8 text-foreground">

        <section>
          <h2 className="text-xl font-semibold mb-3">第1条（総則）</h2>
          <p className="text-sm text-muted-foreground">
            本利用規約（以下「本規約」）は、合同会社わくわく（以下「当社」）が提供する
            予約フォーム管理サービス「NAS（Need Appointment System）」（以下「本サービス」）の
            利用に関する条件を定めるものです。本サービスを利用するすべてのユーザー（以下「ユーザー」）は、
            本規約に同意したものとみなします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第2条（利用登録）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>本サービスの店舗管理機能を利用するには、当社が定める方法により利用登録を行う必要があります。</li>
            <li>当社は、以下の場合に利用登録を拒否することがあります。
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>登録情報に虚偽の内容が含まれている場合</li>
                <li>過去に本規約に違反したことがある場合</li>
                <li>その他、当社が不適切と判断した場合</li>
              </ul>
            </li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第3条（アカウント管理）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>ユーザーは、自己の責任においてアカウント情報を管理するものとします。</li>
            <li>アカウント情報の管理不十分、第三者の使用等による損害について、当社は一切の責任を負いません。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第4条（禁止事項）</h2>
          <p className="text-sm text-muted-foreground mb-2">ユーザーは、以下の行為を行ってはなりません。</p>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>法令または公序良俗に反する行為</li>
            <li>犯罪行為に関連する行為</li>
            <li>本サービスのサーバーまたはネットワークに過度の負荷をかける行為</li>
            <li>本サービスの運営を妨害する行為</li>
            <li>他のユーザーの個人情報を不正に収集・利用する行為</li>
            <li>本サービスのリバースエンジニアリング、逆コンパイル、逆アセンブル</li>
            <li>その他、当社が不適切と判断する行為</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第5条（サービスの変更・停止・終了）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>当社は、事前の通知なく本サービスの内容を変更し、または提供を停止・終了することができます。</li>
            <li>当社は、本サービスの変更・停止・終了によりユーザーに生じた損害について、一切の責任を負いません。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第6条（知的財産権）</h2>
          <p className="text-sm text-muted-foreground">
            本サービスに関する著作権、商標権その他の知的財産権は、当社または正当な権利者に帰属します。
            利用登録は、これらの知的財産権の譲渡または使用許諾を意味するものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第7条（免責事項）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>当社は、本サービスに事実上または法律上の瑕疵がないことを保証しません。</li>
            <li>当社は、本サービスを通じて行われる予約に関するトラブル（予約内容の齟齬、キャンセル等）について、一切の責任を負いません。</li>
            <li>当社がユーザーに対して損害賠償責任を負う場合、その額は当該ユーザーが当社に支払った利用料金の直近1ヶ月分を上限とします。</li>
          </ol>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第8条（個人情報の取扱い）</h2>
          <p className="text-sm text-muted-foreground">
            本サービスにおける個人情報の取扱いについては、
            <Link href="/privacy" className="underline hover:text-foreground">
              プライバシーポリシー
            </Link>
            に定めるとおりとします。
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">第9条（準拠法・管轄裁判所）</h2>
          <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
            <li>本規約の解釈は、日本法に準拠します。</li>
            <li>本サービスに関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とします。</li>
          </ol>
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
