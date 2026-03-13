export interface SavedFilterView {
  id: string;
  name: string;
  query: string;
  created_at: string;
}

function isSavedFilterView(value: unknown): value is SavedFilterView {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.query === "string" &&
    typeof record.created_at === "string"
  );
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSavedFilterViews(storageKey: string, legacyKey?: string): SavedFilterView[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(isSavedFilterView).filter((row) => row.query.trim() !== "");
      }
    }
  } catch {
    // ignore parse errors and fallback to legacy key
  }

  if (legacyKey) {
    const legacyQuery = localStorage.getItem(legacyKey);
    if (legacyQuery && legacyQuery.trim()) {
      return [
        {
          id: createId(),
          name: "Last saved view",
          query: legacyQuery,
          created_at: new Date().toISOString(),
        },
      ];
    }
  }
  return [];
}

export function persistSavedFilterViews(storageKey: string, views: SavedFilterView[], legacyKey?: string) {
  localStorage.setItem(storageKey, JSON.stringify(views));
  if (legacyKey) {
    const latestQuery = views[0]?.query || "";
    if (latestQuery) {
      localStorage.setItem(legacyKey, latestQuery);
    } else {
      localStorage.removeItem(legacyKey);
    }
  }
}

export function upsertSavedView(
  existingViews: SavedFilterView[],
  query: string,
  namePrefix: string,
  maxViews = 8
) {
  const cleanQuery = query.trim();
  const deduped = existingViews.filter((view) => view.query !== cleanQuery);
  const nextView: SavedFilterView = {
    id: createId(),
    name: `${namePrefix} ${new Date().toLocaleString()}`,
    query: cleanQuery,
    created_at: new Date().toISOString(),
  };
  return [nextView, ...deduped].slice(0, maxViews);
}

export function buildShareUrl(pathname: string, query: string) {
  const pathWithQuery = `${pathname}${query ? `?${query}` : ""}`;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${pathWithQuery}`;
  }
  return pathWithQuery;
}
