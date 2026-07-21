import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPollState, profileExistsInEvent } from "@/lib/queries";

export const runtime = "nodejs";

// Live poll for the whole event shell: nav badge counts + any new match to
// toast. GET route handlers aren't cached by default, but be explicit — this
// is per-user and must never be served stale. Load scales as
// (concurrent users / poll interval); the client keeps that in check with
// visibility-gating, jitter, and backoff.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const session = await getSession();
  // Same stale-cookie guard as the page gates: a validly-signed session whose
  // profile was deleted (e.g. a DB reset) must not poll against a dangling id.
  if (
    !session?.profileId ||
    session.eventId !== eventId ||
    !(await profileExistsInEvent(session.profileId, eventId))
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const since = req.nextUrl.searchParams.get("since");
  const state = await getPollState(eventId, session.profileId, since);
  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
