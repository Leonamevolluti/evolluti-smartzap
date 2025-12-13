import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Next.js 16 uses Turbopack by default
  reactStrictMode: true,

  // Standalone output for Docker
  output: 'standalone',

  // Include SQL migration files in the serverless bundle
  outputFileTracingIncludes: {
    '/api/setup/migrate': ['./lib/migrations/**/*'],
  },

  // Environment variables exposed to client
  env: {
    NEXT_PUBLIC_APP_NAME: 'SmartZap',
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 'dev',
  },

  // React Compiler for automatic memoization (moved from experimental in Next.js 16)
  reactCompiler: true,

  // Turbopack config
  turbopack: {
    // Set the workspace root to this directory
    root: __dirname,
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
      },
    ],
  },

  // Headers for security and CORS
  async headers() {
    // CORS precisa ser um origin explícito quando há cookies (credentials).
    // Preferimos um override manual via FRONTEND_URL. Caso não exista, usamos as
    // System Environment Variables da Vercel:
    // - VERCEL_URL: domínio da URL gerada do deployment (sem https://)
    // - VERCEL_PROJECT_PRODUCTION_URL: domínio de produção “canonical” (sem https://)
    // Docs: https://vercel.com/docs/environment-variables/system-environment-variables
    const allowedOrigin =
      process.env.FRONTEND_URL ||
      (process.env.VERCEL_ENV === 'production'
        ? (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))
        : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'))
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, PATCH, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-API-Key' },
          // Necessário para cookies em requests cross-origin (quando aplicável)
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
    ]
  },
}

export default nextConfig
