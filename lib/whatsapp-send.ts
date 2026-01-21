/**
 * WhatsApp Send Message Utility
 * Unified interface for sending WhatsApp messages from the Inbox
 */

import { getWhatsAppCredentials, type WhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { buildTextMessage } from '@/lib/whatsapp/text'
import { fetchWithTimeout, safeJson, safeText } from '@/lib/server-http'
import { normalizePhoneNumber } from '@/lib/phone-formatter'

export interface SendWhatsAppMessageOptions {
  to: string
  type: 'text' | 'template'
  // Text message
  text?: string
  previewUrl?: boolean
  replyToMessageId?: string
  // Template message
  templateName?: string
  templateParams?: Record<string, string[]>
  // Credentials override (optional - will fetch from settings if not provided)
  credentials?: WhatsAppCredentials
}

export interface SendWhatsAppMessageResult {
  success: boolean
  messageId?: string
  error?: string
  details?: unknown
}

/**
 * Send a WhatsApp message (text or template)
 *
 * @param options - Message options
 * @returns Result with messageId on success or error on failure
 */
export async function sendWhatsAppMessage(
  options: SendWhatsAppMessageOptions
): Promise<SendWhatsAppMessageResult> {
  // Get credentials
  const credentials = options.credentials || await getWhatsAppCredentials()
  if (!credentials?.accessToken || !credentials?.phoneNumberId) {
    return { success: false, error: 'WhatsApp credentials not configured' }
  }

  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(options.to)
  if (!normalizedTo || !/^\+\d{8,15}$/.test(normalizedTo)) {
    return { success: false, error: `Invalid phone number: ${options.to}` }
  }

  // Build payload based on type
  let payload: Record<string, unknown>

  if (options.type === 'template' && options.templateName) {
    payload = buildTemplatePayload(normalizedTo, options.templateName, options.templateParams)
  } else {
    // Default to text
    const textPayload = buildTextMessage({
      to: normalizedTo,
      text: options.text || '',
      previewUrl: options.previewUrl,
      replyToMessageId: options.replyToMessageId,
    })
    payload = textPayload as unknown as Record<string, unknown>
  }

  // Send to WhatsApp API
  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 8000,
      }
    )

    const data = await safeJson(response)

    if (!response.ok) {
      const details = data ?? (await safeText(response))
      const metaError =
        typeof details === 'object' && details !== null && 'error' in details
          ? (details as { error?: { message?: string; code?: number } }).error
          : undefined

      return {
        success: false,
        error: metaError?.message || 'WhatsApp send failed',
        details,
      }
    }

    // Extract message ID from response
    const messageId = extractMessageId(data)
    return { success: true, messageId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send message',
    }
  }
}

/**
 * Build template message payload
 */
function buildTemplatePayload(
  to: string,
  templateName: string,
  params?: Record<string, string[]>
): Record<string, unknown> {
  const components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> = []

  // Add body parameters if provided
  if (params?.body && params.body.length > 0) {
    components.push({
      type: 'body',
      parameters: params.body.map((text) => ({ type: 'text', text })),
    })
  }

  // Add header parameters if provided
  if (params?.header && params.header.length > 0) {
    components.push({
      type: 'header',
      parameters: params.header.map((text) => ({ type: 'text', text })),
    })
  }

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      ...(components.length > 0 ? { components } : {}),
    },
  }
}

/**
 * Extract message ID from WhatsApp API response
 */
function extractMessageId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined

  const response = data as { messages?: Array<{ id?: string }> }
  return response.messages?.[0]?.id
}

// =============================================================================
// FLOW MESSAGE
// =============================================================================

export interface SendFlowMessageOptions {
  /** Recipient phone number */
  to: string
  /** Meta Flow ID (from published flow) */
  flowId: string
  /** Unique token for this flow session */
  flowToken?: string
  /** Body text shown before the CTA button */
  bodyText: string
  /** Call-to-action button text */
  ctaText?: string
  /** Header text (optional) */
  headerText?: string
  /** Footer text (optional, max 60 chars) */
  footerText?: string
  /** Flow action type */
  flowAction?: 'navigate' | 'data_exchange'
  /** Credentials override */
  credentials?: WhatsAppCredentials
}

/**
 * Send a WhatsApp Flow (interactive form) message
 *
 * @param options - Flow message options
 * @returns Result with messageId on success or error on failure
 */
export async function sendFlowMessage(
  options: SendFlowMessageOptions
): Promise<SendWhatsAppMessageResult> {
  // Get credentials
  const credentials = options.credentials || (await getWhatsAppCredentials())
  if (!credentials?.accessToken || !credentials?.phoneNumberId) {
    return { success: false, error: 'WhatsApp credentials not configured' }
  }

  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(options.to)
  if (!normalizedTo || !/^\+\d{8,15}$/.test(normalizedTo)) {
    return { success: false, error: `Invalid phone number: ${options.to}` }
  }

  // Generate flow token if not provided
  const flowToken = options.flowToken || `smartzap:${options.flowId}:${Date.now()}`

  // Build flow message payload
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: options.bodyText },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_id: options.flowId,
          flow_token: flowToken,
          flow_cta: options.ctaText || 'Abrir',
          flow_action: options.flowAction || 'navigate',
        },
      },
    },
  }

  // Add optional header
  if (options.headerText) {
    ;(payload.interactive as Record<string, unknown>).header = {
      type: 'text',
      text: options.headerText,
    }
  }

  // Add optional footer
  if (options.footerText) {
    const footer = options.footerText.substring(0, 60)
    ;(payload.interactive as Record<string, unknown>).footer = { text: footer }
  }

  // Send to WhatsApp API
  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 8000,
      }
    )

    const data = await safeJson(response)

    if (!response.ok) {
      const details = data ?? (await safeText(response))
      const metaError =
        typeof details === 'object' && details !== null && 'error' in details
          ? (details as { error?: { message?: string; code?: number } }).error
          : undefined

      return {
        success: false,
        error: metaError?.message || 'WhatsApp flow send failed',
        details,
      }
    }

    const messageId = extractMessageId(data)
    return { success: true, messageId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send flow message',
    }
  }
}
