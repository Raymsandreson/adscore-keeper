// Registry of fixed (built-in) fields for the contact form.
// Used by ContactFieldsUnifiedEditor to allow hiding/reordering them
// and by ContactDetailSheet to honor the saved layout.

export type ContactFieldTab =
  | 'info'
  | 'calls'
  | 'history'
  | 'location'
  | 'groups'
  | 'relationships'
  | 'leads'
  | 'ai_chat'
  | string; // also accepts custom tab keys

export interface ContactFieldDef {
  key: string;
  label: string;
  defaultTab: ContactFieldTab;
  defaultOrder: number;
}

export const CONTACT_FIELD_REGISTRY: ContactFieldDef[] = [
  // Info tab
  { key: 'full_name',           label: 'Nome',                 defaultTab: 'info', defaultOrder: 1 },
  { key: 'phone',               label: 'Telefone',             defaultTab: 'info', defaultOrder: 2 },
  { key: 'whatsapp_group_id',   label: 'Grupo WhatsApp',       defaultTab: 'info', defaultOrder: 3 },
  { key: 'email',               label: 'Email',                defaultTab: 'info', defaultOrder: 4 },
  { key: 'instagram_username',  label: 'Instagram',            defaultTab: 'info', defaultOrder: 5 },
  { key: 'follower_status',     label: 'Status Seguidor',      defaultTab: 'info', defaultOrder: 6 },
  { key: 'profession',          label: 'Profissão (CBO)',      defaultTab: 'info', defaultOrder: 7 },
  { key: 'classifications',     label: 'Relacionamento',       defaultTab: 'info', defaultOrder: 8 },
  { key: 'notes',               label: 'Observações',          defaultTab: 'info', defaultOrder: 9 },

  // Location tab
  { key: 'cep',                 label: 'CEP',                  defaultTab: 'location', defaultOrder: 1 },
  { key: 'state',               label: 'Estado',               defaultTab: 'location', defaultOrder: 2 },
  { key: 'city',                label: 'Cidade',               defaultTab: 'location', defaultOrder: 3 },
  { key: 'neighborhood',        label: 'Bairro',               defaultTab: 'location', defaultOrder: 4 },
  { key: 'street',              label: 'Rua',                  defaultTab: 'location', defaultOrder: 5 },
];

export const CONTACT_FIELDS_BY_KEY: Record<string, ContactFieldDef> =
  Object.fromEntries(CONTACT_FIELD_REGISTRY.map(f => [f.key, f]));
