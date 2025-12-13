/**
 * Supabase Database Service
 * 
 * Camada de acesso ao banco (Supabase)
 */

import { supabase } from './supabase'
import {
    Campaign,
    Contact,
    CampaignStatus,
    ContactStatus,
    Template,
    TemplateCategory,
    TemplateStatus,
    AppSettings,
    TemplateProject,
    TemplateProjectItem,
    CreateTemplateProjectDTO,
    CustomFieldDefinition,
} from '../types'

// Gera um ID compatível com ambientes que usam UUID (preferencial) e também funciona como TEXT.
// - Em Supabase, muitos schemas antigos usam `uuid` como PK.
// - No schema consolidado atual, os PKs são TEXT com defaults, mas aceitar UUID como string é ok.
const generateId = () => {
    try {
        // Web Crypto (browser/edge) e Node moderno
        if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
    } catch {
        // ignore
    }

    // Fallback (menos ideal, mas evita quebrar em runtimes sem randomUUID)
    return Math.random().toString(36).slice(2)
}

// ============================================================================
// CAMPAIGNS
// ============================================================================

export const campaignDb = {
    getAll: async (): Promise<Campaign[]> => {
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        return (data || []).map(row => ({
            id: row.id,
            name: row.name,
            status: row.status as CampaignStatus,
            templateName: row.template_name,
            templateVariables: row.template_variables as { header: string[], body: string[], buttons?: Record<string, string> } | undefined,
            templateSnapshot: (row as any).template_snapshot ?? undefined,
            templateSpecHash: (row as any).template_spec_hash ?? null,
            templateParameterFormat: (row as any).template_parameter_format ?? null,
            templateFetchedAt: (row as any).template_fetched_at ?? null,
            recipients: row.total_recipients,
            sent: row.sent,
            delivered: row.delivered,
            read: row.read,
            skipped: (row as any).skipped || 0,
            failed: row.failed,
            createdAt: row.created_at,
            scheduledAt: row.scheduled_date,
            startedAt: row.started_at,
            completedAt: row.completed_at,
        }))
    },

    getById: async (id: string): Promise<Campaign | undefined> => {
        const { data, error } = await supabase
            .from('campaigns')
            .select('*')
            .eq('id', id)
            .single()

        if (error || !data) return undefined

        return {
            id: data.id,
            name: data.name,
            status: data.status as CampaignStatus,
            templateName: data.template_name,
            templateVariables: data.template_variables as { header: string[], body: string[], buttons?: Record<string, string> } | undefined,
            templateSnapshot: (data as any).template_snapshot ?? undefined,
            templateSpecHash: (data as any).template_spec_hash ?? null,
            templateParameterFormat: (data as any).template_parameter_format ?? null,
            templateFetchedAt: (data as any).template_fetched_at ?? null,
            recipients: data.total_recipients,
            sent: data.sent,
            delivered: data.delivered,
            read: data.read,
            skipped: (data as any).skipped || 0,
            failed: data.failed,
            createdAt: data.created_at,
            scheduledAt: data.scheduled_date,
            startedAt: data.started_at,
            completedAt: data.completed_at,
        }
    },

    create: async (campaign: {
        name: string
        templateName: string
        recipients: number
        scheduledAt?: string
        templateVariables?: { header: string[], body: string[], buttons?: Record<string, string> }
    }): Promise<Campaign> => {
        const id = generateId()
        const now = new Date().toISOString()
        const status = campaign.scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.SENDING

        const { data, error } = await supabase
            .from('campaigns')
            .insert({
                id,
                name: campaign.name,
                status,
                template_name: campaign.templateName,
                template_variables: campaign.templateVariables,
                total_recipients: campaign.recipients,
                sent: 0,
                delivered: 0,
                read: 0,
                failed: 0,
                skipped: 0,
                created_at: now,
                scheduled_date: campaign.scheduledAt,
                started_at: campaign.scheduledAt ? null : now,
            })
            .select()
            .single()

        if (error) throw error

        return {
            id,
            name: campaign.name,
            status,
            templateName: campaign.templateName,
            templateVariables: campaign.templateVariables,
            recipients: campaign.recipients,
            sent: 0,
            delivered: 0,
            read: 0,
            skipped: 0,
            failed: 0,
            createdAt: now,
            scheduledAt: campaign.scheduledAt,
            startedAt: campaign.scheduledAt ? undefined : now,
        }
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('campaigns')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    duplicate: async (id: string): Promise<Campaign | undefined> => {
        const original = await campaignDb.getById(id)
        if (!original) return undefined

        const newId = generateId()
        const now = new Date().toISOString()

        const { error } = await supabase
            .from('campaigns')
            .insert({
                id: newId,
                name: `${original.name} (Cópia)`,
                status: CampaignStatus.DRAFT,
                template_name: original.templateName,
                template_variables: original.templateVariables,  // ← CORRIGIDO: Copiar variáveis do template
                total_recipients: original.recipients,
                sent: 0,
                delivered: 0,
                read: 0,
                skipped: 0,
                failed: 0,
                created_at: now,
            })

        if (error) throw error

        // Copy campaign contacts
        const { data: existingContacts } = await supabase
            .from('campaign_contacts')
            .select('contact_id, phone, name, custom_fields')
            .eq('campaign_id', id)

        if (existingContacts && existingContacts.length > 0) {
            const newContacts = existingContacts.map(c => ({
                id: generateId(),
                campaign_id: newId,
                contact_id: c.contact_id,
                phone: c.phone,
                name: c.name,
                custom_fields: (c as any).custom_fields || {},
                status: 'pending',
            }))

            await supabase.from('campaign_contacts').insert(newContacts)
        }

        return campaignDb.getById(newId)
    },

    updateStatus: async (id: string, updates: Partial<Campaign>): Promise<Campaign | undefined> => {
        const updateData: Record<string, unknown> = {}

        if (updates.status !== undefined) updateData.status = updates.status
        if (updates.sent !== undefined) updateData.sent = updates.sent
        if (updates.delivered !== undefined) updateData.delivered = updates.delivered
        if (updates.read !== undefined) updateData.read = updates.read
        if (updates.skipped !== undefined) updateData.skipped = updates.skipped
        if (updates.failed !== undefined) updateData.failed = updates.failed
        if (updates.completedAt !== undefined) updateData.completed_at = updates.completedAt
        if (updates.startedAt !== undefined) updateData.started_at = updates.startedAt
        if (updates.templateSnapshot !== undefined) updateData.template_snapshot = updates.templateSnapshot
        if (updates.templateSpecHash !== undefined) updateData.template_spec_hash = updates.templateSpecHash
        if (updates.templateParameterFormat !== undefined) updateData.template_parameter_format = updates.templateParameterFormat
        if (updates.templateFetchedAt !== undefined) updateData.template_fetched_at = updates.templateFetchedAt

        updateData.updated_at = new Date().toISOString()

        const { error } = await supabase
            .from('campaigns')
            .update(updateData)
            .eq('id', id)

        if (error) throw error

        return campaignDb.getById(id)
    },

    pause: async (id: string): Promise<Campaign | undefined> => {
        return campaignDb.updateStatus(id, { status: CampaignStatus.PAUSED })
    },

    resume: async (id: string): Promise<Campaign | undefined> => {
        return campaignDb.updateStatus(id, {
            status: CampaignStatus.SENDING,
            startedAt: new Date().toISOString()
        })
    },

    start: async (id: string): Promise<Campaign | undefined> => {
        return campaignDb.updateStatus(id, {
            status: CampaignStatus.SENDING,
            startedAt: new Date().toISOString()
        })
    },
}

// ============================================================================
// CONTACTS
// ============================================================================

export const contactDb = {
    getAll: async (): Promise<Contact[]> => {
        const { data, error } = await supabase
            .from('contacts')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        return (data || []).map(row => ({
            id: row.id,
            name: row.name,
            phone: row.phone,
            email: row.email,
            status: (row.status as ContactStatus) || ContactStatus.OPT_IN,
            tags: row.tags || [],
            lastActive: row.updated_at
                ? new Date(row.updated_at).toLocaleDateString()
                : (row.created_at ? new Date(row.created_at).toLocaleDateString() : '-'),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            custom_fields: row.custom_fields,
        }))
    },

    getById: async (id: string): Promise<Contact | undefined> => {
        const { data, error } = await supabase
            .from('contacts')
            .select('*')
            .eq('id', id)
            .single()

        if (error || !data) return undefined

        return {
            id: data.id,
            name: data.name,
            phone: data.phone,
            status: (data.status as ContactStatus) || ContactStatus.OPT_IN,
            tags: data.tags || [],
            lastActive: data.updated_at
                ? new Date(data.updated_at).toLocaleDateString()
                : (data.created_at ? new Date(data.created_at).toLocaleDateString() : '-'),
            createdAt: data.created_at,
            updatedAt: data.updated_at,
            custom_fields: data.custom_fields,
        }
    },

    add: async (contact: Omit<Contact, 'id' | 'lastActive'>): Promise<Contact> => {
        // Check if contact already exists by phone
        const { data: existing } = await supabase
            .from('contacts')
            .select('*')
            .eq('phone', contact.phone)
            .single()

        const now = new Date().toISOString()

        if (existing) {
            // Update existing contact
            const updateData: any = {
                updated_at: now
            }

            if (contact.name) updateData.name = contact.name
            if (contact.email !== undefined) updateData.email = contact.email
            if (contact.status) updateData.status = contact.status
            if (contact.tags) updateData.tags = contact.tags
            if (contact.custom_fields) updateData.custom_fields = contact.custom_fields

            const { error: updateError } = await supabase
                .from('contacts')
                .update(updateData)
                .eq('id', existing.id)

            if (updateError) throw updateError

            return {
                id: existing.id,
                name: contact.name || existing.name,
                phone: existing.phone,
                email: contact.email ?? existing.email,
                status: (contact.status || existing.status) as ContactStatus,
                tags: contact.tags || existing.tags || [],
                custom_fields: contact.custom_fields || existing.custom_fields || {},
                lastActive: 'Agora mesmo',
                createdAt: existing.created_at,
                updatedAt: now,
            }
        }

        // Create new contact
        const id = generateId()

        const { error } = await supabase
            .from('contacts')
            .insert({
                id,
                name: contact.name || '',
                phone: contact.phone,
                email: contact.email || null,
                status: contact.status || ContactStatus.OPT_IN,
                tags: contact.tags || [],
                custom_fields: contact.custom_fields || {},
                created_at: now,
            })

        if (error) throw error

        return {
            ...contact,
            id,
            lastActive: 'Agora mesmo',
            createdAt: now,
            updatedAt: now,
        }
    },

    update: async (id: string, data: Partial<Contact>): Promise<Contact | undefined> => {
        const updateData: Record<string, unknown> = {}

        if (data.name !== undefined) updateData.name = data.name
        if (data.phone !== undefined) updateData.phone = data.phone
        if (data.email !== undefined) updateData.email = data.email
        if (data.status !== undefined) updateData.status = data.status
        if (data.tags !== undefined) updateData.tags = data.tags
        if (data.custom_fields !== undefined) updateData.custom_fields = data.custom_fields

        updateData.updated_at = new Date().toISOString()

        const { error } = await supabase
            .from('contacts')
            .update(updateData)
            .eq('id', id)

        if (error) throw error

        return contactDb.getById(id)
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('contacts')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    deleteMany: async (ids: string[]): Promise<number> => {
        if (ids.length === 0) return 0

        const { error } = await supabase
            .from('contacts')
            .delete()
            .in('id', ids)

        if (error) throw error

        return ids.length
    },

    import: async (contacts: Omit<Contact, 'id' | 'lastActive'>[]): Promise<number> => {
        if (contacts.length === 0) return 0

        const now = new Date().toISOString()
        const rows = contacts.map(contact => ({
            id: generateId(),
            name: contact.name || '',
            phone: contact.phone,
            status: contact.status || ContactStatus.OPT_IN,
            tags: contact.tags || [],
            created_at: now,
        }))

        // Use upsert to handle duplicates (phone is unique)
        const { error } = await supabase
            .from('contacts')
            .upsert(rows, { onConflict: 'phone', ignoreDuplicates: true })

        if (error) throw error

        return rows.length
    },

    getTags: async (): Promise<string[]> => {
        const { data, error } = await supabase
            .from('contacts')
            .select('tags')
            .not('tags', 'is', null)

        if (error) throw error

        const tagSet = new Set<string>()
            ; (data || []).forEach(row => {
                if (Array.isArray(row.tags)) {
                    row.tags.forEach((tag: string) => tagSet.add(tag))
                }
            })

        return Array.from(tagSet).sort()
    },

    getStats: async () => {
        const { data, error } = await supabase
            .from('contacts')
            .select('status')

        if (error) throw error

        const stats = {
            total: data?.length || 0,
            optIn: 0,
            optOut: 0,
        }

            ; (data || []).forEach(row => {
                if (row.status === 'Opt-in') stats.optIn++
                else if (row.status === 'Opt-out') stats.optOut++
            })

        return stats
    },
}

// ============================================================================
// CAMPAIGN CONTACTS (Junction Table)
// ============================================================================

export const campaignContactDb = {
    addContacts: async (
        campaignId: string,
        contacts: { contactId: string, phone: string, name: string, email?: string | null, custom_fields?: Record<string, unknown> }[]
    ): Promise<void> => {
        const rows = contacts.map(contact => ({
            id: generateId(),
            campaign_id: campaignId,
            contact_id: contact.contactId,
            phone: contact.phone,
            name: contact.name,
            email: contact.email || null,
            custom_fields: contact.custom_fields || {},
            status: 'pending',
        }))

        const { error } = await supabase
            .from('campaign_contacts')
            .insert(rows)

        if (error) throw error
    },

    getContacts: async (campaignId: string) => {
        const { data, error } = await supabase
            .from('campaign_contacts')
            .select('*')
            .eq('campaign_id', campaignId)
            .order('sent_at', { ascending: false })

        if (error) throw error

        return (data || []).map(row => ({
            id: row.id,
            campaignId: row.campaign_id,
            contactId: row.contact_id,
            phone: row.phone,
            name: row.name,
            status: row.status,
            messageId: row.message_id,
            sentAt: row.sent_at,
            deliveredAt: row.delivered_at,
            readAt: row.read_at,
            error: row.error,
            custom_fields: (row as any).custom_fields,
        }))
    },

    updateStatus: async (campaignId: string, phone: string, status: string, messageId?: string, error?: string): Promise<void> => {
        const now = new Date().toISOString()
        const updateData: Record<string, unknown> = { status }

        if (messageId) updateData.message_id = messageId
        if (error) updateData.error = error
        if (status === 'sent') updateData.sent_at = now
        if (status === 'delivered') updateData.delivered_at = now
        if (status === 'read') updateData.read_at = now

        const { error: dbError } = await supabase
            .from('campaign_contacts')
            .update(updateData)
            .eq('campaign_id', campaignId)
            .eq('phone', phone)

        if (dbError) throw dbError
    },
}

// ============================================================================
// TEMPLATES
// ============================================================================

export const templateDb = {
    getAll: async (): Promise<Template[]> => {
        const { data, error } = await supabase
            .from('templates')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        return (data || []).map(row => ({
            id: row.id,
            name: row.name,
            category: (row.category as TemplateCategory) || 'MARKETING',
            language: row.language,
            status: (row.status as TemplateStatus) || 'PENDING',
            parameterFormat: ((row as any).parameter_format as any) || undefined,
            specHash: (row as any).spec_hash ?? null,
            fetchedAt: (row as any).fetched_at ?? null,
            content: row.components,
            preview: '',
            lastUpdated: row.updated_at || row.created_at,
        }))
    },

    getByName: async (name: string): Promise<Template | undefined> => {
        const { data, error } = await supabase
            .from('templates')
            .select('*')
            .eq('name', name)
            .single()

        if (error || !data) return undefined

        return {
            id: data.id,
            name: data.name,
            category: (data.category as TemplateCategory) || 'MARKETING',
            language: data.language,
            status: (data.status as TemplateStatus) || 'PENDING',
            parameterFormat: ((data as any).parameter_format as any) || undefined,
            specHash: (data as any).spec_hash ?? null,
            fetchedAt: (data as any).fetched_at ?? null,
            content: data.components,
            preview: '',
            lastUpdated: data.updated_at || data.created_at,
        }
    },

    upsert: async (
        input:
            | Template
            | Array<{
                name: string
                language?: string
                category?: string
                status?: string
                components?: unknown
                parameter_format?: 'positional' | 'named' | string
                spec_hash?: string | null
                fetched_at?: string | null
              }>
    ): Promise<void> => {
        const now = new Date().toISOString()

        // Batch upsert (rows already in DB column format)
        if (Array.isArray(input)) {
            const { error } = await supabase
                .from('templates')
                .upsert(
                    input.map(r => ({
                        name: r.name,
                        category: r.category,
                        language: r.language,
                        status: r.status,
                        parameter_format: (r as any).parameter_format,
                        components: r.components,
                        spec_hash: (r as any).spec_hash ?? null,
                        fetched_at: (r as any).fetched_at ?? null,
                        updated_at: now,
                    })),
                    { onConflict: 'name' }
                )
            if (error) throw error
            return
        }

        // Single template upsert (App Template shape)
        const template = input

        const { error } = await supabase
            .from('templates')
            .upsert({
                id: template.id,
                name: template.name,
                category: template.category,
                language: template.language,
                status: template.status,
                parameter_format: (template as any).parameterFormat || 'positional',
                components: typeof template.content === 'string'
                    ? JSON.parse(template.content)
                    : template.content,
                spec_hash: (template as any).specHash ?? null,
                fetched_at: (template as any).fetchedAt ?? null,
                created_at: now,
                updated_at: now,
            }, { onConflict: 'name' })

        if (error) throw error
    },
}

// ============================================================================
// CUSTOM FIELD DEFINITIONS
// ============================================================================

export const customFieldDefDb = {
    getAll: async (entityType: 'contact' | 'deal'): Promise<CustomFieldDefinition[]> => {
        const { data, error } = await supabase
            .from('custom_field_definitions')
            .select('*')
            .eq('entity_type', entityType)
            .order('created_at', { ascending: false })

        if (error) throw error

        return (data || []).map(row => ({
            id: row.id,
            key: row.key,
            label: row.label,
            type: row.type,
            options: row.options,
            entity_type: row.entity_type,
            created_at: row.created_at,
        }))
    },

    create: async (def: Omit<CustomFieldDefinition, 'id' | 'created_at'>): Promise<CustomFieldDefinition> => {
        const id = generateId()
        const now = new Date().toISOString()


        // Fetch organization_id (company_id) from settings
        const { data: orgData } = await supabase.from('settings').select('value').eq('key', 'company_id').single()
        const organization_id = orgData?.value

        const { data, error } = await supabase
            .from('custom_field_definitions')
            .insert({
                id,
                key: def.key,
                label: def.label,
                type: def.type,
                options: def.options,
                entity_type: def.entity_type,
                created_at: now,
                organization_id: organization_id
            })
            .select()
            .single()

        if (error) throw error

        return {
            id: data.id,
            key: data.key,
            label: data.label,
            type: data.type,
            options: data.options,
            entity_type: data.entity_type,
            created_at: data.created_at,
        }
    },

    delete: async (id: string): Promise<void> => {
        const { error, count } = await supabase
            .from('custom_field_definitions')
            .delete({ count: 'exact' })
            .eq('id', id)

        console.log('[DEBUG] Deleting custom field:', { id, count, error });

        if (error) throw error
    },
}

// ============================================================================
// SETTINGS
// ============================================================================

export const settingsDb = {
    get: async (key: string): Promise<string | null> => {
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', key)
            .single()

        if (error || !data) return null
        return data.value
    },

    set: async (key: string, value: string): Promise<void> => {
        const now = new Date().toISOString()

        const { error } = await supabase
            .from('settings')
            .upsert({
                key,
                value,
                updated_at: now,
            }, { onConflict: 'key' })

        if (error) throw error
    },

    getAll: async (): Promise<AppSettings> => {
        const { data, error } = await supabase
            .from('settings')
            .select('key, value')

        if (error) throw error

        const settings: Record<string, string> = {}
            ; (data || []).forEach(row => {
                settings[row.key] = row.value
            })

        return {
            phoneNumberId: settings.phoneNumberId || '',
            businessAccountId: settings.businessAccountId || '',
            accessToken: settings.accessToken || '',
            isConnected: settings.isConnected === 'true',
        }
    },

    saveAll: async (settings: AppSettings): Promise<void> => {
        await settingsDb.set('phoneNumberId', settings.phoneNumberId)
        await settingsDb.set('businessAccountId', settings.businessAccountId)
        await settingsDb.set('accessToken', settings.accessToken)
        await settingsDb.set('isConnected', settings.isConnected ? 'true' : 'false')
    },
}

// ============================================================================
// DASHBOARD
// ============================================================================

export const dashboardDb = {
    getStats: async () => {
        // Get campaign stats with aggregation
        const { data, error } = await supabase
            .from('campaigns')
            .select('sent, delivered, read, failed, status, name, total_recipients')

        if (error) throw error

        let totalSent = 0
        let totalDelivered = 0
        let totalFailed = 0
        let activeCampaigns = 0

            ; (data || []).forEach(row => {
                totalSent += row.sent || 0
                totalDelivered += row.delivered || 0
                totalFailed += row.failed || 0
                if (row.status === 'Enviando' || row.status === 'Agendada') {
                    activeCampaigns++
                }
            })

        const deliveryRate = totalSent > 0
            ? ((totalDelivered / totalSent) * 100).toFixed(1)
            : '100'

        // Get recent campaigns for chart
        const chartData = (data || [])
            .slice(0, 7)
            .map(r => ({
                name: (r.name as string).substring(0, 3),
                sent: r.total_recipients as number,
                read: r.read as number,
            }))
            .reverse()

        return {
            sent24h: totalSent.toLocaleString(),
            deliveryRate: `${deliveryRate}%`,
            activeCampaigns: activeCampaigns.toString(),
            failedMessages: totalFailed.toString(),
            chartData,
        }
    },
}
// ============================================================================
// TEMPLATE PROJECTS (Factory)
// ============================================================================

export const templateProjectDb = {
    getAll: async (): Promise<TemplateProject[]> => {
        const { data, error } = await supabase
            .from('template_projects')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data as TemplateProject[];
    },

    getById: async (id: string): Promise<TemplateProject & { items: TemplateProjectItem[] }> => {
        // Fetch project
        const { data: project, error: projectError } = await supabase
            .from('template_projects')
            .select('*')
            .eq('id', id)
            .single();

        if (projectError) throw projectError;

        // Fetch items
        const { data: items, error: itemsError } = await supabase
            .from('template_project_items')
            .select('*')
            .eq('project_id', id)
            .order('created_at', { ascending: true });

        if (itemsError) throw itemsError;

        return { ...(project as TemplateProject), items: (items as TemplateProjectItem[]) || [] };
    },

    create: async (dto: CreateTemplateProjectDTO): Promise<TemplateProject> => {
        // 1. Create Project
        const { data: project, error: projectError } = await supabase
            .from('template_projects')
            .insert({
                title: dto.title,
                prompt: dto.prompt,
                status: dto.status || 'draft',
                template_count: dto.items.length,
                approved_count: 0
                // user_id is explicitly NOT set here, relying on schema default (null) or logic in API route if needed
                // In this single-tenant app, user_id null is acceptable or could be 'admin'
            })
            .select()
            .single();

        if (projectError) throw projectError;

        // 2. Create Items
        if (dto.items.length > 0) {
            const itemsToInsert = dto.items.map(item => ({
                ...item,
                project_id: project.id
            }));

            const { error: itemsError } = await supabase
                .from('template_project_items')
                .insert(itemsToInsert);

            if (itemsError) {
                console.error('Error creating items:', itemsError);
                throw itemsError;
            }
        }

        return project as TemplateProject;
    },

    delete: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('template_projects')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    updateItem: async (id: string, updates: Partial<TemplateProjectItem>): Promise<TemplateProjectItem> => {
        const { data, error } = await supabase
            .from('template_project_items')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data as TemplateProjectItem;
    },

    deleteItem: async (id: string): Promise<void> => {
        const { error } = await supabase
            .from('template_project_items')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};

