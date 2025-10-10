import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel最適化設定
  poweredByHeader: false,
  compress: true,
  
  // 画像最適化
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.dropbox.com',
      },
    ],
  },
  
  // TypeScript設定
  typescript: {
    ignoreBuildErrors: false,
  },
  
  // ESLint設定（デプロイ時は一時的に無効化）
  eslint: {
    ignoreDuringBuilds: true,
  },
  
  // 実験的機能
  experimental: {
    optimizePackageImports: ['@heroicons/react'],
  },
};

export default nextConfig;
