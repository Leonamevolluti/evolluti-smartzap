import { supabase } from '@/lib/supabase'
import { Campaign, CampaignStatus } from '@/types'

export async function getCampaignsServer(): Promise<Campaign[]> {
    const { data, error } = await supabase.from('campaigns')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        console.error('Error fetching campaigns:', error)
        return []
    }

    // Map database columns to Campaign type (same as campaignDb.getAll)
    return (data || []).map(row => ({
        id: row.id,
        name: row.name,
        status: row.status as CampaignStatus,
        templateName: row.template_name,
        templateVariables: row.template_variables as { header: string[], body: string[], buttons?: Record<string, string> } | undefined,
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
}
