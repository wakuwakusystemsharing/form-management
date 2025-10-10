'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Reservation {
  id: string;
  form_id: string;
  store_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  reservation_date: string;
  reservation_time: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  created_at: string;
}

export default function AllReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStoreId, setFilterStoreId] = useState<string>('all');

  useEffect(() => {
    fetchReservations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterStoreId]);

  const fetchReservations = async () => {
    try {
      setLoading(true);
      
      const params = new URLSearchParams();
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }
      if (filterStoreId !== 'all') {
        params.append('store_id', filterStoreId);
      }

      const response = await fetch(`/api/reservations?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setReservations(data);
      }
    } catch (error) {
      console.error('Failed to fetch reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-900/50 text-yellow-200 border-yellow-700',
      confirmed: 'bg-green-900/50 text-green-200 border-green-700',
      cancelled: 'bg-red-900/50 text-red-200 border-red-700',
      completed: 'bg-blue-900/50 text-blue-200 border-blue-700',
    };

    const labels = {
      pending: '保留中',
      confirmed: '確認済み',
      cancelled: 'キャンセル',
      completed: '完了',
    };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  const formatDate = (date: string, time: string) => {
    const d = new Date(date);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    return `${dateStr} ${time}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <button
                onClick={() => router.push('/admin')}
                className="text-blue-400 hover:text-blue-300 mb-2 transition-colors"
              >
                ← 管理画面に戻る
              </button>
              <h1 className="text-3xl font-bold text-gray-100">全予約一覧</h1>
              <p className="text-gray-400 mt-1">全店舗の予約データ（サービス管理者専用）</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                ステータス
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全て</option>
                <option value="pending">保留中</option>
                <option value="confirmed">確認済み</option>
                <option value="cancelled">キャンセル</option>
                <option value="completed">完了</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                店舗
              </label>
              <select
                value={filterStoreId}
                onChange={(e) => setFilterStoreId(e.target.value)}
                className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全店舗</option>
                {/* TODO: 店舗リストを動的に取得 */}
              </select>
            </div>
          </div>
        </div>

        {/* Reservations Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-gray-400">
              読み込み中...
            </div>
          ) : reservations.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              予約データがありません
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      予約日時
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      店舗ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      顧客名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      電話番号
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      ステータス
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      作成日時
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {reservations.map((reservation) => (
                    <tr key={reservation.id} className="hover:bg-gray-700/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                        {formatDate(reservation.reservation_date, reservation.reservation_time)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <code className="text-cyan-400 bg-gray-900 px-2 py-1 rounded">
                          {reservation.store_id}
                        </code>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-100">
                        {reservation.customer_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {reservation.customer_phone}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(reservation.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {new Date(reservation.created_at).toLocaleString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary */}
        {!loading && reservations.length > 0 && (
          <div className="mt-6 bg-gray-800 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-300 text-sm">
              合計 <span className="font-bold text-cyan-400">{reservations.length}</span> 件の予約
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
