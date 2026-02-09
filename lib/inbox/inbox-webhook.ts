/**
 * T046-T048: Inbox Webhook Integration
 * Handles inbox-related webhook events:
 * - T046: Persist inbound messages to inbox_messages
 * - T047: Trigger AI processing when mode = 'bot'
 * - T048: Update delivery status in inbox_messages
 *
 * OTIMIZAÇÕES V2 (2026-01-26):
 * - RPC process_inbound_message: 4-5 queries → 1 chamada
 * - Fallback automático para versão anterior se RPC não existir
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { inboxDb, isHumanModeExpired, switchToBotMode, findConversationByPhoneLightweight } from './inbox-db'
import { cancelDebounce } from '@/lib/ai/agents/chat-agent'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { Client } from '@upstash/qstash'
import { redis } from '@/lib/redis'
import type {
  InboxConversation,
  InboxMessage,
  AIAgent,
} from '@/types'

// Tipo para conversa lightweight (retorno otimizado do webhook)
type LightweightConversation = Awaited<ReturnType<typeof findConversationByPhoneLightweight>>

// Tipo do retorno da RPC process_inbound_message
interface ProcessInboundMessageResult {
  conversation_id: string
  message_id: string
  is_new_conversation: boolean
  conversation_status: string
  conversation_mode: string
  ai_agent_id: string | null
  human_mode_expires_at: string | null
  automation_paused_until: string | null
}

// QStash client para disparar processamento de IA (simplificado)
const getQStashClient = () => {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    console.warn('[Inbox] QSTASH_TOKEN não configurado, AI processing não disponível')
    return null
  }
  return new Client({ token })
}

// =============================================================================
// Types
// =============================================================================

export interface InboundMessagePayload {
  /** WhatsApp message ID */
  messageId: string
  /** Sender phone number (raw format from webhook) */
  from: string
  /** Message type (text, image, interactive, etc) */
  type: string
  /** Text content (extracted from various message formats) */
  text: string
  /** Raw message timestamp from Meta */
  timestamp?: string
  /** Media URL if applicable */
  mediaUrl?: string | null
  /** Phone number ID that received the message */
  phoneNumberId?: string
}

export interface StatusUpdatePayload {
  /** WhatsApp message ID */
  messageId: string
  /** Status (sent, delivered, read, failed) */
  status: 'sent' | 'delivered' | 'read' | 'failed'
  /** Timestamp from webhook */
  timestamp?: string
  /** Error details if failed */
  errors?: Array<{ code: number; title: string; message?: string }>
}

// =============================================================================
// Inbound Message Handler (T046)
// =============================================================================

/**
 * Process an inbound message using optimized RPC (V2)
 * Executes conversation upsert + message creation + counter updates in a single DB call
 *
 * OTIMIZAÇÕES V2 (2026-01-26):
 * 1. RPC process_inbound_message: 4-5 queries → 1 chamada atômica
 * 2. Fallback automático para versão legacy se RPC não existir
 */
export async function handleInboundMessage(
  payload: InboundMessagePayload
): Promise<{
  conversationId: string
  messageId: string
  triggeredAI: boolean
}> {
  const normalizedPhone = normalizePhoneNumber(payload.from)
  const supabase = getSupabaseAdmin()

  // Tenta usar RPC otimizada (V2)
  // Fix aplicado em 20260203000000_fix_process_inbound_message_types.sql
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('process_inbound_message', {
        p_phone: normalizedPhone,
        p_content: payload.text || `[${payload.type}]`,
        p_whatsapp_message_id: payload.messageId || null,
        p_message_type: mapMessageType(payload.type),
        p_media_url: payload.mediaUrl || null,
        p_payload: {
          raw_type: payload.type,
          timestamp: payload.timestamp,
          phone_number_id: payload.phoneNumberId,
        },
        p_contact_id: null, // Contact lookup done inside RPC if needed
      })

      if (!error && data) {
        const result = data as ProcessInboundMessageResult
        console.log(`⚡ [INBOX] RPC process_inbound_message OK: conv=${result.conversation_id}, msg=${result.message_id}, new=${result.is_new_conversation}`)

        // Trigger AI se necessário
        let triggeredAI = false
        let currentMode = result.conversation_mode

        // Check if human mode has expired
        if (currentMode === 'human' && result.human_mode_expires_at) {
          if (isHumanModeExpired(result.human_mode_expires_at)) {
            console.log(`[Inbox] Human mode expired for ${result.conversation_id}, auto-switching to bot mode`)
            await switchToBotMode(result.conversation_id)
            currentMode = 'bot'
          }
        }

        if (currentMode === 'bot') {
          if (isAutomationPaused(result.automation_paused_until)) {
            console.log(`[Inbox] Automation paused until ${result.automation_paused_until}, skipping AI`)
          } else {
            // Cria objeto lightweight para triggerAIProcessing
            const conversationForTrigger = {
              id: result.conversation_id,
              phone: normalizedPhone,
              status: result.conversation_status,
              mode: currentMode,
              ai_agent_id: result.ai_agent_id,
              human_mode_expires_at: result.human_mode_expires_at,
              automation_paused_until: result.automation_paused_until,
            } as InboxConversation

            const messageForTrigger = {
              id: result.message_id,
              conversation_id: result.conversation_id,
              whatsapp_message_id: payload.messageId, // Necessário para deduplicação
            } as InboxMessage

            triggeredAI = await triggerAIProcessing(conversationForTrigger, messageForTrigger)
          }
        }

        return {
          conversationId: result.conversation_id,
          messageId: result.message_id,
          triggeredAI,
        }
      }

      // Se RPC não existe ou falhou, usa fallback
      if (error?.code === '42883') {
        console.log('[Inbox] RPC process_inbound_message não existe, usando fallback legacy')
      } else if (error) {
        console.warn('[Inbox] RPC error, usando fallback:', error.message)
      }
    } catch (rpcError) {
      console.warn('[Inbox] RPC exception, usando fallback:', rpcError)
    }
  }

  // FALLBACK: Versão legacy (4-5 queries)
  return handleInboundMessageLegacy(payload, normalizedPhone)
}

