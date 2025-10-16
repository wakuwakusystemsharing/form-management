/**
 * Vercel Blob Storageへのデプロイメント管理
 * フォームの静的HTMLをVercel Blobにアップロード
 */

import { put, del, list } from '@vercel/blob';
import { shouldUseMockBlob, isProduction, getAppEnvironment } from './env';
import fs from 'fs';
import path from 'path';

export interface DeployResult {
  url: string;
  blob_url?: string;
  environment: 'local' | 'staging' | 'production';
}

export class VercelBlobDeployer {
  private blobToken: string;

  constructor() {
    this.blobToken = process.env.BLOB_READ_WRITE_TOKEN || '';
    if (!this.blobToken && !shouldUseMockBlob()) {
      console.warn('Warning: BLOB_READ_WRITE_TOKEN is not set');
    }
  }

  /**
   * フォームのHTMLをVercel Blobにアップロード（環境対応版）
   * @param storeId 店舗ID
   * @param formId フォームID
   * @param html 生成されたHTML
   * @returns デプロイ結果（URL、Blob URL、環境情報）
   */
  async deployForm(
    storeId: string,
    formId: string,
    html: string
  ): Promise<DeployResult> {
    const env = getAppEnvironment();
    
    // ローカルモック: public/static-forms/ にHTMLを保存
    if (shouldUseMockBlob()) {
      const staticDir = path.join(process.cwd(), 'public', 'static-forms');
      if (!fs.existsSync(staticDir)) {
        fs.mkdirSync(staticDir, { recursive: true });
      }
      
      const filePath = path.join(staticDir, `${formId}.html`);
      fs.writeFileSync(filePath, html, 'utf-8');
      
      console.log(`[LOCAL MODE] Static HTML saved to: ${filePath}`);
      
      return {
        url: `/static-forms/${formId}.html`,
        blob_url: undefined,
        environment: 'local'
      };
    }
    
    // ステージング/本番環境: 実際にVercel Blobにアップロード
    try {
      if (!this.blobToken) {
        throw new Error('BLOB_READ_WRITE_TOKEN が設定されていません');
      }
      
      // 環境ごとに異なるパスプレフィックスを使用
      const envPrefix = isProduction() ? 'prod' : 'staging';
      const blobPath = `${envPrefix}/forms/${storeId}/${formId}.html`;
      
      const blob = await put(blobPath, html, {
        access: 'public',
        token: this.blobToken,
        contentType: 'text/html; charset=utf-8',
        addRandomSuffix: false,
      });

      console.log(`✅ [${env.toUpperCase()}] Form deployed to Blob: ${blob.url}`);
      
      return {
        url: `/form/${formId}`,
        blob_url: blob.url,
        environment: env as 'staging' | 'production'
      };
    } catch (error) {
      console.error('❌ Blob deployment failed:', error);
      throw new Error(`Failed to deploy form to Vercel Blob: ${error}`);
    }
  }

  /**
   * 旧バージョン互換メソッド（DeployResultのurlのみ返す）
   * @deprecated deployForm() を使用してください
   */
  async deployFormLegacy(
    storeId: string,
    formId: string,
    html: string
  ): Promise<string> {
    const result = await this.deployForm(storeId, formId, html);
    return result.blob_url || result.url;
  }

  /**
   * フォームをVercel Blobから削除
   * @param storeId 店舗ID
   * @param formId フォームID
   */
  async deleteForm(storeId: string, formId: string): Promise<void> {
    try {
      const path = `forms/${storeId}/${formId}.html`;
      await del(path, { token: this.blobToken });
      console.log(`✅ Form deleted from Blob: ${path}`);
    } catch (error) {
      console.error('❌ Blob deletion failed:', error);
      throw new Error(`Failed to delete form from Vercel Blob: ${error}`);
    }
  }

  /**
   * 店舗の全フォームをVercel Blobから削除
   * @param storeId 店舗ID
   */
  async deleteStoreAllForms(storeId: string): Promise<void> {
    try {
      const { blobs } = await list({
        prefix: `forms/${storeId}/`,
        token: this.blobToken,
      });

      for (const blob of blobs) {
        await del(blob.url, { token: this.blobToken });
      }

      console.log(`✅ All forms deleted for store: ${storeId}`);
    } catch (error) {
      console.error('❌ Blob bulk deletion failed:', error);
      throw new Error(`Failed to delete store forms from Vercel Blob: ${error}`);
    }
  }

  /**
   * 画像をVercel Blobにアップロード
   * @param file ファイル（Buffer or Blob）
   * @param path 保存先パス（例: menu_images/{storeId}/menu_123.jpg）
   * @returns Blob URL
   */
  async uploadImage(file: Buffer | Blob, path: string): Promise<string> {
    try {
      const blob = await put(path, file, {
        access: 'public',
        token: this.blobToken,
      });

      console.log(`✅ Image uploaded to Blob: ${blob.url}`);
      return blob.url;
    } catch (error) {
      console.error('❌ Image upload failed:', error);
      throw new Error(`Failed to upload image to Vercel Blob: ${error}`);
    }
  }

  /**
   * 画像をVercel Blobから削除
   * @param path 画像パス
   */
  async deleteImage(url: string): Promise<void> {
    try {
      await del(url, { token: this.blobToken });
      console.log(`✅ Image deleted from Blob: ${url}`);
    } catch (error) {
      console.error('❌ Image deletion failed:', error);
      // 画像削除失敗はワーニングのみ（エラーにしない）
      console.warn(`Warning: Failed to delete image: ${error}`);
    }
  }
}

/**
 * デプロイURLがローカルモックかどうかを判定
 * @param deployUrl デプロイURL
 * @returns ローカルモックの場合true
 */
export function isLocalDeployment(deployUrl?: string): boolean {
  return deployUrl?.startsWith('/static-forms/') || false;
}
