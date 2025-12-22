import { redirect } from 'next/navigation'

export default function Home() {
  // ルートアクセス時は /admin にリダイレクト
  redirect('/admin')
}
