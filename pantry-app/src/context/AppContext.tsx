import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { Message, ChatModality, ModelInfo, Conversation, Generation } from '@/types';
import {
  initDatabase,
  loadConversationsFromDb,
  saveConversationToDb,
  deleteConversationFromDb,
  loadGenerationsFromDb,
  saveGenerationToDb,
  deleteGenerationFromDb,
  getSetting,
  setSetting,
  removeSetting,
} from '@/db';
import { sortConversations } from '@/utils/conversationUtils';
import { getPluginById } from '@/plugins/registry';

interface AppState {
  sidebarOpen: boolean;
  activeTab: string;
  messages: Message[];
  model: string;
  modality: ChatModality;
  models: ModelInfo[];
  temperature: number;
  maxTokens: number;
  topP: number;
  systemPrompt: string;
  streamEnabled: boolean;
  preferSpeculative: boolean;
  adapters: string[];
  selectedAdapter: string;
  draftModel: string;
  isStreaming: boolean;
  apiUrl: string;
  generations: Generation[];
}

interface AppContextType {
  state: AppState;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  addUserMessage: (text: string) => void;
  setAssistantContent: (content: string) => void;
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  selectConversation: (id: string | null) => void;
  createConversation: (initialTitle?: string, pluginId?: string, pluginFramework?: string) => Promise<Conversation>;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  loadConversation: (conv: Conversation) => void;
  refreshConversations: () => Promise<void>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  updateCanvasState: (updater: any | ((prev: any) => any)) => void;
  setConversationPlugin: (id: string, pluginId: string, pluginFramework?: string) => void;
  setActiveTab: (tab: string) => void;
  setModel: (model: string) => void;
  setModality: (m: ChatModality) => void;
  setTemperature: (t: number) => void;
  setMaxTokens: (t: number) => void;
  setTopP: (t: number) => void;
  setSystemPrompt: (p: string) => void;
  setStreamEnabled: (s: boolean) => void;
  setPreferSpeculative: (s: boolean) => void;
  setAdapters: (a: string[]) => void;
  setSelectedAdapter: (a: string) => void;
  setDraftModel: (d: string) => void;
  setIsStreaming: (s: boolean) => void;
  setModels: (m: ModelInfo[]) => void;
  setSidebarOpen: (o: boolean) => void;
  generations: Generation[];
  addGeneration: (g: Generation) => void;
  deleteGeneration: (id: string) => void;
  setGenerations: React.Dispatch<React.SetStateAction<Generation[]>>;
  dbReady: boolean;
}

const defaultState: AppState = {
  sidebarOpen: true,
  activeTab: 'chat',
  messages: [],
  model: 'chat-standard',
  modality: 'chat',
  models: [],
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1.0,
  systemPrompt: 'You are a helpful and concise AI assistant powered by Pantry, a local model host.',
  streamEnabled: true,
  preferSpeculative: false,
  adapters: [],
  selectedAdapter: '',
  draftModel: '',
  isStreaming: false,
  apiUrl: 'http://127.0.0.1:18787',
  generations: [],
};

