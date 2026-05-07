import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel最適化設定
  poweredByHeader: false,
  compress: true,
  
  // trailing slash を無効化（307リダイレクト防止）
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  
  // 画像最適化
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.dropbox.com',
      },
      // LINE プロフィール画像（顧客アバター表示で使用）
      {
        protocol: 'https',
        hostname: 'profile.line-scdn.net',
      },
      {
        protocol: 'https',
        hostname: 'obs.line-scdn.net',
      },
    ],
  },
  
  // TypeScript設定
  typescript: {
    ignoreBuildErrors: false,
  },
  
  // 実験的機能
  experimental: {
    optimizePackageImports: ['@heroicons/react'],
  },
};

export default nextConfig;
