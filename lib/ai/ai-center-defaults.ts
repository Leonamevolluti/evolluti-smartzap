import type { AIProvider } from './providers'
import { FLOW_FORM_PROMPT_TEMPLATE } from './prompts/flow-form'
import { UTILITY_GENERATION_PROMPT_TEMPLATE } from './prompts/utility-generator'
import { UTILITY_JUDGE_PROMPT_TEMPLATE } from './prompts/utility-judge'
import { MARKETING_PROMPT } from './prompts/marketing'
import { UTILITY_PROMPT } from './prompts/utility'
import { BYPASS_PROMPT } from './prompts/bypass'

export type AiRoutesConfig = {
  generateUtilityTemplates: boolean
  generateFlowForm: boolean
}

/**
 * Configuração do Vercel AI Gateway.
 *
 * Autenticação via OIDC (VERCEL_OIDC_TOKEN) — automático com `vercel env pull`.
 * Quando enabled=true, BYOK está sempre ativo — configure as chaves no dashboard da Vercel.
 */
export type AiGatewayConfig = {
  /** Se o Gateway está habilitado. Quando false, a IA é desativada no SmartZap. */
  enabled: boolean
  /** Modelo principal no formato "provider/model" (ex: "google/gemini-3-flash-preview") */
  primaryModel: string
  /** Modelos de fallback no formato "provider/model" (ex: "anthropic/claude-haiku-4.5") */
  fallbackModels: string[]
}

export type AiFallbackConfig = {
  enabled: boolean
  order: AIProvider[]
  models: Record<AIProvider, string>
}

export type AiPromptsConfig = {
  utilityGenerationTemplate: string
  utilityJudgeTemplate: string
  flowFormTemplate: string
  // Estratégias de geração de templates
  strategyMarketing: string
  strategyUtility: string
  strategyBypass: string
}

export const DEFAULT_AI_ROUTES: AiRoutesConfig = {
  generateUtilityTemplates: true,
  generateFlowForm: true,
}

export const DEFAULT_AI_FALLBACK: AiFallbackConfig = {
  enabled: false,
  order: ['google', 'openai', 'anthropic'],
  models: {
    google: 'gemini-3-flash-preview',
    openai: 'gpt-5-mini',
    anthropic: 'claude-sonnet-4.5',
  },
}

/**
 * Default: Gateway habilitado.
 * Autenticação via VERCEL_OIDC_TOKEN (automático com `vercel env pull`).
 * Configure as chaves BYOK diretamente no dashboard da Vercel AI Gateway.
 */
export const DEFAULT_AI_GATEWAY: AiGatewayConfig = {
  enabled: true,
  primaryModel: 'google/gemini-3-flash-preview',
  fallbackModels: ['anthropic/claude-haiku-4.5', 'openai/gpt-5.4'],
}

/**
 * Converte modelo local para formato Gateway (provider/model).
 * Ex: gemini-2.5-flash → google/gemini-2.5-flash
 */
export function toGatewayModelId(provider: AIProvider, modelId: string): string {
  return `${provider}/${modelId}`
}

/**
 * Extrai provider e model do formato Gateway.
 * Ex: google/gemini-2.5-flash → { provider: 'google', modelId: 'gemini-2.5-flash' }
 */
export function fromGatewayModelId(gatewayModelId: string): { provider: AIProvider; modelId: string } | null {
  const parts = gatewayModelId.split('/')
  if (parts.length !== 2) return null

  const [provider, modelId] = parts
  if (!['google', 'openai', 'anthropic'].includes(provider)) return null

  return { provider: provider as AIProvider, modelId }
}

export const DEFAULT_AI_PROMPTS: AiPromptsConfig = {
  utilityGenerationTemplate: UTILITY_GENERATION_PROMPT_TEMPLATE,
  utilityJudgeTemplate: UTILITY_JUDGE_PROMPT_TEMPLATE,
  flowFormTemplate: FLOW_FORM_PROMPT_TEMPLATE,
  // Estratégias de geração de templates
  strategyMarketing: MARKETING_PROMPT,
  strategyUtility: UTILITY_PROMPT,
  strategyBypass: BYPASS_PROMPT,
}
