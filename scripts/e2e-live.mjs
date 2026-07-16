// Live HTTP verification of v2 against a running server + real Neon.
// Seeds a live event and a future event, mints a real session cookie, and
// checks every screen renders the right data and the starts_at gate holds.
import postgres from "postgres";
import { SignJWT } from "jose";

const BASE = process.env.BASE_URL ?? "http://localhost:3999";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
const id = (p = "") => p + Math.random().toString(36).slice(2, 12);

let ok = true;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) ok = false;
};

async function cookieFor(payload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
  return `lm_session=${token}`;
}

async function get(path, cookie) {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

const liveEvent = `e2e-live-${id()}`;
const futureEvent = `e2e-future-${id()}`;

try {
  // Wait for the server.
  let up = false;
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(BASE);
      if (r.status < 500) { up = true; break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`server at ${BASE} never came up`);

  // ---- seed: live event with me + testers + a request + a connection --------
  await sql`insert into events (id, name, starts_at) values
    (${liveEvent}, ${"E2E Live Con"}, now() - interval '1 hour'),
    (${futureEvent}, ${"E2E Future Con"}, now() + interval '2 days')`;

  const person = (event_id, email, name, extra = {}) => ({
    id: id(), event_id, email, name,
    headline: null, tags: [], solo: false, is_test: false, ...extra,
  });
  const me = person(liveEvent, "me@e2e.test", "JP Tester", { tags: ["AI", "coffee"], solo: true });
  const tess = person(liveEvent, "t1@e2e.test", "Tess Deckcard", { headline: "Robotics engineer", tags: ["AI", "robotics"], solo: true, is_test: true });
  const rex = person(liveEvent, "t2@e2e.test", "Rex Requester", { tags: ["coffee"], is_test: true });
  const cam = person(liveEvent, "t3@e2e.test", "Cam Connected", { is_test: true });
  const futureMe = person(futureEvent, "me@e2e.test", "JP Tester", { tags: ["AI"], solo: true });
  await sql`insert into profiles ${sql([me, tess, rex, cam, futureMe])}`;

  await sql`insert into intents (id, event_id, from_id, to_id, kind, status)
    values (${id()}, ${liveEvent}, ${rex.id}, ${me.id}, 'meet', 'pending')`;

  const [a, b] = me.id < cam.id ? [me.id, cam.id] : [cam.id, me.id];
  const connId = id();
  await sql`insert into connections (id, event_id, profile_a, profile_b, origin)
    values (${connId}, ${liveEvent}, ${a}, ${b}, 'link')`;
  await sql`insert into messages (id, connection_id, sender_id, body)
    values (${id()}, ${connId}, ${cam.id}, ${"hello from Cam"})`;

  const cookie = await cookieFor({ eventId: liveEvent, email: me.email, profileId: me.id });
  const futureCookie = await cookieFor({ eventId: futureEvent, email: futureMe.email, profileId: futureMe.id });

  // ---- checks -----------------------------------------------------------------
  const noAuth = await get(`/${liveEvent}/explore`);
  check("unauthenticated /explore redirects to login", noAuth.status >= 300 && noAuth.status < 400 && (noAuth.headers.get("location") ?? "").endsWith(`/${liveEvent}`));

  const explore = await get(`/${liveEvent}/explore`, cookie);
  const exploreHtml = await explore.text();
  check("Explore renders", explore.status === 200);
  // JSX text nodes are comment-separated in the HTML, so match loosely.
  check("Explore shows signup counter", /attendee/.test(exploreHtml) && exploreHtml.includes("joined") && exploreHtml.includes("E2E Live Con"));
  check("Explore shows shared-tag stat", exploreHtml.includes("AI"));
  check("Explore shows solo stat", exploreHtml.includes("solo"));
  check("Explore shows Connect-is-live CTA", exploreHtml.includes("Connect is live"));

  const connect = await get(`/${liveEvent}/connect`, cookie);
  const connectHtml = await connect.text();
  check("Connect (deck) renders when live", connect.status === 200);
  check("Deck has a prefetched card server-side", connectHtml.includes("Tess Deckcard"));
  check("Deck excludes existing connection", !connectHtml.includes("Cam Connected"));
  check("Deck excludes pending requester? (should still show — no intent FROM me)", connectHtml.includes("Rex Requester"));

  const requests = await get(`/${liveEvent}/requests`, cookie);
  const requestsHtml = await requests.text();
  check("Requests inbox renders", requests.status === 200);
  check("Requests shows pending sender", requestsHtml.includes("Rex Requester"));
  check("Requests shows intent kind badge", requestsHtml.toLowerCase().includes("meet"));

  const chats = await get(`/${liveEvent}/chats`, cookie);
  const chatsHtml = await chats.text();
  check("Chats list renders", chats.status === 200);
  check("Chats lists the connection", chatsHtml.includes("Cam Connected"));
  check("Chats previews last message", chatsHtml.includes("hello from Cam"));

  const thread = await get(`/${liveEvent}/chats/${connId}`, cookie);
  const threadHtml = await thread.text();
  check("Thread renders", thread.status === 200);
  check("Thread shows the message", threadHtml.includes("hello from Cam"));
  check("Thread has the We met button", threadHtml.includes("We met"));

  const profile = await get(`/${liveEvent}/profile`, cookie);
  const profileHtml = await profile.text();
  check("Profile renders with existing data", profile.status === 200 && profileHtml.includes("JP Tester"));
  check("Profile has solo checkbox", profileHtml.includes("attending solo"));

  const futureExplore = await get(`/${futureEvent}/explore`, futureCookie);
  const futureHtml = await futureExplore.text();
  check("Pre-event Explore shows countdown", futureExplore.status === 200 && futureHtml.includes("Connect opens in"));
  check("Pre-event Explore hides live CTA", !futureHtml.includes("Connect is live"));

  const futureConnect = await get(`/${futureEvent}/connect`, futureCookie);
  check("Pre-event Connect redirects to Explore", futureConnect.status >= 300 && futureConnect.status < 400 && (futureConnect.headers.get("location") ?? "").includes("/explore"));

  const wrongEvent = await get(`/${futureEvent}/explore`, cookie);
  check("Session bound to one event only", wrongEvent.status >= 300 && wrongEvent.status < 400);

  const login = await get(`/${liveEvent}`);
  const loginHtml = await login.text();
  check("Login page renders event name", login.status === 200 && loginHtml.includes("E2E Live Con"));
} catch (err) {
  ok = false;
  console.error("E2E ERROR:", err);
} finally {
  await sql`delete from events where id in (${liveEvent}, ${futureEvent})`;
  await sql.end();
}

process.exit(ok ? 0 : 1);
