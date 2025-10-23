/**
 * Supabase Storageへのデプロイメント管理
 * フォームの静的HTMLをSupabase Storageにアップロード
 */

import { createAdminClient } from './supabase';
import { shouldUseMockBlob, isProduction, getAppEnvironment } from './env';
import fs from 'fs';
import path from 'path';

export interface DeployResult {
  url: string;
  storage_url?: string;
  environment: 'local' | 'staging' | 'production';
}

export class SupabaseStorageDeployer {
  /**
   * フォームのHTMLをSupabase Storageにアップロード（環境対応版）
   * @param storeId 店舗ID
   * @param formId フォームID
   * @param html 生成されたHTML
   * @returns デプロイ結果（URL、Storage URL、環境情報）
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
        storage_url: undefined,
        environment: 'local'
      };
    }
    
    // ステージング/本番環境: 実際にSupabase Storageにアップロード
    try {
      const supabase = createAdminClient();
      
      if (!supabase) {
        throw new Error('Supabase クライアントの初期化に失敗しました');
      }
      
      // 環境ごとに異なるパスプレフィックスを使用
      const envPrefix = isProduction() ? 'prod' : 'staging';
      const storagePath = `${envPrefix}/forms/${storeId}/${formId}/config/current.html`;
      
      // HTMLをBufferに変換
      const htmlBuffer = Buffer.from(html, 'utf-8');
      
      // Supabase Storageにアップロード（upsert: trueで上書き）
      const { data, error } = await supabase.storage
        .from('forms')
        .upload(storagePath, htmlBuffer, {
          contentType: 'text/html; charset=utf-8',
          upsert: true,
          cacheControl: '3600', // 1時間キャッシュ
        });

      if (error) {
        console.error('❌ Supabase Storage upload error:', error);
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }

      // 公開URLを取得
      const { data: publicUrlData } = supabase.storage
        .from('forms')
        .getPublicUrl(storagePath);

      const publicUrl = publicUrlData.publicUrl;

      console.log(`✅ [${env.toUpperCase()}] Form deployed to Supabase Storage: ${publicUrl}`);
      
      return {
        url: publicUrl,
        storage_url: publicUrl,
        environment: env as 'staging' | 'production'
      };
    } catch (error) {
      console.error('❌ Supabase Storage deployment failed:', error);
      throw new Error(`Failed to deploy form to Supabase Storage: ${error}`);
    }
  }

  /**
   * フォームをSupabase Storageから削除
   * @param storeId 店舗ID
   * @param formId フォームID
   */
  async deleteForm(storeId: string, formId: string): Promise<void> {
    if (shouldUseMockBlob()) {
      // ローカル環境: ファイルシステムから削除
      const staticDir = path.join(process.cwd(), 'public', 'static-forms');
      const filePath = path.join(staticDir, `${formId}.html`);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ [LOCAL MODE] Form deleted: ${filePath}`);
      }
      return;
    }

    try {
      const supabase = createAdminClient();
      
      if (!supabase) {
        throw new Error('Supabase クライアントの初期化に失敗しました');
      }

      const envPrefix = isProduction() ? 'prod' : 'staging';
      const storagePath = `${envPrefix}/forms/${storeId}/${formId}/config/current.html`;
      
      const { error } = await supabase.storage
        .from('forms')
        .remove([storagePath]);

      if (error) {
        console.error('❌ Supabase Storage deletion error:', error);
        throw new Error(`Failed to delete form: ${error.message}`);
      }

      console.log(`✅ Form deleted from Supabase Storage: ${storagePath}`);
    } catch (error) {
      console.error('❌ Form deletion failed:', error);
      throw new Error(`Failed to delete form from Supabase Storage: ${error}`);
    }
  }

  /**
   * 店舗の全フォームをSupabase Storageから削除
   * @param storeId 店舗ID
   */
  async deleteStoreAllForms(storeId: string): Promise<void> {
    if (shouldUseMockBlob()) {
      console.log('[LOCAL MODE] Skipping bulk deletion in local mode');
      return;
    }

    try {
      const supabase = createAdminClient();
      
      if (!supabase) {
        throw new Error('Supabase クライアントの初期化に失敗しました');
      }

      const envPrefix = isProduction() ? 'prod' : 'staging';
      const prefix = `${envPrefix}/forms/${storeId}/`;
      
      // 指定プレフィックスのファイル一覧を取得
      const { data: files, error: listError } = await supabase.storage
        .from('forms')
        .list(prefix, {
          limit: 1000,
        });

      if (listError) {
        throw new Error(`Failed to list files: ${listError.message}`);
      }

      if (!files || files.length === 0) {
        console.log(`No forms found for store: ${storeId}`);
        return;
      }

      // ファイルパスの配列を作成
      const filePaths = files.map(file => `${prefix}${file.name}`);

      // 一括削除
      const { error: deleteError } = await supabase.storage
        .from('forms')
        .remove(filePaths);

      if (deleteError) {
        throw new Error(`Failed to delete files: ${deleteError.message}`);
      }

      console.log(`✅ All forms deleted for store: ${storeId} (${files.length} files)`);
    } catch (error) {
      console.error('❌ Bulk deletion failed:', error);
      throw new Error(`Failed to delete store forms from Supabase Storage: ${error}`);
    }
  }

  /**
   * 画像をSupabase Storageにアップロード
   * @param file ファイル（Buffer or Blob）
   * @param filePath 保存先パス（例: menu_images/{storeId}/menu_123.jpg）
   * @returns Storage URL
   */
  async uploadImage(file: Buffer | Blob, filePath: string): Promise<string> {
    try {
      const supabase = createAdminClient();
      
      if (!supabase) {
        throw new Error('Supabase クライアントの初期化に失敗しました');
      }

      // ファイルの拡張子からContent-Typeを推測
      const ext = filePath.split('.').pop()?.toLowerCase();
      const contentTypeMap: { [key: string]: string } = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
      };
      const contentType = contentTypeMap[ext || ''] || 'image/jpeg';

      const { data, error } = await supabase.storage
        .from('forms')
        .upload(filePath, file, {
          contentType,
          upsert: true,
          cacheControl: '31536000', // 1年キャッシュ（画像は不変）
        });

      if (error) {
        throw new Error(`Upload failed: ${error.message}`);
      }

      // 公開URLを取得
      const { data: publicUrlData } = supabase.storage
        .from('forms')
        .getPublicUrl(filePath);

      console.log(`✅ Image uploaded to Supabase Storage: ${publicUrlData.publicUrl}`);
      return publicUrlData.publicUrl;
    } catch (error) {
      console.error('❌ Image upload failed:', error);
      throw new Error(`Failed to upload image to Supabase Storage: ${error}`);
    }
  }

  /**
   * 画像をSupabase Storageから削除
   * @param filePath 画像パス
   */
  async deleteImage(filePath: string): Promise<void> {
    try {
      const supabase = createAdminClient();
      
      if (!supabase) {
        throw new Error('Supabase クライアントの初期化に失敗しました');
      }

      const { error } = await supabase.storage
        .from('forms')
        .remove([filePath]);

      if (error) {
        console.warn(`Warning: Failed to delete image: ${error.message}`);
        return;
      }

      console.log(`✅ Image deleted from Supabase Storage: ${filePath}`);
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

