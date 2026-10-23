/**
 * CardComments — Feature #7: Threaded Comments on Dashboard Cards
 *
 * A slide-out panel that renders threaded comments for a single card.
 * Supports @mentions (detected by typing "@" then a name), replies,
 * edit and soft-delete. Opened by a comment bubble button on each card.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle, X, Send, Reply, Trash2, Edit3,
  ChevronDown, ChevronUp, User as UserIcon
} from 'lucide-react';
import { api } from '../../lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

interface Comment {
  id: number;
  dashboard_id: number;
  card_id: number;
  user_id: number | null;
  display_name: string;
  parent_id: number | null;
  body: string;
  mentions: string[];
  created_at: string;
  updated_at: string;
}

interface CardCommentsProps {
  dashboardId: number;
  cardId: number;
  cardTitle?: string;
  currentUser?: { display_name: string; id?: number };
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ''; }
}

/** Highlight @mentions in comment body */
function renderBody(body: string) {
  return body.split(/(@\w[\w\s]*)/g).map((chunk, i) =>
    chunk.startsWith('@')
      ? <span key={i} className="text-indigo-600 font-semibold">{chunk}</span>
      : <span key={i}>{chunk}</span>
  );
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-sky-500', 'bg-violet-500',
];

function avatarColor(name: string) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── CommentInput ────────────────────────────────────────────────────────────

interface CommentInputProps {
  placeholder?: string;
  onSubmit: (body: string, mentions: string[]) => Promise<void>;
  onCancel?: () => void;
  initialValue?: string;
  autoFocus?: boolean;
}

function CommentInput({ placeholder, onSubmit, onCancel, initialValue = '', autoFocus }: CommentInputProps) {
  const [text, setText] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const extractMentions = (s: string) =>
    [...s.matchAll(/@(\w[\w\s]{0,20})/g)].map(m => m[1].trim());

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, extractMentions(trimmed));
      setText('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
        }}
        placeholder={placeholder || 'Add a comment… Type @ to mention someone'}
        rows={2}
        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 resize-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent outline-none leading-relaxed"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          <Send size={12} />
          {submitting ? 'Sending…' : 'Send'}
        </button>
        {onCancel && (
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
        )}
        <span className="ml-auto text-[10px] text-gray-300">⌘↵ to send</span>
      </div>
    </div>
  );
}

// ── CommentThread ───────────────────────────────────────────────────────────

interface CommentNodeProps {
  comment: Comment;
  replies: Comment[];
  currentUser?: { display_name: string; id?: number };
  dashboardId: number;
  cardId: number;
  onRefresh: () => void;
  depth?: number;
}

