/**
 * Inbox AI Workflow - Processamento Durável de IA
 *
 * Usa Upstash Workflow para processar mensagens do inbox com debounce durável.
 * Resolve o problema do setTimeout que não sobrevive à morte da função serverless.
 *
 * Fluxo:
 * 1. Webhook recebe mensagem → dispara workflow
 * 2. Workflow espera (context.sleep) para acumular mensagens
 * 3. Verifica estado da conversa (context.run)
 * 4. Processa com IA via context.call() para endpoint com maxDuration maior
 * 5. Envia resposta via WhatsApp
 *
 * IMPORTANTE: Usa context.call() em vez de context.run() no step de IA para
 * evitar timeout da Vercel. O workflow "hiberna" enquanto espera a resposta
 * do endpoint /api/internal/ai-generate que tem maxDuration=60s.
 */

import type { WorkflowContext } from '@upstash/workflow'
import { getRedis, REDIS_KEYS } from '@/lib/upstash/redis'
import type { AIAgent, InboxConversation, InboxMessage } from '@/types'

// Constantes
const DEBOUNCE_SECONDS = 2

// =============================================================================
// Types
// =============================================================================

export interface InboxAIWorkflowPayload {
  /** ID da conversa no inbox */
  conversationId: string
  /** Timestamp de quando o workflow foi disparado */
  triggeredAt: number
  /** ID do agente de IA a usar (ou usa default) */
  agentId?: string
}

// =============================================================================
// Main Workflow Function
// =============================================================================

/**
 * Workflow principal de processamento de IA do inbox.
 * Chamado via POST /api/inbox/ai-workflow
 */
