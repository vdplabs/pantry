import React, { useEffect, useRef } from 'react';
import { Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AppProvider, useApp } from '@/context/AppContext';
import TopMenu from '@/components/TopMenu';
import Header from '@/components/Header';
import ConversationList from '@/components/ConversationList';
import ChatPage from '@/pages/ChatPage';
import ModelsPage from '@/pages/ModelsPage';
import ImagePage from '@/pages/ImagePage';
import MusicPage from '@/pages/MusicPage';
import STTPage from '@/pages/STTPage';
import SettingsPage from '@/pages/SettingsPage';
import api from '@/services/api';

const TAB_MAP: Record<string, string> = {
  '': 'chat',
  '/': 'chat',
  chat: 'chat',
  image: 'image',
  music: 'music',
  stt: 'stt',
  models: 'models',
  settings: 'settings',
};

function AppContentInner() {
  const { state, setModels, setActiveTab, conversations, activeConversationId, generations, selectConversation, dbReady, createConversation } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams<{ tab?: string; id?: string }>();
  const navTargetRef = useRef<string | null>(null);
  const lastUrlIdRef = useRef<string | null>(null);

  const urlTab = TAB_MAP[params.tab || ''] || 'chat';
  const urlId = params.id || null;

  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab, setActiveTab]);

  useEffect(() => {
    api.listModels().then(res => {
      const models = res.data || res;
      if (Array.isArray(models)) setModels(models as any);
    }).catch(() => { });
  }, [setModels]);

  useEffect(() => {
    if (!dbReady) return;
    if (urlId === lastUrlIdRef.current) return;
    lastUrlIdRef.current = urlId;
    if (urlTab === 'chat') {
      if (urlId) {
        const conv = conversations.find(c => c.id === urlId);
        if (conv) {
          selectConversation(urlId);
        }
      } else if (activeConversationId) {
        // Navigate to the saved active conversation
        navigate(`/chat/${activeConversationId}`, { replace: true });
      } else if (conversations.length > 0) {
        // Load the most recent conversation
        const latest = conversations[0];
        navigate(`/chat/${latest.id}`, { replace: true });
      } else {
        // No conversations exist, create a new one
        createConversation();
      }
    }
  }, [urlId, urlTab, dbReady, conversations, activeConversationId, selectConversation, navigate, createConversation]);

  useEffect(() => {
    if (!dbReady) return;
    let target: string | null = null;
    if (state.activeTab === 'chat') {
      target = activeConversationId ? `/chat/${activeConversationId}` : '/chat';
    } else if (['image', 'music', 'stt'].includes(state.activeTab)) {
      if (params.id) {
        target = `/${state.activeTab}/${params.id}`;
      } else {
        target = `/${state.activeTab}`;
      }
    }
    if (target && navTargetRef.current !== target) {
      navTargetRef.current = target;
      navigate(target, { replace: true });
    }
  }, [state.activeTab, activeConversationId, generations, dbReady, navigate, params.id]);

  const renderPage = () => {
    switch (state.activeTab) {
      case 'chat': return <ChatPage />;
      case 'image': return <ImagePage />;
      case 'music': return <MusicPage />;
      case 'stt': return <STTPage />;
      case 'models': return <ModelsPage />;
      case 'settings': return <SettingsPage />;
      default: return <ChatPage />;
    }
  };

  return (
    <div className="app-layout">
      <div className="app-main">
        <TopMenu />
        <div className="app-content">
          {state.activeTab === 'chat' ? (
            <div className="chat-layout">
              <div className="chat-sidebar">
                <ConversationList />
              </div>
              <div className="chat-main">
                {/* <Header /> */}
                <div className="app-content">
                  {renderPage()}
                </div>
              </div>
              <aside><ModelsPage /></aside>
              
            </div>
          ) : (
            <>
              {/* <Header /> */}
              <div className="app-content">
                {renderPage()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  return <AppContentInner />;
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/" element={<AppContent />} />
        <Route path="/:tab" element={<AppContent />} />
        <Route path="/:tab/:id" element={<AppContent />} />
      </Routes>
    </AppProvider>
  );
}