/**
 * Versão legacy do handleInboundMessage (fallback se RPC não existir)
 */
async function handleInboundMessageLegacy(
  payload: InboundMessagePayload,
  normalizedPhone: string
): Promise<{
  conversationId: string
  messageId: string
  triggeredAI: boolean
}> {
  // 1. Busca conversa existente (versão LIGHTWEIGHT - sem JOINs)
  let conversation = await findConversationByPhoneLightweight(normalizedPhone)

  if (!conversation) {
    // Paraleliza: busca contato enquanto prepara criação da conversa
    const contactId = await findContactId(normalizedPhone)
    const fullConversation = await inboxDb.createConversation({
      phone: normalizedPhone,
      contact_id: contactId || undefined,
      mode: 'bot',
    })
    conversation = {
      id: fullConversation.id,
      phone: fullConversation.phone,
      status: fullConversation.status,
      mode: fullConversation.mode,
      ai_agent_id: fullConversation.ai_agent_id,
      contact_id: fullConversation.contact_id,
      human_mode_expires_at: fullConversation.human_mode_expires_at,
      automation_paused_until: fullConversation.automation_paused_until,
      total_messages: fullConversation.total_messages,
      unread_count: fullConversation.unread_count,
    }
  } else if (conversation.status === 'closed') {
    await inboxDb.updateConversation(conversation.id, { status: 'open' })
  }

  // 2. Cria mensagem
  const message = await inboxDb.createMessage({
    conversation_id: conversation.id,
    direction: 'inbound',
    content: payload.text || `[${payload.type}]`,
    message_type: mapMessageType(payload.type),
    whatsapp_message_id: payload.messageId || undefined,
    media_url: payload.mediaUrl || undefined,
    delivery_status: 'delivered',
    payload: {
      raw_type: payload.type,
      timestamp: payload.timestamp,
      phone_number_id: payload.phoneNumberId,
    },
  })

  // 3. Trigger AI
  let triggeredAI = false
  let currentMode = conversation.mode

  if (currentMode === 'human' && isHumanModeExpired(conversation.human_mode_expires_at)) {
    await switchToBotMode(conversation.id)
    currentMode = 'bot'
  }

  if (currentMode === 'bot' && !isAutomationPaused(conversation.automation_paused_until)) {
    triggeredAI = await triggerAIProcessing(conversation as InboxConversation, message)
  }

  return {
    conversationId: conversation.id,
    messageId: message.id,
    triggeredAI,
  }
}

// =============================================================================
// AI Processing Trigger (T047) - Via QStash com Debounce Reset
// =============================================================================

/**
 * Trigger AI agent processing via QStash com "debounce com reset"
 *
 * Implementa o padrão usado por n8n, Typebot, Botpress etc:
 * - A cada mensagem, RESETA o timer de espera
 * - Só processa quando o usuário PARA de digitar por X segundos
 *
 * Fluxo:
 * 1. Busca agente para pegar debounce_ms configurado (default: 3s)
 * 2. Atualiza timestamp da "última mensagem" no Redis
 * 3. Agenda job com delay = debounce_ms
 * 4. Quando job executa, verifica se passou debounce_ms desde última msg
 *    - Se sim: processa (usuário parou de digitar)
 *    - Se não: skipa (outro job mais recente vai processar)
 */
