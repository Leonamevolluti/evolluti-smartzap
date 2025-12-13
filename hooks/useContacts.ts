import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { contactService } from '../services';
import { Contact, ContactStatus } from '../types';
import { customFieldService } from '../services/customFieldService';
import { getSupabaseBrowser } from '../lib/supabase';

const ITEMS_PER_PAGE = 10;

const deriveTagsFromContacts = (contacts: Contact[]) => {
  const allTags = contacts.flatMap((c) => c.tags || []);
  return [...new Set(allTags)].sort((a, b) => a.localeCompare(b));
};

const normalizeEmailForUpdate = (email?: string | null) => {
  const trimmed = (email ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeCustomFieldsForUpdate = (fields?: Record<string, any>) => {
  if (!fields) return fields;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out;
};

const mapContactsRowToContact = (row: any): Contact => {
  const createdAt = row?.created_at ?? row?.createdAt ?? new Date().toISOString();
  const updatedAt = row?.updated_at ?? row?.updatedAt ?? null;
  const lastActive = updatedAt
    ? new Date(updatedAt).toLocaleDateString()
    : (createdAt ? new Date(createdAt).toLocaleDateString() : '-');

  return {
    id: String(row?.id ?? ''),
    name: row?.name ?? '',
    phone: row?.phone ?? '',
    email: row?.email ?? null,
    status: (row?.status as ContactStatus) || ContactStatus.OPT_IN,
    tags: row?.tags || [],
    lastActive,
    createdAt,
    updatedAt: updatedAt ?? undefined,
    custom_fields: row?.custom_fields ?? row?.customFields ?? {},
  };
};

export const useContactsController = () => {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  // Em alguns ambientes de teste o mock pode retornar null/undefined.
  const editFromUrl = (searchParams as any)?.get?.('edit') as string | null;

  // UI State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContactStatus | 'ALL'>('ALL');
  const [tagFilter, setTagFilter] = useState<string>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'single' | 'bulk'; id?: string } | null>(null);

  // Import State
  const [importReport, setImportReport] = useState<string | null>(null);

  // --- Queries ---
  const contactsQuery = useQuery({
    queryKey: ['contacts'],
    queryFn: contactService.getAll,
    staleTime: 30 * 1000,  // 30 segundos
    select: (data) => {
      const normalized: Record<string, Contact> = {};
      data.forEach(c => normalized[c.id] = c);
      return { list: data, byId: normalized };
    }
  });

  // Deep-link: /contacts?edit=<id> abre o modal de edição do contato.
  useEffect(() => {
    if (!editFromUrl) return;
    const byId = contactsQuery.data?.byId;
    const contact = byId?.[editFromUrl];
    if (!contact) return;

    setEditingContact(contact);
    setIsEditModalOpen(true);
  }, [editFromUrl, contactsQuery.data]);

  const statsQuery = useQuery({
    queryKey: ['contactStats'],
    queryFn: contactService.getStats,
    staleTime: 60 * 1000
  });

  const tags = useMemo(() => {
    const list = contactsQuery.data?.list || [];
    return deriveTagsFromContacts(list);
  }, [contactsQuery.data?.list]);

  const customFieldsQuery = useQuery({
    queryKey: ['customFields'],
    queryFn: () => customFieldService.getAll(),
    staleTime: 60 * 1000
  });

  const refreshCustomFields = () => {
    queryClient.invalidateQueries({ queryKey: ['customFields'] });
  };

  // --- Realtime Subscription ---
  useEffect(() => {
    const supabaseClient = getSupabaseBrowser();
    if (!supabaseClient) return;

    const channel = supabaseClient
      .channel('contacts-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        (payload: any) => {
          const eventType = payload?.eventType ?? payload?.type;
          const newRow = payload?.new ?? null;
          const oldRow = payload?.old ?? null;

          if (eventType === 'DELETE') {
            const id = oldRow?.id;
            if (id) {
              queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
                if (!current) return current;
                return current.filter((c) => c.id !== id);
              });
              queryClient.removeQueries({ queryKey: ['contact', id], exact: true });
            }
            // Stats: melhor invalidar (depende do backend e filtros)
            queryClient.invalidateQueries({ queryKey: ['contactStats'] });
            return;
          }

          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            if (!newRow?.id) {
              // Payload inesperado: fallback para consistência.
              queryClient.invalidateQueries({ queryKey: ['contacts'] });
              queryClient.invalidateQueries({ queryKey: ['contactStats'] });
              return;
            }

            const incoming = mapContactsRowToContact(newRow);

            queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
              if (!current) return current;
              const idx = current.findIndex((c) => c.id === incoming.id);
              if (idx >= 0) {
                const next = [...current];
                next[idx] = incoming;
                return next;
              }
              // Mantém o comportamento do GET (created_at desc): inserções novas entram no topo.
              return [incoming, ...current];
            });

            // Se alguma tela tiver cache do detalhe, atualiza também.
            queryClient.setQueryData(['contact', incoming.id], incoming);

            // Stats: invalidar é suficiente e barato.
            queryClient.invalidateQueries({ queryKey: ['contactStats'] });
            return;
          }

          // Outros eventos (ou eventType inesperado)
          queryClient.invalidateQueries({ queryKey: ['contacts'] });
          queryClient.invalidateQueries({ queryKey: ['contactStats'] });
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [queryClient]);

  // --- Mutations ---
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
    queryClient.invalidateQueries({ queryKey: ['contactStats'] });
  };

  const addMutation = useMutation({
    mutationFn: contactService.add,
    onMutate: async (newContact) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previous = queryClient.getQueryData<Contact[]>(['contacts']);

      const tempId = `temp-${Date.now()}`;
      const optimistic: Contact = {
        id: tempId,
        name: newContact.name,
        phone: newContact.phone,
        email: newContact.email ?? null,
        status: newContact.status,
        tags: newContact.tags || [],
        lastActive: 'Agora mesmo',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        custom_fields: newContact.custom_fields || {},
      };

      queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
        if (!current) return current;
        return [optimistic, ...current];
      });

      return { previous, tempId };
    },
    onSuccess: (created, _vars, context) => {
      // Reconciliar o tempId com o contato real
      if (context?.tempId) {
        queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
          if (!current) return current;
          return current.map((c) => (c.id === context.tempId ? created : c));
        });
      }

      // Stats dependem do backend, mas já invalidamos para consistência.
      queryClient.invalidateQueries({ queryKey: ['contactStats'] });

      setIsAddModalOpen(false);
      toast.success('Contato adicionado com sucesso!');
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['contacts'], context.previous);
      toast.error(error.message || 'Erro ao adicionar contato');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Contact, 'id'>> }) =>
      contactService.update(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previous = queryClient.getQueryData<Contact[]>(['contacts']);

      queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
        if (!current) return current;
        return current.map((c) => (c.id === id ? ({ ...c, ...data } as Contact) : c));
      });

      return { previous };
    },
    onSuccess: (updated) => {
      // Se o backend devolveu o contato completo, aplica no cache.
      if (updated) {
        queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
          if (!current) return current;
          return current.map((c) => (c.id === updated.id ? updated : c));
        });
      }

      invalidateAll();
      setIsEditModalOpen(false);
      setEditingContact(null);
      toast.success('Contato atualizado com sucesso!');
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['contacts'], context.previous);
      toast.error(error.message || 'Erro ao atualizar contato');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: contactService.delete,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previous = queryClient.getQueryData<Contact[]>(['contacts']);

      queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
        if (!current) return current;
        return current.filter((c) => c.id !== id);
      });

      return { previous };
    },
    onSuccess: () => {
      invalidateAll();
      setIsDeleteModalOpen(false);
      setDeleteTarget(null);
      toast.success('Contato excluído com sucesso!');
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['contacts'], context.previous);
      toast.error(error.message || 'Erro ao excluir contato');
    }
  });

  const deleteManyMutation = useMutation({
    mutationFn: contactService.deleteMany,
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ['contacts'] });
      const previous = queryClient.getQueryData<Contact[]>(['contacts']);
      const idsSet = new Set(ids);

      queryClient.setQueryData<Contact[]>(['contacts'], (current) => {
        if (!current) return current;
        return current.filter((c) => !idsSet.has(c.id));
      });

      return { previous };
    },
    onSuccess: (count) => {
      invalidateAll();
      setSelectedIds(new Set());
      setIsDeleteModalOpen(false);
      setDeleteTarget(null);
      toast.success(`${count} contatos excluídos com sucesso!`);
    },
    onError: (error: any, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['contacts'], context.previous);
      toast.error(error.message || 'Erro ao excluir contatos');
    }
  });

  const importMutation = useMutation({
    mutationFn: contactService.import,
    onSuccess: (count) => {
      invalidateAll();
      toast.success(`${count} contatos importados com sucesso!`);
    },
    onError: () => toast.error('Erro ao importar contatos')
  });

  // New: Import from file with validation report
  const importFromFileMutation = useMutation({
    mutationFn: (file: File) => contactService.importFromFile(file),
    onSuccess: (result) => {
      invalidateAll();
      setImportReport(result.report);
      if (result.imported > 0) {
        toast.success(`${result.imported} contatos importados!`);
      }
      if (result.failed > 0) {
        toast.warning(`${result.failed} contatos inválidos (ver relatório)`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao importar contatos');
    }
  });

  // --- Filtering & Pagination Logic ---
  const filteredContacts = useMemo(() => {
    if (!contactsQuery.data?.list) return [];

    return contactsQuery.data.list.filter(c => {
      // Search filter
      const matchesSearch =
        (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone.includes(searchTerm);

      // Status filter
      const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;

      // Tag filter
      const matchesTag = tagFilter === 'ALL' || c.tags.includes(tagFilter);

      return matchesSearch && matchesStatus && matchesTag;
    });
  }, [contactsQuery.data, searchTerm, statusFilter, tagFilter]);

  const paginatedContacts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return filteredContacts.slice(start, end);
  }, [filteredContacts, currentPage]);

  const totalPages = Math.ceil(filteredContacts.length / ITEMS_PER_PAGE);

  // Reset page when filters change
  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (status: ContactStatus | 'ALL') => {
    setStatusFilter(status);
    setCurrentPage(1);
  };

  const handleTagFilterChange = (tag: string) => {
    setTagFilter(tag);
    setCurrentPage(1);
  };

  // --- Selection Logic ---
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    // If standard "visible page" select is active, toggle it
    if (selectedIds.size === paginatedContacts.length && selectedIds.size > 0 && selectedIds.size < filteredContacts.length) {
      setSelectedIds(new Set()); // Deselect all
    } else if (selectedIds.size === filteredContacts.length) {
      setSelectedIds(new Set()); // Deselect all
    } else {
      // Standard behavior: Select current page
      setSelectedIds(new Set(paginatedContacts.map(c => c.id)));
    }
  };

  const selectAllGlobal = () => {
    setSelectedIds(new Set(filteredContacts.map(c => c.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const isAllSelected = paginatedContacts.length > 0 && selectedIds.size === paginatedContacts.length;
  const isSomeSelected = selectedIds.size > 0;

  // --- Handlers ---
  const handleAddContact = (contact: { name: string; phone: string; email?: string; tags: string; custom_fields?: Record<string, any> }) => {
    if (!contact.phone) {
      toast.error('Telefone é obrigatório');
      return;
    }

    // Validate phone before submitting
    const validation = contactService.validatePhone(contact.phone);
    if (!validation.isValid) {
      toast.error(validation.error || 'Número de telefone inválido');
      return;
    }

    addMutation.mutate({
      name: contact.name || 'Desconhecido',
      phone: contact.phone,
      email: contact.email || undefined,
      status: ContactStatus.OPT_IN,
      tags: contact.tags.split(',').map(t => t.trim()).filter(t => t),
      custom_fields: contact.custom_fields
    });
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setIsEditModalOpen(true);
  };

  const handleUpdateContact = (data: { name: string; phone: string; email?: string; tags: string; status: ContactStatus; custom_fields?: Record<string, any> }) => {
    if (!editingContact) return;
    updateMutation.mutate({
      id: editingContact.id,
      data: {
        name: data.name,
        phone: data.phone,
        // Para “apagar” email, precisamos enviar null (undefined não altera no banco)
        email: normalizeEmailForUpdate(data.email),
        status: data.status,
        tags: data.tags.split(',').map(t => t.trim()).filter(t => t),
        custom_fields: sanitizeCustomFieldsForUpdate(data.custom_fields)
      }
    });
  };

  const handleDeleteClick = (id: string) => {
    setDeleteTarget({ type: 'single', id });
    setIsDeleteModalOpen(true);
  };

  const handleBulkDeleteClick = () => {
    if (selectedIds.size === 0) return;
    setDeleteTarget({ type: 'bulk' });
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'single' && deleteTarget.id) {
      deleteMutation.mutate(deleteTarget.id);
    } else if (deleteTarget.type === 'bulk') {
      deleteManyMutation.mutate(Array.from(selectedIds));
    }
  };

  const handleCancelDelete = () => {
    setIsDeleteModalOpen(false);
    setDeleteTarget(null);
  };

  return {
    // Data
    contacts: paginatedContacts,
    allFilteredContacts: filteredContacts,
    stats: statsQuery.data || { total: 0, optIn: 0, optOut: 0 },
    tags,
    customFields: customFieldsQuery.data || [],
    isLoading: contactsQuery.isLoading || statsQuery.isLoading || customFieldsQuery.isLoading,

    refreshCustomFields,

    // Filters
    searchTerm,
    setSearchTerm: handleSearchChange,
    statusFilter,
    setStatusFilter: handleStatusFilterChange,
    tagFilter,
    setTagFilter: handleTagFilterChange,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    totalFiltered: filteredContacts.length,
    itemsPerPage: ITEMS_PER_PAGE,

    // Selection
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    selectAllGlobal,
    clearSelection,
    isAllSelected,
    isSomeSelected,

    // Modals
    isAddModalOpen,
    setIsAddModalOpen,
    isImportModalOpen,
    setIsImportModalOpen,
    isEditModalOpen,
    setIsEditModalOpen,
    isDeleteModalOpen,
    editingContact,
    deleteTarget,

    // Actions
    onAddContact: handleAddContact,
    onEditContact: handleEditContact,
    onUpdateContact: handleUpdateContact,
    onDeleteClick: handleDeleteClick,
    onBulkDeleteClick: handleBulkDeleteClick,
    onConfirmDelete: handleConfirmDelete,
    onCancelDelete: handleCancelDelete,
    onImport: importMutation.mutateAsync,
    onImportFile: importFromFileMutation.mutateAsync,
    isImporting: importMutation.isPending || importFromFileMutation.isPending,
    isDeleting: deleteMutation.isPending || deleteManyMutation.isPending,

    // Import report
    importReport,
    clearImportReport: () => setImportReport(null),
  };
};
