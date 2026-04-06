import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export interface AIModelInfo {
  id: string
  name: string
  provider: 'google' | 'openai'
  /** true = alias auto-atualizado (ex: gemini-flash-latest) */
  isAlias: boolean
}

const EXCLUDED_PATTERNS = [
  'tts',
  'image',
  'robotics',
  'computer-use',
  'deep-research',
  'lyria',
  'gemma',
  'nano-banana',
  'embedding',
]

function isExcluded(id: string): boolean {
  return EXCLUDED_PATTERNS.some((p) => id.includes(p))
}

async function getSettingValue(key: string): Promise<string | null> {
  const { data, error } = await supabase.admin
    ?.from('settings')
    .select('value')
    .eq('key', key)
    .single() || { data: null, error: null }
  if (error || !data) return null
  return data.value
}

async function fetchGoogleModels(apiKey: string): Promise<AIModelInfo[]> {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': apiKey } }
  )
  if (!res.ok) throw new Error(`Google API error: HTTP ${res.status}`)

  const data = await res.json()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: AIModelInfo[] = (data.models ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((m: any) => {
      const id: string = m.name.replace('models/', '')
      return (
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent') &&
        !isExcluded(id)
      )
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => {
      const id: string = m.name.replace('models/', '')
      return {
        id,
        name: m.displayName || id,
        provider: 'google' as const,
        isAlias: id.endsWith('-latest'),
      }
    })

  // Aliases primeiro (sempre atualizados), depois versões fixas mais recente → mais antigo
  const aliases = all.filter((m) => m.isAlias)
  const pinned = all
    .filter((m) => !m.isAlias)
    .sort((a, b) => b.id.localeCompare(a.id))

  return [...aliases, ...pinned]
}

async function fetchOpenAIModels(apiKey: string): Promise<AIModelInfo[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`OpenAI API error: HTTP ${res.status}`)

  const data = await res.json()
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data.data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) => m.id.startsWith('gpt-') || /^o\d/.test(m.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({
        id: m.id as string,
        name: m.id as string,
        provider: 'openai' as const,
        isAlias: false,
      }))
      .sort((a: AIModelInfo, b: AIModelInfo) => b.id.localeCompare(a.id))
  )
}

/**
 * GET /api/ai/models?provider=google|openai
 *
 * Retorna lista de modelos disponíveis para o provider solicitado,
 * buscando diretamente da API do provider com a chave configurada no banco.
 */
export async function GET(request: NextRequest) {
  const provider = new URL(request.url).searchParams.get('provider')

  if (provider !== 'google' && provider !== 'openai') {
    return NextResponse.json(
      { error: 'Parâmetro "provider" inválido. Use "google" ou "openai".' },
      { status: 400 }
    )
  }

  const keyName = provider === 'google' ? 'google_api_key' : 'openai_api_key'
  const apiKey = await getSettingValue(keyName)

  if (!apiKey) {
    return NextResponse.json({ models: [] })
  }

  try {
    const models =
      provider === 'google'
        ? await fetchGoogleModels(apiKey)
        : await fetchOpenAIModels(apiKey)

    return NextResponse.json({ models })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    console.error(`[api/ai/models] ${message}`)
    return NextResponse.json(
      { error: `Falha ao buscar modelos: ${message}` },
      { status: 502 }
    )
  }
}
