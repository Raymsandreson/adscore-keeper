/**
 * Re-export hub for all WJIA shared utilities.
 * 
 * ARCHITECTURE (refactored):
 * - field-utils.ts       → Field normalization, catalog, resolution, protection
 * - autofill-utils.ts    → Defaults, dates, city/state sync, predefined fields, CEP
 * - zapsign-utils.ts     → ZapSign API: settings, document generation, signer updates
 * - whatsapp-utils.ts    → WhatsApp messaging (send text, split messages)
 * - document-processing.ts → OCR, document classification, base64 conversion
 * - gemini.ts            → Google Gemini AI gateway
 * 
 * All existing imports from this file continue to work unchanged.
 */

// Field utilities
export {
  type TemplateFieldRef,
  normalizeFieldKey,
  hasFieldValue,
  buildTemplateFieldCatalog,
  getFieldLabel,
  resolveTemplateVariable,
  upsertCollectedField,
  computeMissingFields,
  normalizeIncomingField,
  syncNameFields,
  shouldProtectName,
  filterFieldsAgainstTemplate,
  buildCrmContext,
} from "./field-utils.ts";

// Auto-fill utilities
export {
  applyDefaults,
  applyConfiguredPredefinedFields,
  autoFillDates,
  autoSyncCityState,
  lookupCEP,
  reverseLookupCEP,
  extractCEPFromMessage,
  autoFillFromCEP,
} from "./autofill-utils.ts";

// ZapSign utilities
export {
  ZAPSIGN_API_URL,
  DOC_TYPE_LABELS,
  type ZapSignSettings,
  applyZapSignSettings,
  updateSignerSettings,
  filterOnlyAutoFilledData,
  convertImageToPdf,
  generateZapSignDocument,
} from "./zapsign-utils.ts";

// WhatsApp messaging
export { sendWhatsApp, sendWhatsAppAudio, resolveVoiceId } from "./whatsapp-utils.ts";

// Document processing (OCR, classification)
export {
  urlToBase64DataUri,
  classifyDocument,
  extractFromDocuments,
} from "./document-processing.ts";

// Alias resolver (deterministic field mapping)
export {
  type FieldAlias,
  type ResolvedField,
  loadFieldAliases,
  resolveFieldByKeyword,
  extractValueByPattern,
  validateFieldValue,
  resolveIncomingFieldWithAliases,
  autoSeedAliasesFromCatalog,
  normalizeProfessionToCBO,
} from "./alias-resolver.ts";
