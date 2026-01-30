/**
 * Supabase Storageへのデプロイメント管理
 * フォームの静的HTMLをSupabase Storageにアップロード
 */

import { createAdminClient } from './supabase';
import { shouldUseMockBlob, isProduction, isStaging, isDevelopment, getAppEnvironment, getBaseUrl } from './env';
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
   * @param formType フォームタイプ（'reservation' | 'survey'）
   * @returns デプロイ結果（URL、Storage URL、環境情報）
   */
  async deployForm(
    storeId: string,
    formId: string,
    html: string,
    formType: 'reservation' | 'survey' = 'reservation'
  ): Promise<DeployResult> {
    const env = getAppEnvironment();
    
    // ローカル環境: data/forms_html/ にHTMLを保存（Supabaseへのアクセス不要）
    if (env === 'local') {
      const dataDir = path.join(process.cwd(), 'data', 'forms_html');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      const filePath = path.join(dataDir, `${formId}.html`);
      fs.writeFileSync(filePath, html, 'utf-8');
      
      console.log(`[LOCAL MODE] Static HTML saved to: ${filePath}`);
      
      // public/static-forms/ にもコピー（既存のアクセスパスを維持）
      const publicDir = path.join(process.cwd(), 'public', 'static-forms');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      const publicFilePath = path.join(publicDir, `${formId}.html`);
      fs.writeFileSync(publicFilePath, html, 'utf-8');
      
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
      
      // 新しいパス構成: {formType}/{storeId}/{formId}/index.html
      // 環境プレフィックスは不要（プロジェクトレベルで分離されているため）
      const storagePath = `${formType}s/${storeId}/${formId}/index.html`;
      
      // HTMLをBufferに変換
      const htmlBuffer = Buffer.from(html, 'utf-8');
      
      // Supabase Storageにアップロード（upsert: trueで上書き）
      const { error } = await supabase.storage
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

      // 公開URLを取得（直接アクセス用）
      const { data: publicUrlData } = supabase.storage
        .from('forms')
        .getPublicUrl(storagePath);

      const directUrl = publicUrlData.publicUrl;
      
      // プロキシURL（Next.jsのAPIルート経由）を生成
      // これにより正しいContent-Typeヘッダーで配信される
      // キャッシュバスティングのため、タイムスタンプをクエリパラメータに追加
      // 環境に応じた適切なベースURLを使用（カスタムドメイン対応）
      const baseUrl = getBaseUrl();
      const timestamp = Date.now();
      const proxyUrl = `${baseUrl}/api/public-form/${storagePath}?v=${timestamp}`;

      console.log(`✅ [${env.toUpperCase()}] Form deployed to Supabase Storage`);
      console.log(`   Environment: ${getAppEnvironment()}`);
      console.log(`   NEXT_PUBLIC_APP_ENV: ${process.env.NEXT_PUBLIC_APP_ENV}`);
      console.log(`   NEXT_PUBLIC_PRODUCTION_URL: ${process.env.NEXT_PUBLIC_PRODUCTION_URL}`);
      console.log(`   Base URL: ${baseUrl}`);
      console.log(`   Direct URL: ${directUrl}`);
      console.log(`   Proxy URL: ${proxyUrl}`);
      
      return {
        url: proxyUrl,
        storage_url: directUrl,
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
   * @param formType フォームタイプ（'reservation' | 'survey'）
   */
  async deleteForm(storeId: string, formId: string, formType: 'reservation' | 'survey' = 'reservation'): Promise<void> {
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

      // 新しいパス構成: {formType}/{storeId}/{formId}/index.html
      const storagePath = `${formType}s/${storeId}/${formId}/index.html`;
      
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
   * @param formType フォームタイプ（'reservation' | 'survey' | 'all'）
   */
  async deleteStoreAllForms(storeId: string, formType: 'reservation' | 'survey' | 'all' = 'all'): Promise<void> {
    if (shouldUseMockBlob()) {
      console.log('[LOCAL MODE] Skipping bulk deletion in local mode');
      return;
    }

    try {
      const supabase = createAdminClient();
      
      if (!supabase) {
        throw new Error('Supabase クライアントの初期化に失敗しました');
      }

      // 新しいパス構成に基づいて削除
      const prefixes: string[] = [];
      if (formType === 'all') {
        prefixes.push(`reservations/${storeId}/`);
        prefixes.push(`surveys/${storeId}/`);
      } else {
        prefixes.push(`${formType}s/${storeId}/`);
      }

      let totalDeleted = 0;
      for (const prefix of prefixes) {
        // 指定プレフィックスのディレクトリ一覧を取得（例: reservations/{storeId}/）
        const { data: dirs, error: listError } = await supabase.storage
          .from('forms')
          .list(prefix, {
            limit: 1000,
          });

        if (listError) {
          console.warn(`Failed to list directories for ${prefix}: ${listError.message}`);
          continue;
        }

        if (!dirs || dirs.length === 0) {
          continue;
        }

        // 各フォームIDディレクトリ内のindex.htmlを削除
        const filePaths: string[] = [];
        
        for (const dir of dirs) {
          if (!dir.id) {
            // ディレクトリの場合、その中身を確認
            const formDir = `${prefix}${dir.name}/`;
            const { data: files } = await supabase.storage
              .from('forms')
              .list(formDir, {
                limit: 100,
              });
            
            if (files) {
              for (const file of files) {
                if (file.name === 'index.html' && file.id) {
                  filePaths.push(file.id);
                }
              }
            }
          }
        }

        if (filePaths.length === 0) {
          continue;
        }

        // 一括削除
        const { error: deleteError } = await supabase.storage
          .from('forms')
          .remove(filePaths);

        if (deleteError) {
          console.warn(`Failed to delete files for ${prefix}: ${deleteError.message}`);
          continue;
        }

        totalDeleted += filePaths.length;
      }

      if (totalDeleted > 0) {
        console.log(`✅ All forms deleted for store: ${storeId} (${totalDeleted} files)`);
      } else {
        console.log(`No forms found for store: ${storeId}`);
      }
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
      const env = getAppEnvironment();
      
      // ローカル環境: public/ にファイルを保存 (filePathにディレクトリが含まれているため)
      if (env === 'local') {
        const publicDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        
        const localFilePath = path.join(publicDir, filePath);
        const fileDir = path.dirname(localFilePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        
        // Buffer または Blob をファイルに書き込み
        if (file instanceof Blob) {
          const arrayBuffer = await file.arrayBuffer();
          fs.writeFileSync(localFilePath, Buffer.from(arrayBuffer));
        } else {
          fs.writeFileSync(localFilePath, file);
        }
        
        // 公開 URL を返却（public/ から公開されるため /{filePath} でアクセス可能）
        const url = `/${filePath}`;
        console.log(`[LOCAL MODE] Image saved to: ${localFilePath}`);
        return url;
      }
      
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

      const { error } = await supabase.storage
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

