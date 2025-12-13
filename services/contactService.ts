import { Contact, ContactStatus } from '../types';
import {
  processPhoneNumber
} from '../lib/phone-formatter';
import {
  parseContactsFile,
  parseContactsFromFile,
  generateImportReport,
  type ParseOptions
} from '../lib/csv-parser';
import { logger } from '../lib/logger';

export interface ContactStats {
  total: number;
  optIn: number;
  optOut: number;
}

export interface ImportResult {
  imported: number;
  failed: number;
  duplicates: number;
  report: string;
}

/**
 * Contact Service
 * All data is stored in Main Database (source of truth)
 */
export const contactService = {
  getAll: async (): Promise<Contact[]> => {
    const response = await fetch('/api/contacts');
    if (!response.ok) {
      throw new Error('Falha ao buscar contatos');
    }
    return response.json();
  },

  getById: async (id: string): Promise<Contact | undefined> => {
    const response = await fetch(`/api/contacts/${id}`);
    if (!response.ok) {
      if (response.status === 404) return undefined;
      return undefined;
    }
    return response.json();
  },

  getStats: async (): Promise<ContactStats> => {
    const response = await fetch('/api/contacts/stats');
    if (!response.ok) {
      return { total: 0, optIn: 0, optOut: 0 };
    }
    return response.json();
  },

  getTags: async (): Promise<string[]> => {
    // Tags can be extracted from contacts
    const contacts = await contactService.getAll();
    const allTags = contacts.flatMap(c => c.tags || []);
    return [...new Set(allTags)];
  },

  /**
   * Add a single contact with phone validation
   */
  add: async (contact: Omit<Contact, 'id' | 'lastActive'>): Promise<Contact> => {
    const { normalized, validation } = processPhoneNumber(contact.phone);

    if (!validation.isValid) {
      logger.warn('Invalid phone number rejected', {
        phone: contact.phone,
        error: validation.error
      });
      throw new Error(validation.error || 'Número de telefone inválido');
    }

    const normalizedContact = {
      ...contact,
      phone: normalized,
    };

    const response = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizedContact),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Falha ao adicionar contato');
    }

    logger.info('Contact added', {
      name: contact.name,
      phone: normalized
    });

    return response.json();
  },

  /**
   * Validate a phone number without saving
   */
  validatePhone: (phone: string): { isValid: boolean; error?: string; normalized?: string } => {
    const { normalized, validation } = processPhoneNumber(phone);
    return {
      isValid: validation.isValid,
      error: validation.error,
      normalized: validation.isValid ? normalized : undefined,
    };
  },

  update: async (
    id: string,
    data: (Partial<Omit<Contact, 'id'>> & { email?: string | null })
  ): Promise<Contact | undefined> => {
    if (data.phone) {
      const { normalized, validation } = processPhoneNumber(data.phone);
      if (!validation.isValid) {
        throw new Error(validation.error || 'Número de telefone inválido');
      }
      data.phone = normalized;
    }

    const response = await fetch(`/api/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) return undefined;
    return response.json();
  },

  /**
   * Import contacts from CSV/TXT file content
   */
  importFromContent: async (
    content: string,
    options?: ParseOptions
  ): Promise<ImportResult> => {
    logger.info('Starting contact import', { contentLength: content.length });

    const parseResult = parseContactsFile(content, options);

    if (!parseResult.success) {
      throw new Error('Falha ao processar arquivo');
    }

    const contactsToImport = parseResult.contacts.map(c => ({
      name: c.name || 'Desconhecido',
      phone: c.phone,
      status: ContactStatus.OPT_IN,
      tags: [] as string[],
    }));

    // Import via API
    const response = await fetch('/api/contacts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: contactsToImport }),
    });

    if (!response.ok) {
      throw new Error('Falha ao importar contatos');
    }

    const { imported } = await response.json();

    const result: ImportResult = {
      imported,
      failed: parseResult.invalidRows.length,
      duplicates: parseResult.duplicates.length,
      report: generateImportReport(parseResult),
    };

    logger.info('Contact import completed', { ...result });

    return result;
  },

  /**
   * Import contacts from File object (browser)
   */
  importFromFile: async (
    file: File,
    options?: ParseOptions
  ): Promise<ImportResult> => {
    const parseResult = await parseContactsFromFile(file, options);

    const contactsToImport = parseResult.contacts.map(c => ({
      name: c.name || 'Desconhecido',
      phone: c.phone,
      status: ContactStatus.OPT_IN,
      tags: [] as string[],
    }));

    const response = await fetch('/api/contacts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: contactsToImport }),
    });

    if (!response.ok) {
      throw new Error('Falha ao importar contatos');
    }

    const { imported } = await response.json();

    return {
      imported,
      failed: parseResult.invalidRows.length,
      duplicates: parseResult.duplicates.length,
      report: generateImportReport(parseResult),
    };
  },

  /**
   * Legacy import method (for backward compatibility)
   */
  import: async (contacts: Omit<Contact, 'id' | 'lastActive'>[]): Promise<number> => {
    const validContacts = contacts
      .map(c => {
        const { normalized, validation } = processPhoneNumber(c.phone);
        if (!validation.isValid) return null;
        return { ...c, phone: normalized };
      })
      .filter((c): c is Omit<Contact, 'id' | 'lastActive'> => c !== null);

    logger.info('Legacy import', {
      total: contacts.length,
      valid: validContacts.length
    });

    const response = await fetch('/api/contacts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: validContacts }),
    });

    if (!response.ok) {
      throw new Error('Falha ao importar contatos');
    }

    const { imported } = await response.json();
    return imported;
  },

  delete: async (id: string): Promise<void> => {
    const response = await fetch(`/api/contacts/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Falha ao deletar contato');
    }
  },

  deleteMany: async (ids: string[]): Promise<number> => {
    const response = await fetch('/api/contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Falha ao deletar contatos');
    }

    const { deleted } = await response.json();
    return deleted;
  }
};
