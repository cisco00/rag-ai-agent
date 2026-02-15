
import React, { useState, useEffect, useRef } from 'react';
import { Send, Plus, MessageSquare, Trash2, Bot, User, Download, FileText, MonitorPlay } from 'lucide-react';
import { api } from '../services/api';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface Session {
    id: string;
    title: string | null;
    created_at: string;
}

interface Message {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
    visualization?: any;
    query?: string;
}

export const ChatPage: React.FC = () => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const apiKey = localStorage.getItem('vantage_api_key');

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (apiKey) {
            loadSessions();
        }
    }, [apiKey]);

    useEffect(() => {
        if (apiKey && currentSessionId) {
            loadMessages(currentSessionId);
        } else {
            setMessages([]);
        }
    }, [apiKey, currentSessionId]);

    const loadSessions = async () => {
        if (!apiKey) return;
        try {
            const data = await api.getSessions(apiKey);
            setSessions(data);
            if (data.length > 0 && !currentSessionId) {
                setCurrentSessionId(data[0].id);
            }
        } catch (e) {
            console.error("Failed to load sessions", e);
        }
    };

    const loadMessages = async (sessionId: string) => {
        if (!apiKey) return;
        try {
            const data = await api.getSessionMessages(sessionId, apiKey);
            setMessages(data);
        } catch (e) {
            console.error("Failed to load messages", e);
        }
    };

    const handleNewSession = async () => {
        if (!apiKey) return;
        try {
            const newSession = await api.createSession("New Chat", apiKey);
            setSessions([newSession, ...sessions]);
            setCurrentSessionId(newSession.id);
        } catch (e) {
            console.error("Failed to create session", e);
        }
    };

    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (!apiKey) return;
        try {
            await api.deleteSession(sessionId, apiKey);
            setSessions(sessions.filter(s => s.id !== sessionId));
            if (currentSessionId === sessionId) {
                setCurrentSessionId(null);
            }
        } catch (e) {
            console.error("Failed to delete session", e);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || !apiKey) return;
        if (!currentSessionId) {
            const newSession = await api.createSession("New Chat", apiKey);
            setSessions([newSession, ...sessions]);
            setCurrentSessionId(newSession.id);
            await sendMessage(newSession.id, input);
        } else {
            await sendMessage(currentSessionId, input);
        }
    };

    const sendMessage = async (sessionId: string, text: string) => {
        const tempUserMsg: Message = {
            id: Date.now(),
            role: 'user',
            content: text,
            created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempUserMsg]);
        setInput('');
        setIsLoading(true);

        try {
            // @ts-ignore - Ignoring session_id type check as it's passed to backend
            const response = await api.query({ query: text, history: [], session_id: sessionId }, apiKey!);

            const assistantMsg: Message = {
                id: Date.now() + 1,
                role: 'assistant',
                content: response.response,
                created_at: new Date().toISOString(),
                visualization: response.visualization,
                query: text
            };
            setMessages(prev => [...prev, assistantMsg]);

            // Reload sessions to update titles but don't reload messages to keep visualization
            loadSessions();
        } catch (e) {
            console.error("Failed to send message", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportPDF = async (msg: Message) => {
        if (!apiKey) return;
        try {
            const blob = await api.exportPDF({
                query: msg.query || "Chat Query",
                response: msg.content,
                visualization: msg.visualization,
                status: "success"
            }, apiKey);

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `report-${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Export PDF failed", error);
            alert("Failed to export PDF");
        }
    };

    const handleExportPPTX = async (msg: Message) => {
        if (!apiKey) return;
        try {
            const blob = await api.exportPPTX({
                query: msg.query || "Chat Query",
                response: msg.content,
                visualization: msg.visualization,
                status: "success"
            }, apiKey);

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `presentation-${Date.now()}.pptx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Export PPTX failed", error);
            alert("Failed to export PPTX");
        }
    };

    const renderVisualization = (viz: any) => {
        if (!viz || !viz.type || !viz.data) return null;

        const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

        return (
            <div className="visualization-container" style={{ width: '100%', height: 300, marginTop: '1rem', marginBottom: '1rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                    {viz.type === 'bar' ? (
                        <BarChart data={viz.data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey={viz.x_axis || 'name'} />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey={viz.y_axis || 'value'} fill="#8884d8" />
                        </BarChart>
                    ) : viz.type === 'line' ? (
                        <LineChart data={viz.data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey={viz.x_axis || 'name'} />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey={viz.y_axis || 'value'} stroke="#8884d8" />
                        </LineChart>
                    ) : viz.type === 'pie' ? (
                        <PieChart>
                            <Pie
                                data={viz.data}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey={viz.value_column || 'value'}
                            >
                                {viz.data.map((entry: any, index: number) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                    ) : (
                        <div className="viz-error">Unsupported visualization type: {viz.type}</div>
                    )}
                </ResponsiveContainer>
            </div>
        );
    };

    return (
        <div className="chat-page">
            <div className="sessions-sidebar">
                <button className="new-chat-btn" onClick={handleNewSession}>
                    <Plus size={16} /> New Chat
                </button>
                <div className="sessions-list">
                    {sessions.map(session => (
                        <div
                            key={session.id}
                            className={`session-item ${currentSessionId === session.id ? 'active' : ''}`}
                            onClick={() => setCurrentSessionId(session.id)}
                        >
                            <MessageSquare size={14} />
                            <span className="session-title">{session.title || "New Chat"}</span>
                            <button className="delete-session-btn" onClick={(e) => handleDeleteSession(e, session.id)}>
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            <div className="chat-main">
                {!currentSessionId ? (
                    <div className="empty-state">
                        <h2 style={{ color: 'var(--text-primary)' }}>Select or create a chat to begin</h2>
                    </div>
                ) : (
                    <>
                        <div className="messages-area">
                            {messages.map((msg) => (
                                <div key={msg.id} className={`message-wrapper ${msg.role}`}>
                                    <div className="message-avatar">
                                        {msg.role === 'assistant' ? <Bot size={20} /> : <User size={20} />}
                                    </div>
                                    <div className="message-content">
                                        <div className="message-text">
                                            {msg.content.split('\n').map((line, i) => (
                                                <React.Fragment key={i}>
                                                    {line}
                                                    <br />
                                                </React.Fragment>
                                            ))}
                                        </div>
                                        {msg.visualization && renderVisualization(msg.visualization)}
                                        {msg.role === 'assistant' && msg.visualization && (
                                            <div className="message-actions" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem' }}>
                                                <button
                                                    className="action-btn"
                                                    onClick={() => handleExportPDF(msg)}
                                                    title="Export as PDF"
                                                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-primary)' }}
                                                >
                                                    <FileText size={14} /> PDF
                                                </button>
                                                <button
                                                    className="action-btn"
                                                    onClick={() => handleExportPPTX(msg)}
                                                    title="Export as PowerPoint"
                                                    style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-primary)' }}
                                                >
                                                    <MonitorPlay size={14} /> PPTX
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="message-wrapper assistant">
                                    <div className="message-avatar"><Bot size={20} /></div>
                                    <div className="message-content">
                                        <div className="typing-indicator">Thinking...</div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                        <div className="input-area">
                            <div className="input-container">
                                <textarea
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSend();
                                        }
                                    }}
                                    placeholder="Type your message..."
                                    rows={1}
                                />
                                <button className="send-btn" onClick={handleSend} disabled={isLoading || !input.trim()}>
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            <style>{`
        .chat-page {
          display: flex;
          height: 100vh;
          width: 100%;
          background-color: var(--bg-primary);
        }
        .sessions-sidebar {
          width: 250px;
          border-right: 1px solid var(--color-border);
          padding: 1rem;
          display: flex;
          flex-direction: column;
          background-color: var(--sidebar-bg);
        }
        .new-chat-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          padding: 0.75rem;
          background-color: var(--color-primary);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 500;
          margin-bottom: 1rem;
        }
        .sessions-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .session-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem;
          border-radius: 6px;
          cursor: pointer;
          color: var(--text-secondary);
          transition: background-color 0.2s;
        }
        .session-item:hover {
          background-color: var(--sidebar-hover);
        }
        .session-item.active {
          background-color: var(--sidebar-active);
          color: white;
        }
        .session-title {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 0.9rem;
        }
        .delete-session-btn {
          background: none;
          border: none;
          color: inherit;
          opacity: 0;
          cursor: pointer;
          padding: 4px;
        }
        .session-item:hover .delete-session-btn {
          opacity: 1;
        }
        
        .chat-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .messages-area {
          flex: 1;
          overflow-y: auto;
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .message-wrapper {
          display: flex;
          gap: 1rem;
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
        }
        .message-wrapper.user {
          flex-direction: row-reverse;
        }
        .message-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background-color: var(--color-border);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .assistant .message-avatar {
          background-color: var(--color-primary);
          color: white;
        }
        .message-content {
          background-color: var(--card-bg);
          padding: 1rem;
          border-radius: 12px;
          border: 1px solid var(--color-border);
          max-width: 80%;
        }
        .user .message-content {
           background-color: var(--color-primary);
           color: white;
           border: none;
        }
        .input-area {
          padding: 1.5rem 2rem;
          background-color: var(--bg-primary);
          border-top: 1px solid var(--color-border);
        }
        .input-container {
          max-width: 800px;
          margin: 0 auto;
          position: relative;
          background-color: var(--card-bg);
          border-radius: 12px;
          border: 1px solid var(--color-border);
          padding: 0.75rem;
          display: flex;
          align-items: flex-end;
          gap: 0.5rem;
        }
        textarea {
          flex: 1;
          border: none;
          background: transparent;
          resize: none;
          padding: 0.5rem;
          color: var(--text-primary);
          font-family: inherit;
          max-height: 150px;
        }
        textarea:focus {
          outline: none;
        }
        .send-btn {
          background-color: var(--color-primary);
          color: white;
          border: none;
          border-radius: 8px;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .empty-state {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      `}</style>
        </div>
    );
};
