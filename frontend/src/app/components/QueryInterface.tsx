import { useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  Send,
  Loader2,
  Cpu,
  Search,
  History,
  ChevronRight,
  Plus,
  Settings,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Brain,
  FileDown,
  Share2,
  Mic,
  MicOff,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Trash2,
  X,
  Pin,
  Check,
  Bookmark,
  BookmarkCheck,
  Code2,
} from 'lucide-react';
import { api } from '../../lib/api';
import { ChartDisplay } from './ChartDisplay';
import { ShareModal } from './ShareModal';
import { ExportModal } from './ExportModal';

interface QueryInterfaceProps {
  apiKey: string;
  initialQuery?: string;
  onQueryProcessed?: () => void;
  user?: { permissions?: string[], id?: number, role?: string };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap every occurrence of `term` in the text with a highlighted <mark> span. */
function HighlightedText({ text, term }: { text: string; term: string }) {
  if (!term || !text) return <>{text}</>;
  const kw = term.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let lo = text.toLowerCase();
  let idx = lo.indexOf(kw);
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} className="bg-yellow-200 text-yellow-900 rounded px-0.5 not-italic">
        {text.slice(idx, idx + term.length)}
      </mark>
    );
    cursor = idx + term.length;
    idx = lo.indexOf(kw, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/** Format a date string as a human-friendly relative time. */
function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const mins   = Math.floor(diffMs / 60_000);
  const hours  = Math.floor(mins  / 60);
  const days   = Math.floor(hours / 24);
  if (mins  <  1) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  visualization?: {
    type: string;
    data: any;
    title?: string;
    description?: string;
  };
  timestamp: Date;
  feedback?: 'up' | 'down' | null;
  queryId?: string;
  isSaved?: boolean;
  sqlQuery?: string;
  thinkingProcess?: any[];
}

