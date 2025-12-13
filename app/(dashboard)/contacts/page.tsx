'use client'

import { useContactsController } from '@/hooks/useContacts'
import { ContactListView } from '@/components/features/contacts/ContactListView'

export default function ContactsPage() {
  const controller = useContactsController()

  return (
    <ContactListView
      contacts={controller.contacts}
      stats={controller.stats}
      tags={controller.tags}
      customFields={controller.customFields}
      onRefreshCustomFields={controller.refreshCustomFields}
      isLoading={controller.isLoading}
      searchTerm={controller.searchTerm}
      onSearchChange={controller.setSearchTerm}
      statusFilter={controller.statusFilter}
      onStatusFilterChange={controller.setStatusFilter}
      tagFilter={controller.tagFilter}
      onTagFilterChange={controller.setTagFilter}
      currentPage={controller.currentPage}
      totalPages={controller.totalPages}
      totalFiltered={controller.totalFiltered}
      onPageChange={controller.setCurrentPage}
      selectedIds={controller.selectedIds}
      onToggleSelect={controller.toggleSelect}
      onToggleSelectAll={controller.toggleSelectAll}
      selectAllGlobal={controller.selectAllGlobal}
      clearSelection={controller.clearSelection}
      isAllSelected={controller.isAllSelected}
      isSomeSelected={controller.isSomeSelected}
      isAddModalOpen={controller.isAddModalOpen}
      setIsAddModalOpen={controller.setIsAddModalOpen}
      isImportModalOpen={controller.isImportModalOpen}
      setIsImportModalOpen={controller.setIsImportModalOpen}
      isEditModalOpen={controller.isEditModalOpen}
      setIsEditModalOpen={controller.setIsEditModalOpen}
      isDeleteModalOpen={controller.isDeleteModalOpen}
      editingContact={controller.editingContact}
      deleteTarget={controller.deleteTarget}
      onAddContact={controller.onAddContact}
      onEditContact={controller.onEditContact}
      onUpdateContact={controller.onUpdateContact}
      onDeleteClick={controller.onDeleteClick}
      onBulkDeleteClick={controller.onBulkDeleteClick}
      onConfirmDelete={controller.onConfirmDelete}
      onCancelDelete={controller.onCancelDelete}
      onImport={controller.onImport}
      isImporting={controller.isImporting}
      isDeleting={controller.isDeleting}
    />
  )
}
