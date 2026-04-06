import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { mcpContextStorage } from '@/lib/mcp/context'
import { registerAllTools } from '@/lib/mcp/index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Extrai token do header Authorization: Bearer <token> ou X-Api-Key: <token>
function extractToken(request: Request): string {
  const auth = request.headers.get('authorization') ?? ''
  const fromBearer = auth.replace(/^Bearer\s+/i, '').trim()
  if (fromBearer) return fromBearer
  return request.headers.get('x-api-key')?.trim() ?? ''
}

// Mesma lógica do dashboard (user-auth.ts): usa crypto.subtle global, sem import
async function checkMasterPassword(token: string, stored: string): Promise<boolean> {
  const isHashed = stored.length === 64 && /^[a-f0-9]+$/i.test(stored)
  if (!isHashed) return token === stored
  const encoder = new TextEncoder()
  const data = encoder.encode(token + '_smartzap_salt_2026')
  const buf = await crypto.subtle.digest('SHA-256', data)
  const hashed = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hashed === stored
}

// Valida o token e retorna o contexto de admin ou null se inválido
async function resolveToken(token: string): Promise<{ isAdmin: boolean } | null> {
  const adminKey = process.env.SMARTZAP_ADMIN_KEY
  const apiKey = process.env.SMARTZAP_API_KEY
  const masterPassword = process.env.MASTER_PASSWORD

  if (adminKey && token === adminKey) return { isAdmin: true }
  if (apiKey && token === apiKey) return { isAdmin: false }
  // MASTER_PASSWORD (texto puro ou hash sha256+salt) também concede acesso admin
  if (masterPassword && (await checkMasterPassword(token, masterPassword))) return { isAdmin: true }

  return null
}

const mcpHandler = createMcpHandler(
  (server) => {
    registerAllTools(server)
  },
  undefined,
  {
    basePath: '/api',
    maxDuration: 120,
    verboseLogs: process.env.NODE_ENV === 'development',
  }
)

const authWrappedHandler = withMcpAuth(
  mcpHandler,
  async (req, bearerToken) => {
    const token = bearerToken ?? extractToken(req)
    if (!token) return undefined

    const ctx = await resolveToken(token)
    if (!ctx) return undefined

    // Retorna AuthInfo mínimo compatível. O contexto real fica no AsyncLocalStorage.
    return { token, clientId: ctx.isAdmin ? 'admin' : 'api', scopes: [] }
  },
  { required: true }
)

async function wrappedHandler(request: Request) {
  const token = extractToken(request)

  if (token) {
    const ctx = await resolveToken(token)
    if (ctx) {
      return mcpContextStorage.run(ctx, () => authWrappedHandler(request))
    }
  }

  return authWrappedHandler(request)
}

export {
  wrappedHandler as GET,
  wrappedHandler as POST,
  wrappedHandler as DELETE,
}
