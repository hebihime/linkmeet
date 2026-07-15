import { customAlphabet } from "nanoid";

// Opaque row ids.
export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

// Human-typable access code — no ambiguous chars (0/O, 1/I/L).
export const newCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 8);

// Short suffix to keep event slugs unique.
const suffix = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

export function makeEventId(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "event";
  return `${base}-${suffix()}`;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