async function triggerAIProcessing(
  conversation: InboxConversation,
  message: InboxMessage
): Promise<boolean> {
  const conversationId = conversation.id
  const messageId = message.whatsapp_message_id // Usado para deduplicação
  const now = Date.now()

  console.log(`🔥 [TRIGGER] Starting AI processing for ${conversationId}, messageId=${messageId}`)

  const qstash = getQStashClient()

  if (!qstash) {
    console.log('[Inbox] QStash client not available, skipping AI processing')
    return false
  }

  // 1. Busca o agente para pegar o debounce_ms configurado (usa RPC otimizada)
  const agent = await getAgentForTrigger(conversation.ai_agent_id, conversationId)
  const debounceMs = agent?.debounce_ms ?? 3000 // default 3s (padrão do mercado)
  const debounceSeconds = Math.ceil(debounceMs / 1000)

  console.log(`🔥 [TRIGGER] Agent debounce: ${debounceMs}ms (${debounceSeconds}s)`)

  // 2. Se debounce desabilitado (0), dispara imediatamente
  if (debounceMs === 0) {
    console.log(`🔥 [TRIGGER] Debounce disabled, dispatching immediately`)
    return await dispatchToQStash(conversationId, debounceMs, 0, messageId)
  }

  // 3. Atualiza timestamp da ÚLTIMA MENSAGEM no Redis (isso é o "reset" do timer)
  const redisKey = `ai:lastmsg:${conversationId}`
  if (redis) {
    // Expira a chave alguns segundos após o delay para limpeza automática
    await redis.set(redisKey, now, { ex: debounceSeconds + 30 })
    console.log(`🔥 [TRIGGER] Redis SET ${redisKey} = ${now} (última mensagem)`)
  } else {
    console.log(`⚠️ [TRIGGER] Redis not configured, debounce will be best-effort`)
  }

  // 4. Agenda job com delay - quando executar, vai verificar se passou tempo suficiente
  return await dispatchToQStash(conversationId, debounceMs, debounceSeconds, messageId)
}

/**
 * Helper: Dispara job para QStash com delay opcional
 *
 * DEDUPLICAÇÃO (2026-02-03):
 * - Usa messageId como deduplicationId no QStash
 * - Evita reprocessamento em caso de retry automático do QStash
 */
async function dispatchToQStash(
  conversationId: string,
  debounceMs: number,
  delaySeconds: number,
  messageId?: string | null
): Promise<boolean> {
  const qstash = getQStashClient()
  if (!qstash) return false

  // URL do endpoint - prioridade para variáveis de produção da Vercel
  // VERCEL_PROJECT_PRODUCTION_URL sempre retorna o domínio customizado em produção
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
    'http://localhost:3000'

  const aiRespondUrl = `${baseUrl}/api/ai/respond`

  console.log(`🔥 [TRIGGER] Dispatching to ${aiRespondUrl} with delay=${delaySeconds}s, messageId=${messageId}`)

  try {
    // Headers para autenticação e bypass
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Adiciona API key para passar pelo middleware de autenticação
    const apiKey = process.env.SMARTZAP_API_KEY
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    // Se tiver bypass secret configurado, adiciona o header
    // Isso permite que QStash passe pelo Deployment Protection da Vercel
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    if (bypassSecret) {
      headers['x-vercel-protection-bypass'] = bypassSecret
    }

    await qstash.publishJSON({
      url: aiRespondUrl,
      body: { conversationId, debounceMs, messageId },
      delay: delaySeconds > 0 ? delaySeconds : undefined,
      retries: 2,
      headers,
      // DEDUPLICAÇÃO: QStash ignora mensagens com mesmo deduplicationId
      // Janela de 1 hora - evita retry duplicado
      // NOTA: QStash não aceita ":" no deduplicationId, usar "_"
      ...(messageId && { deduplicationId: `ai_respond_${messageId.replace(/[^a-zA-Z0-9_-]/g, '_')}` }),
    })

    console.log(`✅ [TRIGGER] AI scheduled: delay=${delaySeconds}s, debounceMs=${debounceMs}, dedup=${messageId ? 'enabled' : 'disabled'}`)
    return true
  } catch (error) {
    console.error('❌ [TRIGGER] Failed to dispatch AI processing:', error)
    return false
  }
}

/**
 * Helper: Busca agente para pegar debounce_ms
 *
 * OTIMIZAÇÃO V2 (2026-01-26):
 * - Usa RPC get_agent_config que faz JOIN otimizado
 * - Fallback para queries diretas se RPC não existir
 *
 * Versão leve que só busca os campos necessários
 */
