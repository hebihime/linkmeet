"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  fetchThread,
  sendMessage,
  markMet,
  type MetState,
} from "@/lib/actions";
import type { Card, Message } from "@/lib/queries";

const POLL_MS = 3000;
const IMAGE_BODY = /^https?:\/\/\S+\.(jpg|jpeg|png|webp)(\?\S*)?$/i;

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Thread({
  eventId,
  connectionId,
  meId,
  other,
  initialMessages,
  initialMet,
}: {
  eventId: string;
  connectionId: string;
  meId: string;
  other: Card;
  initialMessages: Message[];
  initialMet: MetState;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [met, setMet] = useState<MetState>(initialMet);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(initialMessages.length);

  // Poll for new messages + met-state — no websockets by design.
  useEffect(() => {
    const id = setInterval(async () => {
      const state = await fetchThread(connectionId);
      if (!state) return;
      setMet(state.met);
      setMessages((current) => {
        // Don't clobber optimistic sends still in flight; drop a temp once
        // the same message shows up from the server.
        const temps = current.filter(
          (m) =>
            m.id.startsWith("temp-") &&
            !state.messages.some(
              (s) => s.sender_id === m.sender_id && s.body === m.body,
            ),
        );
        return [...state.messages, ...temps];
      });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [connectionId, meId]);

  useEffect(() => {
    if (messages.length !== countRef.current) {
      countRef.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setBody("");
    const temp: Message = {
      id: `temp-${Date.now()}`,
      sender_id: meId,
      body: text,
      created_at: new Date(),
    };
    setMessages((m) => [...m, temp]);
    const saved = await sendMessage(connectionId, text);
    setMessages((m) =>
      saved ? m.map((x) => (x.id === temp.id ? saved : x)) : m.filter((x) => x.id !== temp.id),
    );
    setSending(false);
  }

  async function onMet() {
    const state = await markMet(connectionId);
    if (state) setMet(state);
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950/90 px-4 py-3 backdrop-blur-md">
        <Link
          href={`/${eventId}/chats`}
          aria-label="Back to chats"
          className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-800 to-fuchsia-800">
          {other.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={other.photo_url} alt={other.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-bold text-white/90">{initials(other.name)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold leading-tight">{other.name}</h1>
          {other.headline && (
            <p className="truncate text-xs text-neutral-500">{other.headline}</p>
          )}
        </div>
        {met.confirmed ? (
          <span className="shrink-0 rounded-full bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/20 px-3 py-1.5 text-xs font-bold text-fuchsia-300">
            You met 🎉
          </span>
        ) : met.iMet ? (
          <span className="shrink-0 rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400">
            Waiting for {other.name.split(" ")[0]}…
          </span>
        ) : (
          <button
            onClick={onMet}
            className="shrink-0 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
          >
            We met
          </button>
        )}
      </header>

      {met.confirmed && (
        <div className="border-b border-fuchsia-900/40 bg-fuchsia-950/30 px-4 py-2 text-center text-xs text-fuchsia-300">
          You and {other.name.split(" ")[0]} met in person — that&apos;s the whole point. 🎉
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ul className="flex flex-col gap-2">
          {messages.map((m) => {
            const mine = m.sender_id === meId;
            const isImage = IMAGE_BODY.test(m.body);
            return (
              <li key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.body}
                    alt="Shared"
                    className={`max-w-[70%] rounded-2xl border ${
                      mine ? "border-fuchsia-900/50" : "border-neutral-800"
                    }`}
                  />
                ) : (
                  <p
                    className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-snug ${
                      mine
                        ? "rounded-br-md bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white"
                        : "rounded-bl-md bg-neutral-800 text-neutral-100"
                    } ${m.id.startsWith("temp-") ? "opacity-60" : ""}`}
                  >
                    {m.body}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-neutral-800 bg-neutral-950 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`Message ${other.name.split(" ")[0]}`}
            className="max-h-32 flex-1 resize-none rounded-2xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-[15px] outline-none focus:border-neutral-400"
          />
          <button
            onClick={send}
            disabled={!body.trim() || sending}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white transition hover:brightness-110 active:scale-90 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-5 w-5">
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}
