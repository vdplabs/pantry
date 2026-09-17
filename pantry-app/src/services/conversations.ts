import api from './api';
import type { Conversation, Message } from '@/types';

export interface ConversationCreate {
  title?: string;
  model?: string;
  system_prompt?: string;
}

export interface ConversationUpdate {
  title?: string;
}

export interface ConversationListResponse {
  conversations: Conversation[];
  total: number;
}

const conversations = {
  list: () =>
    api.get<ConversationListResponse>('/v1/conversations').then(r => r.conversations),

  create: (data: ConversationCreate) =>
    api.post<Conversation>('/v1/conversations', data),

  get: (id: string) =>
    api.get<Conversation>(`/v1/conversations/${id}`),

  update: (id: string, data: ConversationUpdate) =>
    api.put<Conversation>(`/v1/conversations/${id}`, data),

  delete: (id: string) =>
    api.delete(`/v1/conversations/${id}`),

  addMessage: (id: string, message: Message) =>
    api.post(`/v1/conversations/${id}/messages`, { message }),

  rename: (id: string, title: string) =>
    api.put<Conversation>(`/v1/conversations/${id}`, { title }),
};

export default conversations;
