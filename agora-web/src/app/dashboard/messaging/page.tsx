"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getConversations, getMessages, sendMessage, createConversation } from "@/lib/api";

interface Conversation {
  id: string;
  kind: string;
  title: string | null;
  created_at: string;
}

interface Message {
  id: string;
  sender_user_id: string;
  kind: string;
  body: string;
  sent_at: string;
}

export default function MessagingPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // New conversation
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvUserId, setNewConvUserId] = useState("");
  const [newConvTitle, setNewConvTitle] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getConversations({ page_size: "50" });
      setConversations(res.data as Conversation[]);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  async function selectConversation(conv: Conversation) {
    setSelectedConv(conv);
    setMsgLoading(true);
    try {
      const res = await getMessages(conv.id, { page_size: "100" });
      setMessages((res.data as Message[]).reverse());
    } catch {
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!selectedConv || !newMessage.trim()) return;
    setSending(true);
    try {
      await sendMessage(selectedConv.id, newMessage.trim());
      setNewMessage("");
      // Reload messages
      const res = await getMessages(selectedConv.id, { page_size: "100" });
      setMessages((res.data as Message[]).reverse());
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  async function handleNewConversation() {
    if (!newConvUserId.trim()) return;
    try {
      await createConversation({
        kind: "direct",
        title: newConvTitle || undefined,
        participant_user_ids: [newConvUserId.trim()],
      });
      setShowNewConv(false);
      setNewConvUserId("");
      setNewConvTitle("");
      loadConversations();
    } catch {
      // ignore
    }
  }

  return (
    <>
      <Header title="Messaging" />
      <div className="p-6">
        <div className="flex gap-6 h-[calc(100vh-180px)]">
          {/* Conversation List */}
          <div className="w-80 shrink-0 flex flex-col card p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Conversations</h3>
              <button className="text-primary-600 hover:text-primary-800 text-sm font-medium" onClick={() => setShowNewConv(!showNewConv)}>
                + New
              </button>
            </div>

            {showNewConv && (
              <div className="p-3 border-b border-gray-200 space-y-2">
                <input type="text" className="input-field text-sm" placeholder="User UUID" value={newConvUserId} onChange={(e) => setNewConvUserId(e.target.value)} />
                <input type="text" className="input-field text-sm" placeholder="Title (optional)" value={newConvTitle} onChange={(e) => setNewConvTitle(e.target.value)} />
                <button className="btn-primary text-xs w-full" onClick={handleNewConversation}>Start Conversation</button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="p-4 text-gray-400 text-sm text-center">Loading...</p>
              ) : conversations.length === 0 ? (
                <p className="p-4 text-gray-400 text-sm text-center">No conversations yet</p>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => selectConversation(conv)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedConv?.id === conv.id ? "bg-primary-50" : ""}`}
                  >
                    <p className="font-medium text-sm text-gray-900 truncate">{conv.title || conv.kind}</p>
                    <p className="text-xs text-gray-500">{new Date(conv.created_at).toLocaleDateString()}</p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Message Area */}
          <div className="flex-1 flex flex-col card p-0">
            {selectedConv ? (
              <>
                <div className="px-4 py-3 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">{selectedConv.title || selectedConv.kind}</h3>
                  <p className="text-xs text-gray-500">{selectedConv.kind} conversation</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {msgLoading ? (
                    <p className="text-center text-gray-400 text-sm">Loading messages...</p>
                  ) : messages.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm">No messages yet. Start the conversation!</p>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.sender_user_id === user?.id;
                      return (
                        <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${isMe ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-900"}`}>
                            <p className="text-sm">{msg.body}</p>
                            <p className={`text-xs mt-1 ${isMe ? "text-primary-200" : "text-gray-400"}`}>
                              {new Date(msg.sent_at).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="px-4 py-3 border-t border-gray-200">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input-field flex-1"
                      placeholder="Type a message..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    />
                    <button className="btn-primary" onClick={handleSend} disabled={sending || !newMessage.trim()}>
                      {sending ? "..." : "Send"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-400">Select a conversation to start messaging</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