async function getAgentForTrigger(agentId: string | null, conversationId?: string): Promise<Pick<AIAgent, 'debounce_ms'> | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return null

  // OTIMIZAÇÃO: Tenta usar RPC get_agent_config (se tiver conversationId)
  if (conversationId) {
    try {
      const { data, error } = await supabase.rpc('get_agent_config', {
        p_conversation_id: conversationId,
      })

      if (!error && data) {
        console.log(`⚡ [TRIGGER] RPC get_agent_config OK: debounce=${data.debounce_ms}ms`)
        return { debounce_ms: data.debounce_ms ?? 3000 }
      }

      // Se RPC não existe, fallback para queries diretas
      if (error?.code === '42883') {
        console.log('[TRIGGER] RPC get_agent_config não existe, usando fallback')
      }
    } catch {
      // Fallback silencioso
    }
  }

  // FALLBACK: Queries diretas
  // Tenta agente específico
  if (agentId) {
    const { data } = await supabase
      .from('ai_agents')
      .select('debounce_ms')
      .eq('id', agentId)
      .single()
    if (data) return data
  }

  // Fallback para agente padrão
  const { data } = await supabase
    .from('ai_agents')
    .select('debounce_ms')
    .eq('is_active', true)
    .eq('is_default', true)
    .single()

  return data || null
}

/**
 * Handle AI handoff to human
 * Switches conversation mode and creates internal note
 */
async function handleAIHandoff(
  conversation: InboxConversation,
  reason?: string,
  summary?: string
): Promise<void> {
  console.log(
    `[Inbox] AI handoff for conversation ${conversation.id}: ${reason}`
  )

  // Switch to human mode
  await inboxDb.updateConversation(conversation.id, { mode: 'human' })

  // Cancel any pending debounce
  cancelDebounce(conversation.id)

  // Create internal note about handoff
  await inboxDb.createMessage({
    conversation_id: conversation.id,
    direction: 'outbound',
    content: `🤖 **Transferência para atendente**\n\n${reason ? `**Motivo:** ${reason}\n` : ''}${summary ? `**Resumo:** ${summary}` : ''}`,
    message_type: 'internal_note',
    delivery_status: 'delivered',
    payload: {
      type: 'ai_handoff',
      reason,
      summary,
      timestamp: new Date().toISOString(),
    },
  })
}

// =============================================================================
// Delivery Status Handler (T048)
// =============================================================================

/**
 * Update message delivery status in inbox
 */
export async function handleDeliveryStatus(
  payload: StatusUpdatePayload
): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[Inbox] Supabase admin client not available')
    return false
  }

  // Find message by WhatsApp message ID
  const { data: message, error } = await supabase
    .from('inbox_messages')
    .select('id, conversation_id, delivery_status')
    .eq('whatsapp_message_id', payload.messageId)
    .single()

  if (error || !message) {
    // Message not found in inbox - might be from campaigns
    return false
  }

  // Update delivery status
  const updates: Record<string, unknown> = {
    delivery_status: payload.status,
  }

  // Add timestamp fields
  if (payload.status === 'delivered') {
    updates.delivered_at = payload.timestamp || new Date().toISOString()
  } else if (payload.status === 'read') {
    updates.read_at = payload.timestamp || new Date().toISOString()
  } else if (payload.status === 'failed') {
    updates.failed_at = payload.timestamp || new Date().toISOString()
    if (payload.errors?.[0]) {
      updates.failure_reason = `[${payload.errors[0].code}] ${payload.errors[0].title}`
    }
  }

  const { error: updateError } = await supabase
    .from('inbox_messages')
    .update(updates)
    .eq('id', message.id)

  if (updateError) {
    console.error('[Inbox] Failed to update delivery status:', updateError)
    return false
  }

  return true
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find contact ID by phone number
 */
async function findContactId(phone: string): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    console.error('[Inbox] Supabase admin client not available')
    return null
  }

  const { data } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone', phone)
    .single()

  return data?.id || null
}

/**
 * Map WhatsApp message types to inbox message types
 */
function mapMessageType(waType: string): InboxMessage['message_type'] {
  const typeMap: Record<string, InboxMessage['message_type']> = {
    text: 'text',
    image: 'image',
    audio: 'audio',
    video: 'video',
    document: 'document',
    template: 'template',
    interactive: 'interactive',
    button: 'interactive',
    location: 'text',
    contacts: 'text',
    sticker: 'image',
  }

  return typeMap[waType] || 'text'
}

/**
 * T066: Check if automation is paused for a conversation
 * Returns true if pause timestamp exists and is in the future
 */
function isAutomationPaused(pausedUntil: string | null | undefined): boolean {
  if (!pausedUntil) return false
  const pauseTime = new Date(pausedUntil).getTime()
  const now = Date.now()
  return pauseTime > now
}
