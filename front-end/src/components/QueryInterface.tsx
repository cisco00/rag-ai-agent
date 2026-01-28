import React, { useState } from 'react';
import { Send, Loader2, MessageSquare, FileText } from 'lucide-react';
import { api } from '../services/api';
import Plot from 'react-plotly.js';

interface Message {
    role: 'user' | 'assistant';
    content: string;
    visualization?: any;
}

import { useLocation } from 'react-router-dom';

export const QueryInterface: React.FC = () => {
    const location = useLocation();
    const initialQuery = location.state?.initialQuery || '';
    const [query, setQuery] = useState(initialQuery);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: 'Hello! Ask me any question about your data.' }
    ]);
    const [loading, setLoading] = useState(false);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        const userMsg = query;
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setQuery('');
        setLoading(true);

        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            const result = await api.query({
                query: userMsg,
                history: [] // Simplify history for now
            }, apiKey);

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: result.response,
                visualization: result.visualization
            }]);
        } catch (err: any) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${err.message || 'Something went wrong.'}`
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleExportPPTX = async (msg: Message) => {
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) return;

            // Use the last user query as the title/query context if available
            // For simplicity, we'll just use a generic title or find the preceding user message
            // But the API expects 'query'. We can try to find it from the message history context or just pass "Analysis Result"
            // Actually, let's pass the message content as the response.
            // And we need the query that generated this. 
            // In this simple UI, we can just grab the content of the message.

            const blob = await api.exportPPTX({
                query: "Analysis Export", // Ideally we'd track which query generated this response
                response: msg.content,
                visualization: msg.visualization,
                status: "success"
            }, apiKey);

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `presentation_${Date.now()}.pptx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error("Failed to export PPTX", err);
            alert("Failed to create presentation");
        }
    };

    return (
        <div className="chat-interface">
            <div className="messages-area">
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.role}`}>
                        <div className="message-content">
                            {msg.role === 'assistant' && <MessageSquare size={16} className="msg-icon" />}
                            <div className="text-content">
                                <p>{msg.content}</p>
                                {msg.visualization && (
                                    <div className="viz-container">
                                        <Plot
                                            data={[
                                                {
                                                    type: msg.visualization.type || 'bar',
                                                    x: msg.visualization.data.map((d: any) => d.label),
                                                    y: msg.visualization.data.map((d: any) => d.value),
                                                    marker: { color: '#3b82f6' }
                                                }
                                            ]}
                                            layout={{
                                                width: undefined,
                                                height: 300,
                                                autosize: true,
                                                margin: { l: 40, r: 20, t: 20, b: 40 },
                                                paper_bgcolor: 'rgba(0,0,0,0)',
                                                plot_bgcolor: 'rgba(0,0,0,0)',
                                            }}
                                            style={{ width: '100%', height: '100%' }}
                                            config={{ responsive: true, displayModeBar: true }}
                                        />
                                    </div>
                                )}
                                {msg.role === 'assistant' && (
                                    <div className="message-actions">
                                        <button
                                            className="action-btn"
                                            onClick={() => handleExportPPTX(msg)}
                                            title="Export to PowerPoint"
                                        >
                                            <FileText size={14} />
                                            <span>Export to PPTX</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="message assistant">
                        <div className="message-content">
                            <Loader2 size={16} className="msg-icon spin" />
                            <span>Thinking...</span>
                        </div>
                    </div>
                )}
            </div>

            <form className="input-area" onSubmit={handleSend}>
                <input
                    type="text"
                    className="query-input"
                    placeholder="Ask a question about your data..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={loading}
                />
                <button type="submit" className="send-btn" disabled={loading || !query.trim()}>
                    <Send size={18} />
                </button>
            </form>

            <style>{`
                .chat-interface {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: white;
                    border-radius: 12px;
                    border: 1px solid var(--color-border);
                    overflow: hidden;
                }
                .messages-area {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1.5rem;
                    display: flex;
                    flex-direction: column;
                    gap: 1.5rem;
                }
                .message {
                    display: flex;
                    max-width: 85%;
                }
                .message.user { align-self: flex-end; }
                .message.assistant { align-self: flex-start; }
                
                .message-content {
                    padding: 1rem;
                    border-radius: 12px;
                    display: flex;
                    gap: 0.75rem;
                    line-height: 1.5;
                }
                .message.user .message-content {
                    background-color: var(--color-primary);
                    color: white;
                }
                .message.assistant .message-content {
                    background-color: #f1f5f9;
                    color: var(--color-text-primary);
                }
                
                .msg-icon { margin-top: 0.25rem; flex-shrink: 0; }
                .text-content { flex: 1; }
                
                .viz-container {
                    margin-top: 1rem;
                    background: white;
                    padding: 1rem;
                    border-radius: 8px;
                    border: 1px solid var(--color-border);
                    width: 100%;
                    min-width: 400px;
                }

                .message-actions {
                    margin-top: 0.5rem;
                    display: flex;
                    gap: 0.5rem;
                }
                .action-btn {
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                    background: none;
                    border: 1px solid var(--color-border);
                    border-radius: 4px;
                    padding: 0.25rem 0.5rem;
                    font-size: 0.75rem;
                    color: var(--color-text-secondary);
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .action-btn:hover {
                    background: #f1f5f9;
                    color: var(--color-primary);
                }

                .input-area {
                    padding: 1rem;
                    border-top: 1px solid var(--color-border);
                    display: flex;
                    gap: 0.5rem;
                    background: white;
                }
                .query-input {
                    flex: 1;
                    padding: 0.75rem 1rem;
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    outline: none;
                }
                .query-input:focus { border-color: var(--color-primary); }
                .send-btn {
                    background: var(--color-primary);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    width: 48px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .send-btn:disabled { background: #94a3b8; cursor: not-allowed; }
                .spin { animation: spin 1s linear infinite; }
            `}</style>
        </div>
    );
};
