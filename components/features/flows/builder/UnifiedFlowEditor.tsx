'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { ChevronDown, MoreVertical, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { InspectorPanel } from '@/components/features/flows/builder/InspectorPanel'

import { normalizeFlowFieldName } from '@/lib/flow-form'
import {
  bookingConfigToDynamicSpec,
  dynamicFlowSpecFromJson,
  formSpecToDynamicSpec,
  generateDynamicFlowJson,
  normalizeDynamicFlowSpec,
  validateDynamicFlowSpec,
} from '@/lib/dynamic-flow'
import type { DynamicFlowActionType, DynamicFlowBranchRuleV1, DynamicFlowSpecV1 } from '@/lib/dynamic-flow'
import { flowJsonToFormSpec } from '@/lib/flow-form'

type BlockType =
  | 'text_heading'
  | 'text_subheading'
  | 'text_body'
  | 'text_caption'
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'single_choice'
  | 'multi_choice'
  | 'optin'

const BLOCK_TYPE_LABEL: Record<BlockType, string> = {
  text_heading: 'Título',
  text_subheading: 'Subtítulo',
  text_body: 'Texto',
  text_caption: 'Legenda',
  short_text: 'Campo: texto',
  long_text: 'Campo: texto longo',
  email: 'Campo: e-mail',
  phone: 'Campo: telefone',
  number: 'Campo: número',
  date: 'Campo: data',
  dropdown: 'Lista (dropdown)',
  single_choice: 'Escolha única',
  multi_choice: 'Múltipla escolha',
  optin: 'Opt-in (checkbox)',
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function defaultOptions() {
  return [
    { id: 'opcao_1', title: 'Opção 1' },
    { id: 'opcao_2', title: 'Opção 2' },
  ]
}

function createSlug(base: string) {
  const slug = normalizeFlowFieldName(base) || 'campo'
  const suffix = nanoid(4).toLowerCase()
  return normalizeFlowFieldName(`${slug}_${suffix}`) || `${slug}_${suffix}`
}

function createNewBlock(type: BlockType): Record<string, unknown> {
  if (type === 'text_heading') return { type: 'TextHeading', text: 'Novo título' }
  if (type === 'text_subheading') return { type: 'TextSubheading', text: 'Novo subtítulo' }
  if (type === 'text_caption') return { type: 'TextCaption', text: 'Legenda' }
  if (type === 'text_body') return { type: 'TextBody', text: 'Novo texto' }

  if (type === 'optin') {
    return { type: 'OptIn', name: createSlug('optin'), text: 'Quero receber mensagens sobre novidades e promoções.' }
  }

  if (type === 'dropdown' || type === 'single_choice' || type === 'multi_choice') {
    const componentType = type === 'dropdown' ? 'Dropdown' : type === 'single_choice' ? 'RadioButtonsGroup' : 'CheckboxGroup'
    return {
      type: componentType,
      name: createSlug('opcao'),
      label: 'Escolha uma opção',
      required: false,
      'data-source': defaultOptions(),
    }
  }

  if (type === 'date') {
    return {
      type: 'CalendarPicker',
      name: createSlug('data'),
      label: 'Data',
      required: true,
      mode: 'single',
    }
  }

  if (type === 'long_text') {
    return { type: 'TextArea', name: createSlug('texto'), label: 'Digite aqui', required: false }
  }

  const inputType = type === 'email' ? 'email' : type === 'phone' ? 'phone' : type === 'number' ? 'number' : 'text'
  return {
    type: 'TextInput',
    name: createSlug('campo'),
    label: 'Novo campo',
    required: type === 'short_text',
    'input-type': inputType,
  }
}

function getFirstForm(screen: any): { index: number; form: any } | null {
  const comps = Array.isArray(screen?.components) ? screen.components : []
  const idx = comps.findIndex((c: any) => c && typeof c === 'object' && c.type === 'Form' && Array.isArray(c.children))
  if (idx < 0) return null
  return { index: idx, form: comps[idx] }
}

function getBlocksForScreen(screen: any): any[] {
  const found = getFirstForm(screen)
  if (found) {
    const blocks = Array.isArray(found.form.children) ? found.form.children : []
    return blocks.filter((b: any) => b?.type !== 'Footer')
  }
  const comps = Array.isArray(screen?.components) ? screen.components : []
  return comps.filter((b: any) => b?.type !== 'Footer')
}

function setBlocksForScreen(screen: any, nextBlocks: any[]): any {
  const comps = Array.isArray(screen?.components) ? screen.components : []
  const found = getFirstForm(screen)
  if (found) {
    const next = [...comps]
    next[found.index] = { ...found.form, children: nextBlocks }
    return { ...screen, components: next }
  }
  return {
    ...screen,
    components: [
      {
        type: 'Form',
        name: 'form',
        children: nextBlocks,
      },
    ],
  }
}

function guessActionType(screen: any): DynamicFlowActionType {
  const t = String(screen?.action?.type || '').trim()
  if (t === 'data_exchange' || t === 'navigate' || t === 'complete') return t
  if (screen?.terminal) return 'complete'
  return 'navigate'
}

function guessCtaLabel(screen: any): string {
  const label = String(screen?.action?.label || '').trim()
  if (label) return label
  return screen?.terminal ? 'Concluir' : 'Continuar'
}

export function UnifiedFlowEditor(props: {
  flowName: string
  currentSpec: unknown
  flowJsonFromDb?: unknown
  isSaving: boolean
  selectedEditorKey?: string | null
  onOpenAdvanced?: () => void
  onSave: (patch: { spec: unknown; flowJson: unknown }) => void
  onPreviewChange?: (payload: {
    spec: DynamicFlowSpecV1
    generatedJson: unknown
    issues: string[]
    dirty: boolean
    activeScreenId: string
  }) => void
  onPreviewScreenIdChange?: (screenId: string | null) => void
}) {
  const migratedRef = useRef(false)
  const initialSpec = useMemo(() => {
    const s = (props.currentSpec as any) || {}
    const rawDynamic = s?.dynamicFlow
    if (rawDynamic?.flowJson && typeof rawDynamic.flowJson === 'object') {
      return normalizeDynamicFlowSpec(dynamicFlowSpecFromJson(rawDynamic.flowJson), props.flowName)
    }
    if (rawDynamic && typeof rawDynamic === 'object') {
      return normalizeDynamicFlowSpec(rawDynamic, props.flowName)
    }
    if (s?.booking && typeof s.booking === 'object') {
      return bookingConfigToDynamicSpec(s.booking)
    }
    if (s?.form && typeof s.form === 'object') {
      return formSpecToDynamicSpec(s.form, props.flowName)
    }
    if (props.flowJsonFromDb && typeof props.flowJsonFromDb === 'object') {
      const flowJson = props.flowJsonFromDb as any
      const hasRoutingModel = !!flowJson?.routing_model
      const hasDataApi = typeof flowJson?.data_api_version === 'string'
      if (hasRoutingModel || hasDataApi) {
        return normalizeDynamicFlowSpec(dynamicFlowSpecFromJson(flowJson), props.flowName)
      }
      const asForm = flowJsonToFormSpec(flowJson, props.flowName)
      return formSpecToDynamicSpec(asForm, props.flowName)
    }
    return normalizeDynamicFlowSpec({}, props.flowName)
  }, [props.currentSpec, props.flowJsonFromDb, props.flowName])

  const initialFingerprint = useMemo(() => JSON.stringify(initialSpec), [initialSpec])

  const indexToLetters = (index: number): string => {
    // 0 -> A, 25 -> Z, 26 -> AA ...
    let n = Math.max(0, Math.floor(index))
    let out = ''
    do {
      const r = n % 26
      out = String.fromCharCode(65 + r) + out
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    return out || 'A'
  }

  const makeNextScreenId = (existing: string[]): string => {
    const used = new Set(existing.map((s) => String(s || '').toUpperCase()))
    for (let i = 0; i < 2000; i++) {
      const candidate = `SCREEN_${indexToLetters(i)}`
      if (!used.has(candidate)) return candidate
    }
    return `SCREEN_${indexToLetters(0)}`
  }

  const [spec, setSpec] = useState<DynamicFlowSpecV1>(initialSpec)
  const [dirty, setDirty] = useState(false)
  const [activeScreenId, setActiveScreenId] = useState<string>(initialSpec.screens[0]?.id || 'SCREEN_A')
  const lastAddedRef = useRef<string | null>(null)

  useEffect(() => {
    if (dirty) return
    setSpec(initialSpec)
    setActiveScreenId((prev) => {
      const next = (initialSpec.screens || []).some((s) => s?.id === prev)
      return next ? prev : (initialSpec.screens[0]?.id || 'SCREEN_A')
    })
    // OBS: dependemos do fingerprint para não “piscar” ao trocar dirty->false no auto-save
  }, [initialFingerprint])

  useEffect(() => {
    props.onPreviewScreenIdChange?.(activeScreenId || null)
  }, [activeScreenId, props])

  useEffect(() => {
    if (!lastAddedRef.current) return
    const el = document.querySelector<HTMLInputElement>(`[data-block-focus="${lastAddedRef.current}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus()
    }
    lastAddedRef.current = null
  }, [spec])

  const issues = useMemo(() => validateDynamicFlowSpec(spec), [spec])
  const generatedJson = useMemo(() => generateDynamicFlowJson(spec), [spec])
  const canSave = issues.length === 0 && dirty && !props.isSaving
  const saveStatusText = props.isSaving ? 'Salvando…' : dirty ? 'Alterações…' : 'Salvo'

  useEffect(() => {
    props.onPreviewChange?.({ spec, generatedJson, issues, dirty, activeScreenId })
  }, [activeScreenId, dirty, generatedJson, issues, props, spec])

  // Migração “silenciosa”: se não houver spec.dynamicFlow ainda, persistimos o canônico em background.
  useEffect(() => {
    if (dirty) return
    if (migratedRef.current) return
    const s = (props.currentSpec as any) || {}
    const hasCanonical = s?.dynamicFlow && typeof s.dynamicFlow === 'object'
    if (hasCanonical) return
    migratedRef.current = true
    const baseSpec = props.currentSpec && typeof props.currentSpec === 'object' ? (props.currentSpec as any) : {}
    const nextSpec = { ...baseSpec, dynamicFlow: spec }
    props.onSave({ spec: nextSpec, flowJson: generatedJson })
  }, [dirty, generatedJson, props, spec])

  const save = React.useCallback(() => {
    const baseSpec = props.currentSpec && typeof props.currentSpec === 'object' ? (props.currentSpec as any) : {}
    const nextSpec = { ...baseSpec, dynamicFlow: spec }
    props.onSave({ spec: nextSpec, flowJson: generatedJson })
    setDirty(false)
  }, [generatedJson, props.currentSpec, props.onSave, spec])

  useEffect(() => {
    if (!dirty) return
    if (issues.length > 0) return
    if (props.isSaving) return
    const t = setTimeout(() => {
      save()
    }, 900)
    return () => clearTimeout(t)
  }, [dirty, issues.length, props.isSaving, save])

  const updateSpec = (updater: (prev: DynamicFlowSpecV1) => DynamicFlowSpecV1) => {
    setSpec((prev) => {
      const nextDraft = updater(prev)
      // Mantém o spec sempre consistente (routing + defaults + branches).
      const normalized = normalizeDynamicFlowSpec(nextDraft, props.flowName)
      const screens = Array.isArray(normalized?.screens) ? [...normalized.screens] : []
      const routingModel =
        (normalized as any)?.routingModel && typeof (normalized as any).routingModel === 'object' ? (normalized as any).routingModel : {}

      // Regra UX: se uma tela tem próxima tela, ela NÃO pode ser “final”.
      for (let i = 0; i < screens.length; i++) {
        const s: any = screens[i]
        const nextId = Array.isArray(routingModel?.[s.id]) ? routingModel[s.id][0] : undefined
        if (nextId && s?.terminal) {
          screens[i] = {
            ...s,
            terminal: false,
            action: {
              ...(s.action || {}),
              type: 'navigate',
              label: 'Continuar',
              screen: nextId,
            },
          }
        }
      }

      return normalizeDynamicFlowSpec({ ...normalized, screens }, props.flowName)
    })
    setDirty(true)
  }

  const activeIndex = useMemo(() => spec.screens.findIndex((s) => s.id === activeScreenId), [activeScreenId, spec.screens])
  const activeScreen = activeIndex >= 0 ? spec.screens[activeIndex] : spec.screens[0]
  const blocks = useMemo(() => getBlocksForScreen(activeScreen), [activeScreen])

  const nextScreenId = useMemo(() => {
    const routes = spec.routingModel?.[activeScreen?.id] || []
    return routes[0] || ''
  }, [activeScreen?.id, spec.routingModel])

  const ctaType = guessActionType(activeScreen)
  const ctaLabel = guessCtaLabel(activeScreen)
  const defaultNextId = useMemo(() => spec.defaultNextByScreen?.[activeScreenId] || '', [activeScreenId, spec.defaultNextByScreen])

  const pathFieldOptions = useMemo(() => {
    const list = (blocks || [])
      .map((b: any) => {
        const name = String(b?.name || '').trim()
        if (!name) return null
        const label = String(b?.label || b?.text || name).trim() || name
        const type = String(b?.type || '').trim()
        return { name, label, type }
      })
      .filter(Boolean) as Array<{ name: string; label: string; type: string }>
    // Dedup por name
    const seen = new Set<string>()
    return list.filter((x) => {
      if (seen.has(x.name)) return false
      seen.add(x.name)
      return true
    })
  }, [blocks])

  const activeBranches = useMemo(
    () => (Array.isArray(spec.branchesByScreen?.[activeScreenId]) ? (spec.branchesByScreen[activeScreenId] as DynamicFlowBranchRuleV1[]) : []),
    [activeScreenId, spec.branchesByScreen],
  )

  const setDefaultNextForActive = (next: string | null) => {
    updateSpec((prev) => {
      const defaultNextByScreen: Record<string, string | null> = { ...(prev.defaultNextByScreen || {}) }
      defaultNextByScreen[activeScreenId] = next
      const routingModel: Record<string, string[]> = { ...(prev.routingModel || {}) }
      routingModel[activeScreenId] = next ? [next] : []
      return { ...prev, defaultNextByScreen, routingModel }
    })
  }

  const setBranchesForActive = (rules: DynamicFlowBranchRuleV1[]) => {
    updateSpec((prev) => {
      const branchesByScreen: Record<string, DynamicFlowBranchRuleV1[]> = { ...(prev.branchesByScreen || {}) }
      branchesByScreen[activeScreenId] = rules
      return { ...prev, branchesByScreen }
    })
  }

  const patchActiveScreen = (patch: any) => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === activeScreenId)
      if (idx < 0) return prev
      screens[idx] = { ...screens[idx], ...patch }
      return { ...prev, screens }
    })
  }

  const patchScreenById = (screenId: string, patch: any) => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === screenId)
      if (idx < 0) return prev
      const current = screens[idx] as any
      // Se o título for data-binding (${data.*}), edita o __example__ ao invés da string binding.
      if (patch?.title !== undefined && typeof current.title === 'string') {
        const match = current.title.match(/^\$\{data\.([a-zA-Z0-9_]+)\}$/)
        const key = match?.[1]
        if (key && current.data && typeof current.data === 'object' && (current.data as any)[key] && typeof (current.data as any)[key] === 'object') {
          const nextData = { ...(current.data as any) }
          const nextField = { ...((nextData as any)[key] as any), __example__: String(patch.title) }
          ;(nextData as any)[key] = nextField
          screens[idx] = { ...current, data: nextData }
          return { ...prev, screens }
        }
      }
      screens[idx] = { ...current, ...patch }
      return { ...prev, screens }
    })
  }

  const updateComponentByBuilderId = (screenId: string, builderId: string, patch: { text?: string; label?: string }) => {
    const walk = (nodes: any[], screenData: any): any[] =>
      nodes.map((n) => {
        if (!n || typeof n !== 'object') return n
        const id = String((n as any).__builder_id || '')
        if (id && id === builderId) {
          // Se o texto atual for data-binding (${data.*}), edita o __example__ ao invés do binding.
          if (patch.text !== undefined && typeof (n as any).text === 'string') {
            const m = String((n as any).text).match(/^\$\{data\.([a-zA-Z0-9_]+)\}$/)
            const key = m?.[1]
            if (key && screenData && typeof screenData === 'object' && (screenData as any)[key] && typeof (screenData as any)[key] === 'object') {
              ;(screenData as any)[key] = { ...((screenData as any)[key] as any), __example__: String(patch.text) }
              const { text, ...rest } = patch as any
              return { ...n, ...rest }
            }
          }
          return { ...n, ...patch }
        }
        const children = Array.isArray((n as any).children) ? ((n as any).children as any[]) : null
        if (children?.length) {
          return { ...n, children: walk(children, screenData) }
        }
        return n
      })

    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === screenId)
      if (idx < 0) return prev
      const current = screens[idx] as any
      const components = Array.isArray(current.components) ? current.components : []
      const nextData = current.data && typeof current.data === 'object' ? { ...(current.data as any) } : current.data
      screens[idx] = { ...current, components: walk(components, nextData), ...(nextData ? { data: nextData } : {}) }
      return { ...prev, screens }
    })
  }

  const updateCtaForScreen = (screenId: string, patch: { label?: string; nextScreenId?: string }) => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === screenId)
      if (idx < 0) return prev
      const current = screens[idx] as any
      const terminal = !!current.terminal

      const nextLabel = patch.label !== undefined ? patch.label : guessCtaLabel(current)
      const nextTo = patch.nextScreenId !== undefined ? patch.nextScreenId : (prev.routingModel?.[screenId]?.[0] || '')

      const routingModel: Record<string, string[]> = { ...(prev.routingModel || {}) }
      routingModel[screenId] = terminal ? [] : nextTo ? [nextTo] : []

      const action: any = { ...(current.action || {}) }
      action.type = terminal ? 'complete' : guessActionType(current)
      action.label = nextLabel
      if (action.type === 'navigate' && !terminal) {
        action.screen = nextTo || undefined
      }

      screens[idx] = { ...current, action }
      return { ...prev, screens, routingModel }
    })
  }

  const updateBookingServices = (services: Array<{ id: string; title: string }>) => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === 'BOOKING_START')
      if (idx >= 0) {
        const current = screens[idx] as any
        const data = current.data && typeof current.data === 'object' ? { ...(current.data as any) } : {}
        const existing = (data as any).services
        ;(data as any).services =
          existing && typeof existing === 'object'
            ? { ...(existing as any), __example__: services }
            : {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, title: { type: 'string' } },
                },
                __example__: services,
              }
        screens[idx] = { ...current, data }
      }
      return { ...prev, screens, services }
    })
  }

  const updateBookingDateComponent = (mode: 'calendar' | 'dropdown') => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === 'BOOKING_START')
      if (idx < 0) return { ...prev, dateComponent: mode }
      const current = screens[idx] as any
      const replace = (nodes: any[]): any[] =>
        nodes.map((n) => {
          if (!n || typeof n !== 'object') return n
          const children = Array.isArray((n as any).children) ? ((n as any).children as any[]) : null
          const name = String((n as any).name || '')
          if (name === 'selected_date') {
            const label = String((n as any).label || 'Data')
            const base: any = { ...(n as any), name: 'selected_date', label, required: true }
            if (mode === 'dropdown') {
              return { ...base, type: 'Dropdown', 'data-source': '${data.dates}' }
            }
            return {
              ...base,
              type: 'CalendarPicker',
              mode: 'single',
              'min-date': '${data.min_date}',
              'max-date': '${data.max_date}',
              'include-days': '${data.include_days}',
              'unavailable-dates': '${data.unavailable_dates}',
            }
          }
          if (children?.length) return { ...n, children: replace(children) }
          return n
        })

      const components = Array.isArray(current.components) ? current.components : []
      screens[idx] = { ...current, components: replace(components) }
      return { ...prev, screens, dateComponent: mode }
    })
  }

  useEffect(() => {
    // Selecionar algo no preview também “leva” para a tela correspondente.
    const key = (props.selectedEditorKey || '').trim()
    if (!key.startsWith('screen:')) return
    const parts = key.split(':')
    const screenId = parts[1]
    if (!screenId) return
    if (spec.screens.some((s) => s.id === screenId)) {
      setActiveScreenId(screenId)
    }
  }, [props.selectedEditorKey, spec.screens])

  const setActiveBlocks = (nextBlocks: any[]) => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === activeScreenId)
      if (idx < 0) return prev
      screens[idx] = setBlocksForScreen(screens[idx] as any, nextBlocks)
      return { ...prev, screens }
    })
  }

  const addBlock = (type: BlockType) => {
    const newBlock = createNewBlock(type)
    const blockId = nanoid(8)
    ;(newBlock as any).__builder_id = blockId
    lastAddedRef.current = blockId
    setActiveBlocks([...blocks, newBlock])
  }

  const updateBlock = (idx: number, patch: any) => {
    const next = [...blocks]
    next[idx] = { ...next[idx], ...patch }
    setActiveBlocks(next)
  }

  const moveBlock = (idx: number, dir: 'up' | 'down') => {
    const newIdx = dir === 'up' ? Math.max(0, idx - 1) : Math.min(blocks.length - 1, idx + 1)
    setActiveBlocks(moveItem(blocks, idx, newIdx))
  }

  const removeBlock = (idx: number) => {
    setActiveBlocks(blocks.filter((_, i) => i !== idx))
  }

  const setCta = (patch: { type?: DynamicFlowActionType; label?: string; nextScreenId?: string }) => {
    updateSpec((prev) => {
      const screens = [...prev.screens]
      const idx = screens.findIndex((s) => s.id === activeScreenId)
      if (idx < 0) return prev
      const current = screens[idx] as any
      const terminal = !!current.terminal

      const nextType = patch.type || guessActionType(current)
      const nextLabel = patch.label !== undefined ? patch.label : guessCtaLabel(current)
      const nextTo =
        patch.nextScreenId !== undefined
          ? patch.nextScreenId
          : (prev.defaultNextByScreen?.[current.id] || prev.routingModel?.[current.id]?.[0] || '')

      const routingModel: Record<string, string[]> = { ...(prev.routingModel || {}) }
      routingModel[current.id] = terminal || nextType === 'complete' ? [] : nextTo ? [nextTo] : []

      const defaultNextByScreen: Record<string, string | null> = { ...(prev.defaultNextByScreen || {}) }
      defaultNextByScreen[current.id] = terminal || nextType === 'complete' ? null : nextTo || null

      const action: any = {
        type: terminal ? 'complete' : nextType,
        label: nextLabel,
      }

      if (!terminal && nextType === 'navigate' && nextTo) {
        action.screen = nextTo
      }

      if (!terminal && nextType === 'data_exchange') {
        const currentBlocks = getBlocksForScreen(current)
        const fieldNames = currentBlocks
          .map((b: any) => String(b?.name || '').trim())
          .filter(Boolean)
          .slice(0, 20)
        const payload: Record<string, unknown> = {}
        for (const n of fieldNames) payload[n] = `\${form.${n}}`
        action.payload = payload
        delete action.screen
      }

      screens[idx] = { ...current, action }
      return { ...prev, screens, routingModel, defaultNextByScreen }
    })
  }

  const handleAddScreen = () => {
    updateSpec((prev) => {
      const nextId = makeNextScreenId(prev.screens.map((s) => s.id))
      const idx = prev.screens.length + 1
      const nextScreens = [...prev.screens]

      // Regra UX: ao adicionar uma nova tela, a tela anterior deixa de ser “final”
      // e a nova tela vira “final” automaticamente (Continuar -> Enviar).
      const lastIndex = nextScreens.length - 1
      if (lastIndex >= 0) {
        const last = nextScreens[lastIndex] as any
        const wasTerminal = !!last.terminal || String(last?.action?.type || '').toLowerCase() === 'complete'
        nextScreens[lastIndex] = {
          ...last,
          terminal: false,
          action: {
            ...(last.action || {}),
            type: 'navigate',
            // Se antes era “final”, não reaproveita label tipo “Enviar/Concluir”.
            label: wasTerminal ? 'Continuar' : (last.action?.label && String(last.action.label).trim()) || 'Continuar',
            screen: nextId,
          },
        }
      }

      nextScreens.push({
        id: nextId,
        title: `Tela ${idx}`,
        terminal: true,
        components: [
          {
            type: 'Form',
            name: 'form',
            children: [{ type: 'TextBody', text: 'Nova tela' }],
          },
        ],
        action: { type: 'complete', label: 'Enviar' },
      })

      const routingModel: Record<string, string[]> = { ...(prev.routingModel || {}) }
      const last = prev.screens[prev.screens.length - 1]
      if (last) routingModel[last.id] = [nextId]
      routingModel[nextId] = []

      const defaultNextByScreen: Record<string, string | null> = { ...(prev.defaultNextByScreen || {}) }
      if (last) defaultNextByScreen[last.id] = nextId
      defaultNextByScreen[nextId] = null

      setActiveScreenId(nextId)
      return { ...prev, screens: nextScreens, routingModel, defaultNextByScreen }
    })
  }

  const handleRemoveScreen = () => {
    if (!activeScreen) return
    updateSpec((prev) => {
      if (prev.screens.length <= 1) return prev
      const nextScreens = prev.screens.filter((s) => s.id !== activeScreenId)

      const routingModel: Record<string, string[]> = {}
      for (const s of nextScreens) {
        const first = (prev.routingModel?.[s.id] || []).find((id) => nextScreens.some((x) => x.id === id))
        routingModel[s.id] = first ? [first] : []
      }

      const defaultNextByScreen: Record<string, string | null> = {}
      for (const s of nextScreens) {
        const raw = prev.defaultNextByScreen?.[s.id] || null
        defaultNextByScreen[s.id] = raw && nextScreens.some((x) => x.id === raw) ? raw : null
      }

      const branchesByScreen: Record<string, DynamicFlowBranchRuleV1[]> = {}
      for (const s of nextScreens) {
        const rules = prev.branchesByScreen?.[s.id] || []
        const cleaned = rules.filter((r) => r && (r.next === null || nextScreens.some((x) => x.id === r.next)))
        if (cleaned.length) branchesByScreen[s.id] = cleaned
      }

      setActiveScreenId(nextScreens[0]?.id || 'SCREEN_A')
      return { ...prev, screens: nextScreens, routingModel, defaultNextByScreen, branchesByScreen }
    })
  }

  const renderBlockEditor = (block: any, idx: number) => {
    const type = String(block?.type || '')
    const builderId = String(block?.__builder_id || `${activeScreenId}_${idx}`)

    const showLabel = type !== 'TextHeading' && type !== 'TextSubheading' && type !== 'TextBody' && type !== 'TextCaption'
    const showText = type === 'TextHeading' || type === 'TextSubheading' || type === 'TextBody' || type === 'TextCaption'
    const isOptIn = type === 'OptIn'
    const isTextInput = type === 'TextInput' || type === 'TextEntry'
    const isTextArea = type === 'TextArea'
    const isDate = type === 'CalendarPicker' || type === 'DatePicker'
    const isChoice = type === 'Dropdown' || type === 'RadioButtonsGroup' || type === 'CheckboxGroup'

    const options = Array.isArray(block?.['data-source']) ? (block['data-source'] as any[]) : []

    return (
      <div key={builderId} className="py-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            {showText && (
              <div className="space-y-2">
                <label className="block text-xs uppercase tracking-widest text-gray-500">Texto</label>
                <Textarea
                  value={String(block?.text || '')}
                  onChange={(e) => updateBlock(idx, { text: e.target.value })}
                  className="min-h-18"
                  placeholder="Digite o texto"
                  data-block-focus={builderId}
                />
              </div>
            )}

            {showLabel && (
              <div className="mt-3">
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Pergunta</label>
                <Input
                  value={String(block?.label || '')}
                  onChange={(e) => updateBlock(idx, { label: e.target.value })}
                  placeholder="Digite a pergunta"
                  data-block-focus={builderId}
                />
              </div>
            )}

            {(isTextInput || isTextArea || isDate || isChoice) && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-gray-300">Obrigatório</div>
                  <div className="text-[11px] text-gray-500">O usuário precisa preencher</div>
                </div>
                <Switch checked={!!block?.required} onCheckedChange={(checked) => updateBlock(idx, { required: checked })} />
              </div>
            )}

            {isOptIn && (
              <div className="mt-3 space-y-2">
                <label className="block text-xs uppercase tracking-widest text-gray-500">Texto do opt-in</label>
                <Textarea value={String(block?.text || '')} onChange={(e) => updateBlock(idx, { text: e.target.value })} />
              </div>
            )}

            {isChoice && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs uppercase tracking-widest text-gray-500">Opções</label>
                  <Button
                    type="button"
                    variant="secondary"
                    className="bg-zinc-950/40 border border-white/10 text-gray-200 hover:text-white hover:bg-white/5"
                    onClick={() => {
                      const next = [...(options.length ? options : defaultOptions())]
                      const n = next.length + 1
                      next.push({ id: `opcao_${n}`, title: `Opção ${n}` })
                      updateBlock(idx, { 'data-source': next })
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar opção
                  </Button>
                </div>
                <div className="space-y-2">
                  {(options.length ? options : defaultOptions()).map((opt: any, oidx: number) => (
                    <div key={`${builderId}_${oidx}`} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
                      <Input
                        value={String(opt?.id || '')}
                        onChange={(e) => {
                          const next = [...(options.length ? options : defaultOptions())]
                          next[oidx] = { ...next[oidx], id: normalizeFlowFieldName(e.target.value) || next[oidx]?.id }
                          updateBlock(idx, { 'data-source': next })
                        }}
                        className="font-mono text-xs"
                        placeholder="id"
                      />
                      <Input
                        value={String(opt?.title || '')}
                        onChange={(e) => {
                          const next = [...(options.length ? options : defaultOptions())]
                          next[oidx] = { ...next[oidx], title: e.target.value }
                          updateBlock(idx, { 'data-source': next })
                        }}
                        placeholder="Título"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                        onClick={() => {
                          const next = (options.length ? options : defaultOptions()).filter((_: any, i: number) => i !== oidx)
                          updateBlock(idx, { 'data-source': next })
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
              disabled={idx === 0}
              onClick={() => moveBlock(idx, 'up')}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
              disabled={idx === blocks.length - 1}
              onClick={() => moveBlock(idx, 'down')}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-red-500/20 bg-zinc-950/40 hover:bg-red-500/10"
              onClick={() => removeBlock(idx)}
            >
              <Trash2 className="h-4 w-4 text-red-300" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <InspectorPanel
        spec={spec}
        selectedEditorKey={props.selectedEditorKey || null}
        onUpdateScreenTitle={(screenId, title) => patchScreenById(screenId, { title })}
        onUpdateCta={(screenId, patch) => updateCtaForScreen(screenId, patch)}
        onUpdateComponent={(screenId, builderId, patch) => updateComponentByBuilderId(screenId, builderId, patch)}
        onUpdateBookingServices={(services) => updateBookingServices(services)}
        onUpdateBookingDateComponent={(mode) => updateBookingDateComponent(mode)}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">Telas</div>
          <div className="text-xs text-gray-400">Monte o conteúdo de cada tela e escolha para onde o botão vai.</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-gray-500">{saveStatusText}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="border-white/10 bg-zinc-950/40 hover:bg-white/5 px-2"
                aria-label="Ações"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-zinc-900 border-white/10 text-white min-w-56">
              <DropdownMenuItem onClick={handleAddScreen}>Adicionar tela</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={spec.screens.length <= 1} onClick={handleRemoveScreen}>
                Remover tela
              </DropdownMenuItem>
              {props.onOpenAdvanced ? (
                <>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem onClick={props.onOpenAdvanced}>Ajustes avançados</DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem disabled={!canSave} onClick={save}>
                Salvar agora
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs value={activeScreenId} onValueChange={setActiveScreenId}>
        <TabsList className="bg-zinc-950/40 border border-white/10">
          {spec.screens.map((s) => (
            <TabsTrigger key={s.id} value={s.id} className="text-xs">
              {String(s.title || s.id).slice(0, 18)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeScreenId} className="space-y-6 pt-2">
          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Título da tela</label>
                <Input value={String(activeScreen?.title || '')} onChange={(e) => patchActiveScreen({ title: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-gray-300">Tela final</div>
                  <div className="text-[11px] text-gray-500">O botão vira “Concluir”</div>
                </div>
                <Switch
                  checked={!!activeScreen?.terminal}
                  onCheckedChange={(checked) => {
                    patchActiveScreen({ terminal: checked })
                    setCta({ type: checked ? 'complete' : 'navigate', nextScreenId: checked ? '' : nextScreenId })
                  }}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-6">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Conteúdo</div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" className="bg-white text-black hover:bg-gray-200">
                    <Plus className="h-4 w-4" />
                    Adicionar
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-900 border-white/10 text-white min-w-64">
                  {Object.entries(BLOCK_TYPE_LABEL).map(([k, label]) => (
                    <DropdownMenuItem key={k} onClick={() => addBlock(k as BlockType)}>
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {blocks.length === 0 ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/40 px-6 py-8 text-center text-gray-400">
                <div className="text-sm text-gray-300">Adicione o primeiro bloco para montar sua tela.</div>
              </div>
            ) : (
              <div className="divide-y divide-white/10 mt-4">{blocks.map(renderBlockEditor)}</div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
            <div className="text-sm font-semibold text-white">Botão</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Texto do botão</label>
                <Input value={ctaLabel} onChange={(e) => setCta({ label: e.target.value })} placeholder="Continuar" />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Ir para</label>
                <select
                  value={ctaType === 'complete' || !!activeScreen?.terminal ? '' : nextScreenId}
                  onChange={(e) => setCta({ nextScreenId: e.target.value })}
                  disabled={ctaType === 'complete' || !!activeScreen?.terminal}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-[14px] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 disabled:opacity-50"
                >
                  <option value="">— Concluir —</option>
                  {spec.screens
                    .filter((x) => x.id !== activeScreenId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title || x.id}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">Caminhos</div>
                <div className="text-xs text-gray-400">Decida para onde ir depois do botão, com ou sem ramificações.</div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="bg-zinc-950/40 border border-white/10 text-gray-200 hover:text-white hover:bg-white/5"
                onClick={() => {
                  const firstField = pathFieldOptions[0]?.name || ''
                  const next: DynamicFlowBranchRuleV1 = {
                    field: firstField,
                    op: 'equals',
                    value: '',
                    next: null,
                  }
                  setBranchesForActive([...(activeBranches || []), next])
                }}
                disabled={pathFieldOptions.length === 0}
              >
                <Plus className="h-4 w-4" />
                Adicionar regra
              </Button>
            </div>

            {pathFieldOptions.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-zinc-950/40 px-4 py-3 text-sm text-gray-300">
                Adicione um campo (ex: texto, lista, escolha) para criar ramificações.
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Destino padrão</label>
                <select
                  value={defaultNextId || ''}
                  onChange={(e) => setDefaultNextForActive(e.target.value || null)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-[14px] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                >
                  <option value="">— Concluir —</option>
                  {spec.screens
                    .filter((x) => x.id !== activeScreenId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title || x.id}
                      </option>
                    ))}
                </select>
                {activeBranches.length > 0 ? (
                  <div className="mt-2 text-[11px] text-gray-500">Obrigatório quando há regras (pode ser “Concluir”).</div>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/10 bg-zinc-950/40 px-3 py-3">
                <div className="text-xs font-medium text-gray-300">Quando uma regra casar</div>
                <div className="text-[11px] text-gray-500 mt-1">O primeiro caminho que casar ganha.</div>
              </div>
            </div>

            {activeBranches.length > 0 ? (
              <div className="space-y-3">
                {activeBranches.map((rule, idx) => {
                  const op = String(rule.op || 'equals')
                  const needsValue = op === 'equals' || op === 'contains' || op === 'gt' || op === 'lt'
                  return (
                    <div key={`${activeScreenId}_branch_${idx}`} className="rounded-xl border border-white/10 bg-zinc-950/40 p-3">
                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_160px_1fr_200px_auto] gap-2 items-end">
                        <div>
                          <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Campo</label>
                          <select
                            value={String(rule.field || '')}
                            onChange={(e) => {
                              const next = [...activeBranches]
                              next[idx] = { ...next[idx], field: e.target.value }
                              setBranchesForActive(next)
                            }}
                            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-[14px] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                          >
                            {pathFieldOptions.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.label} ({f.name})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Operador</label>
                          <select
                            value={op}
                            onChange={(e) => {
                              const next = [...activeBranches]
                              next[idx] = { ...next[idx], op: e.target.value as any }
                              setBranchesForActive(next)
                            }}
                            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-[14px] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                          >
                            <option value="is_filled">preenchido</option>
                            <option value="is_empty">vazio</option>
                            <option value="equals">é igual a</option>
                            <option value="contains">contém</option>
                            <option value="gt">maior que</option>
                            <option value="lt">menor que</option>
                            <option value="is_true">é verdadeiro</option>
                            <option value="is_false">é falso</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Valor</label>
                          <Input
                            value={needsValue ? String(rule.value ?? '') : ''}
                            onChange={(e) => {
                              const next = [...activeBranches]
                              next[idx] = { ...next[idx], value: e.target.value }
                              setBranchesForActive(next)
                            }}
                            disabled={!needsValue}
                            placeholder={needsValue ? 'valor…' : '—'}
                          />
                        </div>

                        <div>
                          <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Vai para</label>
                          <select
                            value={rule.next || ''}
                            onChange={(e) => {
                              const next = [...activeBranches]
                              next[idx] = { ...next[idx], next: e.target.value ? e.target.value : null }
                              setBranchesForActive(next)
                            }}
                            className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-[14px] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                          >
                            <option value="">— Concluir —</option>
                            {spec.screens
                              .filter((x) => x.id !== activeScreenId)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.title || x.id}
                                </option>
                              ))}
                          </select>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                          onClick={() => {
                            const next = activeBranches.filter((_, i) => i !== idx)
                            setBranchesForActive(next)
                          }}
                          aria-label="Remover regra"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-sm text-gray-400">Sem ramificações. (Opcional) Adicione regras para desviar para telas diferentes.</div>
            )}
          </div>

          {issues.length > 0 && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <div className="font-semibold mb-1">Ajustes necessários</div>
              <ul className="list-disc pl-5 space-y-1">
                {issues.map((i, idx) => (
                  <li key={idx}>{i}</li>
                ))}
              </ul>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

