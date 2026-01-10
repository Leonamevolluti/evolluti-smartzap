import { NextRequest, NextResponse } from 'next/server'
import { getWhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { fetchWithTimeout, safeJson } from '@/lib/server-http'
import { supabase } from '@/lib/supabase'
import { createHash } from 'crypto'

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function getTemplateHeaderMediaExampleLink(components: any[]): { format?: string; example?: string } {
  if (!Array.isArray(components)) return {}
  const header = components.find((c: any) => String(c?.type || '').toUpperCase() === 'HEADER') as any | undefined
  if (!header) return {}
  const format = header?.format ? String(header.format).toUpperCase() : undefined
  if (!format || !['IMAGE', 'VIDEO', 'DOCUMENT', 'GIF'].includes(format)) return { format }

  let exampleObj: any = header.example
  if (typeof header.example === 'string') {
    try {
      exampleObj = JSON.parse(header.example)
    } catch {
      exampleObj = undefined
    }
  }

  const arr = exampleObj?.header_handle
  const example = Array.isArray(arr) && typeof arr[0] === 'string' ? String(arr[0]).trim() : undefined
  return { format, example }
}

function guessExtFromContentType(contentType: string | null | undefined): string {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim()
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg'
  if (ct === 'image/png') return 'png'
  if (ct === 'image/webp') return 'webp'
  if (ct === 'image/gif') return 'gif'
  if (ct === 'video/mp4') return 'mp4'
  if (ct === 'video/quicktime') return 'mov'
  if (ct === 'application/pdf') return 'pdf'
  return 'bin'
}

async function tryDownloadBinary(url: string, accessToken?: string): Promise<{
  ok: boolean
  status: number
  contentType?: string
  size?: number
  buffer?: Buffer
  error?: string
}> {
  const timeoutMs = Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || '20000')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const attempt = async (headers?: Record<string, string>) => {
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    const contentType = res.headers.get('content-type') || undefined
    if (!res.ok) {
      return { ok: false, status: res.status, contentType, error: `HTTP ${res.status}` }
    }
    const ab = await res.arrayBuffer()
    const buffer = Buffer.from(ab)
    return {
      ok: true,
      status: res.status,
      contentType,
      size: buffer.byteLength,
      buffer,
    }
  }

  try {
    const a1 = await attempt()
    if (a1.ok) return a1
    if (accessToken) {
      const a2 = await attempt({ Authorization: `Bearer ${accessToken}` })
      return a2
    }
    return a1
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, status: 0, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}

async function ensureHeaderMediaPreviewUrl(params: {
  templateName: string
  components: any[]
  accessToken: string
}): Promise<{ url: string; expiresAt?: string | null } | null> {
  const { templateName, components, accessToken } = params
  const headerInfo = getTemplateHeaderMediaExampleLink(components)
  const example = headerInfo.example
  if (!example || !isHttpUrl(example)) return null

  const client = supabase.admin
  if (!client) return null

  const exampleHash = createHash('sha256').update(example).digest('hex').slice(0, 32)
  const nowIso = new Date().toISOString()

  try {
    const cached = await client
      .from('templates')
      .select('header_media_preview_url, header_media_preview_expires_at, header_media_hash')
      .eq('name', templateName)
      .maybeSingle()

    const cachedUrl = String(cached.data?.header_media_preview_url || '').trim()
    const cachedHash = String(cached.data?.header_media_hash || '').trim()
    const cachedExpiresAt = cached.data?.header_media_preview_expires_at as string | null | undefined
    const isExpired = cachedExpiresAt ? new Date(cachedExpiresAt).getTime() <= Date.now() : false

    if (cachedUrl && cachedHash === exampleHash && !isExpired) {
      return { url: cachedUrl, expiresAt: cachedExpiresAt || null }
    }
  } catch {
    // best-effort
  }

  const maxBytes = Number(process.env.MEDIA_REHOST_MAX_BYTES || String(25 * 1024 * 1024))
  const downloaded = await tryDownloadBinary(example, accessToken)
  if (!downloaded.ok || !downloaded.buffer) return null
  if (typeof downloaded.size === 'number' && downloaded.size > maxBytes) return null

  const bucket = String(process.env.SUPABASE_TEMPLATE_MEDIA_BUCKET || 'wa-template-media')
  try {
    await client.storage.createBucket(bucket, { public: true })
  } catch {
    // ignore
  }
  try {
    await client.storage.updateBucket(bucket, { public: true })
  } catch {
    // ignore
  }

  const contentType = downloaded.contentType || 'application/octet-stream'
  const ext = guessExtFromContentType(contentType)
  const urlHash = createHash('sha256').update(example).digest('hex').slice(0, 12)
  const safeName = String(templateName || 'template').replace(/[^a-zA-Z0-9_\-]/g, '_')
  const path = `templates/${safeName}/preview_${urlHash}.${ext}`

  const up = await client.storage
    .from(bucket)
    .upload(path, downloaded.buffer, {
      contentType,
      upsert: true,
      cacheControl: '3600',
    })
  if (up.error) return null

  const pub = client.storage.from(bucket).getPublicUrl(path)
  const publicUrl = pub?.data?.publicUrl

  const probeTimeoutMs = Number(process.env.MEDIA_PUBLIC_PROBE_TIMEOUT_MS || '8000')
  const probe = async (url: string) => {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), probeTimeoutMs)
      try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal })
        return res.status
      } finally {
        clearTimeout(t)
      }
    } catch {
      return 0
    }
  }

  let finalUrl: string | null = null
  let expiresAt: string | null = null

  if (publicUrl) {
    const status = await probe(publicUrl)
    if (status >= 200 && status < 300) {
      finalUrl = publicUrl
    } else {
      const expiresIn = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS || String(24 * 60 * 60))
      const signed = await client.storage.from(bucket).createSignedUrl(path, expiresIn)
      const signedUrl = signed?.data?.signedUrl
      if (signedUrl) {
        finalUrl = signedUrl
        expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
      }
    }
  }

  if (!finalUrl) return null

  try {
    await client
      .from('templates')
      .update({
        header_media_preview_url: finalUrl,
        header_media_preview_expires_at: expiresAt,
        header_media_hash: exampleHash,
        header_media_preview_updated_at: nowIso,
        updated_at: nowIso,
      })
      .eq('name', templateName)
  } catch {
    // best-effort
  }

  return { url: finalUrl, expiresAt }
}

