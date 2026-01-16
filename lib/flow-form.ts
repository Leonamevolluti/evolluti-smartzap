export type FlowFormFieldType =
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

export type FlowFormOption = { id: string; title: string }

export type FlowFormFieldV1 = {
  id: string
  name: string
  label: string
  type: FlowFormFieldType
  required: boolean
  placeholder?: string
  options?: FlowFormOption[]
  /** usado no opt-in */
  text?: string
}

export type FlowFormStepV1 = {
  id: string
  title?: string
  /** Apenas para o botão “continuar” das etapas intermediárias */
  nextLabel?: string
  fields: FlowFormFieldV1[]
}

export type FlowFormSpecV1 = {
  version: 1
  screenId: string
  title: string
  intro?: string
  submitLabel: string
  sendConfirmation?: boolean
  confirmationTitle?: string
  confirmationFooter?: string
  /** Multi-etapas (retrocompatível: se ausente, funciona como 1 tela) */
  steps?: FlowFormStepV1[]
  fields: FlowFormFieldV1[]
}

type FlowComponent = Record<string, any>

function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function normalizeFlowFieldName(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeScreenId(input: string): string {
  const raw = (input || '').trim().toUpperCase()
  const cleaned = raw.replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'FORM'
}

export function normalizeFlowFormSpec(input: unknown, fallbackTitle?: string): FlowFormSpecV1 {
  const baseTitle = (fallbackTitle || 'Formulário').trim() || 'Formulário'

  const defaults: FlowFormSpecV1 = {
    version: 1,
    screenId: 'FORM',
    title: baseTitle,
    intro: 'Preencha os dados abaixo:',
    submitLabel: 'Enviar',
    sendConfirmation: true,
    confirmationTitle: '',
    confirmationFooter: '',
    steps: undefined,
    fields: [],
  }

  if (!isPlainObject(input)) return defaults

  const normalizeField = (f: any, idx: number): FlowFormFieldV1 | null => {
      if (!f || typeof f !== 'object') return null
      const type = safeString(f.type) as FlowFormFieldType
      const allowed: FlowFormFieldType[] = [
        'short_text',
        'long_text',
        'email',
        'phone',
        'number',
        'date',
        'dropdown',
        'single_choice',
        'multi_choice',
        'optin',
      ]
      const normalizedType: FlowFormFieldType = allowed.includes(type) ? type : 'short_text'

      const label = safeString(f.label, `Pergunta ${idx + 1}`).trim() || `Pergunta ${idx + 1}`
      const rawName = safeString(f.name, normalizeFlowFieldName(label))
      const name = normalizeFlowFieldName(rawName) || `campo_${idx + 1}`
      const id = safeString(f.id, `q_${idx + 1}`) || `q_${idx + 1}`
      const required = typeof f.required === 'boolean' ? f.required : false

      const out: FlowFormFieldV1 = {
        id,
        name,
        label,
        type: normalizedType,
        required,
      }

      const placeholder = safeString(f.placeholder, '').trim()
      if (placeholder) out.placeholder = placeholder

      if (normalizedType === 'optin') {
        const text = safeString(f.text, label).trim() || label
        out.text = text
      }

      if (normalizedType === 'dropdown' || normalizedType === 'single_choice' || normalizedType === 'multi_choice') {
        const optionsRaw = Array.isArray(f.options) ? f.options : []
        const options: FlowFormOption[] = optionsRaw
          .map((o: any, oidx: number): FlowFormOption | null => {
            if (!o || typeof o !== 'object') return null
            const title = safeString(o.title, '').trim() || `Opção ${oidx + 1}`
            const id = safeString(o.id, normalizeFlowFieldName(title)).trim() || `${oidx + 1}`
            return { id, title }
          })
          .filter(Boolean) as FlowFormOption[]

        out.options = options.length > 0 ? options : [{ id: 'opcao_1', title: 'Opção 1' }]
      }

      return out
  }

  const stepsRaw = Array.isArray((input as any).steps) ? (input as any).steps : []
  const steps: FlowFormStepV1[] = stepsRaw
    .map((step: any, idx: number): FlowFormStepV1 | null => {
      if (!step || typeof step !== 'object') return null
      const fieldsRaw = Array.isArray(step.fields) ? step.fields : []
      const fields = fieldsRaw.map((f: any, fidx: number) => normalizeField(f, fidx)).filter(Boolean) as FlowFormFieldV1[]
      const id = safeString(step.id, `STEP_${idx + 1}`) || `STEP_${idx + 1}`
      const title = safeString(step.title, '').trim()
      const nextLabel = safeString(step.nextLabel, '').trim()
      return {
        id,
        ...(title ? { title } : {}),
        ...(nextLabel ? { nextLabel } : {}),
        fields,
      }
    })
    .filter(Boolean) as FlowFormStepV1[]

  const topFieldsRaw = Array.isArray((input as any).fields) ? (input as any).fields : []
  const topFields: FlowFormFieldV1[] = topFieldsRaw
    .map((f: any, idx: number) => normalizeField(f, idx))
    .filter(Boolean) as FlowFormFieldV1[]

  const normalizedSteps =
    steps.length > 0
      ? steps
      : [
          {
            id: 'STEP_1',
            fields: topFields,
          },
        ]

  const flattenedFields = normalizedSteps.flatMap((s) => s.fields)

  const first = normalizedSteps[0] as any
  const hasStepMeta =
    normalizedSteps.length > 1 ||
    !!String(first?.title || '').trim() ||
    !!String(first?.nextLabel || '').trim()

  return {
    version: 1,
    screenId: normalizeScreenId(safeString(input.screenId, defaults.screenId)),
    title: safeString(input.title, defaults.title).trim() || defaults.title,
    intro: safeString(input.intro, defaults.intro).trim() || defaults.intro,
    submitLabel: safeString(input.submitLabel, defaults.submitLabel).trim() || defaults.submitLabel,
    sendConfirmation:
      typeof (input as any).sendConfirmation === 'boolean'
        ? (input as any).sendConfirmation
        : defaults.sendConfirmation,
    confirmationTitle:
      safeString((input as any).confirmationTitle, defaults.confirmationTitle).trim() ||
      defaults.confirmationTitle,
    confirmationFooter:
      safeString((input as any).confirmationFooter, defaults.confirmationFooter).trim() ||
      defaults.confirmationFooter,
    steps: hasStepMeta ? normalizedSteps : undefined,
    fields: flattenedFields,
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getOptions(comp: FlowComponent): FlowFormOption[] {
  const raw = Array.isArray(comp['data-source'])
    ? comp['data-source']
    : Array.isArray(comp.options)
      ? comp.options
      : []
  return raw
    .map((o: any, idx: number) => ({
      id: asText(o?.id || `opcao_${idx + 1}`) || `opcao_${idx + 1}`,
      title: asText(o?.title || `Opção ${idx + 1}`) || `Opção ${idx + 1}`,
    }))
    .filter((o: FlowFormOption) => o.id && o.title)
}

export function flowJsonToFormSpec(flowJson: unknown, fallbackTitle?: string): FlowFormSpecV1 {
  const base = normalizeFlowFormSpec({}, fallbackTitle)
  if (!flowJson || typeof flowJson !== 'object') return base

  const screens = Array.isArray((flowJson as any).screens) ? (flowJson as any).screens : []
  const firstScreen = screens[0]
  const title = asText(firstScreen?.title).trim() || base.title
  const screenId = asText(firstScreen?.id).trim() || base.screenId

  function flatten(nodes: FlowComponent[]): FlowComponent[] {
    const out: FlowComponent[] = []
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue
      out.push(n)
      const children = Array.isArray((n as any).children) ? ((n as any).children as FlowComponent[]) : null
      if (children?.length) out.push(...flatten(children))
    }
    return out
  }

  function extractFieldsFromChildren(children: FlowComponent[]): FlowFormFieldV1[] {
    const flat = flatten(children)
    const fields: FlowFormFieldV1[] = []
    for (const child of flat) {
      const type = asText(child?.type)
      if (!type) continue
      if (type === 'Footer' || type === 'Form') continue
      if (type === 'TextBody' || type === 'BasicText' || type === 'RichText' || type === 'TextHeading' || type === 'TextSubheading' || type === 'TextCaption') {
        continue
      }

      if (type === 'TextArea') {
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.label || 'Pergunta').trim() || 'Pergunta',
          type: 'long_text',
          required: !!child?.required,
        })
        continue
      }

      if (type === 'TextInput' || type === 'TextEntry') {
        const inputType = asText(child?.['input-type'])
        const mappedType: FlowFormFieldType =
          inputType === 'email'
            ? 'email'
            : inputType === 'phone'
              ? 'phone'
              : inputType === 'number'
                ? 'number'
                : 'short_text'
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.label || 'Pergunta').trim() || 'Pergunta',
          type: mappedType,
          required: !!child?.required,
        })
        continue
      }

      if (type === 'Dropdown') {
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.label || 'Pergunta').trim() || 'Pergunta',
          type: 'dropdown',
          required: !!child?.required,
          options: getOptions(child),
        })
        continue
      }

      if (type === 'RadioButtonsGroup') {
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.label || 'Pergunta').trim() || 'Pergunta',
          type: 'single_choice',
          required: !!child?.required,
          options: getOptions(child),
        })
        continue
      }

      if (type === 'CheckboxGroup') {
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.label || 'Pergunta').trim() || 'Pergunta',
          type: 'multi_choice',
          required: !!child?.required,
          options: getOptions(child),
        })
        continue
      }

      if (type === 'DatePicker' || type === 'CalendarPicker') {
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.label || 'Pergunta').trim() || 'Pergunta',
          type: 'date',
          required: !!child?.required,
        })
        continue
      }

      if (type === 'OptIn') {
        fields.push({
          id: asText(child?.name || `q_${fields.length + 1}`) || `q_${fields.length + 1}`,
          name: normalizeFlowFieldName(asText(child?.name || `campo_${fields.length + 1}`)),
          label: asText(child?.text || child?.label || 'Opt-in').trim() || 'Opt-in',
          type: 'optin',
          required: false,
          text: asText(child?.text || child?.label || '').trim(),
        })
        continue
      }
    }
    return fields
  }

  const steps: FlowFormStepV1[] = []
  for (const [idx, s] of screens.entries()) {
    const layout = s?.layout
    const children: FlowComponent[] = Array.isArray(layout?.children) ? layout.children : []
    const fields = extractFieldsFromChildren(children)
    const footerNode = flatten(children).find((c) => c?.type === 'Footer')
    const ctaLabel = footerNode ? asText(footerNode.label).trim() : ''
    steps.push({
      id: `STEP_${idx + 1}`,
      title: asText(s?.title).trim() || (idx === 0 ? title : ''),
      ...(idx < screens.length - 1 && ctaLabel ? { nextLabel: ctaLabel } : {}),
      fields,
    })
  }

  const firstChildren: FlowComponent[] = Array.isArray(firstScreen?.layout?.children) ? firstScreen.layout.children : []
  const introNode = flatten(firstChildren).find((c) => c?.type === 'TextBody' || c?.type === 'BasicText' || c?.type === 'RichText')
  const intro = introNode ? asText(introNode.text).trim() : base.intro

  const lastScreen = screens[screens.length - 1]
  const lastChildren: FlowComponent[] = Array.isArray(lastScreen?.layout?.children) ? lastScreen.layout.children : []
  const lastFooterNode = flatten(lastChildren).find((c) => c?.type === 'Footer')
  const submitLabel = lastFooterNode ? asText(lastFooterNode.label).trim() || base.submitLabel : base.submitLabel
  const footerPayload = lastFooterNode?.['on-click-action']?.payload || {}
  const sendConfirmation =
    typeof footerPayload?.send_confirmation === 'boolean'
      ? footerPayload.send_confirmation !== false
      : true
  const confirmationTitle = asText(footerPayload?.confirmation_title || '').trim()
  const confirmationFooter = asText(footerPayload?.confirmation_footer || '').trim()

  return normalizeFlowFormSpec(
    {
      screenId,
      title,
      intro,
      submitLabel,
      confirmationTitle,
      confirmationFooter,
      sendConfirmation,
      steps: steps.length > 1 ? steps : undefined,
      fields: steps.length > 0 ? steps[0]?.fields || [] : [],
    },
    fallbackTitle,
  )
}

