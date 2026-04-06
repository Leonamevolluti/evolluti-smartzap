import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ok, err } from '@/lib/mcp/helpers'

const getDb = () => getSupabaseAdmin()!
const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
const apiKey = () => process.env.SMARTZAP_API_KEY ?? ''

export function registerInboxTools(server: McpServer) {
  // ─── sz.inbox.list ───────────────────────────────────────────────────────
  server.registerTool(
    'sz.inbox.list',
    {
      title: 'Listar conversas',
      description: 'Lista conversas do inbox com filtros opcionais.',
      inputSchema: {
        status: z.enum(['active', 'resolved', 'bot', 'human']).optional(),
        search: z.string().optional().describe('Busca por nome ou telefone'),
        limit: z.number().int().min(1).max(50).default(20),
      },
    },
    async ({ status, search, limit }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      let query = db
        .from('conversations')
        .select(
          'id, contact_id, phone, contact_name, status, last_message, last_message_at, is_bot_active, unread_count'
        )
        .order('last_message_at', { ascending: false })
        .limit(limit)

      if (status === 'bot') {
        query = query.eq('is_bot_active', true)
      } else if (status === 'human') {
        query = query.eq('is_bot_active', false)
      } else if (status) {
        query = query.eq('status', status)
      }

      if (search) {
        query = query.or(`contact_name.ilike.%${search}%,phone.ilike.%${search}%`)
      }

      const { data, error } = await query
      if (error) return err(error.message)

      return ok({ conversations: data, count: data.length })
    }
  )

  // ─── sz.inbox.get ────────────────────────────────────────────────────────
  server.registerTool(
    'sz.inbox.get',
    {
      title: 'Detalhes da conversa',
      description: 'Retorna uma conversa com as últimas mensagens.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da conversa'),
        messageLimit: z.number().int().min(1).max(50).default(20).describe('Últimas N mensagens'),
      },
    },
    async ({ id, messageLimit }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const [convResult, msgResult] = await Promise.all([
        db.from('conversations').select('*').eq('id', id).maybeSingle(),
        db
          .from('messages')
          .select('id, role, content, type, status, created_at')
          .eq('conversation_id', id)
          .order('created_at', { ascending: false })
          .limit(messageLimit),
      ])

      if (convResult.error) return err(convResult.error.message)
      if (!convResult.data) return err('Conversa não encontrada')
      if (msgResult.error) return err(msgResult.error.message)

      return ok({
        conversation: convResult.data,
        messages: msgResult.data.reverse(),
      })
    }
  )

  // ─── sz.inbox.takeover ───────────────────────────────────────────────────
  server.registerTool(
    'sz.inbox.takeover',
    {
      title: 'Assumir conversa (desativar bot)',
      description: 'Pausa o bot em uma conversa, colocando em modo de atendimento humano.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da conversa'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/inbox/conversations/${id}/takeover`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey() },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )

  // ─── sz.inbox.return_to_bot ──────────────────────────────────────────────
  server.registerTool(
    'sz.inbox.return_to_bot',
    {
      title: 'Retornar para o bot',
      description: 'Reativa o bot em uma conversa que estava em modo humano.',
      inputSchema: {
        id: z.string().uuid().describe('UUID da conversa'),
      },
    },
    async ({ id }) => {
      const res = await fetch(`${baseUrl()}/api/inbox/conversations/${id}/return-to-bot`, {
        method: 'POST',
        headers: { 'x-api-key': apiKey() },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return err(body.error ?? `HTTP ${res.status}`)
      return ok(body)
    }
  )
}
