/**
 * Google File Search Store API Helpers
 *
 * Provides functions to manage File Search Stores for RAG (Retrieval Augmented Generation)
 * with Gemini models.
 *
 * Flow:
 * 1. Create a File Search Store (one per agent)
 * 2. Upload files to the store (they get indexed automatically)
 * 3. Use google.tools.fileSearch() in generateText to query the indexed documents
 */

// ============================================================================
// Types
// ============================================================================

export interface FileSearchStore {
  name: string // e.g., "fileSearchStores/abc123"
  displayName?: string
  createTime?: string
  updateTime?: string
  activeDocumentsCount?: string
  pendingDocumentsCount?: string
  failedDocumentsCount?: string
  sizeBytes?: string
}

export interface FileSearchFile {
  name: string // e.g., "fileSearchStores/abc123/files/xyz789"
  displayName?: string
  state?: 'PROCESSING' | 'ACTIVE' | 'FAILED'
}

export interface FileSearchOperation {
  name: string
  done: boolean
  metadata?: Record<string, unknown>
  error?: { code: number; message: string }
  response?: Record<string, unknown>
}

/**
 * Chunking configuration for file upload
 * Controls how documents are split into chunks for semantic search
 */
export interface ChunkingConfig {
  whiteSpaceConfig?: {
    /** Maximum tokens per chunk (default: 256, recommended: 200-500) */
    maxTokensPerChunk?: number
    /** Overlap tokens between chunks (default: 20, recommended: 10-50) */
    maxOverlapTokens?: number
  }
}

/**
 * Custom metadata for file filtering
 * Allows filtering documents at query time
 */
export interface CustomMetadata {
  key: string
  stringValue?: string
  numericValue?: number
}

/**
 * Upload configuration options
 */
export interface UploadConfig {
  /** Display name for the file (visible in citations) */
  displayName?: string
  /** Custom chunking configuration */
  chunkingConfig?: ChunkingConfig
  /** Custom metadata for filtering */
  customMetadata?: CustomMetadata[]
  /** MIME type of the file */
  mimeType?: string
}

/**
 * Default chunking configuration optimized for RAG
 * - 300 tokens per chunk: good balance between context and precision
 * - 30 tokens overlap: ensures continuity between chunks
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  whiteSpaceConfig: {
    maxTokensPerChunk: 300,
    maxOverlapTokens: 30,
  },
}

// ============================================================================
// File Search Store CRUD
// ============================================================================

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Create a new File Search Store
 */
