import type { Conversation } from '@/types';

/**
 * Returns the most accurate timestamp for a conversation.
 * It checks the latest message's timestamp (if available) or falls back to updated_at / created_at.
 */
export function getConversationTimestamp(conv: Conversation): string {
  if (conv.messages && conv.messages.length > 0) {
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const msg = conv.messages[i];
      if (msg.meta?.created) {
        const ms = msg.meta.created < 1e11 ? msg.meta.created * 1000 : msg.meta.created;
        if (!isNaN(ms) && ms > 0) {
          return new Date(ms).toISOString();
        }
      }
    }
  }
  return conv.updated_at || conv.created_at || new Date().toISOString();
}

/**
 * Formats a date or ISO string into a human-friendly relative time string.
 */
export function formatTime(iso: string | number | undefined | null): string {
  if (!iso) return '';
  let d: Date;
  if (typeof iso === 'number') {
    const ms = iso < 1e11 ? iso * 1000 : iso;
    d = new Date(ms);
  } else {
    d = new Date(iso);
  }
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diff = now.getTime() - d.getTime();

  // If clock skew or less than 1 minute
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Categorizes a timestamp into grouped sidebar sections.
 */
export function getGroupLabel(iso: string | number | undefined | null): string {
  if (!iso) return 'Older';
  let d: Date;
  if (typeof iso === 'number') {
    const ms = iso < 1e11 ? iso * 1000 : iso;
    d = new Date(ms);
  } else {
    d = new Date(iso);
  }
  if (isNaN(d.getTime())) return 'Older';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const lastWeek = new Date(today.getTime() - 7 * 86400000);

  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= lastWeek) return 'Previous 7 Days';
  return 'Older';
}

/**
 * Sorts conversations descending by their most recent activity timestamp.
 */
export function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const tA = new Date(getConversationTimestamp(a)).getTime();
    const tB = new Date(getConversationTimestamp(b)).getTime();
    return tB - tA;
  });
}
