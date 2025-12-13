'use client'

import { useCampaignDetailsController } from '@/hooks/useCampaignDetails'
import { CampaignDetailsView } from '@/components/features/campaigns/CampaignDetailsView'

export default function CampaignDetailsPage() {
  const controller = useCampaignDetailsController()

  return (
    <CampaignDetailsView
      campaign={controller.campaign}
      messages={controller.messages}
      messageStats={controller.messageStats}
      realStats={controller.realStats}
      isLoading={controller.isLoading}
      searchTerm={controller.searchTerm}
      setSearchTerm={controller.setSearchTerm}
      navigate={controller.navigate}
      onPause={controller.onPause}
      onResume={controller.onResume}
      onStart={controller.onStart}
      onResendSkipped={controller.onResendSkipped}
      isResendingSkipped={controller.isResendingSkipped}
      isPausing={controller.isPausing}
      isResuming={controller.isResuming}
      isStarting={controller.isStarting}
      canPause={controller.canPause}
      canResume={controller.canResume}
      canStart={controller.canStart}
      isRealtimeConnected={controller.isRealtimeConnected}
      shouldShowRefreshButton={controller.shouldShowRefreshButton}
      isRefreshing={controller.isRefreshing}
      refetch={controller.refetch}
      filterStatus={controller.filterStatus}
      setFilterStatus={controller.setFilterStatus}
    />
  )
}
