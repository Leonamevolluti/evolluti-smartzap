import { NextResponse } from 'next/server'
import { Client } from '@upstash/workflow'

import { supabase } from '@/lib/supabase'
import { templateDb, campaignDb } from '@/lib/supabase-db'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'

import { precheckContactForTemplate } from '@/lib/whatsapp/template-contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

interface CampaignContactRow {
  id: string
  phone: string
  name: string | null
  email: string | null
  contact_id: string | null
  custom_fields: Record<string, unknown> | null
}

interface ContactRow {
  id: string
  name: string | null
  phone: string
  email: string | null
  custom_fields: Record<string, unknown> | null
}

/**
 * POST /api/campaigns/[id]/resend-skipped
 * Revalida os contatos SKIPPED e reenfileira apenas os que ficarem válidos.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id: campaignId } = await params

    // 1) Carregar campanha (templateName + templateVariables)
    const { data: campaignRow, error: campaignError } = await supabase
      .from('campaigns')
      .select('template_name, template_variables')
      .eq('id', campaignId)
      .single()

    if (campaignError) {
      return NextResponse.json({ error: 'Falha ao carregar campanha', details: campaignError.message }, { status: 500 })
    }

    const templateName = (campaignRow as any)?.template_name as string | null
    if (!templateName) {
      return NextResponse.json({ error: 'Campanha sem template associado' }, { status: 400 })
    }

    // JSONB normalmente já é objeto. Mantém fallback por segurança.
    let templateVariables: any = (campaignRow as any)?.template_variables
    if (typeof templateVariables === 'string') {
      try {
        templateVariables = JSON.parse(templateVariables)
      } catch {
        templateVariables = undefined
      }
    }

    // 2) Template precisa existir no cache local (documented-only)
    const template = await templateDb.getByName(templateName)
    if (!template) {
      return NextResponse.json(
        { error: 'Template não encontrado no banco local. Sincronize Templates antes de reenviar ignorados.' },
        { status: 400 }
      )
    }

    // Snapshot do template na campanha (se ainda não existir)
    try {
      const snapshot = {
        name: template.name,
        language: template.language,
        parameter_format: (template as any).parameterFormat || 'positional',
        spec_hash: (template as any).specHash ?? null,
        fetched_at: (template as any).fetchedAt ?? null,
        components: (template as any).components || (template as any).content || [],
      }

      const { data: existing } = await supabase
        .from('campaigns')
        .select('template_spec_hash')
        .eq('id', campaignId)
        .single()

      if (!(existing as any)?.template_spec_hash) {
        await supabase
          .from('campaigns')
          .update({
            template_snapshot: snapshot,
            template_spec_hash: snapshot.spec_hash,
            template_parameter_format: snapshot.parameter_format,
            template_fetched_at: snapshot.fetched_at,
            updated_at: new Date().toISOString(),
          })
          .eq('id', campaignId)
      }
    } catch (e) {
      console.warn('[ResendSkipped] Falha ao salvar snapshot do template na campanha (best-effort):', e)
    }

    // 3) Buscar contatos skipped (snapshot em campaign_contacts)
    const { data: skippedRows, error: skippedError } = await supabase
      .from('campaign_contacts')
      .select('id, phone, name, email, contact_id, custom_fields')
      .eq('campaign_id', campaignId)
      .eq('status', 'skipped')

    if (skippedError) {
      return NextResponse.json({ error: 'Falha ao buscar ignorados', details: skippedError.message }, { status: 500 })
    }

    const contacts = (skippedRows || []) as CampaignContactRow[]
    if (contacts.length === 0) {
      return NextResponse.json(
        { status: 'nothing', resent: 0, stillSkipped: 0, message: 'Não há contatos ignorados para reenviar.' },
        { status: 200 }
      )
    }

    // 3.1) Trazer dados atuais de contacts (para refletir correções no contato)
    const contactIds = Array.from(
      new Set(
        contacts
          .map((c) => c.contact_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    )

    const contactById = new Map<string, ContactRow>()
    if (contactIds.length > 0) {
      const { data: latestContacts, error: latestContactsError } = await supabase
        .from('contacts')
        .select('id, name, phone, email, custom_fields')
        .in('id', contactIds)

      if (latestContactsError) {
        return NextResponse.json(
          { error: 'Falha ao carregar contatos', details: latestContactsError.message },
          { status: 500 }
        )
      }

      for (const c of (latestContacts || []) as any[]) {
        if (!c?.id) continue
        contactById.set(String(c.id), {
          id: String(c.id),
          name: (c.name as string | null) ?? null,
          phone: String(c.phone || ''),
          email: (c.email as string | null) ?? null,
          custom_fields: (c.custom_fields as Record<string, unknown> | null) ?? null,
        })
      }
    }

    const nowIso = new Date().toISOString()

    const validForResend: Array<{ contactId?: string; phone: string; name: string; email?: string; custom_fields?: Record<string, unknown> }> = []
    const updates: Array<any> = []

    for (const row of contacts) {
      const latest = row.contact_id ? contactById.get(row.contact_id) : undefined
      const effectiveName = (latest?.name ?? row.name ?? '') as string
      const effectivePhone = (latest?.phone ?? row.phone) as string
      const effectiveEmail = (latest?.email ?? row.email) as string | null
      const effectiveCustomFields = (latest?.custom_fields ?? row.custom_fields ?? {}) as Record<string, unknown>

      const precheck = precheckContactForTemplate(
        {
          phone: effectivePhone,
          name: effectiveName || '',
          email: effectiveEmail || undefined,
          custom_fields: effectiveCustomFields || {},
          contactId: row.contact_id || null,
        },
        template as any,
        templateVariables
      )

      if (!precheck.ok) {
        updates.push({
          id: row.id,
          status: 'skipped',
          // Mantém snapshot sincronizado com o contato atual
          phone: precheck.normalizedPhone || effectivePhone,
          name: effectiveName || null,
          email: effectiveEmail,
          custom_fields: effectiveCustomFields,
          // Motivo do skip: usa colunas existentes (failure_reason/error)
          failure_reason: precheck.reason,
          error: precheck.reason,
          message_id: null,
          failed_at: null,
        })
        continue
      }

      // Válido: volta para pending e limpa campos de skip/erro
      updates.push({
        id: row.id,
        phone: precheck.normalizedPhone,
        name: effectiveName || null,
        email: effectiveEmail,
        custom_fields: effectiveCustomFields,
        status: 'pending',
        failure_code: null,
        failure_reason: null,
        error: null,
        message_id: null,
        failed_at: null,
      })

      validForResend.push({
        contactId: row.contact_id || undefined,
        phone: precheck.normalizedPhone,
        name: effectiveName || '',
        email: effectiveEmail || undefined,
        custom_fields: effectiveCustomFields || {},
      })
    }

    // 4) Persistir updates (bulk upsert por PK id)
    if (updates.length) {
      const { error: upsertError } = await supabase
        .from('campaign_contacts')
        .upsert(updates, { onConflict: 'id' })

      if (upsertError) {
        return NextResponse.json({ error: 'Falha ao atualizar status dos contatos', details: upsertError.message }, { status: 500 })
      }
    }

    const stillSkipped = contacts.length - validForResend.length

    // Atualiza contador de skipped na campanha (para UI imediata)
    await campaignDb.updateStatus(campaignId, { skipped: stillSkipped })

    // 5) Se ninguém ficou válido, não enfileira
    if (validForResend.length === 0) {
      return NextResponse.json(
        {
          status: 'skipped',
          resent: 0,
          stillSkipped,
          message: 'Nenhum contato ignorado passou na revalidação.',
        },
        { status: 202 }
      )
    }

    // 6) Credenciais WhatsApp (Redis/env)
    const credentials = await getWhatsAppCredentials()
    if (!credentials?.phoneNumberId || !credentials?.accessToken) {
      return NextResponse.json(
        { error: 'Credenciais WhatsApp não configuradas. Configure em Configurações.' },
        { status: 401 }
      )
    }

    // 7) Enfileirar workflow com apenas os válidos
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim())
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : null)
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : null)
      || 'http://localhost:3000'

    const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')

    const workflowPayload = {
      campaignId,
      templateName,
      contacts: validForResend,
      templateVariables,
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
      isResend: true,
    }

    if (isLocalhost) {
      const response = await fetch(`${baseUrl}/api/campaign/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workflowPayload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Workflow failed with status ${response.status}`)
      }
    } else {
      if (!process.env.QSTASH_TOKEN) {
        return NextResponse.json(
          { error: 'Serviço de workflow não configurado. Configure QSTASH_TOKEN.' },
          { status: 503 }
        )
      }

      const workflowClient = new Client({ token: process.env.QSTASH_TOKEN })
      await workflowClient.trigger({
        url: `${baseUrl}/api/campaign/workflow`,
        body: workflowPayload,
      })
    }

    return NextResponse.json(
      {
        status: 'queued',
        resent: validForResend.length,
        stillSkipped,
        message: `${validForResend.length} contatos reenfileirados • ${stillSkipped} ainda ignorados`,
      },
      { status: 202 }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[ResendSkipped] Error:', error)
    return NextResponse.json(
      { error: 'Falha ao reenviar ignorados', details: errorMessage },
      { status: 500 }
    )
  }
}
