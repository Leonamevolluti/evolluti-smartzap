import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerContactsTools } from './tools/contacts'
import { registerContactsWriteTools } from './tools/contacts-write'
import { registerCampaignsTools } from './tools/campaigns'
import { registerCampaignsWriteTools } from './tools/campaigns-write'
import { registerTemplatesTools } from './tools/templates'
import { registerInboxTools } from './tools/inbox'
import { registerMessagesTools } from './tools/messages'
import { registerSystemTools } from './tools/system'
import { registerSettingsTools } from './tools/settings'
import { registerAgentsTools } from './tools/agents'
import { registerFlowsTools } from './tools/flows'

export function registerAllTools(server: McpServer) {
  // Leitura
  registerContactsTools(server)
  registerCampaignsTools(server)
  registerTemplatesTools(server)
  registerInboxTools(server)
  registerMessagesTools(server)
  registerSystemTools(server)

  // Escrita / Admin
  registerContactsWriteTools(server)
  registerCampaignsWriteTools(server)
  registerSettingsTools(server)
  registerAgentsTools(server)
  registerFlowsTools(server)
}
