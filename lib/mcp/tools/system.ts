import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { getMcpContext } from '@/lib/mcp/context'
import { ok, err } from '@/lib/mcp/helpers'

const getDb = () => getSupabaseAdmin()!
const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
const apiKey = () => process.env.SMARTZAP_API_KEY ?? ''

export function registerSystemTools(server: McpServer) {
  // ─── sz.health.check ─────────────────────────────────────────────────────
  server.registerTool(
    'sz.health.check',
    {
      title: 'Health check',
      description: 'Verifica conectividade com banco, credenciais WhatsApp e fila QStash.',
      inputSchema: {},
    },
    async () => {
      const res = await fetch(`${baseUrl()}/api/health`)
      const body = await res.json().catch(() => ({}))
      return ok(body)
    }
  )

  // ─── sz.settings.credentials_status ─────────────────────────────────────
  server.registerTool(
    'sz.settings.credentials_status',
    {
      title: 'Status das credenciais WhatsApp',
      description:
        'Verifica se as credenciais WhatsApp estão configuradas. Nunca retorna os valores das chaves.',
      inputSchema: {},
    },
    async () => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data } = await db
        .from('settings')
        .select('key')
        .in('key', ['whatsapp_phone_number_id', 'whatsapp_access_token', 'whatsapp_business_id'])

      const keys = new Set((data ?? []).map((r) => r.key))
      return ok({
        hasPhoneNumberId: keys.has('whatsapp_phone_number_id'),
        hasAccessToken: keys.has('whatsapp_access_token'),
        hasBusinessAccountId: keys.has('whatsapp_business_id'),
        fullyConfigured:
          keys.has('whatsapp_phone_number_id') &&
          keys.has('whatsapp_access_token') &&
          keys.has('whatsapp_business_id'),
      })
    }
  )

  // ─── sz.settings.ai_status ───────────────────────────────────────────────
  server.registerTool(
    'sz.settings.ai_status',
    {
      title: 'Status da configuração de IA',
      description: 'Retorna provider e modelo ativos. Nunca retorna as chaves API.',
      inputSchema: {},
    },
    async () => {
      const res = await fetch(`${baseUrl()}/api/settings/ai`, {
        headers: { 'x-api-key': apiKey() },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)

      // Remove chaves sensíveis da resposta
      const { googleApiKey: _g, openaiApiKey: _o, ...safe } = body
      return ok({
        ...safe,
        hasGoogleKey: !!body.googleApiKey,
        hasOpenAIKey: !!body.openaiApiKey,
      })
    }
  )

  // ─── sz.debug.alerts ─────────────────────────────────────────────────────
  server.registerTool(
    'sz.debug.alerts',
    {
      title: 'Alertas recentes da conta',
      description: 'Lista alertas e erros de entrega recentes (erros Meta, rate limits, etc.).',
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ limit }) => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('account_alerts')
        .select('id, type, message, details, created_at, resolved_at')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) return err(error.message)
      return ok({ alerts: data, count: data.length })
    }
  )

  // ─── sz.debug.campaign_contacts ──────────────────────────────────────────
  server.registerTool(
    'sz.debug.campaign_contacts',
    {
      title: 'Contatos com falha em campanha',
      description: 'Lista contatos com erro de entrega em uma campanha específica.',
      inputSchema: {
        campaignId: z.string().uuid().describe('UUID da campanha'),
        status: z
          .enum(['FAILED', 'PENDING', 'SKIPPED'])
          .default('FAILED')
          .describe('Status para filtrar'),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ campaignId, status, limit }) => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('campaign_contacts')
        .select('id, phone, status, error_code, error_message, sent_at, updated_at')
        .eq('campaign_id', campaignId)
        .eq('status', status)
        .order('updated_at', { ascending: false })
        .limit(limit)

      if (error) return err(error.message)
      return ok({ contacts: data, count: data.length, status })
    }
  )

  // ─── sz.debug.test_connection ────────────────────────────────────────────
  server.registerTool(
    'sz.debug.test_connection',
    {
      title: 'Testar conexão WhatsApp',
      description: 'Verifica se as credenciais WhatsApp estão válidas chamando a API da Meta.',
      inputSchema: {},
    },
    async () => {
      const ctx = getMcpContext()
      if (!ctx.isAdmin) return err('Requer chave admin (SMARTZAP_ADMIN_KEY)')

      const res = await fetch(`${baseUrl()}/api/settings/test-connection`, {
        method: 'POST',
        headers: { 'x-api-key': process.env.SMARTZAP_ADMIN_KEY ?? '' },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
