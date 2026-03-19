import { useState, useEffect } from 'react';
import { Send, Loader2, FileDown, Share2, BarChart3, Mic, MicOff, ThumbsUp, ThumbsDown, MessageSquare, Plus, Trash2, X, Pin, Check } from 'lucide-react';
import { api } from '../../lib/api';
import { ChartDisplay } from './ChartDisplay';
import { ShareModal } from './ShareModal';
import { ExportModal } from './ExportModal';

interface QueryInterfaceProps {
  apiKey: string;
  initialQuery?: string;
  onQueryProcessed?: () => void;
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
}

export function QueryInterface({ apiKey, initialQuery, onQueryProcessed }: QueryInterfaceProps) {
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

  // Chat Session states
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [exampleQueries, setExampleQueries] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useEffect(() => {
    fetchSessions();
    fetchSuggestions();
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
      if (data.length > 0 && !currentSessionId) {
        // We do not auto-load the first session to avoid jarring the user, 
        // but let's load it if we want to default to the most recent conversation.
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
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

    try {
      let activeSessionId = currentSessionId;
      if (!activeSessionId) {
        // Auto-create a session if we don't have one active
        const session = await api.post<any>('/chat/sessions', { title: queryText.substring(0, 30) });
        activeSessionId = session.id;
        setCurrentSessionId(session.id);
        fetchSessions(); // refresh the sidebar
      }

      const response = await api.post<any>('/query', {
        query: queryText,
        session_id: activeSessionId
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.answer || 'I have analyzed your data and prepared the results.',
        visualization: response.visualization,
        timestamp: new Date(),
        feedback: null,
        queryId: response.query_id,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error(err);
      const errorMessage: Message = {
        role: 'assistant',
        content: `Error: ${err.message || 'Failed to process your query.'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
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
      setDashboards(d.dashboards || []);
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
        <div className="p-4">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors font-medium border border-blue-100"
          >
            <Plus className="size-4" />
            New Chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto w-full pb-4 space-y-1">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => loadSession(session.id)}
              className={`group flex items-center justify-between px-4 py-3 mx-2 rounded-lg cursor-pointer transition-colors ${currentSessionId === session.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare className="size-4 shrink-0 opacity-60" />
                <span className="truncate text-sm font-medium">{session.title || 'New Chat'}</span>
              </div>
              <button
                onClick={(e) => deleteSession(e, session.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded transition-all"
                title="Delete Chat"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
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
                      <button
                        onClick={() => handleOpenPin(message, index)}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100 transition-colors"
                      >
                        <Pin className="size-3 md:size-4" />
                        Pin
                      </button>

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
                <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm p-6 shadow-sm">
                  <div className="flex items-center gap-3">
                    <Loader2 className="size-5 text-blue-600 animate-spin" />
                    <span className="text-gray-600">Analyzing your data...</span>
                  </div>
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
    </div>
  );
}