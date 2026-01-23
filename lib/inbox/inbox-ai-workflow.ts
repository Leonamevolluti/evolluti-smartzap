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

  const fetchResult = await context.run('fetch-conversation-and-agent', async () => {
    console.log(`📦 [FETCH] Inside context.run - starting fetch...`)

    const { inboxDb } = await import('./inbox-db')
    const { getSupabaseAdmin } = await import('@/lib/supabase')

    // Busca conversa
    console.log(`📦 [FETCH] Getting conversation ${conversationId}...`)
    const conversationData = await inboxDb.getConversation(conversationId)
    if (!conversationData) {
      console.log(`❌ [FETCH] Conversation not found!`)
      return { valid: false as const, reason: 'conversation-not-found' }
    }
    console.log(`📦 [FETCH] Conversation found: mode=${conversationData.mode}, phone=${conversationData.phone}`)

    // Verifica se ainda está em modo bot
    if (conversationData.mode !== 'bot') {
      console.log(`❌ [FETCH] Not in bot mode: ${conversationData.mode}`)
      return { valid: false as const, reason: 'not-in-bot-mode', mode: conversationData.mode }
    }

    // Verifica se automação está pausada
    if (conversationData.automation_paused_until) {
      const pauseTime = new Date(conversationData.automation_paused_until).getTime()
      if (pauseTime > Date.now()) {
        console.log(`❌ [FETCH] Automation paused until ${conversationData.automation_paused_until}`)
        return { valid: false as const, reason: 'automation-paused' }
      }
    }

    // Busca agente
    console.log(`📦 [FETCH] Getting Supabase admin...`)
    const supabase = getSupabaseAdmin()
    if (!supabase) {
      console.log(`❌ [FETCH] Supabase not configured!`)
      return { valid: false as const, reason: 'supabase-not-configured' }
    }
    console.log(`📦 [FETCH] Supabase admin OK`)

    let agentData: AIAgent | null = null

    // Primeiro tenta agente específico da conversa
    if (conversationData.ai_agent_id) {
      console.log(`📦 [FETCH] Fetching specific agent: ${conversationData.ai_agent_id}`)
      const { data } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('id', conversationData.ai_agent_id)
        .single()
      agentData = data as AIAgent | null
      console.log(`📦 [FETCH] Specific agent result: ${agentData ? agentData.name : 'null'}`)
    }

    // Se não tem, busca default
    if (!agentData) {
      console.log(`📦 [FETCH] Fetching default agent...`)
      const { data } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('is_active', true)
        .eq('is_default', true)
        .single()
      agentData = data as AIAgent | null
      console.log(`📦 [FETCH] Default agent result: ${agentData ? agentData.name : 'null'}`)
    }

    if (!agentData) {
      console.log(`❌ [FETCH] No agent configured!`)
      return { valid: false as const, reason: 'no-agent-configured' }
    }

    if (!agentData.is_active) {
      console.log(`❌ [FETCH] Agent not active!`)
      return { valid: false as const, reason: 'agent-not-active' }
    }

    // Valida que o agente tem system_prompt configurado
    if (!agentData.system_prompt || agentData.system_prompt.trim().length < 10) {
      console.log(`❌ [FETCH] Agent missing system prompt!`)
      return { valid: false as const, reason: 'agent-missing-system-prompt' }
    }

    // Busca mensagens recentes
    console.log(`📦 [FETCH] Fetching messages...`)
    const { messages: messagesData } = await inboxDb.listMessages(conversationId, { limit: 20 })
    console.log(`📦 [FETCH] Found ${messagesData.length} messages`)

    console.log(`✅ [FETCH] All data fetched successfully!`)
    return {
      valid: true as const,
      conversation: conversationData,
      agent: agentData,
      messages: messagesData,
    }
  })

  console.log(`📦 [WORKFLOW] Step 2 result: valid=${fetchResult.valid}`)

  // Se não é válido, faz cleanup e retorna
  if (!fetchResult.valid) {
    console.log(`⚠️ [WORKFLOW] Skipping AI processing: ${fetchResult.reason}`)

    await context.run('cleanup-invalid', async () => {
      console.log(`🧹 [CLEANUP] Cleaning up invalid workflow...`)
      const redis = getRedis()
      if (redis) {
        await redis.del(REDIS_KEYS.inboxLastMessage(conversationId))
        await redis.del(REDIS_KEYS.inboxWorkflowPending(conversationId))
      }
      console.log(`🧹 [CLEANUP] Done`)
    })

    return { status: 'skipped', reason: fetchResult.reason }
  }

  // Extrai dados com tipos garantidos
  const conversation = fetchResult.conversation
  const agent = fetchResult.agent
  const messages = fetchResult.messages

  console.log(`✅ [WORKFLOW] Step 2 complete! Agent: ${agent.name}, Messages: ${messages.length}`)

  // =========================================================================
  // Step 3: Processar com IA via context.call()
  // =========================================================================

  console.log(`🤖 [WORKFLOW] ========================================`)
  console.log(`🤖 [WORKFLOW] Step 3: STARTING AI PROCESSING`)
  console.log(`🤖 [WORKFLOW] Agent: ${agent.name}`)
  console.log(`🤖 [WORKFLOW] Model: ${agent.model}`)
  console.log(`🤖 [WORKFLOW] Messages: ${messages.length}`)
  console.log(`🤖 [WORKFLOW] ========================================`)

  // Monta a URL do endpoint interno - com fallback hardcoded para produção
  const envAppUrl = process.env.NEXT_PUBLIC_APP_URL
  const envVercelUrl = process.env.VERCEL_URL
  const fallbackUrl = 'https://smartzapv3.vercel.app'

  const baseUrl = envAppUrl || envVercelUrl || fallbackUrl

  console.log(`🔗 [WORKFLOW] URL Config:`)
  console.log(`🔗 [WORKFLOW]   NEXT_PUBLIC_APP_URL = "${envAppUrl || 'undefined'}"`)
  console.log(`🔗 [WORKFLOW]   VERCEL_URL = "${envVercelUrl || 'undefined'}"`)
  console.log(`🔗 [WORKFLOW]   Fallback = "${fallbackUrl}"`)
  console.log(`🔗 [WORKFLOW]   Final baseUrl = "${baseUrl}"`)

  const aiEndpointUrl = baseUrl.startsWith('http')
    ? `${baseUrl}/api/internal/ai-generate`
    : `https://${baseUrl}/api/internal/ai-generate`

  console.log(`🔗 [WORKFLOW] AI Endpoint URL: ${aiEndpointUrl}`)

  const apiKey = process.env.SMARTZAP_API_KEY
  console.log(`🔑 [WORKFLOW] SMARTZAP_API_KEY exists: ${!!apiKey}`)
  console.log(`🔑 [WORKFLOW] SMARTZAP_API_KEY length: ${apiKey ? apiKey.length : 0}`)

  if (!apiKey) {
    console.error(`❌ [WORKFLOW] SMARTZAP_API_KEY NOT CONFIGURED!`)

    // Registra o erro como um step para visibilidade no dashboard
    await context.run('error-missing-api-key', async () => {
      console.error(`❌ [ERROR-STEP] SMARTZAP_API_KEY not configured in environment!`)
      console.error(`❌ [ERROR-STEP] Available env vars:`, Object.keys(process.env).filter(k => k.includes('SMART') || k.includes('API')))
      return { error: 'SMARTZAP_API_KEY not configured' }
    })
    return { status: 'error', error: 'API_KEY not configured' }
  }

  console.log(`🚀 [WORKFLOW] About to call context.call('process-ai')...`)
  console.log(`🚀 [WORKFLOW] Request config:`)
  console.log(`🚀 [WORKFLOW]   URL: ${aiEndpointUrl}`)
  console.log(`🚀 [WORKFLOW]   Method: POST`)
  console.log(`🚀 [WORKFLOW]   Timeout: 60s`)
  console.log(`🚀 [WORKFLOW]   Retries: 2`)

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

  // Chama o endpoint via context.call() - workflow hiberna enquanto espera
  console.log(`📡 [WORKFLOW] CALLING context.call('process-ai') NOW...`)

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

  console.log(`📡 [WORKFLOW] context.call RETURNED!`)
  console.log(`📡 [WORKFLOW] Response status: ${aiCallResult.status}`)
  console.log(`📡 [WORKFLOW] Response header:`, JSON.stringify(aiCallResult.header))
  console.log(`📡 [WORKFLOW] Response body:`, JSON.stringify(aiCallResult.body))

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
