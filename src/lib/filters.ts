// Deck filters — shared by the client (FiltersModal, Deck) and the server
// (getDeckCards). Keep this file free of server imports so it can live in the
// client bundle.

export type ShowMe = "everyone" | "men" | "women";

export type DeckFilters = {
  tags: string[]; // empty = no tag filter
  soloOnly: boolean;
  hasPhoto: boolean;
  ageMin: number | null;
  ageMax: number | null;
  ageUnspecified: boolean; // include people with no birth year
  showMe: ShowMe;
  genderUnspecified: boolean; // include people with no gender set
  company: string; // substring match; "" = off
  companyUnspecified: boolean; // include people with no company set
};

export const DEFAULT_FILTERS: DeckFilters = {
  tags: [],
  soloOnly: false,
  hasPhoto: false,
  ageMin: null,
  ageMax: null,
  ageUnspecified: true,
  showMe: "everyone",
  genderUnspecified: true,
  company: "",
  companyUnspecified: true,
};

// How many filters are actively narrowing the deck — the hamburger badge.
export function activeFilterCount(f: DeckFilters): number {
  let n = 0;
  if (f.tags.length > 0) n++;
  if (f.soloOnly) n++;
  if (f.hasPhoto) n++;
  if (f.ageMin != null || f.ageMax != null) n++;
  if (f.showMe !== "everyone") n++;
  if (f.company.trim() !== "") n++;
  return n;
}

// localStorage round-trip, tolerant of old/corrupt payloads.
export function loadFilters(eventId: string): DeckFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(`linkmeet:filters:${eventId}`);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) } as DeckFilters;
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(eventId: string, f: DeckFilters) {
  try {
    window.localStorage.setItem(`linkmeet:filters:${eventId}`, JSON.stringify(f));
  } catch {
    // storage full / private mode — filters just won't persist
  }
}