export function QueryInterface({ apiKey, initialQuery, onQueryProcessed, user }: QueryInterfaceProps) {
  const hasManageDashboards = Array.isArray(user?.permissions) && user.permissions.includes('MANAGE_DASHBOARDS');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! I\'m your AI analytics assistant. Ask me anything about your data, and I\'ll provide insights with visualizations. You can type or use voice input.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [streamingSteps, setStreamingSteps] = useState<string[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

  // Pin-to-dashboard state
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinMessage, setPinMessage] = useState<Message | null>(null);
  const [pinUserQuery, setPinUserQuery] = useState<string>('');
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [pinningId, setPinningId] = useState<number | null>(null);
  const [pinnedIds, setPinnedIds] = useState<number[]>([]);

  // Saved queries state
  const [savedQueries, setSavedQueries] = useState<any[]>([]);
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState<{sql: string; query: string} | null>(null);

  // Chat Session states
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [exampleQueries, setExampleQueries] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // History search
  const [sessionSearch, setSessionSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchSessions();
    fetchSuggestions();
    fetchSavedQueries();
  }, []);

  useEffect(() => {
    if (initialQuery && !isLoading) {
      handleAutoQuery(initialQuery);
      onQueryProcessed?.();
    }
  }, [initialQuery]);

  const handleAutoQuery = async (queryText: string) => {
    setInput(queryText);
    // Use a small timeout to ensure the state update is reflected or just pass it directly
    await executeQuery(queryText);
  };

  const fetchSavedQueries = async () => {
    try {
      const data = await api.get<any[]>('/saved-queries');
      setSavedQueries(data || []);
    } catch (err) {
      console.error('Failed to fetch saved queries:', err);
    }
  };

  const toggleSaveQuery = async (msg: Message, userQuery: string) => {
    if (!msg.queryId) return;
    const id = parseInt(msg.queryId);
    try {
      if (msg.isSaved) {
        await api.delete(`/saved-queries/${id}`);
        setMessages(prev => prev.map(m => m === msg ? { ...m, isSaved: false } : m));
        setSavedQueries(prev => prev.filter(q => q.id !== id));
      } else {
        await api.post(`/saved-queries/${id}`, { title: userQuery.slice(0, 100) });
        setMessages(prev => prev.map(m => m === msg ? { ...m, isSaved: true } : m));
        fetchSavedQueries();
      }
    } catch (err) {
      console.error('Failed to toggle saved query:', err);
    }
  };

  const fetchSuggestions = async () => {
    setIsLoadingSuggestions(true);
    try {
      const data = await api.get<{ queries: string[] }>('/analytics/suggested-queries');
      if (data && data.queries && data.queries.length > 0) {
        setExampleQueries(data.queries);
      }
    } catch (err) {
      console.error('Failed to fetch suggested queries:', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const data = await api.get<any[]>('/chat/sessions');
      setSessions(data);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  };

  const handleSessionSearch = (value: string) => {
    setSessionSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await api.get<any[]>(`/chat/sessions/search?q=${encodeURIComponent(value.trim())}`);
        setSearchResults(results || []);
      } catch (err) {
        console.error('Session search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  };

  const handleNewChat = async () => {
    try {
      const session = await api.post<any>('/chat/sessions', { title: 'New Chat' });
      setSessions((prev) => [session, ...prev]);
      setCurrentSessionId(session.id);
      setMessages([{
        role: 'assistant',
        content: 'Hello! I\'m your AI analytics assistant. Ask me anything about your data, and I\'ll provide insights with visualizations. You can type or use voice input.',
        timestamp: new Date(),
      }]);
      setIsSidebarOpen(false);
    } catch (err) {
      console.error('Failed to create new chat:', err);
      // Fallback
      setMessages([{
        role: 'assistant',
        content: 'Hello! I\'m your AI analytics assistant. Ask me anything about your data...',
        timestamp: new Date(),
      }]);
      setCurrentSessionId(null);
    }
  };

  const loadSession = async (id: string) => {
    try {
      const history = await api.get<any[]>(`/chat/sessions/${id}/messages`);
      setCurrentSessionId(id);

      if (history.length === 0) {
        setMessages([{
          role: 'assistant',
          content: 'Hello! I\'m your AI analytics assistant. Ask me anything about your data, and I\'ll provide insights with visualizations. You can type or use voice input.',
          timestamp: new Date(),
        }]);
      } else {
        setMessages(history.map((msg: any) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: new Date(msg.created_at || Date.now()),
          visualization: msg.visualization || undefined,
          queryId: msg.query_id || undefined,
          thinkingProcess: msg.thinking_process || undefined,
        })));
      }
      setIsSidebarOpen(false);
    } catch (err) {
      console.error('Failed to load session:', err);
      alert('Failed to load chat history.');
    }
  };

  const deleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat session?')) return;

    try {
      await api.delete(`/chat/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setMessages([{
          role: 'assistant',
          content: 'Hello! I\'m your AI analytics assistant. Ask me anything about your data, and I\'ll provide insights with visualizations. You can type or use voice input.',
          timestamp: new Date(),
        }]);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
      alert('Failed to delete session.');
    }
  };

  const executeQuery = async (queryText: string) => {
    if (!queryText.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: queryText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingSteps([]);

    try {
      let activeSessionId = currentSessionId;
      if (!activeSessionId) {
        const session = await api.post<any>('/chat/sessions', { title: queryText.substring(0, 30) });
        activeSessionId = session.id;
        setCurrentSessionId(session.id);
        fetchSessions();
      }

      // Use SSE streaming endpoint
      const baseUrl = (window as any).__VANTAGE_API_URL__ || import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const accessToken = localStorage.getItem('vantage_access_token');
      const apiKey = localStorage.getItem('vantage_api_key');

      const body = JSON.stringify({ query: queryText, session_id: activeSessionId });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
      if (apiKey) headers['X-API-KEY'] = apiKey;

      const resp = await fetch(`${baseUrl}/query/stream`, {
        method: 'POST',
        headers,
        body,
      });

      if (!resp.ok || !resp.body) {
        // Fallback to regular endpoint if streaming fails
        throw new Error(`Stream failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: any = null;
      const thinkingSteps: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            if (event.type === 'thinking') {
              thinkingSteps.push(event);
              // Show a friendly step label
              const label = event.tool_calls?.length
                ? `Running: ${event.tool_calls.map((t: any) => t.name).join(', ')}`
                : event.action === 'Complete'
                  ? 'Composing answer…'
                  : 'Analyzing…';
              setStreamingSteps((prev) => [...new Set([...prev, label])]);
            } else if (event.type === 'done') {
              finalResult = event.result;
            } else if (event.type === 'error') {
              // Surface backend error rather than silently falling back
              finalResult = { text: event.message || 'An error occurred while processing your query.' };
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      if (!finalResult) {
        throw new Error('No result received from stream');
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: (finalResult.text != null ? finalResult.text : null) ?? finalResult.response ?? finalResult.answer ?? 'I have analyzed your data and prepared the results.',
        visualization: finalResult.visualization,
        timestamp: new Date(),
        feedback: null,
        queryId: finalResult.query_id,
        sqlQuery: finalResult.sql_query,
        isSaved: false,
        thinkingProcess: finalResult.thinking_process || thinkingSteps,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('Streaming failed, falling back to regular query:', err);
      // Fallback: call the regular /query endpoint
      try {
        let activeSessionId = currentSessionId;
        const response = await api.post<any>('/query', {
          query: queryText,
          session_id: activeSessionId,
        });
        const assistantMessage: Message = {
          role: 'assistant',
          content: response.text ?? response.response ?? response.answer ?? 'I have analyzed your data and prepared the results.',
          visualization: response.visualization,
          timestamp: new Date(),
          feedback: null,
          queryId: response.query_id,
          sqlQuery: response.sql_query,
          isSaved: false,
          thinkingProcess: response.thinking_process,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (fallbackErr: any) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Error: ${fallbackErr.message || 'Failed to process your query.'}`,
          timestamp: new Date(),
        }]);
      }
    } finally {
      setIsLoading(false);
      setStreamingSteps([]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentInput = input;
    setInput('');
    await executeQuery(currentInput);
  };

  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Voice input is not supported in your browser. Please use Chrome or Edge.');
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setIsListening(false);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleFeedback = async (messageIndex: number, feedback: 'up' | 'down') => {
    // Optimistic UI update
    setMessages(
      messages.map((msg, idx) =>
        idx === messageIndex ? { ...msg, feedback } : msg
      )
    );
    try {
      const assistantMsg = messages[messageIndex];
      const userMsg = messageIndex > 0 ? messages[messageIndex - 1] : null;

      await api.post('/feedback', {
        query: userMsg?.content || 'System Message',
        response: assistantMsg.content,
        vote: feedback === 'up' ? 1 : -1,
        feedback_text: null
      });
    } catch (e) {
      console.error('Failed to submit feedback:', e);
    }
  };

  const handleShare = (message: Message) => {
    setSelectedMessage(message);
    setShowShareModal(true);
  };

  const handleExport = (message: Message) => {
    setSelectedMessage(message);
    setShowExportModal(true);
  };

  const handleOpenPin = async (message: Message, index: number) => {
    setPinMessage(message);
    setPinnedIds([]);
    // find the preceding user message to use as the query label
    const prevUser = messages.slice(0, index).reverse().find(m => m.role === 'user');
    setPinUserQuery(prevUser?.content || message.content.substring(0, 80));
    try {
      const d = await api.get<{ dashboards: any[] }>('/dashboards');
      const myDashboards = (d.dashboards || []).filter((dash: any) => dash.created_by === user?.id);
      setDashboards(myDashboards);
    } catch (e) { setDashboards([]); }
    setShowPinModal(true);
  };

  const handlePinToBoard = async (dashboardId: number) => {
    if (!pinMessage || pinningId !== null) return;
    setPinningId(dashboardId);
    try {
      await api.post(`/dashboards/${dashboardId}/cards`, {
        title: pinUserQuery.substring(0, 80),
        query_text: pinUserQuery,
        response_text: pinMessage.content,
        visualization: pinMessage.visualization || null,
        card_type: pinMessage.visualization ? 'chart' : 'text',
      });
      setPinnedIds(prev => [...prev, dashboardId]);
    } catch (e: any) { alert(e.message || 'Failed to pin card'); }
    setPinningId(null);
  };

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-50 overflow-hidden relative">
      {/* Mobile Chat History Toggle (positioned relative to main content) */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="md:hidden absolute top-3 right-4 z-30 p-2 bg-white/80 backdrop-blur rounded-lg shadow-sm border border-gray-200 text-gray-600"
        title="Chat History"
      >
        <MessageSquare className="size-5" />
      </button>

      {/* Sidebar for Chat Sessions */}
      <div className={`
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
        md:translate-x-0 absolute md:relative z-40 h-full w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ease-in-out shrink-0
      `}>
        <div className="p-4 border-b border-gray-200 flex justify-between items-center md:pt-6">
          <h2 className="font-semibold text-gray-700">Chat History</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-500 hover:text-gray-700 p-1">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors font-medium border border-blue-100"
          >
            <Plus className="size-4" />
            New Chat
          </button>
          <button
            onClick={() => setShowSavedPanel(v => !v)}
            className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg transition-colors font-medium border ${showSavedPanel ? 'bg-yellow-50 text-yellow-700 border-yellow-100' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-100'}`}
          >
            <Bookmark className="size-4" />
            Saved ({savedQueries.length})
          </button>
          {/* Search box */}
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => handleSessionSearch(e.target.value)}
              placeholder="Search history…"
              className="w-full pl-8 pr-7 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 placeholder-gray-400 transition-all"
            />
            {sessionSearch && (
              <button
                onClick={() => { setSessionSearch(''); setSearchResults([]); setIsSearching(false); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto w-full pb-4 space-y-1">
          {/* Search state indicator */}
          {isSearching && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-gray-400">
              <Loader2 className="size-3 animate-spin" />
              Searching…
            </div>
          )}

          {/* Search results */}
          {sessionSearch && !isSearching && searchResults.length === 0 && (
            <div className="text-center text-sm text-gray-400 px-4 py-8">
              No results for &ldquo;{sessionSearch}&rdquo;
            </div>
          )}

          {/* Result count when searching */}
          {sessionSearch && !isSearching && searchResults.length > 0 && (
            <div className="px-4 py-1.5 text-[11px] text-gray-400 font-medium">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
          )}

          {(sessionSearch ? searchResults : sessions).map((session) => (
            <div
              key={session.id}
              onClick={() => loadSession(session.id)}
              className={`group flex items-start justify-between px-4 py-3 mx-2 rounded-lg cursor-pointer transition-colors ${
                currentSessionId === session.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <div className="flex items-start gap-3 overflow-hidden min-w-0">
                <MessageSquare className="size-4 shrink-0 opacity-60 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-sm font-medium block">
                      <HighlightedText text={session.title || 'New Chat'} term={sessionSearch} />
                    </span>
                    {session.updated_at && (
                      <span className="text-[10px] text-gray-400 shrink-0 ml-1 tabular-nums">
                        {relativeTime(session.updated_at)}
                      </span>
                    )}
                  </div>
                  {session.snippet && (
                    <span className="text-xs text-gray-400 line-clamp-2 mt-0.5 leading-relaxed block">
                      <HighlightedText text={session.snippet} term={sessionSearch} />
                    </span>
                  )}
                  {sessionSearch && session.match_role === 'title' && (
                    <span className="inline-block mt-1 text-[10px] bg-blue-50 text-blue-500 font-semibold px-1.5 py-0.5 rounded">
                      title match
                    </span>
                  )}
                </div>
              </div>
              {!sessionSearch && (
                <button
                  onClick={(e) => deleteSession(e, session.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded transition-all shrink-0 mt-0.5"
                  title="Delete Chat"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}

          {!sessionSearch && sessions.length === 0 && (
            <div className="text-center text-sm text-gray-400 px-4 py-8">
              No chat history yet.
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 p-4 md:p-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3">
              <BarChart3 className="size-6 md:size-8 text-blue-600 shrink-0" />
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight">AI Query</h1>
                <p className="text-xs md:text-sm text-gray-600 line-clamp-1">Ask anything about your data in plain English</p>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] md:max-w-3xl ${message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm'
                    : 'bg-white border border-gray-200 rounded-2xl rounded-tl-sm'
                    } p-4 md:p-6 shadow-sm`}
                >
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-2 md:mb-3">
                      <BarChart3 className="size-4 md:size-5 text-blue-600" />
                      <span className="font-bold text-sm md:text-base text-gray-900">Vantage AI</span>
                    </div>
                  )}

                  <p className={`text-sm md:text-base ${message.role === 'user' ? 'text-white' : 'text-gray-900'}`}>
                    {message.content}
                  </p>

                  {message.visualization && (
                    <div className="mt-4 overflow-x-auto">
                      <ChartDisplay visualization={message.visualization} />
                    </div>
                  )}

                  {message.role === 'assistant' && message.thinkingProcess && message.thinkingProcess.length > 0 && (
                    <div className="mt-4">
                      <details className="group border border-gray-100 rounded-xl bg-gray-50/50 shadow-sm overflow-hidden">
                        <summary className="flex items-center gap-2 p-3 cursor-pointer select-none text-sm font-semibold text-gray-700 hover:bg-gray-100/50 transition-colors">
                          <Brain className="size-4 text-blue-500 group-open:text-blue-600" />
                          <span>View Logical Reasoning Trace</span>
                          <span className="ml-auto text-xs font-normal text-gray-400 group-open:rotate-180 transition-transform">▼</span>
                        </summary>
                        <div className="p-4 pt-0 space-y-4 border-t border-gray-100 bg-white rounded-b-xl">
                          {message.thinkingProcess.map((step: any, i: number) => (
                            <div key={i} className="relative pl-6 border-l-2 border-blue-100">
                              <div className="absolute -left-1.5 top-1 size-3 rounded-full bg-blue-100 border-2 border-white" />
                              <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">
                                Step {step.step}: {step.action || 'Analysis'}
                              </div>
                              <p className="text-sm text-gray-700 leading-relaxed mb-2">
                                {step.thought}
                              </p>
                              {step.tool_calls && step.tool_calls.length > 0 && (
                                <div className="space-y-2">
                                  {step.tool_calls.map((tc: any, j: number) => (
                                    <div key={j} className="bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-600 break-all border border-gray-200">
                                      <div className="font-bold text-gray-900 mb-1 flex items-center gap-2">
                                        <BarChart3 className="size-3" />
                                        {tc.name}
                                      </div>
                                      <div className="opacity-80">
                                        {JSON.stringify(tc.args)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}

                  {message.role === 'assistant' && (
                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-200">
                      {message.visualization && (
                        <>
                          <button
                            onClick={() => handleShare(message)}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            <Share2 className="size-3 md:size-4" />
                            Share
                          </button>
                          <button
                            onClick={() => handleExport(message)}
                            className="flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                          >
                            <FileDown className="size-3 md:size-4" />
                            Export
                          </button>
                        </>
                      )}
                      {hasManageDashboards && (
                        <button
                          onClick={() => handleOpenPin(message, index)}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors"
                        >
                          <Pin className="size-3 md:size-4" />
                          Pin
                        </button>
                      )}

                      {/* Save query button */}
                      {message.queryId && (
                        <button
                          onClick={() => {
                            const userMsg = messages[index - 1];
                            toggleSaveQuery(message, userMsg?.content || '');
                          }}
                          title={message.isSaved ? 'Remove bookmark' : 'Save query'}
                          className={`flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm rounded-lg transition-colors ${
                            message.isSaved
                              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          {message.isSaved
                            ? <BookmarkCheck className="size-3 md:size-4" />
                            : <Bookmark className="size-3 md:size-4" />}
                          {message.isSaved ? 'Saved' : 'Save'}
                        </button>
                      )}

                      {/* Show SQL button */}
                      {message.sqlQuery && (
                        <button
                          onClick={() => setShowSqlModal({ sql: message.sqlQuery!, query: message.content })}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <Code2 className="size-3 md:size-4" />
                          SQL
                        </button>
                      )}

                      {/* Feedback buttons */}
                      <div className="ml-auto flex items-center gap-1 md:gap-2">
                        <button
                          onClick={() => handleFeedback(index, 'up')}
                          className={`p-2 rounded-lg transition-colors ${message.feedback === 'up'
                            ? 'bg-green-100 text-green-600'
                            : 'hover:bg-gray-100 text-gray-400'
                            }`}
                        >
                          <ThumbsUp className="size-4" />
                        </button>
                        <button
                          onClick={() => handleFeedback(index, 'down')}
                          className={`p-2 rounded-lg transition-colors ${message.feedback === 'down'
                            ? 'bg-red-100 text-red-600'
                            : 'hover:bg-gray-100 text-gray-400'
                            }`}
                        >
                          <ThumbsDown className="size-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="text-xs opacity-60 mt-3">
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm p-4 md:p-6 shadow-sm max-w-sm">
                  <div className="flex items-center gap-3 mb-2">
                    <Loader2 className="size-5 text-blue-600 animate-spin shrink-0" />
                    <span className="text-gray-600 font-medium text-sm">Analyzing your data…</span>
                  </div>
                  {streamingSteps.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {streamingSteps.map((step, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-gray-500">
                          <CheckCircle2 className="size-3 text-green-500 shrink-0" />
                          {step}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Example Queries (shown when no messages) */}
        {messages.length === 1 && (isLoadingSuggestions || exampleQueries.length > 0) && (
          <div className="p-6 bg-white border-t border-gray-200">
            <div className="max-w-5xl mx-auto">
              <p className="text-sm font-medium text-gray-700 mb-3">Try asking:</p>
              {isLoadingSuggestions ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[1, 2, 3, 4].map((skeleton) => (
                    <div key={skeleton} className="h-12 bg-gray-100 animate-pulse rounded-lg border border-gray-200"></div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {exampleQueries.map((query, index) => (
                    <button
                      key={index}
                      onClick={() => setInput(query)}
                      className="text-left px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 hover:border-gray-300 transition-colors text-sm"
                    >
                      {query}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="bg-white border-t border-gray-200 p-4 md:p-6">
          <form onSubmit={handleSubmit} className="max-w-5xl mx-auto">
            <div className="flex gap-2 md:gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                disabled={isLoading}
                className="flex-1 px-4 md:px-6 py-3 md:py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 text-sm md:text-base"
              />
              <button
                type="button"
                onClick={handleVoiceInput}
                disabled={isLoading || isListening}
                className={`px-3 md:px-6 py-3 md:py-4 rounded-xl transition-colors font-medium flex items-center gap-2 ${isListening
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                {isListening ? <MicOff className="size-4 md:size-5" /> : <Mic className="size-4 md:size-5" />}
              </button>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-4 md:px-8 py-3 md:py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
              >
                {isLoading ? (
                  <Loader2 className="size-4 md:size-5 animate-spin" />
                ) : (
                  <Send className="size-4 md:size-5" />
                )}
                <span className="hidden sm:inline">Send</span>
              </button>
            </div>
          </form>
        </div>

        {/* Modals */}
        {showShareModal && selectedMessage && (
          <ShareModal
            message={selectedMessage}
            onClose={() => setShowShareModal(false)}
            apiKey={apiKey}
          />
        )}

        {showExportModal && selectedMessage && (
          <ExportModal
            message={selectedMessage}
            onClose={() => setShowExportModal(false)}
            apiKey={apiKey}
          />
        )}

        {/* Pin to Dashboard Modal */}
        {showPinModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Pin className="size-5 text-purple-600" />
                  <h2 className="font-semibold text-gray-900">Pin to Dashboard</h2>
                </div>
                <button onClick={() => setShowPinModal(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-4">
                {dashboards.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">
                    No dashboards yet. Create one in the
                    <span className="font-medium text-purple-600"> Dashboards </span>section first.
                  </p>
                ) : (
                  <ul className="space-y-2 max-h-64 overflow-y-auto">
                    {dashboards.map((d: any) => {
                      const pinned = pinnedIds.includes(d.id);
                      const loading = pinningId === d.id;
                      return (
                        <li key={d.id}>
                          <button
                            onClick={() => handlePinToBoard(d.id)}
                            disabled={loading || pinned}
                            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${pinned
                              ? 'bg-green-50 border-green-200 text-green-700'
                              : 'bg-gray-50 border-gray-200 hover:bg-purple-50 hover:border-purple-300 text-gray-800'
                              }`}
                          >
                            <span className="text-sm font-medium font-medium">{d.name}</span>
                            {pinned && <Check className="size-4 text-green-600" />}
                            {loading && <Loader2 className="size-4 animate-spin text-purple-500" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={() => setShowPinModal(false)}
                  className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {pinnedIds.length > 0 ? 'Done' : 'Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Saved Queries slide-in panel */}
      {showSavedPanel && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setShowSavedPanel(false)}>
          <div className="bg-white w-full max-w-sm h-full shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Bookmark className="size-5 text-yellow-600" />
                <h2 className="font-semibold text-gray-900">Saved Queries</h2>
              </div>
              <button onClick={() => setShowSavedPanel(false)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {savedQueries.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <BookmarkCheck className="size-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No saved queries yet.</p>
                  <p className="text-xs mt-1">Click <strong>Save</strong> on any answer to bookmark it.</p>
                </div>
              ) : (
                savedQueries.map(sq => (
                  <div key={sq.id} className="bg-gray-50 rounded-xl p-4 border border-gray-100 hover:border-yellow-200 transition-colors group">
                    <p className="text-sm font-medium text-gray-800 line-clamp-2 mb-1">
                      {sq.saved_title || sq.query}
                    </p>
                    <p className="text-xs text-gray-400 mb-3">
                      {new Date(sq.created_at).toLocaleDateString()}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setInput(sq.query);
                          setShowSavedPanel(false);
                        }}
                        className="flex-1 text-xs py-1.5 px-3 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        Re-run
                      </button>
                      <button
                        onClick={async () => {
                          await api.delete(`/saved-queries/${sq.id}`);
                          setSavedQueries(prev => prev.filter(q => q.id !== sq.id));
                        }}
                        className="text-xs py-1.5 px-3 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SQL Query Viewer Modal */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSqlModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Code2 className="size-5 text-gray-600" />
                <h2 className="font-semibold text-gray-900">Generated SQL</h2>
              </div>
              <button onClick={() => setShowSqlModal(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <pre className="bg-gray-900 text-green-300 rounded-xl p-4 text-xs md:text-sm overflow-x-auto whitespace-pre-wrap font-mono max-h-80">
                {showSqlModal.sql}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(showSqlModal.sql);
                }}
                className="mt-3 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Copy to clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}