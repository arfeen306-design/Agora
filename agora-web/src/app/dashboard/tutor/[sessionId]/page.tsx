"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import {
  getTutorSession,
  sendTutorMessage,
  closeTutorSession,
  type TutorMessage,
  type TutorSessionDetail,
} from "@/lib/api";

function MarkdownText({ text }: { text: string }) {
  // Simple inline markdown rendering
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h3 key={i} className="font-bold text-sm mt-2">{line.slice(4)}</h3>;
        if (line.startsWith("## ")) return <h2 key={i} className="font-bold text-sm mt-2">{line.slice(3)}</h2>;
        if (line.startsWith("# ")) return <h1 key={i} className="font-bold text-base mt-2">{line.slice(2)}</h1>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return <li key={i} className="ml-4 list-disc text-sm">{line.slice(2)}</li>;
        if (/^\d+\. /.test(line))
          return <li key={i} className="ml-4 list-decimal text-sm">{line.replace(/^\d+\. /, "")}</li>;
        if (line.startsWith("```")) return null; // skip code fences
        if (line.trim() === "") return <div key={i} className="h-1" />;
        // Inline bold **text**
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="text-sm leading-relaxed">
            {parts.map((part, j) =>
              part.startsWith("**") && part.endsWith("**")
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}

function MessageBubble({ msg, isUser }: { msg: TutorMessage; isUser: boolean }) {
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shadow-sm
        ${isUser ? "bg-violet-600 text-white" : "bg-gradient-to-br from-indigo-500 to-violet-600 text-white"}`}>
        {isUser ? "👤" : "🤖"}
      </div>
      {/* Bubble */}
      <div className={`max-w-[75%] group`}>
        <div className={`rounded-2xl px-4 py-3 shadow-sm
          ${isUser
            ? "bg-violet-600 text-white rounded-tr-sm"
            : "bg-white border border-gray-200 text-gray-900 rounded-tl-sm"
          }`}>
          {isUser
            ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            : <MarkdownText text={msg.content} />
          }
        </div>
        <p className={`text-xs text-gray-400 mt-1 ${isUser ? "text-right" : "text-left"}`}>{time}</p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-sm shadow-sm">🤖</div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex gap-1.5 items-center h-5">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const SUGGESTED_PROMPTS = [
  "Can you explain this topic step by step?",
  "Give me a practice problem",
  "Summarize what we've covered so far",
  "Explain it more simply",
  "What are the key formulas I need to know?",
];

export default function TutorChatPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const sessionId = params?.sessionId as string;

  const [session, setSession] = useState<TutorSessionDetail | null>(null);
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const s = await getTutorSession(sessionId);
      setSession(s);
      setMessages(s.messages || []);
      if ((s.messages || []).length > 0) setShowSuggestions(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Session not found");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const isActive = session?.status === "active";

  async function handleSend(content?: string) {
    const text = (content ?? input).trim();
    if (!text || sending || !isActive) return;
    setInput("");
    setSending(true);
    setShowSuggestions(false);
    setError("");

    // Optimistic user message
    const optimisticUser: TutorMessage = {
      id: `opt-${Date.now()}`,
      session_id: sessionId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticUser]);

    try {
      const result = await sendTutorMessage(sessionId, text);
      // Replace optimistic + add real messages
      setMessages(prev => [
        ...prev.filter(m => m.id !== optimisticUser.id),
        result.user_message,
        result.assistant_message,
      ]);
    } catch (err: unknown) {
      setMessages(prev => prev.filter(m => m.id !== optimisticUser.id));
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  async function handleClose() {
    if (!confirm("End this session? The AI will generate a summary for you.")) return;
    setClosing(true);
    try {
      await closeTutorSession(sessionId);
      router.push("/dashboard/tutor");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to close session");
      setClosing(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header title="AI Tutor" />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header title="AI Tutor" />
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <p className="text-gray-500">Session not found.</p>
          <button className="btn-primary" onClick={() => router.push("/dashboard/tutor")}>← Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* ── Top Bar ── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/tutor")}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
          >
            ←
          </button>
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-lg shadow-sm">🤖</div>
          <div>
            <div className="font-semibold text-gray-900 text-sm">
              {session.topic || "AI Tutor"}
            </div>
            <div className="flex items-center gap-2">
              {session.subject_name && (
                <span className="badge-blue">{session.subject_name}</span>
              )}
              <span className={isActive ? "badge-green" : "badge-gray"}>
                {isActive ? "Active" : session.status}
              </span>
              <span className="text-xs text-gray-400">{messages.length} messages</span>
            </div>
          </div>
        </div>
        {isActive && (
          <button
            className="btn-secondary text-sm gap-1.5"
            onClick={handleClose}
            disabled={closing}
          >
            {closing ? "Closing…" : "✅ End Session"}
          </button>
        )}
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        <div className="max-w-3xl mx-auto space-y-4">

          {/* Welcome bubble */}
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">🎓</div>
              <h2 className="font-bold text-gray-900 text-lg">
                {session.topic ? `Let's learn about: ${session.topic}` : "Hello! I'm your AI Tutor"}
              </h2>
              <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto">
                Ask me anything — I can explain concepts, solve problems, give examples, or quiz you.
              </p>
            </div>
          )}

          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} isUser={msg.role === "user"} />
          ))}

          {sending && <TypingIndicator />}

          {/* Session closed notice */}
          {!isActive && (
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 bg-gray-100 rounded-xl px-4 py-2 text-sm text-gray-600">
                ✅ Session ended
                {session.summary && <span>· <em>{session.summary.slice(0, 80)}…</em></span>}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Suggestions ── */}
      {showSuggestions && isActive && messages.length === 0 && (
        <div className="flex-shrink-0 px-4 pb-2">
          <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
            {SUGGESTED_PROMPTS.map(p => (
              <button
                key={p}
                onClick={() => handleSend(p)}
                className="text-xs rounded-full border border-violet-200 bg-violet-50 text-violet-700 px-3 py-1.5 hover:bg-violet-100 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex-shrink-0 px-4 pb-1">
          <div className="max-w-3xl mx-auto">
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          </div>
        </div>
      )}

      {/* ── Input Bar ── */}
      <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3">
        <div className="max-w-3xl mx-auto">
          {isActive ? (
            <div className="flex items-end gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
              <textarea
                ref={inputRef}
                className="flex-1 bg-transparent resize-none text-sm text-gray-900 placeholder:text-gray-400 outline-none max-h-32 py-1"
                placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={sending}
                style={{ minHeight: 28 }}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || sending}
                className="flex-shrink-0 h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                aria-label="Send"
              >
                {sending ? (
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : "↑"}
              </button>
            </div>
          ) : (
            <div className="text-center py-2">
              <p className="text-sm text-gray-500 mb-3">This session is closed.</p>
              <button className="btn-primary" onClick={() => router.push("/dashboard/tutor")}>
                ← Back to Tutor Home
              </button>
            </div>
          )}
          {isActive && (
            <p className="text-xs text-gray-400 text-center mt-2">
              AI responses may be incorrect — always verify important information
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