export function generateFlowJsonFromFormSpec(form: FlowFormSpecV1): Record<string, unknown> {
  const steps: FlowFormStepV1[] =
    Array.isArray(form.steps) && form.steps.length > 0
      ? form.steps
      : [
          {
            id: 'STEP_1',
            fields: form.fields,
          },
        ]

  const baseScreenId = normalizeScreenId(form.screenId)
  const screenIdForStep = (idx: number) => (idx === 0 ? baseScreenId : `${baseScreenId}_${idx + 1}`)

  const renderField = (field: FlowFormFieldV1): any => {
    if (field.type === 'optin') {
      return {
        type: 'OptIn',
        name: field.name,
        label: (field.text || field.label || '').trim() || 'Quero receber mensagens',
      }
    }
    if (field.type === 'dropdown') {
      return {
        type: 'Dropdown',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'data-source': Array.isArray(field.options) ? field.options : [],
      }
    }
    if (field.type === 'single_choice') {
      return {
        type: 'RadioButtonsGroup',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'data-source': Array.isArray(field.options) ? field.options : [],
      }
    }
    if (field.type === 'multi_choice') {
      return {
        type: 'CheckboxGroup',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'data-source': Array.isArray(field.options) ? field.options : [],
      }
    }
    if (field.type === 'date') {
      return {
        type: 'DatePicker',
        name: field.name,
        label: field.label,
        required: !!field.required,
      }
    }
    if (field.type === 'number') {
      return {
        type: 'TextInput',
        name: field.name,
        label: field.label,
        required: !!field.required,
        'input-type': 'number',
      }
    }
    if (field.type === 'long_text') {
      return {
        type: 'TextArea',
        name: field.name,
        label: field.label,
        required: !!field.required,
      }
    }
    // short_text, email, phone (e outros) como TextInput
    return {
      type: 'TextInput',
      name: field.name,
      label: field.label,
      required: !!field.required,
      ...(field.type === 'email' ? { 'input-type': 'email' } : {}),
      ...(field.type === 'phone' ? { 'input-type': 'phone' } : {}),
    }
  }

  const allFields = steps.flatMap((s) => s.fields)

  // payload final (complete)
  const completePayload: Record<string, string> = {}
  for (const field of allFields) {
    completePayload[field.name] = `\${form.${field.name}}`
  }
  if (form.sendConfirmation === false) {
    completePayload.send_confirmation = 'false'
  }
  if (form.confirmationTitle && form.confirmationTitle.trim()) {
    completePayload.confirmation_title = form.confirmationTitle.trim()
  }
  if (form.confirmationFooter && form.confirmationFooter.trim()) {
    completePayload.confirmation_footer = form.confirmationFooter.trim()
  }

  const screens = steps.map((step, idx) => {
    const children: any[] = []
    if (idx === 0 && form.intro && form.intro.trim()) {
      children.push({ type: 'TextBody', text: form.intro.trim() })
    }
    for (const f of step.fields) children.push(renderField(f))

    const isLast = idx === steps.length - 1
    if (isLast) {
      children.push({
        type: 'Footer',
        label: form.submitLabel || 'Enviar',
        'on-click-action': {
          name: 'complete',
          payload: completePayload,
        },
      })
    } else {
      const nextId = screenIdForStep(idx + 1)
      const payload: Record<string, string> = {}
      for (const f of step.fields) {
        payload[f.name] = `\${form.${f.name}}`
      }
      children.push({
        type: 'Footer',
        label: step.nextLabel || 'Continuar',
        'on-click-action': {
          name: 'navigate',
          next: { type: 'screen', name: nextId },
          ...(Object.keys(payload).length ? { payload } : {}),
        },
      })
    }

    return {
      id: screenIdForStep(idx),
      title: (step.title || form.title || 'Formulário').trim() || 'Formulário',
      terminal: isLast,
      layout: {
        type: 'SingleColumnLayout',
        children,
      },
    }
  })

  return {
    version: '7.3',
    screens,
  }
}

