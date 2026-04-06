import { AsyncLocalStorage } from 'node:async_hooks'

export type McpRequestContext = {
  isAdmin: boolean
}

export const mcpContextStorage = new AsyncLocalStorage<McpRequestContext>()

export function getMcpContext(): McpRequestContext {
  const ctx = mcpContextStorage.getStore()
  if (!ctx) {
    throw new Error('MCP context não disponível — chamado fora do request handler')
  }
  return ctx
}
