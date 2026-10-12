/**
 * 会话（conversation）—— 与"品牌会话"刻意分开。
 *
 * 为什么必须分开：新流程是**先聊天推荐、再挑品牌填 token**。
 * 所以对话必须能在**还没有任何品牌凭据**时就存在并工作。
 * 品牌会话（session.ts 的 Session）才持有 token 与品牌绑定。
 *
 * 一个 conversation 可以在聊到一半时**绑定**一个品牌会话，
 * 之后同一段对话就升级成"能查真实菜单、能暂存订单"的模式。
 */
import { randomUUID } from 'node:crypto';

export type ConversationTurn = { role: 'user' | 'assistant'; text: string; at: number };

export type Conversation = {
  id: string;
  turns: ConversationTurn[];
  /** 绑定后的品牌会话 id；未绑定即"纯推荐"模式。 */
  sessionId?: string;
  /** 记下绑定的品牌，便于展示与排查。 */
  brandId?: string;
  createdAt: number;
  lastSeenAt: number;
  chatTimes: number[];
  chatCount: number;
};

const CONVERSATIONS = new Map<string, Conversation>();

/** 对话闲置多久回收（比品牌会话长一些，因为聊天可能断断续续）。 */
const TTL_MS = Number(process.env.CHAT_CONVERSATION_TTL_MS ?? 2 * 60 * 60 * 1000);
/** 送进模型的历史轮数上限——太长会白烧 token。 */
export const HISTORY_LIMIT = Number(process.env.CHAT_HISTORY_LIMIT ?? 12);

export function createConversation(): Conversation {
  const conversation: Conversation = {
    id: randomUUID(),
    turns: [],
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    chatTimes: [],
    chatCount: 0,
  };
  CONVERSATIONS.set(conversation.id, conversation);
  return conversation;
}

export function getConversation(id: string): Conversation | undefined {
  const conversation = CONVERSATIONS.get(id);
  if (conversation === undefined) return undefined;
  if (Date.now() - conversation.lastSeenAt > TTL_MS) {
    CONVERSATIONS.delete(id);
    return undefined;
  }
  conversation.lastSeenAt = Date.now();
  return conversation;
}

export function appendTurn(conversation: Conversation, role: 'user' | 'assistant', text: string): void {
  conversation.turns.push({ role, text, at: Date.now() });
  // 只保留最近若干轮，避免内存与提示词无限增长。
  if (conversation.turns.length > HISTORY_LIMIT * 2) {
    conversation.turns = conversation.turns.slice(-HISTORY_LIMIT * 2);
  }
}

/** 把对话绑定到品牌会话——这一步之后同一段聊天就能查真实菜单了。 */
export function bindSession(conversation: Conversation, sessionId: string, brandId: string): void {
  conversation.sessionId = sessionId;
  conversation.brandId = brandId;
}

export function sweepConversations(): number {
  const now = Date.now();
  let removed = 0;
  for (const [id, conversation] of CONVERSATIONS) {
    if (now - conversation.lastSeenAt > TTL_MS) {
      CONVERSATIONS.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function conversationStats(): { active: number; bound: number } {
  let bound = 0;
  for (const conversation of CONVERSATIONS.values()) if (conversation.sessionId !== undefined) bound += 1;
  return { active: CONVERSATIONS.size, bound };
}

/** 供 runChatTurn 使用的最近历史（不含刚发来的那条）。 */
export function recentHistory(conversation: Conversation): ConversationTurn[] {
  return conversation.turns.slice(-HISTORY_LIMIT);
}
