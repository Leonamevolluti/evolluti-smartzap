/**
 * OCR Provider Factory
 *
 * Cria e seleciona o provider de OCR.
 * Usa a chave Google (`google_api_key`) do Supabase — mesma chave dos agentes de IA.
 *
 * Configurações no banco:
 * - `google_api_key`: API key do Google Gemini (obrigatória para OCR)
 * - `ocr_gemini_model`: modelo Gemini para OCR (default: 'gemini-2.5-flash')
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { GeminiOCRProvider, DEFAULT_OCR_MODEL } from './providers/gemini'
import type { OCRProvider } from './types'

/** Providers de OCR disponíveis */
export type OCRProviderName = 'gemini'

/**
 * Obtém o provider de OCR Gemini configurado com a chave do banco.
 *
 * @returns Provider configurado ou null se `google_api_key` não estiver disponível
 */
export async function getOCRProvider(): Promise<OCRProvider | null> {
  const supabase = getSupabaseAdmin()
  let googleApiKey: string | undefined
  let geminiOcrModel = DEFAULT_OCR_MODEL

  if (supabase) {
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['google_api_key', 'ocr_gemini_model'])

    const settingsMap = new Map(settings?.map((s) => [s.key, s.value]) || [])
    googleApiKey = settingsMap.get('google_api_key') || undefined
    geminiOcrModel = settingsMap.get('ocr_gemini_model') || DEFAULT_OCR_MODEL
  }

  // Env var: canônico @ai-sdk/google; GEMINI_API_KEY aceito como alias retrocompat
  googleApiKey = googleApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || undefined

  if (!googleApiKey) {
    console.warn('[ocr] google_api_key não configurada — OCR indisponível')
    return null
  }

  return new GeminiOCRProvider(geminiOcrModel, googleApiKey)
}

/**
 * Lista providers disponíveis (com API key configurada)
 */
export async function getAvailableOCRProviders(): Promise<OCRProviderName[]> {
  const supabase = getSupabaseAdmin()
  let googleApiKey: string | undefined

  if (supabase) {
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['google_api_key'])

    const settingsMap = new Map(settings?.map((s) => [s.key, s.value]) || [])
    googleApiKey = settingsMap.get('google_api_key') || undefined
  }

  googleApiKey = googleApiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || undefined

  return googleApiKey ? ['gemini'] : []
}
