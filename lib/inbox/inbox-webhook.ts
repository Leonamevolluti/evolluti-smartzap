/**
 * T046-T048: Inbox Webhook Integration
 * Handles inbox-related webhook events:
 * - T046: Persist inbound messages to inbox_messages
 * - T047: Trigger AI processing when mode = 'bot'
 * - T048: Update delivery status in inbox_messages
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { normalizePhoneNumber } from '@/lib/phone-formatter'
import { inboxDb, isHumanModeExpired, switchToBotMode } from './inbox-db'
import { cancelDebounce } from '@/lib/ai/agents/chat-agent'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { getRedis, REDIS_KEYS } from '@/lib/upstash/redis'
import { Client } from '@upstash/workflow'
import type { InboxAIWorkflowPayload } from './inbox-ai-workflow'
import type {
  InboxConversation,
  InboxMessage,
} from '@/types'

// Workflow client para disparar processamento de IA
const getWorkflowClient = () => {
  const token = process.env.QSTASH_TOKEN
  if (!token) {
    console.warn('[Inbox] QSTASH_TOKEN não configurado, workflow não disponível')
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
 * Process an inbound message and persist to inbox
 * Creates conversation if needed, adds message, triggers AI if mode=bot
 */
export async function handleInboundMessage(
  payload: InboundMessagePayload
): Promise<{
  conversationId: string
  messageId: string
  triggeredAI: boolean
}> {
  // Note: We use inboxDb which uses getSupabaseAdmin() internally
  const normalizedPhone = normalizePhoneNumber(payload.from)

  // 1. Get or create conversation
  let conversation = await inboxDb.findConversationByPhone(normalizedPhone)

  if (!conversation) {
    // Create new conversation
    const contactId = await findContactId(normalizedPhone)
    conversation = await inboxDb.createConversation({
      phone: normalizedPhone,
      contact_id: contactId || undefined,
      mode: 'bot', // Default to bot mode for new conversations
    })
  } else if (conversation.status === 'closed') {
    // Reopen closed conversation on new inbound message
    await inboxDb.updateConversation(conversation.id, { status: 'open' })
  }

  // 2. Create inbox message
  const message = await inboxDb.createMessage({
    conversation_id: conversation.id,
    direction: 'inbound',
    content: payload.text || `[${payload.type}]`,
    message_type: mapMessageType(payload.type),
    whatsapp_message_id: payload.messageId || undefined,
    media_url: payload.mediaUrl || undefined,
    delivery_status: 'delivered', // Inbound messages are already delivered
    payload: {
      raw_type: payload.type,
      timestamp: payload.timestamp,
      phone_number_id: payload.phoneNumberId,
    },
  })

  // 3. Trigger AI processing if mode is 'bot' and automation is not paused (T066)
  let triggeredAI = false
  let currentMode = conversation.mode

  // Check if human mode has expired → auto-switch back to bot
  if (currentMode === 'human' && isHumanModeExpired(conversation.human_mode_expires_at)) {
    console.log(
      `[Inbox] Human mode expired for ${conversation.id}, auto-switching to bot mode`
    )
    await switchToBotMode(conversation.id)
    currentMode = 'bot'
  }

  console.log(`🤖 [INBOX] Checking AI trigger: mode=${currentMode}, automationPausedUntil=${conversation.automation_paused_until}`)

  if (currentMode === 'bot') {
    // T066: Check if automation is paused
    if (isAutomationPaused(conversation.automation_paused_until)) {
      console.log(
        `[Inbox] Automation paused until ${conversation.automation_paused_until}, skipping AI processing`
      )
    } else {
      console.log(`🤖 [INBOX] Calling triggerAIProcessing for conversation ${conversation.id}`)
      triggeredAI = await triggerAIProcessing(conversation, message)
      console.log(`🤖 [INBOX] triggerAIProcessing returned: ${triggeredAI}`)
    }
  } else {
    console.log(`🤖 [INBOX] Skipping AI trigger because mode=${currentMode}`)
  }

  return {
    conversationId: conversation.id,
    messageId: message.id,
    triggeredAI,
  }
}

