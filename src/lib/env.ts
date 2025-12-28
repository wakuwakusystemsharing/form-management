/**
 * 環境判定ユーティリティ
 */

export type AppEnvironment = 'local' | 'staging' | 'production' | 'development';

export function getAppEnvironment(): AppEnvironment {
  const env = process.env.NEXT_PUBLIC_APP_ENV || 'local';
  return env as AppEnvironment;
}

export function isLocal(): boolean {
  return getAppEnvironment() === 'local';
}

export function isStaging(): boolean {
  return getAppEnvironment() === 'staging';
}

export function isProduction(): boolean {
  return getAppEnvironment() === 'production';
}

export function isDevelopment(): boolean {
  return getAppEnvironment() === 'development';
}

/**
 * 認証をスキップすべきかどうかを判定
 * ローカル環境のみ認証をスキップ
 */
export function shouldSkipAuth(): boolean {
  return isLocal();
}

export function shouldUseMockBlob(): boolean {
  // ローカル開発環境でBLOB_READ_WRITE_TOKENがない場合はモック使用
  return isLocal() && !process.env.BLOB_READ_WRITE_TOKEN;
}

export function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  if (isLocal()) {
    return 'http://localhost:3000';
  }
  
  if (isStaging()) {
    return process.env.NEXT_PUBLIC_STAGING_URL || 'https://form-management-staging.vercel.app';
  }
  
  // Production環境: カスタムドメインを優先使用
  // VERCEL_URL がプレビューデプロイメントURL（-wakuwakusystems-projects.vercel.app）の場合でも
  // カスタムドメインを強制的に使用
  const vercelUrl = process.env.VERCEL_URL;
  const isPreviewDeployment = vercelUrl && vercelUrl.includes('-wakuwakusystems-projects.vercel.app');
  
  // 環境変数が明示的に設定されている場合はそれを使用
  if (process.env.NEXT_PUBLIC_PRODUCTION_URL) {
    return process.env.NEXT_PUBLIC_PRODUCTION_URL;
  }
  
  // プレビューデプロイメントでもカスタムドメインを使用
  if (isPreviewDeployment || isProduction()) {
    return 'https://nas-rsv.com';
  }
  
  // フォールバック
  return 'https://nas-rsv.com';
}

export function getEnvironmentBadge(): { label: string; color: string } {
  const env = getAppEnvironment();
  
  switch (env) {
    case 'local':
      return { label: '🔧 ローカル開発', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
    case 'staging':
      return { label: '🧪 ステージング', color: 'bg-blue-100 text-blue-800 border-blue-300' };
    case 'development':
      return { label: '🔨 開発環境', color: 'bg-purple-100 text-purple-800 border-purple-300' };
    case 'production':
      return { label: '✅ 本番環境', color: 'bg-green-100 text-green-800 border-green-300' };
  }
}

/**
 * サブドメイン用のベースドメインを取得
 * 環境に応じた適切なドメインを返す
 */
export function getSubdomainBaseDomain(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    
    // プレビューデプロイメントURLの場合（例: form-management-git-dev-...vercel.app）
    if (hostname.includes('-wakuwakusystems-projects.vercel.app')) {
      return hostname;
    }
    
    // staging環境
    if (hostname.includes('form-management-staging.vercel.app')) {
      return 'form-management-staging.vercel.app';
    }
    
    // 本番環境（カスタムドメイン）
    if (hostname === 'nas-rsv.com' || hostname.endsWith('.nas-rsv.com')) {
      return 'nas-rsv.com';
    }
    
    // フォールバック
    return hostname;
  }
  
  // サーバーサイド
  const env = getAppEnvironment();
  
  if (isLocal()) {
    return 'localhost:3000';
  }
  
  if (isStaging()) {
    return process.env.NEXT_PUBLIC_STAGING_URL?.replace('https://', '') || 'form-management-staging.vercel.app';
  }
  
  if (isDevelopment()) {
    // dev環境のプレビューデプロイメントURLを取得
    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl) {
      return vercelUrl;
    }
    return 'form-management-git-dev-wakuwakusystems-projects.vercel.app';
  }
  
  // Production
  return 'nas-rsv.com';
}
