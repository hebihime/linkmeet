// Rating + safety-report vocabulary, shared by client UI and server actions.
// Two deliberately separate channels: a positive endorsement (feeds
// reputation) and a safety report (routed to review). Never one star scale.
// Keep this file free of server imports — it lives in the client bundle.

export const POSITIVE_TAGS = [
  { key: "great_conversation", label: "Great conversation" },
  { key: "showed_up", label: "Showed up on time" },
  { key: "helpful", label: "Helpful / made an intro" },
  { key: "professional", label: "Professional" },
] as const;

export const REPORT_REASONS = [
  { key: "no_show", label: "Didn't show up" },
  { key: "disrespect", label: "Rude or disrespectful" },
  { key: "harassment", label: "Harassment" },
  { key: "safety", label: "Made me feel unsafe" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["key"];

export const POSITIVE_KEYS = POSITIVE_TAGS.map((t) => t.key as string);
export const REPORT_KEYS = REPORT_REASONS.map((r) => r.key as string);
