export interface SettingsTemplate<T = unknown> {
  id: string;
  name: string;
  payload: T;
  updatedAt: number;
}

interface TemplateDocument {
  version: 1;
  items: Record<string, SettingsTemplate[]>;
}

interface TemplateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SettingsTemplateStore {
  list(scope: string): SettingsTemplate[];
  /** Upserts by name within a scope. */
  save(scope: string, name: string, payload: unknown): SettingsTemplate[];
  remove(scope: string, id: string): SettingsTemplate[];
}

/** One store for every settings dialog; scopes keep indicator and chart templates apart. */
export const SETTINGS_TEMPLATES_KEY = 'screener.settingsTemplates.v1';
const LEGACY_INDICATOR_KEY = 'screener.indicatorTemplates.v1';

function emptyDocument(): TemplateDocument {
  return { version: 1, items: {} };
}

function isTemplate(value: unknown): value is SettingsTemplate {
  if (typeof value !== 'object' || value === null) return false;
  const template = value as SettingsTemplate;
  return (
    typeof template.id === 'string' &&
    typeof template.name === 'string' &&
    typeof template.updatedAt === 'number' &&
    'payload' in template
  );
}

function isDocument(value: unknown): value is TemplateDocument {
  if (typeof value !== 'object' || value === null) return false;
  const document = value as TemplateDocument;
  if (document.version !== 1 || typeof document.items !== 'object' || document.items === null) {
    return false;
  }
  return Object.values(document.items).every(
    (list) => Array.isArray(list) && list.every((item) => isTemplate(item)),
  );
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `tpl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createSettingsTemplateStore(
  storage: TemplateStorage,
  key: string = SETTINGS_TEMPLATES_KEY,
): SettingsTemplateStore {
  const load = (): TemplateDocument => {
    const raw = storage.getItem(key);
    if (!raw) return emptyDocument();
    try {
      const parsed: unknown = JSON.parse(raw);
      return isDocument(parsed) ? parsed : emptyDocument();
    } catch {
      return emptyDocument();
    }
  };

  const write = (document: TemplateDocument): void => {
    try {
      storage.setItem(key, JSON.stringify(document));
    } catch {
      /* a circular or oversized payload must not break the dialog */
    }
  };

  return {
    list(scope) {
      return load().items[scope] ?? [];
    },
    save(scope, name, payload) {
      const document = load();
      const list = document.items[scope] ?? [];
      const trimmed = name.trim();
      if (!trimmed || payload === undefined) return list;
      const existing = list.find(
        (template) => template.name.toLowerCase() === trimmed.toLowerCase(),
      );
      const template: SettingsTemplate = {
        id: existing?.id ?? newId(),
        name: trimmed,
        payload,
        updatedAt: Date.now(),
      };
      document.items[scope] = existing
        ? list.map((item) => (item.id === existing.id ? template : item))
        : [...list, template];
      write(document);
      return document.items[scope];
    },
    remove(scope, id) {
      const document = load();
      const next = (document.items[scope] ?? []).filter((template) => template.id !== id);
      if (next.length > 0) document.items[scope] = next;
      else delete document.items[scope];
      write(document);
      return next;
    },
  };
}

export const settingsTemplates = createSettingsTemplateStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
});

/**
 * Fold the first indicator-only store into the shared one. Idempotent: the
 * legacy key is removed once every entry has been copied.
 */
export function migrateLegacyIndicatorTemplates(
  storage: TemplateStorage = window.localStorage,
  target: SettingsTemplateStore = settingsTemplates,
): void {
  const raw = storage.getItem(LEGACY_INDICATOR_KEY);
  if (!raw) return;
  try {
    const document = JSON.parse(raw) as {
      items?: Record<string, Array<{ name?: unknown; inputs?: unknown; props?: unknown }>>;
    };
    for (const [key, list] of Object.entries(document?.items ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item.name !== 'string') continue;
        target.save(`indicator:${key}`, item.name, {
          ...(item.inputs && typeof item.inputs === 'object' ? { inputs: item.inputs } : {}),
          ...(item.props && typeof item.props === 'object' ? { props: item.props } : {}),
        });
      }
    }
    storage.removeItem(LEGACY_INDICATOR_KEY);
  } catch {
    /* leave the legacy payload for the next start */
  }
}