export async function createFileSearchStore(
  apiKey: string,
  displayName: string
): Promise<FileSearchStore> {
  const response = await fetch(`${BASE_URL}/fileSearchStores?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('[file-search-store] Create store error:', error)
    throw new Error(`Failed to create File Search Store: ${error}`)
  }

  return response.json()
}

/**
 * Get a File Search Store by name
 */
export async function getFileSearchStore(
  apiKey: string,
  storeName: string
): Promise<FileSearchStore | null> {
  const response = await fetch(`${BASE_URL}/${storeName}?key=${apiKey}`)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const error = await response.text()
    console.error('[file-search-store] Get store error:', error)
    throw new Error(`Failed to get File Search Store: ${error}`)
  }

  return response.json()
}

/**
 * Delete a File Search Store
 */
export async function deleteFileSearchStore(
  apiKey: string,
  storeName: string,
  force = true
): Promise<void> {
  const url = `${BASE_URL}/${storeName}?key=${apiKey}${force ? '&force=true' : ''}`
  const response = await fetch(url, { method: 'DELETE' })

  if (!response.ok && response.status !== 404) {
    const error = await response.text()
    console.error('[file-search-store] Delete store error:', error)
    throw new Error(`Failed to delete File Search Store: ${error}`)
  }
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Upload a file directly to a File Search Store
 * The file will be chunked, embedded, and indexed automatically
 *
 * Uses the multipart upload approach as documented in Google's API
 *
 * @param apiKey - Google API key
 * @param storeName - File Search Store name (e.g., "fileSearchStores/abc123")
 * @param fileContent - File content as ArrayBuffer, Blob, or string
 * @param fileName - Display name for the file (visible in citations)
 * @param mimeType - MIME type of the file
 * @param config - Optional upload configuration (chunking, metadata)
 */
export async function uploadToFileSearchStore(
  apiKey: string,
  storeName: string,
  fileContent: ArrayBuffer | Blob | string,
  fileName: string,
  mimeType: string,
  config?: Omit<UploadConfig, 'displayName' | 'mimeType'>
): Promise<FileSearchOperation> {
  // Convert content to Blob
  let blob: Blob
  if (typeof fileContent === 'string') {
    blob = new Blob([fileContent], { type: mimeType })
  } else if (fileContent instanceof Blob) {
    blob = fileContent
  } else {
    // ArrayBuffer
    blob = new Blob([fileContent], { type: mimeType })
  }

  // Use the simple multipart upload
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore?key=${apiKey}`

  // Build config object with chunking and metadata
  const uploadConfig: Record<string, unknown> = {
    displayName: fileName,
  }

  // Apply chunking config (use defaults if not provided)
  const chunkingConfig = config?.chunkingConfig ?? DEFAULT_CHUNKING_CONFIG
  if (chunkingConfig.whiteSpaceConfig) {
    uploadConfig.chunkingConfig = {
      whiteSpaceConfig: {
        maxTokensPerChunk: chunkingConfig.whiteSpaceConfig.maxTokensPerChunk ?? 300,
        maxOverlapTokens: chunkingConfig.whiteSpaceConfig.maxOverlapTokens ?? 30,
      },
    }
  }

  // Add custom metadata if provided
  if (config?.customMetadata && config.customMetadata.length > 0) {
    uploadConfig.customMetadata = config.customMetadata
  }

  console.log('[file-search-store] Upload config:', JSON.stringify(uploadConfig, null, 2))

  // Create multipart form data
  const formData = new FormData()
  formData.append('config', JSON.stringify(uploadConfig))
  formData.append('file', blob, fileName)

  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('[file-search-store] Upload error:', error)
    throw new Error(`Failed to upload file: ${error}`)
  }

  const result = await response.json()
  console.log('[file-search-store] Upload response:', JSON.stringify(result, null, 2))

  return result
}

/**
 * Import an already uploaded file (via Files API) to a File Search Store
 */
