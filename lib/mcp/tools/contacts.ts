import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ok, err } from '@/lib/mcp/helpers'

const getDb = () => getSupabaseAdmin()!

export function registerContactsTools(server: McpServer) {
  // ─── sz.contacts.list ────────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.list',
    {
      title: 'Listar contatos',
      description: 'Lista contatos com filtros opcionais. Retorna até 100 por vez.',
      inputSchema: {
        search: z.string().optional().describe('Busca por nome ou telefone'),
        tag: z.string().optional().describe('Filtrar por tag'),
        status: z.enum(['OPT_IN', 'OPT_OUT', 'UNKNOWN']).optional().describe('Filtrar por status'),
        limit: z.number().int().min(1).max(100).default(20).describe('Máximo de resultados'),
        offset: z.number().int().min(0).default(0).describe('Offset para paginação'),
      },
    },
    async ({ search, tag, status, limit, offset }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      let query = db
        .from('contacts')
        .select('id, name, phone, email, status, tags, custom_fields, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (search) {
        query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
      }
      if (tag) {
        query = query.contains('tags', [tag])
      }
      if (status) {
        query = query.eq('status', status)
      }

      const { data, error, count } = await query
      if (error) return err(error.message)

      return ok({ contacts: data, total: count, offset, limit })
    }
  )

  // ─── sz.contacts.get ─────────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.get',
    {
      title: 'Buscar contato',
      description: 'Retorna detalhes de um contato por ID ou telefone.',
      inputSchema: {
        id: z.string().uuid().optional().describe('UUID do contato'),
        phone: z.string().optional().describe('Telefone em qualquer formato'),
      },
    },
    async ({ id, phone }) => {
      const db = getDb()
      if (!db) return err('Banco não configurado')
      if (!id && !phone) return err('Forneça id ou phone')

      let query = db
        .from('contacts')
        .select('id, name, phone, email, status, tags, custom_fields, notes, created_at')

      if (id) {
        query = query.eq('id', id)
      } else {
        query = query.or(`phone.eq.${phone},phone.ilike.%${phone!.replace(/\D/g, '')}%`)
      }

      const { data, error } = await query.maybeSingle()
      if (error) return err(error.message)
      if (!data) return err('Contato não encontrado')

      return ok(data)
    }
  )

  // ─── sz.contacts.stats ───────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.stats',
    {
      title: 'Estatísticas de contatos',
      description: 'Retorna totais por status (opt_in, opt_out, unknown) e total geral.',
      inputSchema: {},
    },
    async () => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db
        .from('contacts')
        .select('status')

      if (error) return err(error.message)

      const stats = { total: data.length, OPT_IN: 0, OPT_OUT: 0, UNKNOWN: 0 }
      for (const { status } of data) {
        if (status === 'OPT_IN') stats.OPT_IN++
        else if (status === 'OPT_OUT') stats.OPT_OUT++
        else stats.UNKNOWN++
      }

      return ok(stats)
    }
  )

  // ─── sz.contacts.tags ────────────────────────────────────────────────────
  server.registerTool(
    'sz.contacts.tags',
    {
      title: 'Listar tags',
      description: 'Retorna todas as tags únicas usadas nos contatos.',
      inputSchema: {},
    },
    async () => {
      const db = getDb()
      if (!db) return err('Banco não configurado')

      const { data, error } = await db.from('contacts').select('tags')
      if (error) return err(error.message)

      const tagSet = new Set<string>()
      for (const row of data ?? []) {
        for (const tag of row.tags ?? []) tagSet.add(tag)
      }

      return ok({ tags: Array.from(tagSet).sort() })
    }
  )
}
