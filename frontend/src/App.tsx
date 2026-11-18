
import { useEffect, useState } from "react";
import {
  Plus, Send, Menu, Settings, Sparkles, PanelLeftClose,
  Copy, Check, Trash2, MessageSquare, Clock, LogOut,
  Volume2, VolumeX, ThumbsUp, ThumbsDown
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

type Message = {
  role: "user" | "assistant";
  text: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

const API = "http://127.0.0.1:8000";
const GUEST_STORAGE_KEY = "ai_guest_chats";

function getGuestChats(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(GUEST_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("ai_token") || "");
  const [username, setUsername] = useState(localStorage.getItem("ai_username") || "");

  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState("");

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    token ? [] : getGuestChats()
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [temporary, setTemporary] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "good" | "bad">>({});
  const [chatError, setChatError] = useState("");

  // Load private server history for logged-in accounts.
  // Guests use a separate local history.
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      if (!token) {
        setConversations(getGuestChats());
        return;
      }

      try {
        const response = await fetch(`${API}/chats`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "Could not load chat history.");
        }

        if (!cancelled) {
          const chats = (Array.isArray(data) ? data : []).map((chat: any) => ({
            id: chat.id,
            title: chat.title,
            messages: typeof chat.messages === "string"
              ? JSON.parse(chat.messages)
              : chat.messages
          }));

          setConversations(chats);
        }
      } catch (error) {
        if (!cancelled) {
          setChatError(
            error instanceof Error ? error.message : "Could not load history."
          );
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Save only guest conversations in the browser.
  // Account conversations are saved on the backend.
  useEffect(() => {
    if (!token) {
      localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(conversations));
    }
  }, [conversations, token]);

  // Stop speech when the component is removed.
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function authenticate() {
    setAuthError("");

    try {
      const response = await fetch(
        `${API}/auth/${authMode === "signup" ? "signup" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: authUsername,
            password: authPassword
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Authentication failed.");
      }

      localStorage.setItem("ai_token", data.token);
      localStorage.setItem("ai_username", data.username);

      setToken(data.token);
      setUsername(data.username);
      setConversations([]);
      setMessages([]);
      setActiveId(null);
      setAuthOpen(false);
      setAuthPassword("");
      setChatError("");
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to connect."
      );
    }
  }

  function logout() {
    window.speechSynthesis?.cancel();

    localStorage.removeItem("ai_token");
    localStorage.removeItem("ai_username");

    setToken("");
    setUsername("");
    setMessages([]);
    setActiveId(null);
    setConversations(getGuestChats());
    setFeedback({});
    setSpeakingIndex(null);
    setChatError("");
  }

  function newChat() {
    window.speechSynthesis?.cancel();
    setMessages([]);
    setActiveId(null);
    setTemporary(false);
    setMessage("");
    setSpeakingIndex(null);
    setChatError("");
  }

  function temporaryChat() {
    window.speechSynthesis?.cancel();
    setMessages([]);
    setActiveId(null);
    setTemporary(true);
    setMessage("");
    setSpeakingIndex(null);
    setChatError("");
  }

  function openChat(chat: Conversation) {
    window.speechSynthesis?.cancel();
    setMessages(chat.messages);
    setActiveId(chat.id);
    setTemporary(false);
    setSpeakingIndex(null);
    setChatError("");
  }

  async function saveChat(id: string, updated: Message[]) {
    const title =
      updated.find(m => m.role === "user")?.text.slice(0, 35) || "New chat";

    const chat: Conversation = {
      id,
      title,
      messages: updated
    };

    if (token) {
      try {
        const response = await fetch(`${API}/chats`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(chat)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || "Could not save chat.");
        }

        setConversations(prev => [
          chat,
          ...prev.filter(c => c.id !== id)
        ]);
        setChatError("");
      } catch (error) {
        setChatError(
          error instanceof Error ? error.message : "Could not save chat."
        );
      }
    } else {
      setConversations(prev => [
        chat,
        ...prev.filter(c => c.id !== id)
      ]);
    }
  }

  async function deleteChat(id: string) {
    if (token) {
      try {
        const response = await fetch(`${API}/chats/${id}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`
          }
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.detail || "Could not delete chat.");
        }
      } catch (error) {
        setChatError(
          error instanceof Error ? error.message : "Could not delete chat."
        );
        return;
      }
    }

    setConversations(prev => prev.filter(c => c.id !== id));

    if (activeId === id) {
      newChat();
    }
  }

  async function clearHistory() {
    if (!window.confirm("Delete all saved conversations?")) return;

    if (token) {
      try {
        const results = await Promise.all(
          conversations.map(chat =>
            fetch(`${API}/chats/${chat.id}`, {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`
              }
            })
          )
        );

        const failed = results.some(response => !response.ok);

        if (failed) {
          throw new Error("Some conversations could not be deleted.");
        }
      } catch (error) {
        setChatError(
          error instanceof Error ? error.message : "Could not clear history."
        );
        return;
      }
    }

    setConversations([]);
    newChat();
  }

  async function sendMessage() {
    const text = message.trim();

    if (!text || loading) return;

    const id = activeId || crypto.randomUUID();
    const updated: Message[] = [
      ...messages,
      { role: "user", text }
    ];

    setMessages(updated);
    setActiveId(id);
    setMessage("");
    setChatError("");
    setLoading(true);

    if (!temporary) {
      await saveChat(id, updated);
    }

    try {
      const context = updated
        .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
        .join("\n\n");

      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: context + "\n\nAssistant:"
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Chat failed.");
      }

      const completed: Message[] = [
        ...updated,
        { role: "assistant", text: data.reply }
      ];

      setMessages(completed);

      if (!temporary) {
        await saveChat(id, completed);
      }
    } catch (error) {
      const failed: Message[] = [
        ...updated,
        {
          role: "assistant",
          text: `Error: ${
            error instanceof Error ? error.message : "Connection failed."
          }`
        }
      ];

      setMessages(failed);

      if (!temporary) {
        await saveChat(id, failed);
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyMessage(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      alert("Could not copy.");
    }
  }

  function readAloud(text: string, index: number) {
    if (!("speechSynthesis" in window)) {
      alert("Read aloud is not supported by this browser.");
      return;
    }

    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);

    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  }

  async function rateMessage(index: number, rating: "good" | "bad") {
    if (!token || !activeId) {
      setChatError("Log in and save this chat to submit feedback.");
      return;
    }

    const key = `${activeId}:${index}`;

    try {
      const response = await fetch(
        `${API}/chats/${activeId}/feedback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            message_index: index,
            rating
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Could not submit feedback.");
      }

      setFeedback(prev => ({
        ...prev,
        [key]: rating
      }));

      setChatError("");
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Could not submit feedback."
      );
    }
  }

  if (authOpen) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Sparkles size={30} />
          <h1>
            {authMode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p>AI Assistant</p>

          <input
            placeholder="Username"
            value={authUsername}
            onChange={e => setAuthUsername(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password (minimum 8 characters)"
            value={authPassword}
            onChange={e => setAuthPassword(e.target.value)}
          />

          {authError && <p className="auth-error">{authError}</p>}

          <button className="auth-submit" onClick={authenticate}>
            {authMode === "login" ? "Log in" : "Sign up"}
          </button>

          <button
            className="auth-switch"
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setAuthError("");
            }}
          >
            {authMode === "login"
              ? "Create an account"
              : "Already have an account? Log in"}
          </button>

          <button
            className="auth-switch"
            onClick={() => setAuthOpen(false)}
          >
            Continue as guest
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {sidebar && (
        <aside className="sidebar">
          <div className="side-header">
            <div className="brand">
              <Sparkles size={21} /> AI Assistant
            </div>

            <button className="icon-btn" onClick={() => setSidebar(false)}>
              <PanelLeftClose size={19} />
            </button>
          </div>

          <button className="new-chat" onClick={newChat}>
            <Plus size={18} /> New chat
          </button>

          <button className="temporary-chat" onClick={temporaryChat}>
            <Clock size={17} /> Temporary chat
          </button>

          <div className="history-heading">
            <span>{token ? "Your chats" : "Guest chats"}</span>
            <button onClick={clearHistory}>Clear</button>
          </div>

          <div className="history-list">
            {conversations.map(chat => (
              <div className="history-item" key={chat.id}>
                <button
                  className="history-open"
                  onClick={() => openChat(chat)}
                >
                  <MessageSquare size={16} />
                  <span>{chat.title}</span>
                </button>

                <button
                  className="history-delete"
                  onClick={() => deleteChat(chat.id)}
                  title="Delete chat"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="side-bottom">
            {token ? (
              <>
                <div className="account-label">{username}</div>
                <button className="settings-btn" onClick={logout}>
                  <LogOut size={18} /> Log out
                </button>
              </>
            ) : (
              <button
                className="settings-btn"
                onClick={() => {
                  setAuthMode("login");
                  setAuthOpen(true);
                }}
              >
                <Settings size={18} /> Log in / Sign up
              </button>
            )}
          </div>
        </aside>
      )}

      <main className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setSidebar(!sidebar)}>
            <Menu size={20} />
          </button>

          <span>{temporary ? "Temporary Chat" : "AI Assistant"}</span>

          <div className="avatar">
            {username ? username[0].toUpperCase() : "G"}
          </div>
        </header>

        {chatError && (
          <div className="chat-error">
            {chatError}
            <button onClick={() => setChatError("")}>Dismiss</button>
          </div>
        )}

        <section className="chat-area">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon">
                <Sparkles size={28} />
              </div>

              <h1>
                {temporary ? "Temporary chat" : "How can I help you today?"}
              </h1>

              <p>
                {temporary
                  ? "This chat won't be saved in history."
                  : "Ask anything. I'm here to help."}
              </p>
            </div>
          ) : (
            <div className="messages">
              {messages.map((msg, index) => (
                <div className={`message ${msg.role}`} key={index}>
                  <div className="message-avatar">
                    {msg.role === "user"
                      ? "U"
                      : <Sparkles size={17} />}
                  </div>

                  <div className="message-content">
                    {msg.role === "assistant" ? (
                      <>
                        <div className="markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.text}
                          </ReactMarkdown>
                        </div>

                        <div className="message-actions">
                          <button
                            className="copy-btn"
                            onClick={() => copyMessage(msg.text, index)}
                            title="Copy response"
                          >
                            {copiedIndex === index
                              ? <Check size={15} />
                              : <Copy size={15} />}
                            {copiedIndex === index ? "Copied" : "Copy"}
                          </button>

                          <button
                            className="copy-btn"
                            onClick={() => readAloud(msg.text, index)}
                            title="Read aloud"
                          >
                            {speakingIndex === index
                              ? <VolumeX size={15} />
                              : <Volume2 size={15} />}
                            {speakingIndex === index ? "Stop" : "Read aloud"}
                          </button>

                          <button
                            className={`copy-btn ${
                              feedback[`${activeId}:${index}`] === "good"
                                ? "feedback-active"
                                : ""
                            }`}
                            onClick={() => rateMessage(index, "good")}
                            title="Good response"
                            disabled={!token}
                          >
                            <ThumbsUp size={15} />
                          </button>

                          <button
                            className={`copy-btn ${
                              feedback[`${activeId}:${index}`] === "bad"
                                ? "feedback-active"
                                : ""
                            }`}
                            onClick={() => rateMessage(index, "bad")}
                            title="Bad response"
                            disabled={!token}
                          >
                            <ThumbsDown size={15} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="user-text">{msg.text}</div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="message assistant">
                  <div className="message-avatar">
                    <Sparkles size={17} />
                  </div>
                  <div className="message-content">Thinking...</div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="composer-area">
          <div className="composer">
            <textarea
              placeholder="Message AI Assistant..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              rows={1}
            />

            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={!message.trim() || loading}
            >
              <Send size={18} />
            </button>
          </div>

          <p className="disclaimer">
            AI Assistant can make mistakes. Check important information.
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
