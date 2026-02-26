import { useState, useEffect } from 'react';
import { Send, Loader2, FileDown, Share2, BarChart3, Mic, MicOff, ThumbsUp, ThumbsDown, MessageSquare, Plus, Trash2, Menu, X } from 'lucide-react';
import { api } from '../../lib/api';
import { ChartDisplay } from './ChartDisplay';
import { ShareModal } from './ShareModal';
import { ExportModal } from './ExportModal';

interface QueryInterfaceProps {
  apiKey: string;
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

export function QueryInterface({ apiKey }: QueryInterfaceProps) {
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

  // Chat Session states
  const [sessions, setSessions] = useState<any[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [exampleQueries, setExampleQueries] = useState<string[]>([
    'What are the top 5 products by revenue?',
    'Show me sales trends over the last quarter',
    'Which customers have the highest lifetime value?',
    'Compare product categories by profit margin',
  ]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  useEffect(() => {
    fetchSessions();
    fetchSuggestions();
  }, []);

  const fetchSuggestions = async () => {
    setIsLoadingSuggestions(true);
    try {
      const data = await api.get<{ queries: string[] }>('/suggested-queries');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages([...messages, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    try {
      let activeSessionId = currentSessionId;
      if (!activeSessionId) {
        // Auto-create a session if we don't have one active
        const session = await api.post<any>('/chat/sessions', { title: currentInput.substring(0, 30) });
        activeSessionId = session.id;
        setCurrentSessionId(session.id);
        fetchSessions(); // refresh the sidebar
      }

      const response = await api.post<any>('/query', {
        query: currentInput,
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

  return (
    <div className="h-full flex flex-col md:flex-row bg-gray-50 overflow-hidden relative">
      {/* Mobile Sidebar Toggle */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="md:hidden absolute top-4 left-4 z-50 p-2 bg-white rounded-md shadow-sm border border-gray-200"
      >
        <Menu className="size-5 text-gray-600" />
      </button>

      {/* Sidebar for Chat Sessions */}
      <div className={`
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
        md:translate-x-0 absolute md:relative z-40 h-full w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ease-in-out shrink-0
      `}>
        <div className="p-4 border-b border-gray-200 flex justify-between items-center md:pt-6">
          <h2 className="font-semibold text-gray-700 ml-10 md:ml-0">Chat History</h2>
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
        <div className="bg-white border-b border-gray-200 p-6 pl-16 md:pl-6">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3">
              <BarChart3 className="size-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Natural Language Query</h1>
                <p className="text-sm text-gray-600">Ask questions about your data in plain English or use voice input</p>
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
                  className={`max-w-3xl ${message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm'
                    : 'bg-white border border-gray-200 rounded-2xl rounded-tl-sm'
                    } p-6 shadow-sm`}
                >
                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 className="size-5 text-blue-600" />
                      <span className="font-bold text-gray-900">Vantage AI</span>
                    </div>
                  )}

                  <p className={message.role === 'user' ? 'text-white' : 'text-gray-900'}>
                    {message.content}
                  </p>

                  {message.visualization && (
                    <div className="mt-4">
                      <ChartDisplay visualization={message.visualization} />
                    </div>
                  )}

                  {message.role === 'assistant' && (
                    <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-200">
                      {message.visualization && (
                        <>
                          <button
                            onClick={() => handleShare(message)}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors"
                          >
                            <Share2 className="size-4" />
                            Share
                          </button>
                          <button
                            onClick={() => handleExport(message)}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
                          >
                            <FileDown className="size-4" />
                            Export
                          </button>
                        </>
                      )}

                      {/* Feedback buttons */}
                      <div className="ml-auto flex items-center gap-2">
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
        {messages.length === 1 && (
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
        <div className="bg-white border-t border-gray-200 p-6">
          <form onSubmit={handleSubmit} className="max-w-5xl mx-auto">
            <div className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question about your data..."
                disabled={isLoading}
                className="flex-1 px-6 py-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
              />
              <button
                type="button"
                onClick={handleVoiceInput}
                disabled={isLoading || isListening}
                className={`px-6 py-4 rounded-xl transition-colors font-medium flex items-center gap-2 ${isListening
                  ? 'bg-red-600 text-white animate-pulse'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
              >
                {isListening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-8 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
              >
                {isLoading ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Send className="size-5" />
                )}
                Send
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
      </div>
    </div>
  );
}