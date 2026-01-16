'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Loader2, Save, UploadCloud, Wand2, LayoutTemplate, PenSquare, Check } from 'lucide-react'
import { toast } from 'sonner'

import { Page, PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UnifiedFlowEditor } from '@/components/features/flows/builder/UnifiedFlowEditor'
import { AdvancedFlowPanel } from '@/components/features/flows/builder/dynamic-flow/AdvancedFlowPanel'
import { MetaFlowPreview } from '@/components/ui/MetaFlowPreview'
import { useFlowEditorController } from '@/hooks/useFlowEditor'
import { Textarea } from '@/components/ui/textarea'
import { FLOW_TEMPLATES } from '@/lib/flow-templates'
import { flowJsonToFormSpec, generateFlowJsonFromFormSpec } from '@/lib/flow-form'
import {
  dynamicFlowSpecFromJson,
  bookingConfigToDynamicSpec,
  formSpecToDynamicSpec,
  type DynamicFlowSpecV1,
  generateDynamicFlowJson,
  getDefaultBookingFlowConfig,
  normalizeBookingFlowConfig,
} from '@/lib/dynamic-flow'

export default function FlowBuilderEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const { id } = React.use(params)

  const controller = useFlowEditorController(id)

  const flow = controller.flow

  const [name, setName] = React.useState('')
  const [metaFlowId, setMetaFlowId] = React.useState<string>('')
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [formPreviewJson, setFormPreviewJson] = React.useState<unknown>(null)
  const [templateSelectedPreviewJson, setTemplateSelectedPreviewJson] = React.useState<unknown>(null)
  const [templateHoverPreviewJson, setTemplateHoverPreviewJson] = React.useState<unknown>(null)
  const [formPreviewSelectedScreenId, setFormPreviewSelectedScreenId] = React.useState<string | null>(null)
  const [previewSelectedEditorKey, setPreviewSelectedEditorKey] = React.useState<string | null>(null)
  const [previewDynamicSpec, setPreviewDynamicSpec] = React.useState<DynamicFlowSpecV1 | null>(null)
  const [startMode, setStartMode] = React.useState<'ai' | 'template' | 'zero' | null>(null)
  const [aiPrompt, setAiPrompt] = React.useState('')
  const [aiLoading, setAiLoading] = React.useState(false)
  const [selectedTemplateKey, setSelectedTemplateKey] = React.useState<string>(FLOW_TEMPLATES[0]?.key || '')
  const [hoverTemplateKey, setHoverTemplateKey] = React.useState<string | null>(null)
  const hoverPreviewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showAdvancedPanel, setShowAdvancedPanel] = React.useState(false)

  const advancedGate = React.useMemo(() => {
    const hasJson = !!formPreviewJson && typeof formPreviewJson === 'object'
    const hasRouting = hasJson ? !!(formPreviewJson as any)?.routing_model : false
    return { hasJson, hasRouting, canRender: !!showAdvancedPanel && hasJson && hasRouting }
  }, [formPreviewJson, showAdvancedPanel])

  React.useEffect(() => {
    if (!showAdvancedPanel) return
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'advanced-panel',hypothesisId:'H11',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'showAdvancedPanel turned on',data:{step,startMode,hasJson:advancedGate.hasJson,hasRouting:advancedGate.hasRouting},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }, [advancedGate.hasJson, advancedGate.hasRouting, showAdvancedPanel, startMode, step])

  React.useEffect(() => {
    if (!showAdvancedPanel) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'advanced-panel',hypothesisId:'H15',location:'app/(dashboard)/flows/builder/[id]/page.tsx:keydown',message:'escape closes advanced panel',data:{},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
      setShowAdvancedPanel(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showAdvancedPanel])

  React.useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'advanced-panel',hypothesisId:'H14',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'showAdvancedPanel state',data:{showAdvancedPanel},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }, [showAdvancedPanel])

  React.useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'start-mode',hypothesisId:'H10',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'startMode changed',data:{step,startMode},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }, [startMode, step])

  const handleGenerateWithAI = React.useCallback(async () => {
    if (aiLoading) return
    if (!aiPrompt.trim() || aiPrompt.trim().length < 10) {
      toast.error('Descreva melhor o que você quer (mínimo 10 caracteres)')
      return
    }
    setAiLoading(true)
    try {
      const res = await fetch('/api/ai/generate-flow-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
          titleHint: name,
          maxQuestions: 10,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = (data?.error && String(data.error)) || 'Falha ao gerar miniapp com IA'
        const details = data?.details ? `: ${String(data.details)}` : ''
        throw new Error(`${msg}${details}`)
      }
      const generatedForm = data?.form
      if (!generatedForm) throw new Error('Resposta inválida da IA (form ausente)')

      const dynamicSpec = formSpecToDynamicSpec(generatedForm, name || 'MiniApp')
      const dynamicJson = generateDynamicFlowJson(dynamicSpec)
      setFormPreviewJson(dynamicJson)
      controller.save({
        spec: { ...(controller.spec as any), form: generatedForm, dynamicFlow: dynamicSpec },
        flowJson: dynamicJson,
      })
      setStep(2)
      toast.success('MiniApp gerada! Ajuste as telas e publique.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar miniapp com IA')
    } finally {
      setAiLoading(false)
    }
  }, [aiLoading, aiPrompt, controller, name])

  const handleApplyTemplate = React.useCallback(() => {
    const tpl = FLOW_TEMPLATES.find((t) => t.key === selectedTemplateKey)
    if (!tpl) return
    // Usa tpl.form se disponível (para templates dinâmicos), senão converte do flowJson
    const form = tpl.form
      ? { ...tpl.form, title: name || tpl.form.title }
      : flowJsonToFormSpec(tpl.flowJson, name || 'MiniApp')
    if (tpl.key === 'agendamento_dinamico_v1') {
      const normalized = normalizeBookingFlowConfig(tpl.dynamicConfig || getDefaultBookingFlowConfig())
      const dynamicSpec = bookingConfigToDynamicSpec(normalized)
      const dynamicJson = generateDynamicFlowJson(dynamicSpec)
      setFormPreviewJson(dynamicJson)
      controller.save({
        spec: { ...(controller.spec as any), form, booking: normalized, dynamicFlow: dynamicSpec },
        flowJson: dynamicJson,
        templateKey: tpl.key,
      })
      setStep(2)
      toast.success('Template aplicado! Ajuste as telas e publique.')
      return
    }
    const dynamicSpec = tpl.isDynamic ? dynamicFlowSpecFromJson(tpl.flowJson as any) : formSpecToDynamicSpec(form, name || 'MiniApp')
    const dynamicJson = tpl.isDynamic ? tpl.flowJson : generateDynamicFlowJson(dynamicSpec)
    setFormPreviewJson(dynamicJson)
    controller.save({
      spec: { ...(controller.spec as any), form, dynamicFlow: dynamicSpec },
      flowJson: dynamicJson,
      templateKey: tpl.key,
    })
    setStep(2)
    toast.success(tpl.isDynamic
      ? 'Template dinâmico aplicado! O agendamento em tempo real será configurado ao publicar.'
      : 'Modelo aplicado! Ajuste as telas.')
  }, [controller, name, selectedTemplateKey])

  const computeTemplatePreviewJson = React.useCallback((tpl: any): unknown => {
    // Preview deve refletir o que será aplicado (sem salvar).
    const form = tpl.form
      ? { ...tpl.form, title: name || tpl.form.title }
      : flowJsonToFormSpec(tpl.flowJson, name || 'MiniApp')
    if (tpl.key === 'agendamento_dinamico_v1') {
      const normalized = normalizeBookingFlowConfig(tpl.dynamicConfig || getDefaultBookingFlowConfig())
      const dynamicSpec = bookingConfigToDynamicSpec(normalized)
      return generateDynamicFlowJson(dynamicSpec)
    }
    const dynamicSpec = tpl.isDynamic ? dynamicFlowSpecFromJson(tpl.flowJson as any) : formSpecToDynamicSpec(form, name || 'MiniApp')
    return tpl.isDynamic ? tpl.flowJson : generateDynamicFlowJson(dynamicSpec)
  }, [name])

  const handleTemplateHover = React.useCallback((tpl: { flowJson: unknown; key?: string; form?: any; isDynamic?: boolean }) => {
    if (tpl.key) {
      setHoverTemplateKey(tpl.key)
    }
    // Aplica preview imediatamente para evitar “flash” do selecionado antes do hover.
    try {
      const immediateJson = computeTemplatePreviewJson(tpl)
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H7',location:'app/(dashboard)/flows/builder/[id]/page.tsx:handleTemplateHover',message:'hover immediate preview applied',data:{tplKey:tpl.key ?? null,screenCount:Array.isArray((immediateJson as any)?.screens)?(immediateJson as any).screens.length:null,firstScreenId:Array.isArray((immediateJson as any)?.screens)?String((immediateJson as any).screens?.[0]?.id||''):null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
      setTemplateHoverPreviewJson(immediateJson)
    } catch {
      // ignore
    }
    if (hoverPreviewTimerRef.current) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H3',location:'app/(dashboard)/flows/builder/[id]/page.tsx:handleTemplateHover',message:'hover cancels previous timer',data:{step,startMode,newTplKey:tpl.key ?? null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
      clearTimeout(hoverPreviewTimerRef.current)
    }
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H3',location:'app/(dashboard)/flows/builder/[id]/page.tsx:handleTemplateHover',message:'hover schedules timer',data:{step,startMode,tplKey:tpl.key ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
    hoverPreviewTimerRef.current = setTimeout(() => {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H1',location:'app/(dashboard)/flows/builder/[id]/page.tsx:handleTemplateHover',message:'hover fired',data:{step, startMode, tplKey:tpl.key ?? null,selectedTemplateKey,hasTplForm:Boolean(tpl.form),isDynamic:Boolean(tpl.isDynamic)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
        const nextJson = computeTemplatePreviewJson(tpl)
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H1',location:'app/(dashboard)/flows/builder/[id]/page.tsx:handleTemplateHover',message:'hover computed preview json',data:{tplKey:tpl.key ?? null,screenCount:Array.isArray((nextJson as any)?.screens)?(nextJson as any).screens.length:null,firstScreenId:Array.isArray((nextJson as any)?.screens)?String((nextJson as any).screens?.[0]?.id||''):null},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
        setTemplateHoverPreviewJson(nextJson)
      } catch {
        // ignore hover preview errors
      }
    }, 150)
  }, [computeTemplatePreviewJson, name])

  React.useEffect(() => {
    const current = step === 1 && startMode === 'template'
      ? (templateHoverPreviewJson || templateSelectedPreviewJson)
      : formPreviewJson
    if (!current || typeof current !== 'object') return
    const screens = Array.isArray((current as any).screens) ? (current as any).screens : []
    const firstScreenId = screens.length ? String(screens[0]?.id || '') : null
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H2',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'formPreviewJson updated',data:{step,startMode,selectedTemplateKey,firstScreenId,screenCount:screens.length,selectedScreenId:formPreviewSelectedScreenId ?? null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }, [formPreviewJson, startMode, step, templateHoverPreviewJson, templateSelectedPreviewJson])

  React.useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H2',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'selectedTemplateKey changed',data:{step,startMode,selectedTemplateKey,hasPreviewJson:Boolean(formPreviewJson),selectedScreenId:formPreviewSelectedScreenId ?? null,previewFlowJsonSource:formPreviewJson ? 'state' : ((flow as any)?.flow_json ? 'db' : 'none')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }, [selectedTemplateKey])

  React.useEffect(() => {
    if (!flow) return
    // Só sincroniza quando o registro muda (ou quando ainda não há valor no state)
    setName((prev) => prev || flow.name || '')
    setMetaFlowId((prev) => prev || flow.meta_flow_id || '')
    if (flow.template_key) {
      setSelectedTemplateKey(flow.template_key)
    }
    // Se vier de um fluxo já salvo, mostra no preview imediatamente.
    const savedJson = (flow as any)?.flow_json
    if (savedJson && typeof savedJson === 'object') {
      setFormPreviewJson((prev) => prev || savedJson)
    }
  }, [flow?.id])

  // No passo 1, só mostramos prévia quando o usuário está escolhendo um modelo pronto.
  // Em "Criar com IA" (e antes de escolher), não existe conteúdo para pré-visualizar ainda.
  const previewFlowJson =
    step === 1
      ? (startMode === 'template' ? (templateHoverPreviewJson || templateSelectedPreviewJson || null) : null)
      : formPreviewJson || (flow as any)?.flow_json

  React.useEffect(() => {
    const source =
      step === 1
        ? startMode === 'template'
          ? templateHoverPreviewJson
            ? 'template-hover'
            : templateSelectedPreviewJson
              ? 'template-selected'
              : 'none'
          : 'none'
        : formPreviewJson
          ? 'editor-state'
          : (flow as any)?.flow_json
            ? 'db'
            : 'none'
    const json = previewFlowJson as any
    const screens = json && typeof json === 'object' && Array.isArray(json.screens) ? json.screens : []
    const firstScreenId = screens.length ? String(screens[0]?.id || '') : null
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H6',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'previewFlowJson computed',data:{step,startMode,source,firstScreenId,selectedScreenId:formPreviewSelectedScreenId ?? null,selectedTemplateKey},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
  }, [formPreviewJson, formPreviewSelectedScreenId, previewFlowJson, selectedTemplateKey, startMode, step, templateHoverPreviewJson, templateSelectedPreviewJson])

  React.useEffect(() => {
    if (step !== 1 || startMode !== 'template') return
    // garante que ao abrir “Usar modelo pronto” exista um preview “selecionado”
    const tpl = FLOW_TEMPLATES.find((t) => t.key === selectedTemplateKey)
    if (!tpl) return
    const nextJson = computeTemplatePreviewJson(tpl)
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H5',location:'app/(dashboard)/flows/builder/[id]/page.tsx:effect',message:'set selected template preview json',data:{selectedTemplateKey},timestamp:Date.now()})}).catch(()=>{});
    // #endregion agent log
    setTemplateSelectedPreviewJson(nextJson)
  }, [computeTemplatePreviewJson, selectedTemplateKey, startMode, step])

  React.useEffect(() => {
    // quando mudar de tela, limpa seleção anterior
    setPreviewSelectedEditorKey(null)
  }, [formPreviewSelectedScreenId])

  const shouldShowLoading = controller.isLoading
  const panelClass = 'rounded-2xl border border-white/10 bg-zinc-900/60 shadow-[0_12px_30px_rgba(0,0,0,0.35)]'
  const metaStatus = String((flow as any)?.meta_status || '').toUpperCase()
  const hasMetaErrors = Array.isArray((flow as any)?.meta_validation_errors)
    ? (flow as any).meta_validation_errors.length > 0
    : !!(flow as any)?.meta_validation_errors
  const statusLabel = metaStatus === 'PUBLISHED'
    ? 'Publicado'
    : metaStatus === 'PENDING' || metaStatus === 'IN_REVIEW'
      ? 'Em revisão'
      : metaStatus === 'REJECTED' || metaStatus === 'ERROR' || hasMetaErrors
        ? 'Requer ação'
        : metaStatus
          ? metaStatus
          : 'Rascunho'
  const statusClass = metaStatus === 'PUBLISHED'
    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
    : metaStatus === 'PENDING' || metaStatus === 'IN_REVIEW' || metaStatus === 'REJECTED' || metaStatus === 'ERROR' || hasMetaErrors
      ? 'border-amber-400/30 bg-amber-500/10 text-amber-200'
      : 'border-white/10 bg-zinc-950/40 text-gray-300'
  const steps = [
    { id: 1, label: 'Começar' },
    { id: 2, label: 'Conteúdo' },
    { id: 3, label: 'Finalizar' },
  ] as const

  return (
    <Page>
      <PageHeader>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-gray-500">Templates / MiniApps / Builder</div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <PageTitle>Editor de MiniApp</PageTitle>
              {flow ? (
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusClass}`}>
                  {statusLabel}
                </span>
              ) : null}
            </div>
            <PageDescription>
              MiniApp é uma experiência por telas. Edite conteúdo e navegação sem precisar alternar modos.
            </PageDescription>
          </div>
        </div>
        <PageActions>
          <div className="flex items-center gap-2">
            <Link href="/templates?tab=flows">
              <Button variant="outline" className="border-white/10 bg-zinc-900 hover:bg-white/5">
                <ArrowLeft className="w-4 h-4" />
                Voltar
              </Button>
            </Link>
            <Link href="/flows/builder">
              <Button variant="outline" className="border-white/10 bg-zinc-900 hover:bg-white/5">
                Lista
              </Button>
            </Link>
          </div>
        </PageActions>
      </PageHeader>

      {shouldShowLoading ? (
        <div className={`${panelClass} p-8 text-gray-300 flex items-center gap-3`}>
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando miniapp...
        </div>
      ) : controller.isError ? (
        <div className={`${panelClass} p-8 text-red-300 space-y-2`}>
          <div className="font-medium">Falha ao carregar miniapp.</div>
          <div className="text-sm text-red-200/90 whitespace-pre-wrap">
            {controller.error?.message || 'Erro desconhecido'}
          </div>
          <div>
            <Button variant="outline" onClick={() => router.refresh()} className="border-white/10 bg-zinc-900 hover:bg-white/5">
              Tentar novamente
            </Button>
          </div>
        </div>
      ) : !flow ? (
        <div className={`${panelClass} p-8 text-gray-300`}>MiniApp não encontrada.</div>
      ) : (
        <>
          <div className="mt-4 grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {steps.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStep(item.id)}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      step === item.id
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-white'
                        : 'border-white/10 bg-zinc-900/40 text-gray-400 hover:text-white'
                    }`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-xs font-semibold leading-none">
                      {item.id}
                    </span>
                    <span className="uppercase tracking-widest text-xs">{item.label}</span>
                  </button>
                ))}
              </div>

              {step === 1 && (
                <div className={`${panelClass} p-6 space-y-6`}>
                  <div>
                    <div className="text-lg font-semibold text-white">Como quer começar?</div>
                    <div className="text-xs text-gray-500">Escolha uma opção para criar sua MiniApp.</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      type="button"
                      aria-pressed={startMode === 'ai'}
                      onClick={() => {
                        // #region agent log
                        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'start-mode',hypothesisId:'H9',location:'app/(dashboard)/flows/builder/[id]/page.tsx:startMode',message:'start mode selected',data:{mode:'ai',prev:startMode},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion agent log
                        setStartMode('ai')
                      }}
                      className={`relative rounded-2xl border p-4 text-left transition ${
                        startMode === 'ai'
                          ? 'border-emerald-400/40 bg-emerald-500/10'
                          : 'border-white/10 bg-zinc-900/60 hover:bg-white/5'
                      }`}
                    >
                      {startMode === 'ai' ? (
                        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <Check className="h-3 w-3" />
                          Selecionado
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2 text-white font-semibold">
                        <Wand2 className="h-4 w-4" />
                        Criar com IA
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Descreva o que precisa e a IA monta as perguntas.</div>
                    </button>

                    <button
                      type="button"
                      aria-pressed={startMode === 'template'}
                      onClick={() => {
                        // #region agent log
                        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'start-mode',hypothesisId:'H9',location:'app/(dashboard)/flows/builder/[id]/page.tsx:startMode',message:'start mode selected',data:{mode:'template',prev:startMode},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion agent log
                        setStartMode('template')
                      }}
                      className={`relative rounded-2xl border p-4 text-left transition ${
                        startMode === 'template'
                          ? 'border-emerald-400/40 bg-emerald-500/10'
                          : 'border-white/10 bg-zinc-900/60 hover:bg-white/5'
                      }`}
                    >
                      {startMode === 'template' ? (
                        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <Check className="h-3 w-3" />
                          Selecionado
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2 text-white font-semibold">
                        <LayoutTemplate className="h-4 w-4" />
                        Usar modelo pronto
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Escolha um template e personalize.</div>
                    </button>

                    <button
                      type="button"
                      aria-pressed={startMode === 'zero'}
                      onClick={() => {
                        // #region agent log
                        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'start-mode',hypothesisId:'H9',location:'app/(dashboard)/flows/builder/[id]/page.tsx:startMode',message:'start mode selected',data:{mode:'zero',prev:startMode},timestamp:Date.now()})}).catch(()=>{});
                        // #endregion agent log
                        setStartMode('zero')
                        setStep(2)
                      }}
                      className={`relative rounded-2xl border p-4 text-left transition ${
                        startMode === 'zero'
                          ? 'border-emerald-400/40 bg-emerald-500/10'
                          : 'border-white/10 bg-zinc-900/60 hover:bg-white/5'
                      }`}
                    >
                      {startMode === 'zero' ? (
                        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <Check className="h-3 w-3" />
                          Selecionado
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2 text-white font-semibold">
                        <PenSquare className="h-4 w-4" />
                        Criar do zero
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Comece com a primeira pergunta.</div>
                    </button>
                  </div>

                  {startMode === 'ai' ? (
                    <div className={`rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3 ${aiLoading ? 'animate-pulse' : ''}`}>
                      <div className="text-sm font-semibold text-white">Criar com IA</div>
                      <div className="text-xs text-gray-500">Descreva o que você quer coletar.</div>
                      <Textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        className="min-h-28 bg-zinc-900 border-white/10 text-white"
                        placeholder='Ex: "Quero um formulário de pré-cadastro para uma turma. Pergunte nome, telefone, e-mail e cidade."'
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                          onClick={() => setStartMode(null)}
                          disabled={aiLoading}
                        >
                          Cancelar
                        </Button>
                        <Button type="button" onClick={handleGenerateWithAI} disabled={aiLoading || aiPrompt.trim().length < 10}>
                          {aiLoading ? 'Gerando…' : 'Gerar MiniApp'}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {startMode === 'template' ? (
                    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
                      <div className="text-sm font-semibold text-white">Usar modelo pronto</div>
                      <div
                        className="grid grid-cols-1 md:grid-cols-2 gap-3"
                        onMouseLeave={() => {
                          if (hoverPreviewTimerRef.current) {
                            clearTimeout(hoverPreviewTimerRef.current)
                            hoverPreviewTimerRef.current = null
                          }
                          // #region agent log
                          fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H8',location:'app/(dashboard)/flows/builder/[id]/page.tsx:templateGrid',message:'grid mouse leave clears hover preview',data:{selectedTemplateKey},timestamp:Date.now()})}).catch(()=>{});
                          // #endregion agent log
                          setTemplateHoverPreviewJson(null)
                          setHoverTemplateKey(null)
                        }}
                      >
                        {FLOW_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.key}
                            type="button"
                            onMouseEnter={() => handleTemplateHover(tpl)}
                            onClick={() => {
                              // #region agent log
                              fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H1',location:'app/(dashboard)/flows/builder/[id]/page.tsx:templateCard',message:'template card clicked',data:{step,startMode,clickedKey:tpl.key,previousSelectedTemplateKey:selectedTemplateKey,hoverKey:hoverTemplateKey ?? null},timestamp:Date.now()})}).catch(()=>{});
                              // #endregion agent log
                              if (hoverPreviewTimerRef.current) {
                                // #region agent log
                                fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H3',location:'app/(dashboard)/flows/builder/[id]/page.tsx:templateCard',message:'click cancels hover timer',data:{clickedKey:tpl.key},timestamp:Date.now()})}).catch(()=>{});
                                // #endregion agent log
                                clearTimeout(hoverPreviewTimerRef.current)
                                hoverPreviewTimerRef.current = null
                              }
                              setSelectedTemplateKey(tpl.key)
                              try {
                                const nextJson = computeTemplatePreviewJson(tpl)
                                // #region agent log
                                fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H1',location:'app/(dashboard)/flows/builder/[id]/page.tsx:templateCard',message:'template click computed preview json',data:{clickedKey:tpl.key,screenCount:Array.isArray((nextJson as any)?.screens)?(nextJson as any).screens.length:null,firstScreenId:Array.isArray((nextJson as any)?.screens)?String((nextJson as any).screens?.[0]?.id||''):null},timestamp:Date.now()})}).catch(()=>{});
                                // #endregion agent log
                                setFormPreviewSelectedScreenId(null)
                                setTemplateHoverPreviewJson(null)
                                setHoverTemplateKey(null)
                                setTemplateSelectedPreviewJson(nextJson)
                              } catch {
                                // ignore click preview errors
                              }
                            }}
                            className={`rounded-xl border p-4 text-left transition ${
                              selectedTemplateKey === tpl.key
                                ? 'border-emerald-400/40 bg-emerald-500/10 text-white'
                                : 'border-white/10 bg-zinc-900/60 text-gray-300 hover:bg-white/5'
                            }`}
                          >
                            <div className="text-sm font-semibold">{tpl.name}</div>
                            <div className="mt-1 text-xs text-gray-400">{tpl.description}</div>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                          onClick={() => setStartMode(null)}
                        >
                          Cancelar
                        </Button>
                        <Button type="button" onClick={handleApplyTemplate} disabled={!selectedTemplateKey}>
                          Usar modelo
                        </Button>
                      </div>
                    </div>
                  ) : null}

                </div>
              )}

              <div className={`${panelClass} p-6 space-y-4 ${step === 2 ? '' : 'hidden'}`}>
                {step === 2 ? (
                  <UnifiedFlowEditor
                    flowName={name || flow?.name || 'MiniApp'}
                    currentSpec={controller.spec}
                    flowJsonFromDb={(flow as any)?.flow_json}
                    isSaving={controller.isSaving}
                    selectedEditorKey={previewSelectedEditorKey}
                    onOpenAdvanced={() => {
                      // #region agent log
                      fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'advanced-panel',hypothesisId:'H11',location:'app/(dashboard)/flows/builder/[id]/page.tsx:onOpenAdvanced',message:'open advanced clicked',data:{step,startMode,hasPreviewJson:!!formPreviewJson,hasRoutingModel:!!(formPreviewJson as any)?.routing_model},timestamp:Date.now()})}).catch(()=>{});
                      // #endregion agent log
                      setShowAdvancedPanel(true)
                    }}
                    onPreviewChange={({ spec, generatedJson, activeScreenId }) => {
                      // #region agent log
                      try {
                        const screens = Array.isArray((generatedJson as any)?.screens) ? (generatedJson as any).screens : []
                        const firstScreenId = screens.length ? String(screens[0]?.id || '') : null
                        fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'template-preview',hypothesisId:'H4',location:'app/(dashboard)/flows/builder/[id]/page.tsx:UnifiedFlowEditor.onPreviewChange',message:'editor emitted preview',data:{step,startMode,firstScreenId,activeScreenId},timestamp:Date.now()})}).catch(()=>{});
                      } catch {}
                      // #endregion agent log
                      setFormPreviewJson(generatedJson)
                      setPreviewDynamicSpec(spec || null)
                      setFormPreviewSelectedScreenId(activeScreenId || null)
                    }}
                    onPreviewScreenIdChange={(screenId) => setFormPreviewSelectedScreenId(screenId)}
                    onSave={(patch) => {
                      controller.save({
                        ...(patch.spec !== undefined ? { spec: patch.spec } : {}),
                        ...(patch.flowJson !== undefined ? { flowJson: patch.flowJson } : {}),
                      })
                    }}
                  />
                ) : null}

                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                    onClick={() => setStep(3)}
                  >
                    Ir para finalizar
                  </Button>
                </div>
              </div>

              {step === 3 && (
                <div className={`${panelClass} p-6 space-y-4`}>
                  <div>
                    <div className="text-lg font-semibold text-white">Finalizar</div>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-widest text-gray-500 mb-2">Nome</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={() => controller.save({ name, metaFlowId: metaFlowId || undefined })}
                      disabled={controller.isSaving}
                      className="border-white/10 bg-zinc-950/40 hover:bg-white/5"
                    >
                      {controller.isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Salvar rascunho
                    </Button>

                    <Button
                      onClick={async () => {
                        const flowJsonToSave = formPreviewJson || (flow as any)?.flow_json

                        await controller.saveAsync({
                          name,
                          metaFlowId: metaFlowId || undefined,
                          ...(controller.spec ? { spec: controller.spec } : {}),
                          ...(flowJsonToSave ? { flowJson: flowJsonToSave } : {}),
                        })

                        const updated = await controller.publishToMetaAsync({
                          publish: true,
                          categories: ['OTHER'],
                          updateIfExists: true,
                        })

                        setMetaFlowId(updated.meta_flow_id || '')
                        toast.success('MiniApp publicada na Meta com sucesso!')
                        router.push('/templates?tab=flows')
                      }}
                      disabled={controller.isSaving || controller.isPublishingToMeta}
                      className="bg-white text-black hover:bg-gray-200"
                    >
                      {(controller.isSaving || controller.isPublishingToMeta) ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <UploadCloud className="w-4 h-4" />
                      )}
                      Enviar para Meta
                    </Button>
                  </div>
                </div>
              )}

            </div>

            <div className="space-y-4 lg:sticky lg:top-6 self-start">
              <div className={`${panelClass} p-4`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-gray-500">Resumo</div>
                    <div className="text-lg font-semibold text-white">Prévia</div>
                  </div>
                </div>

                {previewFlowJson ? (
                  <div className="flex items-center justify-center">
                    <MetaFlowPreview
                      flowJson={previewFlowJson}
                      selectedScreenId={formPreviewSelectedScreenId || undefined}
                      selectedEditorKey={previewSelectedEditorKey}
                      paths={
                        step === 2 && previewDynamicSpec
                          ? {
                              defaultNextByScreen: previewDynamicSpec.defaultNextByScreen,
                              branchesByScreen: previewDynamicSpec.branchesByScreen,
                            }
                          : undefined
                      }
                      onSelectEditorKey={(key) => setPreviewSelectedEditorKey(key)}
                    />
                  </div>
                ) : (
                  <div className="py-16 text-center text-sm text-gray-500">
                    A prévia aparece aqui assim que você criar a primeira tela.
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {showAdvancedPanel &&
        formPreviewJson &&
        typeof formPreviewJson === 'object' && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => {
              // #region agent log
              fetch('http://127.0.0.1:7243/ingest/1294d6ce-76f2-430d-96ab-3ae4d7527327',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'advanced-panel',hypothesisId:'H15',location:'app/(dashboard)/flows/builder/[id]/page.tsx:overlay',message:'overlay click closes advanced panel',data:{},timestamp:Date.now()})}).catch(()=>{});
              // #endregion agent log
              setShowAdvancedPanel(false)
            }}
          />
          <AdvancedFlowPanel
            screens={(formPreviewJson as any)?.screens || []}
            routingModel={(formPreviewJson as any)?.routing_model || {}}
            onScreensChange={(screens) => {
              const next = { ...(formPreviewJson as any), screens }
              setFormPreviewJson(next)
              const nextSpec = dynamicFlowSpecFromJson(next)
              controller.save({
                spec: { ...(controller.spec as any), dynamicFlow: nextSpec },
                flowJson: next,
              })
            }}
            onRoutingChange={(routing) => {
              const next = { ...(formPreviewJson as any), routing_model: routing }
              setFormPreviewJson(next)
              const nextSpec = dynamicFlowSpecFromJson(next)
              controller.save({
                spec: { ...(controller.spec as any), dynamicFlow: nextSpec },
                flowJson: next,
              })
            }}
            onClose={() => setShowAdvancedPanel(false)}
          />
        </>
      )}
    </Page>
  )
}