function CommentNode({ comment, replies, currentUser, dashboardId, cardId, onRefresh, depth = 0 }: CommentNodeProps) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(true);

  const isOwn = currentUser && comment.display_name === currentUser.display_name;

  const handleDelete = async () => {
    if (!confirm('Delete this comment?')) return;
    await api.delete(`/dashboards/${dashboardId}/cards/${cardId}/comments/${comment.id}`);
    onRefresh();
  };

  const handleEdit = async (body: string) => {
    await api.put(`/dashboards/${dashboardId}/cards/${cardId}/comments/${comment.id}`, { body });
    setEditing(false);
    onRefresh();
  };

  const handleReply = async (body: string, mentions: string[]) => {
    await api.post(`/dashboards/${dashboardId}/cards/${cardId}/comments`, {
      body,
      parent_id: comment.id,
      mentions,
    });
    setReplying(false);
    onRefresh();
  };

  return (
    <div className={`${depth > 0 ? 'ml-8 border-l-2 border-indigo-50 pl-4' : ''}`}>
      <div className="flex items-start gap-2.5 group py-3">
        {/* Avatar */}
        <div className={`size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarColor(comment.display_name)}`}>
          {initials(comment.display_name)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-gray-900">{comment.display_name}</span>
            <span className="text-[10px] text-gray-400">{relTime(comment.created_at)}</span>
            {comment.created_at !== comment.updated_at && (
              <span className="text-[10px] text-gray-400 italic">(edited)</span>
            )}
          </div>

          {/* Body */}
          {editing ? (
            <CommentInput
              initialValue={comment.body}
              onSubmit={handleEdit}
              onCancel={() => setEditing(false)}
              autoFocus
            />
          ) : (
            <p className="text-sm text-gray-700 leading-relaxed">{renderBody(comment.body)}</p>
          )}

          {/* Mentions */}
          {comment.mentions.length > 0 && !editing && (
            <div className="mt-1 flex flex-wrap gap-1">
              {comment.mentions.map(m => (
                <span key={m} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full">@{m}</span>
              ))}
            </div>
          )}

          {/* Actions */}
          {!editing && (
            <div className="flex items-center gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setReplying(r => !r)}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-indigo-600 transition-colors"
              >
                <Reply size={11} /> Reply
              </button>
              {isOwn && (
                <>
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <Edit3 size={11} /> Edit
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </>
              )}
            </div>
          )}

          {/* Reply input */}
          {replying && (
            <div className="mt-2">
              <CommentInput
                placeholder={`Reply to ${comment.display_name}…`}
                onSubmit={handleReply}
                onCancel={() => setReplying(false)}
                autoFocus
              />
            </div>
          )}
        </div>
      </div>

      {/* Nested replies */}
      {replies.length > 0 && (
        <div>
          <button
            onClick={() => setShowReplies(s => !s)}
            className="flex items-center gap-1 text-[11px] text-indigo-500 mb-1 ml-9 hover:text-indigo-700"
          >
            {showReplies ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          </button>
          {showReplies && replies.map(r => (
            <CommentNode
              key={r.id}
              comment={r}
              replies={[]}
              currentUser={currentUser}
              dashboardId={dashboardId}
              cardId={cardId}
              onRefresh={onRefresh}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export function CardComments({ dashboardId, cardId, cardTitle, currentUser, onClose }: CardCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ comments: Comment[] }>(
        `/dashboards/${dashboardId}/cards/${cardId}/comments`
      );
      setComments(res.comments || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [dashboardId, cardId]);

  useEffect(() => { load(); }, [load]);

  const handleNew = async (body: string, mentions: string[]) => {
    await api.post(`/dashboards/${dashboardId}/cards/${cardId}/comments`, {
      body, parent_id: null, mentions,
    });
    load();
  };

  // Build thread structure: top-level + their replies
  const topLevel = comments.filter(c => !c.parent_id);
  const repliesFor = (parentId: number) => comments.filter(c => c.parent_id === parentId);

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-indigo-600" />
          <h3 className="font-bold text-sm text-gray-900">Comments</h3>
          {comments.length > 0 && (
            <span className="text-xs bg-indigo-100 text-indigo-600 font-bold px-1.5 py-0.5 rounded-full">{comments.length}</span>
          )}
        </div>
        {cardTitle && <p className="text-xs text-gray-400 truncate max-w-[140px]">{cardTitle}</p>}
        <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
          <X size={15} />
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-4 divide-y divide-gray-50">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="size-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        )}
        {!loading && topLevel.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-2 text-gray-400">
            <MessageCircle size={32} className="opacity-30" />
            <p className="text-xs">No comments yet. Start the conversation!</p>
          </div>
        )}
        {topLevel.map(c => (
          <CommentNode
            key={c.id}
            comment={c}
            replies={repliesFor(c.id)}
            currentUser={currentUser}
            dashboardId={dashboardId}
            cardId={cardId}
            onRefresh={load}
          />
        ))}
      </div>

      {/* New comment */}
      <div className="border-t border-gray-100 p-4 shrink-0">
        <div className="flex items-start gap-2">
          <div className={`size-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5 ${currentUser ? avatarColor(currentUser.display_name) : 'bg-gray-300'}`}>
            {currentUser ? initials(currentUser.display_name) : <UserIcon size={12} />}
          </div>
          <div className="flex-1">
            <CommentInput onSubmit={handleNew} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bubble button (placed on each card) ────────────────────────────────────

interface CommentBubbleProps {
  count: number;
  onClick: () => void;
}

export function CommentBubble({ count, onClick }: CommentBubbleProps) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
        count > 0
          ? 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
      }`}
      title="Comments"
    >
      <MessageCircle size={13} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
