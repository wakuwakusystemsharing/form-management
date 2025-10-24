/**
 * フォーム URL ヘルパー
 * 本番 Blob URL の生成やプレビュー URL の構築
 */

/**
 * 本番環境の Blob URL を生成
 * @param storeId 店舗ID
 * @param formId フォームID
 * @returns 本番 Blob URL
 */
export function getProductionBlobUrl(storeId: string, formId: string): string {
  return `https://form-management-seven.vercel.app/prod/forms/${storeId}/${formId}.html`;
}

/**
 * プレビュー URL を生成（編集画面）
 * @param storeId 店舗ID
 * @param formId フォームID
 * @returns プレビュー URL
 */
export function getPreviewUrl(storeId: string, formId: string): string {
  return `/preview/${storeId}/forms/${formId}`;
}

/**
 * LINE リッチメニュー用の公開 URL を生成
 * 本番 Blob URL が優先、なければ Vercel のデフォルト URL
 * @param form フォームオブジェクト
 * @returns 本番フォーム URL
 */
export function getPublicFormUrl(form: any): string {
  // static_deploy に本番 Blob URL が保存されていれば使用
  if (form.static_deploy?.blob_url) {
    return form.static_deploy.blob_url;
  }
  
  // なければ生成
  return getProductionBlobUrl(form.store_id, form.id);
}
