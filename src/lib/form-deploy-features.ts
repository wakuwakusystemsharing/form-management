/**
 * デプロイ済みの予約フォーム（静的 HTML）が持っている機能の印。
 * 静的 HTML は「保存＆デプロイ」するまで古いままなので、サーバー側の新機能が
 * 「フォーム側の対応」を前提にするときは、デプロイ時に記録したこの印で判定する。
 *
 * - menu_change: メニュー変更フォーム（URL の ?change=予約ID。LINE の「予約を変更」→「メニューを変更」）。
 *   未対応の HTML をこの URL で開くと通常の予約フォームになり、送信すると予約が増えてしまうので、
 *   印の無いフォームでは「メニューを変更」ボタンを出さない
 */
import type { StaticDeploy } from '@/types/form';

export const RESERVATION_FORM_FEATURES = ['menu_change'] as const;
export type ReservationFormFeature = (typeof RESERVATION_FORM_FEATURES)[number];

export function hasDeployedFeature(staticDeploy: Pick<StaticDeploy, 'features' | 'status'> | null | undefined, feature: ReservationFormFeature): boolean {
  if (!staticDeploy || typeof staticDeploy !== 'object') return false;
  return Array.isArray(staticDeploy.features) && staticDeploy.features.includes(feature);
}