// GET /api/templates/[name] - Buscar template específico
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const credentials = await getWhatsAppCredentials()
    
    if (!credentials?.businessAccountId || !credentials?.accessToken) {
      return NextResponse.json(
        { error: 'Credenciais não configuradas.' }, 
        { status: 401 }
      )
    }

    // Buscar template específico pelo nome
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.businessAccountId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,language,category,parameter_format,components,last_updated_time,quality_score,rejected_reason`,
      {
        headers: { 'Authorization': `Bearer ${credentials.accessToken}` },
        timeoutMs: 8000,
      }
    )

    if (!response.ok) {
      const error = await safeJson<any>(response)
      return NextResponse.json(
        { error: error?.error?.message || 'Template não encontrado' },
        { status: response.status }
      )
    }

    const data = await safeJson<any>(response)
    
    if (!data.data || data.data.length === 0) {
      return NextResponse.json(
        { error: 'Template não encontrado' },
        { status: 404 }
      )
    }

    const template = data.data[0]
    const bodyComponent = template.components?.find((c: { type: string }) => c.type === 'BODY')
    const headerComponent = template.components?.find((c: { type: string }) => c.type === 'HEADER')
    const footerComponent = template.components?.find((c: { type: string }) => c.type === 'FOOTER')
    const buttonsComponent = template.components?.find((c: { type: string }) => c.type === 'BUTTONS')

    const previewResult = await ensureHeaderMediaPreviewUrl({
      templateName: template.name,
      components: template.components || [],
      accessToken: credentials.accessToken,
    })

    return NextResponse.json({
      id: template.name,
      metaTemplateId: template.id || null,
      name: template.name,
      category: template.category,
      language: template.language,
      status: template.status,
      content: bodyComponent?.text || '',
      header: headerComponent?.text || headerComponent?.format || null,
      footer: footerComponent?.text || null,
      buttons: buttonsComponent?.buttons || [],
      components: template.components,
      headerMediaPreviewUrl: previewResult?.url || null,
      headerMediaPreviewExpiresAt: previewResult?.expiresAt || null,
      qualityScore: template.quality_score?.score || null,
      rejectedReason: template.rejected_reason || null,
      lastUpdated: template.last_updated_time
    })

  } catch (error) {
    console.error('Get Template Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}

// DELETE /api/templates/[name] - Deletar template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const credentials = await getWhatsAppCredentials()
    
    if (!credentials?.businessAccountId || !credentials?.accessToken) {
      return NextResponse.json(
        { error: 'Credenciais não configuradas.' }, 
        { status: 401 }
      )
    }

    // Deletar template via Meta API
    // A Meta exige que especifiquemos o nome do template
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.businessAccountId}/message_templates?name=${name}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${credentials.accessToken}` },
        timeoutMs: 8000,
      }
    )

    const result = await safeJson<any>(response)

    if (!response.ok) {
      console.error('Meta Delete Error:', result)
      
      let errorMessage = result?.error?.message || 'Erro ao deletar template'
      
      // Traduzir erros comuns
      if (result?.error?.code === 100) {
        errorMessage = 'Template não encontrado ou já foi deletado.'
      } else if (result?.error?.code === 190) {
        errorMessage = 'Token de acesso inválido ou expirado.'
      }
      
      return NextResponse.json(
        { error: errorMessage, metaError: result?.error },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Template "${name}" deletado com sucesso!`
    })

  } catch (error) {
    console.error('Delete Template Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 }
    )
  }
}