export async function importFileToStore(
  apiKey: string,
  storeName: string,
  fileName: string // e.g., "files/abc123"
): Promise<FileSearchOperation> {
  const response = await fetch(
    `${BASE_URL}/${storeName}:importFile?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    }
  )

  if (!response.ok) {
    const error = await response.text()
    console.error('[file-search-store] Import error:', error)
    throw new Error(`Failed to import file: ${error}`)
  }

  return response.json()
}

/**
 * Delete a file from a File Search Store
 * Silently ignores 404 (not found) and 403 (permission denied for old files)
 */
export async function deleteFileFromStore(
  apiKey: string,
  fileSearchFileName: string // e.g., "fileSearchStores/xxx/files/yyy"
): Promise<void> {
  // Only attempt delete if the file name looks like a File Search Store file
  if (!fileSearchFileName.startsWith('fileSearchStores/')) {
    console.log(`[file-search-store] Skipping delete for non-store file: ${fileSearchFileName}`)
    return
  }

  const response = await fetch(
    `${BASE_URL}/${fileSearchFileName}?key=${apiKey}`,
    { method: 'DELETE' }
  )

  // Ignore 404 (not found) and 403 (old files from different API)
  if (!response.ok && response.status !== 404 && response.status !== 403) {
    const error = await response.text()
    console.error('[file-search-store] Delete file error:', error)
    throw new Error(`Failed to delete file: ${error}`)
  }

  if (response.status === 403) {
    console.log(`[file-search-store] File not in store (403), skipping: ${fileSearchFileName}`)
  }
}

// ============================================================================
// Operation Polling
// ============================================================================

/**
 * Poll an operation until it completes
 */
export async function waitForOperation(
  apiKey: string,
  operationName: string,
  maxAttempts = 30,
  delayMs = 2000
): Promise<FileSearchOperation> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(
      `${BASE_URL}/${operationName}?key=${apiKey}`
    )

    if (!response.ok) {
      console.error(`[file-search-store] Operation check failed (attempt ${attempt})`)
      if (attempt === maxAttempts) {
        throw new Error('Max attempts reached checking operation status')
      }
      await new Promise(resolve => setTimeout(resolve, delayMs))
      continue
    }

    const operation: FileSearchOperation = await response.json()

    if (operation.done) {
      if (operation.error) {
        throw new Error(`Operation failed: ${operation.error.message}`)
      }
      console.log(`[file-search-store] Operation completed after ${attempt} attempt(s)`)
      return operation
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw new Error('Operation timed out')
}

// ============================================================================
// Store Validation & Health Check
// ============================================================================

/**
 * Validation result for a File Search Store
 */
export interface StoreValidationResult {
  /** Whether the store is valid and usable */
  isValid: boolean
  /** Status of the store */
  status: 'valid' | 'not_found' | 'no_documents' | 'permission_denied' | 'error'
  /** Human-readable message */
  message: string
  /** Store details if available */
  store?: FileSearchStore
  /** Error details if any */
  error?: string
}

/**
 * Validate a File Search Store
 *
 * Checks:
 * 1. Store exists
 * 2. Store is accessible (no permission errors)
 * 3. Store has active documents
 *
 * @returns Validation result with status and details
 */
export async function validateFileSearchStore(
  apiKey: string,
  storeName: string
): Promise<StoreValidationResult> {
  try {
    const response = await fetch(`${BASE_URL}/${storeName}?key=${apiKey}`)

    // Check for 404 - store not found
    if (response.status === 404) {
      return {
        isValid: false,
        status: 'not_found',
        message: `File Search Store não encontrado: ${storeName}`,
      }
    }

    // Check for 403 - permission denied
    if (response.status === 403) {
      const errorText = await response.text()
      return {
        isValid: false,
        status: 'permission_denied',
        message: 'Sem permissão para acessar o File Search Store',
        error: errorText,
      }
    }

    // Check for other errors
    if (!response.ok) {
      const errorText = await response.text()
      return {
        isValid: false,
        status: 'error',
        message: `Erro ao verificar File Search Store: ${response.status}`,
        error: errorText,
      }
    }

    // Parse store data
    const store: FileSearchStore = await response.json()

    console.log('[file-search-store] Validation response:', JSON.stringify(store, null, 2))

    // Check for active documents
    const activeCount = parseInt(store.activeDocumentsCount || '0', 10)
    const pendingCount = parseInt(store.pendingDocumentsCount || '0', 10)
    const failedCount = parseInt(store.failedDocumentsCount || '0', 10)

    // If there are pending documents, the store is being indexed - consider it valid
    if (pendingCount > 0) {
      return {
        isValid: true,
        status: 'valid',
        message: `Store indexando: ${pendingCount} documento(s) pendente(s), ${activeCount} ativo(s)`,
        store,
      }
    }

    // If there are active documents, the store is valid
    if (activeCount > 0) {
      return {
        isValid: true,
        status: 'valid',
        message: `Store válido com ${activeCount} documento(s) ativo(s)`,
        store,
      }
    }

    // No documents at all
    if (activeCount === 0 && pendingCount === 0 && failedCount === 0) {
      return {
        isValid: false,
        status: 'no_documents',
        message: 'File Search Store não possui documentos indexados',
        store,
      }
    }

    // Only failed documents
    if (failedCount > 0 && activeCount === 0) {
      return {
        isValid: false,
        status: 'no_documents',
        message: `Todos os ${failedCount} documento(s) falharam na indexação`,
        store,
      }
    }

    // Fallback - store exists, consider it potentially valid
    return {
      isValid: true,
      status: 'valid',
      message: `Store existente (active: ${activeCount}, pending: ${pendingCount}, failed: ${failedCount})`,
      store,
    }
  } catch (err) {
    return {
      isValid: false,
      status: 'error',
      message: 'Erro ao validar File Search Store',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Result of cleaning up an invalid store
 */
export interface StoreCleanupResult {
  /** Whether cleanup was performed */
  cleaned: boolean
  /** What action was taken */
  action: 'cleared_store_id' | 'no_action' | 'error'
  /** Human-readable message */
  message: string
}

/**
 * Clean up invalid File Search Store reference from an agent
 *
 * When a store no longer exists or is inaccessible, this function:
 * 1. Sets file_search_store_id to null in the database
 * 2. Optionally marks knowledge files as needing re-indexing
 *
 * @param supabase - Supabase client
 * @param agentId - Agent ID to clean up
 * @param reason - Why the cleanup is happening (for logging)
 */
export async function cleanupInvalidStoreReference(
  supabase: ReturnType<typeof import('@/lib/supabase').getSupabaseAdmin>,
  agentId: string,
  reason: string
): Promise<StoreCleanupResult> {
  if (!supabase) {
    return {
      cleaned: false,
      action: 'error',
      message: 'Supabase client not available',
    }
  }

  try {
    console.log(`[file-search-store] Cleaning up invalid store for agent ${agentId}: ${reason}`)

    // Clear the file_search_store_id
    const { error: updateError } = await supabase
      .from('ai_agents')
      .update({ file_search_store_id: null })
      .eq('id', agentId)

    if (updateError) {
      console.error('[file-search-store] Failed to clear store ID:', updateError)
      return {
        cleaned: false,
        action: 'error',
        message: `Failed to clear store ID: ${updateError.message}`,
      }
    }

    // Mark knowledge files as needing re-indexing
    const { error: filesError } = await supabase
      .from('ai_knowledge_files')
      .update({
        indexing_status: 'pending',
        external_file_id: null,
        external_file_uri: null,
      })
      .eq('agent_id', agentId)
      .eq('indexing_status', 'completed')

    if (filesError) {
      console.warn('[file-search-store] Failed to reset file status:', filesError)
      // Don't fail the whole operation for this
    }

    console.log(`[file-search-store] Cleaned up store reference for agent ${agentId}`)

    return {
      cleaned: true,
      action: 'cleared_store_id',
      message: `Store reference cleared. Reason: ${reason}`,
    }
  } catch (err) {
    console.error('[file-search-store] Cleanup error:', err)
    return {
      cleaned: false,
      action: 'error',
      message: err instanceof Error ? err.message : 'Unknown error during cleanup',
    }
  }
}

/**
 * Validate store and auto-cleanup if invalid
 *
 * Combines validation and cleanup in one operation.
 * Returns whether File Search should be used.
 */
export async function validateAndCleanupStore(
  apiKey: string,
  storeName: string,
  supabase: ReturnType<typeof import('@/lib/supabase').getSupabaseAdmin>,
  agentId: string
): Promise<{
  useFileSearch: boolean
  validation: StoreValidationResult
  cleanup?: StoreCleanupResult
}> {
  const validation = await validateFileSearchStore(apiKey, storeName)

  // If valid, no cleanup needed
  if (validation.isValid) {
    return { useFileSearch: true, validation }
  }

  // Store is invalid - clean up the reference
  const cleanup = await cleanupInvalidStoreReference(
    supabase,
    agentId,
    `${validation.status}: ${validation.message}`
  )

  return {
    useFileSearch: false,
    validation,
    cleanup,
  }
}

// ============================================================================
// Helper to ensure store exists
// ============================================================================

/**
 * Ensure a File Search Store exists for an agent
 * Returns existing store name or creates a new one
 */
export async function ensureFileSearchStore(
  apiKey: string,
  agentId: string,
  agentName: string,
  existingStoreName?: string | null
): Promise<string> {
  // If we have an existing store, verify it still exists
  if (existingStoreName) {
    const store = await getFileSearchStore(apiKey, existingStoreName)
    if (store) {
      return existingStoreName
    }
    console.log(`[file-search-store] Store ${existingStoreName} not found, creating new one`)
  }

  // Create new store
  const displayName = `smartzap-agent-${agentName}-${agentId.slice(0, 8)}`
  const store = await createFileSearchStore(apiKey, displayName)

  console.log(`[file-search-store] Created new store: ${store.name}`)
  return store.name
}