// =============================================================================
// AI Processing Trigger (T047) - Via Upstash Workflow
// =============================================================================

/**
 * Trigger AI agent processing via durable workflow
 *
 * Usa Upstash Workflow ao invés de setTimeout para debounce durável.
 * O workflow sobrevive à morte da função serverless.
 *
 * Fluxo:
 * 1. Atualiza timestamp da última mensagem no Redis
 * 2. Se não existe workflow pendente, dispara novo workflow
 * 3. Se existe, o workflow em execução vai detectar a nova mensagem
 */
async function triggerAIProcessing(
  conversation: InboxConversation,
  message: InboxMessage
): Promise<boolean> {
  const conversationId = conversation.id
  console.log(`🔥 [TRIGGER] Starting triggerAIProcessing for ${conversationId}`)

  const redis = getRedis()
  const workflowClient = getWorkflowClient()

  console.log(`🔥 [TRIGGER] Redis available: ${!!redis}, WorkflowClient available: ${!!workflowClient}`)

  // Verifica se temos os clientes necessários
  if (!workflowClient) {
    console.log('[Inbox] Workflow client not available, skipping AI processing')
    return false
  }

  // Atualiza timestamp da última mensagem (para debounce distribuído)
  if (redis) {
    const timestamp = Date.now().toString()
    await redis.set(REDIS_KEYS.inboxLastMessage(conversationId), timestamp)
    console.log(`🔥 [TRIGGER] Set last message timestamp: ${timestamp}`)
  }

  // Verifica se já existe workflow pendente para esta conversa
  if (redis) {
    const pendingWorkflow = await redis.get(REDIS_KEYS.inboxWorkflowPending(conversationId))
    console.log(`🔥 [TRIGGER] Pending workflow check: ${pendingWorkflow}`)

    if (pendingWorkflow) {
      // Workflow já existe, só atualizamos o timestamp (ele vai buscar msgs novas)
      console.log(
        `[Inbox] Workflow already pending for ${conversationId}, updated last message timestamp`
      )
      return true
    }

    // Marca workflow como pendente (TTL de 5 min para safety)
    await redis.set(REDIS_KEYS.inboxWorkflowPending(conversationId), 'true', { ex: 300 })
    console.log(`🔥 [TRIGGER] Set workflow pending flag`)
  }

  // Dispara novo workflow
  // Prioridade: NEXT_PUBLIC_APP_URL (manual) > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL > localhost
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || 'http://localhost:3000'

  const workflowUrl = `${baseUrl}/api/inbox/ai-workflow`

  console.log(`🔥 [TRIGGER] Triggering AI workflow for ${conversationId} at ${workflowUrl}`)

  try {
    const payload: InboxAIWorkflowPayload = {
      conversationId,
      triggeredAt: Date.now(),
    }

    console.log(`🔥 [TRIGGER] Calling workflowClient.trigger with payload:`, JSON.stringify(payload))

    await workflowClient.trigger({
      url: workflowUrl,
      body: payload,
    })

    console.log(`✅ [TRIGGER] AI workflow triggered successfully for ${conversationId}`)
    return true
  } catch (error) {
    console.error('❌ [TRIGGER] Failed to trigger AI workflow:', error)

    // Limpa flag de pendente em caso de erro
    if (redis) {
      await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
    }

    return false
  }
}

// NOTE: processAIResponse foi movido para lib/inbox/inbox-ai-workflow.ts
// O workflow agora gerencia todo o processamento de IA de forma durável.

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

// NOTE: isAIAgentsGloballyEnabled e getAIAgentForConversation foram movidos para
// lib/inbox/inbox-ai-workflow.ts como parte do processamento durável.

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
