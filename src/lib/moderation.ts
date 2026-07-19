// Content safety filter for card-visible free text (name, headline, company,
// tags). Two layers behind stable exported signatures (still swappable for an
// LLM pass later):
//
//  1. `obscenity` — maintained English profanity engine with years of
//     false-positive hardening (leetspeak, confusables, boundary/whitelist
//     handling). Two preset phrases are removed as policy: "sex" (blocks
//     real professionals — sex therapist, sextech founder) and "cum"
//     ("summa cum laude" on a headline is a real thing at cons).
//  2. A curated supplemental list — terms the preset lacks (hate/violence,
//     "kys", "onlyfans", extra slurs) plus a spaced-single-letter rejoin
//     pass ("f.u.c.k", "k y s") the engine doesn't catch.
//
// Matching is token/boundary aware, never raw substrings — "Scunthorpe",
// "analytics", "raccoon" pass. Reject-with-message, so nothing silently
// half-saves.
//
// ⚠ EXTRA_TERMS and the policy removals are judgment calls — review before
// changing.

import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  pattern,
} from "obscenity";

// Terms the english preset doesn't cover (stored normalized: lowercase,
// leetspeak resolved). Also used by the spaced-letter rejoin pass.
const EXTRA_TERMS = [
  // violence / hate
  "nazi", "hitler", "kkk", "heil", "rapist", "molest", "molester",
  "pedophile", "pedo", "kys",
  // slurs the preset lacks
  "paki", "wetback", "beaner", "towelhead", "raghead", "spic",
  // harassment / sexual
  "skank", "nudes", "onlyfans", "porno", "rimjob", "gangbang", "deepthroat",
];

// obscenity's `pattern` is a template tag; wrap it so we can build patterns
// from plain strings. `|` = word boundary in its pattern syntax.
const rawPattern = (s: string) =>
  pattern({ raw: [s] } as unknown as TemplateStringsArray);

const dataset = new DataSet<{ originalWord: string }>()
  .addAll(englishDataset)
  .removePhrasesIf((p) => {
    const word = (p.metadata as { originalWord?: string } | undefined)
      ?.originalWord;
    return word === "sex" || word === "cum"; // policy removals, see header
  });
for (const term of EXTRA_TERMS) {
  dataset.addPhrase((p) =>
    p.setMetadata({ originalWord: term }).addPattern(rawPattern(`|${term}|`)),
  );
}

const matcher = new RegExpMatcher({
  ...dataset.build(),
  ...englishRecommendedTransformers,
});

// ---- Layer 2: spaced-letter evasions ("f.u.c.k", "k y s") -------------------

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "+": "t",
};

// Core spelled-out terms for the rejoin pass (the engine covers these in
// normal text; this set only backstops the letter-by-letter evasion).
const REJOIN_TERMS = new Set([
  ...EXTRA_TERMS,
  "fuck", "cunt", "cock", "dick", "pussy", "bitch", "whore", "slut",
  "asshole", "faggot", "fag", "nigger", "nigga", "kike", "chink", "tranny",
  "retard", "porn", "rape",
]);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/[0134578@$!+]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function spacedLetterMatch(text: string): string | null {
  const tokens = normalize(text).split(" ").filter(Boolean);
  let run = "";
  for (const token of [...tokens, ""]) {
    if (token.length === 1) {
      run += token;
      continue;
    }
    if (run.length > 1 && REJOIN_TERMS.has(run)) return run;
    run = "";
  }
  return null;
}

/** Returns the matched term, or null if the text is clean. */
export function containsUnsafe(text: string): string | null {
  const matches = matcher.getAllMatches(text, true);
  if (matches.length > 0) {
    const { phraseMetadata } = dataset.getPayloadWithPhraseMetadata(matches[0]);
    return phraseMetadata?.originalWord ?? "that term";
  }
  return spacedLetterMatch(text);
}

// Terms we deliberately allow in professional free text (a "sex therapist"
// headline, "summa cum laude") but NOT as a bare interest tag, where there's
// no surrounding context to make them legitimate. Re-blocks exactly the two
// phrases removed from the preset above, at the tag level only.
const TAG_ONLY_TERMS = new Set(["sex", "cum"]);

/** Stricter than `containsUnsafe`: also blocks the context-free tag terms. */
export function tagUnsafe(tag: string): string | null {
  const general = containsUnsafe(tag);
  if (general) return general;
  for (const token of normalize(tag).split(" ")) {
    if (TAG_ONLY_TERMS.has(token)) return token;
  }
  return null;
}

export function filterTags(tags: string[]): {
  clean: string[];
  rejected: string[];
} {
  const clean: string[] = [];
  const rejected: string[] = [];
  for (const tag of tags) (tagUnsafe(tag) ? rejected : clean).push(tag);
  return { clean, rejected };
}

/**
 * Check every card-visible field at once. Returns the first offending field
 * for a reject-with-message flow (silent stripping would make users think a
 * tag saved when it didn't).
 */
export function checkProfileText(fields: {
  name: string;
  headline?: string | null;
  company?: string | null;
  tags: string[];
}): { field: string; term: string } | null {
  const checks: [string, string][] = [
    ["name", fields.name],
    ["headline", fields.headline ?? ""],
    ["company", fields.company ?? ""],
    ...fields.tags.map((t): [string, string] => ["tags", t]),
  ];
  for (const [field, text] of checks) {
    // Tags are held to the stricter, context-free standard.
    const term = field === "tags" ? tagUnsafe(text) : containsUnsafe(text);
    if (term) return { field, term };
  }
  return null;
}