export function validateFlowFormSpec(form: FlowFormSpecV1): string[] {
  const issues: string[] = []

  if (!form.title.trim()) issues.push('Defina um título para o formulário')
  if (!form.screenId.trim()) issues.push('Defina um ID de tela (screenId)')

  const steps: FlowFormStepV1[] =
    Array.isArray(form.steps) && form.steps.length > 0
      ? form.steps
      : [
          {
            id: 'STEP_1',
            fields: form.fields,
          },
        ]

  if (!steps.length) issues.push('Adicione pelo menos 1 etapa')

  const names = new Set<string>()
  for (const [sidx, step] of steps.entries()) {
    const fields = Array.isArray(step.fields) ? step.fields : []
    for (const f of fields) {
    if (!f.label.trim()) issues.push('Existe uma pergunta sem título')
    if (!f.name.trim()) issues.push(`A pergunta "${f.label}" está sem identificador (name)`) 

    if (f.name && !/^[a-z0-9_]+$/.test(f.name)) {
      issues.push(`Campo "${f.label}": name inválido (use apenas a-z, 0-9 e _)`)
    }
    if (names.has(f.name)) issues.push(`Identificador duplicado: ${f.name}`)
    names.add(f.name)

    if ((f.type === 'dropdown' || f.type === 'single_choice' || f.type === 'multi_choice') && (!f.options || f.options.length < 1)) {
      issues.push(`Campo "${f.label}": adicione pelo menos 1 opção`)
    }
    }

    // Máximo recomendado pela Meta: 50 componentes por tela.
    const componentCount = (sidx === 0 && form.intro?.trim() ? 1 : 0) + fields.length + 1
    if (componentCount > 50) {
      issues.push(`Etapa ${sidx + 1}: muitos campos para uma única tela (${componentCount}/50). Adicione outra etapa.`)
    }
  }

  return issues
}