export function generateAutoTitle(text: string): string {
  const cleaned = text
    .replace(/^[#\s*`>-]+/, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!cleaned) return 'New Chat';
  if (cleaned.length <= 42) return cleaned;
  const truncated = cleaned.slice(0, 40);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim() + '...';
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(defaultState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [dbReady, setDbReady] = useState(false);
  const initialLoadRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function setup() {
      try {
        await initDatabase();
      } catch (err) {
        console.error('initDatabase failed:', err);
        return;
      }
      if (cancelled) return;
      try {
        const [loadedConvs, loadedGens, activeId, model, modality, apiUrl, sidebarOpen] = await Promise.all([
          loadConversationsFromDb(),
          loadGenerationsFromDb(),
          getSetting('active_conversation_id'),
          getSetting('pantry_model'),
          getSetting('pantry_modality'),
          getSetting('pantry_api_url'),
          getSetting('pantry_active'),
        ]);
        if (cancelled) return;
        setConversations(sortConversations(loadedConvs));
        setGenerations(loadedGens);
        if (activeId) {
          setActiveConversationId(activeId);
          const activeConv = loadedConvs.find(c => c.id === activeId);
          if (activeConv && activeConv.messages) {
            setMessages(activeConv.messages);
          }
        }
        if (model) updateState({ model });
        if (modality) updateState({ modality: modality as any });
        if (apiUrl) updateState({ apiUrl });
        if (sidebarOpen) {
          try {
            updateState({ sidebarOpen: JSON.parse(sidebarOpen) });
          } catch { }
        }
        setDbReady(true);
      } catch (err) {
        console.error('load data failed:', err);
      }
    }
    setup();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    if (activeConversationId) {
      setSetting('active_conversation_id', activeConversationId).catch(e => console.error('save active id failed:', e));
    } else {
      removeSetting('active_conversation_id').catch(e => console.error('remove active id failed:', e));
    }
  }, [activeConversationId, dbReady]);

  useEffect(() => {
    if (!dbReady) return;
    setSetting('pantry_active', JSON.stringify(state.sidebarOpen)).catch(e => console.error('save sidebar failed:', e));
  }, [state.sidebarOpen, dbReady]);

  useEffect(() => {
    if (!dbReady) return;
    setSetting('pantry_model', state.model).catch(e => console.error('save model failed:', e));
  }, [state.model, dbReady]);

  useEffect(() => {
    if (!dbReady) return;
    setSetting('pantry_modality', state.modality).catch(e => console.error('save modality failed:', e));
  }, [state.modality, dbReady]);

  useEffect(() => {
    if (!dbReady) return;
    setSetting('pantry_api_url', state.apiUrl).catch(e => console.error('save api url failed:', e));
  }, [state.apiUrl, dbReady]);

  useEffect(() => {
    setState(prev => ({ ...prev, messages }));
  }, [messages]);

  useEffect(() => {
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      return;
    }
    // Avoid hammering DB and triggering re-renders on every token during active streaming
    if (state.isStreaming) return;

    if (activeConversationId) {
      setConversations(prev => {
        const currentConv = prev.find(c => c.id === activeConversationId);
        if (!currentConv) return prev;

        const currentMsgs = currentConv.messages || [];
        const isSameMessages =
          currentMsgs === messages ||
          (currentMsgs.length === messages.length &&
            (currentMsgs.length === 0 ||
              (currentMsgs[currentMsgs.length - 1]?.content === messages[messages.length - 1]?.content &&
               currentMsgs[currentMsgs.length - 1]?.role === messages[messages.length - 1]?.role &&
               currentMsgs[0]?.content === messages[0]?.content)));

        let title = currentConv.title;
        // Auto-rename if title is default 'New Chat' or 'Untitled Chat' and we have user messages
        if ((!title || title === 'New Chat' || title === 'Untitled Chat') && messages.length > 0) {
          const firstUserMsg = messages.find(m => m.role === 'user');
          if (firstUserMsg) {
            let text = '';
            if (typeof firstUserMsg.content === 'string') {
              text = firstUserMsg.content;
            } else if (Array.isArray(firstUserMsg.content)) {
              const textObj = firstUserMsg.content.find(p => p.type === 'text');
              text = textObj?.text || '';
            }
            const autoTitle = generateAutoTitle(text);
            if (autoTitle && autoTitle !== 'New Chat') {
              title = autoTitle;
            }
          }
        }

        // If messages and title haven't changed, don't update updated_at or re-save
        if (isSameMessages && title === currentConv.title) {
          return prev;
        }

        const updatedConv: Conversation = {
          ...currentConv,
          title,
          messages,
          message_count: messages.length,
          updated_at: new Date().toISOString(),
        };

        saveConversationToDb(updatedConv).catch(e => console.error('saveConversation failed:', e));

        const updated = prev.map(c => c.id === activeConversationId ? updatedConv : c);
        return sortConversations(updated);
      });
    }
  }, [messages, activeConversationId, state.isStreaming]);

  const updateState = useCallback((partial: Partial<AppState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'user', content: text }]);
  }, []);

  const setAssistantContent = useCallback((content: string) => {
    setMessages(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (updated[lastIdx]?.role === 'assistant') {
        updated[lastIdx] = { ...updated[lastIdx], content };
      }
      return updated;
    });
  }, []);

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;

  const selectConversation = useCallback((id: string | null) => {
    setActiveConversationId(id);
    if (id) {
      const conv = conversations.find(c => c.id === id);
      if (conv) {
        setMessages(conv.messages);
        if (conv.model) updateState({ model: conv.model });
      }
    } else {
      setMessages([]);
    }
  }, [conversations, updateState]);

  const loadConversation = useCallback((conv: Conversation) => {
    setActiveConversationId(conv.id);
    setMessages(conv.messages);
    if (conv.model) updateState({ model: conv.model });
  }, [updateState]);

  const createConversation = useCallback(async (initialTitle?: string, pluginId?: string, pluginFramework?: string) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    const now = new Date().toISOString();

    let canvas_state: any = undefined;
    let title = initialTitle || 'New Chat';
    let plugin_framework = pluginFramework;

    if (pluginId) {
      const plugin = getPluginById(pluginId);
      if (plugin) {
        plugin_framework = pluginFramework || plugin.defaultFramework;
        canvas_state = plugin.getInitialState(plugin_framework);
        if (!initialTitle) {
          title = `${plugin.shortName || plugin.name} (${plugin_framework})`;
        }
      }
    }

    const conv: Conversation = {
      id,
      title,
      created_at: now,
      updated_at: now,
      message_count: 0,
      model: state.model || 'chat-standard',
      messages: [],
      plugin_id: pluginId,
      plugin_framework,
      canvas_state,
    };
    setConversations(prev => sortConversations([conv, ...prev]));
    setActiveConversationId(conv.id);
    setMessages([]);
    await saveConversationToDb(conv).catch(e => console.error('saveConversation failed:', e));
    return conv;
  }, [state.model]);

  const updateCanvasState = useCallback((updater: any) => {
    if (!activeConversationId) return;
    setConversations(prev => {
      const conv = prev.find(c => c.id === activeConversationId);
      if (!conv) return prev;
      const nextState = typeof updater === 'function' ? updater(conv.canvas_state) : { ...conv.canvas_state, ...updater };
      const updatedConv: Conversation = {
        ...conv,
        canvas_state: nextState,
        updated_at: new Date().toISOString(),
      };
      saveConversationToDb(updatedConv).catch(e => console.error('saveConversation failed:', e));
      return prev.map(c => c.id === activeConversationId ? updatedConv : c);
    });
  }, [activeConversationId]);

  const setConversationPlugin = useCallback((id: string, pluginId: string, pluginFramework?: string) => {
    const plugin = getPluginById(pluginId);
    if (!plugin) return;
    const framework = pluginFramework || plugin.defaultFramework;
    const initialState = plugin.getInitialState(framework);
    setConversations(prev => {
      const conv = prev.find(c => c.id === id);
      if (!conv) return prev;
      const updatedConv: Conversation = {
        ...conv,
        plugin_id: pluginId,
        plugin_framework: framework,
        canvas_state: initialState,
        updated_at: new Date().toISOString(),
      };
      saveConversationToDb(updatedConv).catch(e => console.error('saveConversation failed:', e));
      return prev.map(c => c.id === id ? updatedConv : c);
    });
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    setConversations(prev => {
      const conv = prev.find(c => c.id === id);
      if (!conv) return prev;
      const updatedConv = { ...conv, title, updated_at: new Date().toISOString() };
      saveConversationToDb(updatedConv).catch(e => console.error('saveConversation failed:', e));
      const updated = prev.map(c => c.id === id ? updatedConv : c);
      return sortConversations(updated);
    });
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
    }
    await deleteConversationFromDb(id).catch(e => console.error('deleteConversationFromDb failed:', e));
  }, [activeConversationId]);

  const addGeneration = useCallback((gen: Generation) => {
    setGenerations(prev => [gen, ...prev]);
    saveGenerationToDb(gen).catch(e => console.error('saveGeneration failed:', e));
  }, []);

  const deleteGeneration = useCallback(async (id: string) => {
    console.log('deleteGeneration called for:', id);
    setGenerations(prev => prev.filter(g => g.id !== id));
    try {
      await deleteGenerationFromDb(id);
      console.log('deleteGenerationFromDb succeeded for:', id);
    } catch (e) {
      console.error('deleteGenerationFromDb failed:', e);
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    console.warn('refreshConversations: backend API not available; conversations are local-only');
  }, []);

  return (
    <AppContext.Provider
      value={{
        state,
        setMessages,
        addUserMessage,
        setAssistantContent,
        conversations,
        activeConversationId,
        activeConversation,
        selectConversation,
        createConversation,
        renameConversation,
        deleteConversation,
        loadConversation,
        refreshConversations,
        setConversations,
        updateCanvasState,
        setConversationPlugin,
        setActiveTab: useCallback((tab) => updateState({ activeTab: tab }), [updateState]),
        setModel: useCallback((model) => updateState({ model }), [updateState]),
        setModality: useCallback((modality) => updateState({ modality }), [updateState]),
        setTemperature: useCallback((t) => updateState({ temperature: t }), [updateState]),
        setMaxTokens: useCallback((t) => updateState({ maxTokens: t }), [updateState]),
        setTopP: useCallback((t) => updateState({ topP: t }), [updateState]),
        setSystemPrompt: useCallback((p) => updateState({ systemPrompt: p }), [updateState]),
        setStreamEnabled: useCallback((s) => updateState({ streamEnabled: s }), [updateState]),
        setPreferSpeculative: useCallback((s) => updateState({ preferSpeculative: s }), [updateState]),
        setAdapters: useCallback((a) => updateState({ adapters: a }), [updateState]),
        setSelectedAdapter: useCallback((a) => updateState({ selectedAdapter: a }), [updateState]),
        setDraftModel: useCallback((d) => updateState({ draftModel: d }), [updateState]),
        setIsStreaming: useCallback((s) => updateState({ isStreaming: s }), [updateState]),
        setModels: useCallback((m) => updateState({ models: m }), [updateState]),
        setSidebarOpen: useCallback((o) => updateState({ sidebarOpen: o }), [updateState]),
        generations,
        addGeneration,
        deleteGeneration,
        setGenerations,
        dbReady,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}