export async function processInboxAIWorkflow(context: WorkflowContext) {
  const payload = context.requestPayload as InboxAIWorkflowPayload
  const { conversationId } = payload

  console.log(`🚀 [WORKFLOW] ========================================`)
  console.log(`🚀 [WORKFLOW] STARTING for conversation: ${conversationId}`)
  console.log(`🚀 [WORKFLOW] Payload:`, JSON.stringify(payload))
  console.log(`🚀 [WORKFLOW] Run ID: ${context.workflowRunId}`)
  console.log(`🚀 [WORKFLOW] ========================================`)

  // =========================================================================
  // Step 1: Debounce simples - espera para acumular mensagens
  // =========================================================================

  console.log(`⏳ [WORKFLOW] Step 1: Starting debounce wait (${DEBOUNCE_SECONDS}s)...`)
  await context.sleep('debounce-wait', `${DEBOUNCE_SECONDS}s`)
  console.log(`✅ [WORKFLOW] Step 1: Debounce complete!`)

  // =========================================================================
  // Step 2: Verificar estado da conversa e buscar dados
  // =========================================================================

  console.log(`📦 [WORKFLOW] Step 2: Fetching conversation and agent...`)

  // Dividido em múltiplos context.run para isolar problemas de serialização

  // Step 2a: Fetch conversation
  const convResult = await context.run('fetch-conversation', async () => {
    console.log(`📦 [FETCH-CONV] Starting...`)
    const { inboxDb } = await import('./inbox-db')

    const conversationData = await inboxDb.getConversation(conversationId)
    if (!conversationData) {
      console.log(`❌ [FETCH-CONV] Not found!`)
      return { valid: false as const, reason: 'conversation-not-found' }
    }
    console.log(`📦 [FETCH-CONV] Found: mode=${conversationData.mode}`)

    if (conversationData.mode !== 'bot') {
      return { valid: false as const, reason: 'not-in-bot-mode' }
    }

    if (conversationData.automation_paused_until) {
      const pauseTime = new Date(conversationData.automation_paused_until).getTime()
      if (pauseTime > Date.now()) {
        return { valid: false as const, reason: 'automation-paused' }
      }
    }

    // Serializa imediatamente
    const serialized = JSON.parse(JSON.stringify(conversationData))
    console.log(`✅ [FETCH-CONV] Serialized OK`)
    return { valid: true as const, conversation: serialized }
  })

  if (!convResult.valid) {
    console.log(`⚠️ [WORKFLOW] Conv fetch failed: ${convResult.reason}`)
    await context.run('cleanup-conv-invalid', async () => {
      const redis = getRedis()
      if (redis) {
        await redis.del(REDIS_KEYS.inboxLastMessage(conversationId))
        await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
      }
    })
    return { status: 'skipped', reason: convResult.reason }
  }

  const conversation = convResult.conversation

  // Step 2b: Fetch agent
  const agentResult = await context.run('fetch-agent', async () => {
    console.log(`📦 [FETCH-AGENT] Starting for agent: ${conversation.ai_agent_id}`)
    const { getSupabaseAdmin } = await import('@/lib/supabase')
    const supabase = getSupabaseAdmin()
    if (!supabase) return { valid: false as const, reason: 'supabase-not-configured' }

    let agentData = null
    if (conversation.ai_agent_id) {
      const { data } = await supabase.from('ai_agents').select('*').eq('id', conversation.ai_agent_id).single()
      agentData = data
    }
    if (!agentData) {
      const { data } = await supabase.from('ai_agents').select('*').eq('is_active', true).eq('is_default', true).single()
      agentData = data
    }

    if (!agentData) return { valid: false as const, reason: 'no-agent-configured' }
    if (!agentData.is_active) return { valid: false as const, reason: 'agent-not-active' }
    if (!agentData.system_prompt || agentData.system_prompt.trim().length < 10) {
      return { valid: false as const, reason: 'agent-missing-system-prompt' }
    }

    const serialized = JSON.parse(JSON.stringify(agentData))
    console.log(`✅ [FETCH-AGENT] Serialized OK: ${serialized.name}`)
    return { valid: true as const, agent: serialized }
  })

  if (!agentResult.valid) {
    console.log(`⚠️ [WORKFLOW] Agent fetch failed: ${agentResult.reason}`)
    await context.run('cleanup-agent-invalid', async () => {
      const redis = getRedis()
      if (redis) {
        await redis.del(REDIS_KEYS.inboxLastMessage(conversationId))
        await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
      }
    })
    return { status: 'skipped', reason: agentResult.reason }
  }

  const agent = agentResult.agent

  // Step 2c: Fetch messages
  const msgsResult = await context.run('fetch-messages', async () => {
    console.log(`📦 [FETCH-MSGS] Starting...`)
    const { inboxDb } = await import('./inbox-db')
    const { messages } = await inboxDb.listMessages(conversationId, { limit: 20 })
    console.log(`📦 [FETCH-MSGS] Found ${messages.length} messages`)
    const serialized = JSON.parse(JSON.stringify(messages))
    console.log(`✅ [FETCH-MSGS] Serialized OK`)
    return { messages: serialized }
  })

  const messages = msgsResult.messages

  // Validação final
  const fetchResult = { valid: true as const, conversation, agent, messages }

  console.log(`📦 [WORKFLOW] Step 2 result: valid=${fetchResult.valid}`)

  console.log(`✅ [WORKFLOW] Step 2 complete! Agent: ${agent.name}, Messages: ${messages.length}`)

  // =========================================================================
  // Step 3: Processar com IA via context.call()
  // =========================================================================

  console.log(`🤖 [WORKFLOW] Step 3: AI processing | Agent: ${agent.name} | Messages: ${messages.length}`)

  // Monta a URL do endpoint interno - com fallback hardcoded para produção
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || 'https://smartzapv3.vercel.app'
  const aiEndpointUrl = baseUrl.startsWith('http')
    ? `${baseUrl}/api/internal/ai-generate`
    : `https://${baseUrl}/api/internal/ai-generate`

  const apiKey = process.env.SMARTZAP_API_KEY
  console.log(`🔗 [WORKFLOW] Calling ${aiEndpointUrl} | API key: ${!!apiKey}`)

  if (!apiKey) {
    console.error(`❌ [WORKFLOW] SMARTZAP_API_KEY NOT CONFIGURED!`)
    return { status: 'error', error: 'API_KEY not configured' }
  }

  // Tipo de resposta do endpoint de IA
  type AICallResponse = {
    success: boolean
    message?: string
    sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated'
    shouldHandoff?: boolean
    handoffReason?: string
    handoffSummary?: string
    sources?: Array<{ title: string; content: string }>
    logId?: string
    error?: string
  }

  console.log(`📡 [WORKFLOW] Calling context.call('process-ai')...`)

  const aiCallResult = await context.call<AICallResponse>('process-ai', {
    url: aiEndpointUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: {
      agent,
      conversation,
      messages,
    },
    retries: 2,
    timeout: 60, // 60 segundos de timeout
  })

  console.log(`📡 [WORKFLOW] context.call returned: status=${aiCallResult.status}`)

  // Verifica se a chamada HTTP foi bem sucedida
  if (aiCallResult.status !== 200) {
    console.error(`❌ [WORKFLOW] AI endpoint returned status ${aiCallResult.status}`)
    console.error(`❌ [WORKFLOW] Response body:`, JSON.stringify(aiCallResult.body))

    // Trata como erro e faz handoff
    await context.run('auto-handoff-http-error', async () => {
      console.log(`🚨 [HANDOFF] HTTP error - sending fallback message...`)
      const { inboxDb } = await import('./inbox-db')
      const { sendWhatsAppMessage } = await import('@/lib/whatsapp-send')

      const fallbackMessage =
        'Desculpe, estou com dificuldades técnicas. Vou transferir você para um atendente.'

      const sendResult = await sendWhatsAppMessage({
        to: conversation.phone,
        type: 'text',
        text: fallbackMessage,
      })

      console.log(`🚨 [HANDOFF] Send result:`, JSON.stringify(sendResult))

      if (sendResult.success && sendResult.messageId) {
        await inboxDb.createMessage({
          conversation_id: conversationId,
          direction: 'outbound',
          content: fallbackMessage,
          message_type: 'text',
          whatsapp_message_id: sendResult.messageId,
          delivery_status: 'sent',
        })
      }

      await inboxDb.updateConversation(conversationId, { mode: 'human' })

      await inboxDb.createMessage({
        conversation_id: conversationId,
        direction: 'outbound',
        content: `🤖 **Transferência automática**\n\n**Motivo:** Erro HTTP ${aiCallResult.status} no endpoint de IA`,
        message_type: 'internal_note',
        delivery_status: 'delivered',
      })
    })

    await context.run('cleanup-http-error', async () => {
      const redis = getRedis()
      if (redis) {
        await redis.del(REDIS_KEYS.inboxLastMessage(conversationId))
        await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
      }
    })

    return { status: 'error', error: `HTTP ${aiCallResult.status}` }
  }

  // Extrai o resultado do body da resposta
  const aiResult = aiCallResult.body

  console.log(`✅ [WORKFLOW] AI processing completed!`)
  console.log(`✅ [WORKFLOW] AI Result: success=${aiResult?.success}, message=${aiResult?.message?.substring(0, 50)}...`)

  if (!aiResult?.success || !aiResult?.message) {
    console.log(`❌ [WORKFLOW] AI processing failed: ${aiResult?.error}`)

    // Auto-handoff em caso de erro
    if (aiResult?.error) {
      await context.run('auto-handoff-error', async () => {
        const { inboxDb } = await import('./inbox-db')
        const { sendWhatsAppMessage } = await import('@/lib/whatsapp-send')

        // Envia mensagem de fallback
        const fallbackMessage =
          'Desculpe, estou com dificuldades técnicas. Vou transferir você para um atendente.'

        const sendResult = await sendWhatsAppMessage({
          to: conversation.phone,
          type: 'text',
          text: fallbackMessage,
        })

        if (sendResult.success && sendResult.messageId) {
          await inboxDb.createMessage({
            conversation_id: conversationId,
            direction: 'outbound',
            content: fallbackMessage,
            message_type: 'text',
            whatsapp_message_id: sendResult.messageId,
            delivery_status: 'sent',
          })
        }

        // Switch para modo humano
        await inboxDb.updateConversation(conversationId, { mode: 'human' })

        // Cria nota interna
        await inboxDb.createMessage({
          conversation_id: conversationId,
          direction: 'outbound',
          content: `🤖 **Transferência automática**\n\n**Motivo:** Erro técnico: ${aiResult?.error || 'Resposta vazia'}`,
          message_type: 'internal_note',
          delivery_status: 'delivered',
        })
      })
    }

    await context.run('cleanup-error', async () => {
      const redis = getRedis()
      if (redis) {
        await redis.del(REDIS_KEYS.inboxLastMessage(conversationId))
        await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
      }
    })

    return { status: 'error', error: aiResult?.error || 'Empty response' }
  }

  // =========================================================================
  // Step 4: Enviar resposta via WhatsApp
  // =========================================================================

  console.log(`📤 [WORKFLOW] Step 4: Sending WhatsApp response...`)

  await context.run('send-response', async () => {
    console.log(`📤 [SEND] Sending message to ${conversation.phone}...`)
    const { inboxDb } = await import('./inbox-db')
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp-send')

    const sendResult = await sendWhatsAppMessage({
      to: conversation.phone,
      type: 'text',
      text: aiResult.message!,
    })

    console.log(`📤 [SEND] Send result:`, JSON.stringify(sendResult))

    if (sendResult.success && sendResult.messageId) {
      await inboxDb.createMessage({
        conversation_id: conversationId,
        direction: 'outbound',
        content: aiResult.message!,
        message_type: 'text',
        whatsapp_message_id: sendResult.messageId,
        delivery_status: 'sent',
        ai_response_id: aiResult.logId || null,
        ai_sentiment: aiResult.sentiment,
        ai_sources: aiResult.sources || null,
      })
      console.log(`✅ [SEND] Message saved to DB with ID ${sendResult.messageId}`)
    } else {
      console.error(`❌ [SEND] Failed to send:`, sendResult.error)
    }

    return sendResult
  })

  // =========================================================================
  // Step 5: Handle handoff (se necessário)
  // =========================================================================

  if (aiResult.shouldHandoff) {
    console.log(`🔄 [WORKFLOW] Step 5: Processing handoff request...`)

    await context.run('handle-handoff', async () => {
      const { inboxDb } = await import('./inbox-db')

      console.log(`🔄 [HANDOFF] AI requested handoff: ${aiResult.handoffReason}`)

      // Switch para modo humano
      await inboxDb.updateConversation(conversationId, { mode: 'human' })

      // Cria nota interna sobre handoff
      await inboxDb.createMessage({
        conversation_id: conversationId,
        direction: 'outbound',
        content: `🤖 **Transferência para atendente**\n\n${aiResult.handoffReason ? `**Motivo:** ${aiResult.handoffReason}\n` : ''}${aiResult.handoffSummary ? `**Resumo:** ${aiResult.handoffSummary}` : ''}`,
        message_type: 'internal_note',
        delivery_status: 'delivered',
        payload: {
          type: 'ai_handoff',
          reason: aiResult.handoffReason,
          summary: aiResult.handoffSummary,
          timestamp: new Date().toISOString(),
        },
      })
    })
  }

  // =========================================================================
  // Step 6: Cleanup
  // =========================================================================

  console.log(`🧹 [WORKFLOW] Step 6: Cleanup...`)

  await context.run('cleanup-success', async () => {
    const redis = getRedis()
    if (redis) {
      await redis.del(REDIS_KEYS.inboxLastMessage(conversationId))
      await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
    }
  })

  console.log(`🎉 [WORKFLOW] ========================================`)
  console.log(`🎉 [WORKFLOW] COMPLETED SUCCESSFULLY!`)
  console.log(`🎉 [WORKFLOW] Conversation: ${conversationId}`)
  console.log(`🎉 [WORKFLOW] Sentiment: ${aiResult.sentiment}`)
  console.log(`🎉 [WORKFLOW] Handoff: ${aiResult.shouldHandoff}`)
  console.log(`🎉 [WORKFLOW] ========================================`)

  return {
    status: 'completed',
    conversationId,
    sentiment: aiResult.sentiment,
    handoff: aiResult.shouldHandoff,
  }
}
