import type React from 'react';

export interface StudioPlugin<TState = any> {
  id: string;
  name: string;
  shortName: string;
  description: string;
  icon: string; // emoji or icon name
  category: 'security' | 'research' | 'architecture' | 'productivity';
  frameworks?: { id: string; name: string; description: string }[];
  defaultFramework?: string;
  getInitialState: (framework?: string) => TState;
  buildSystemPrompt: (canvasState: TState, framework?: string) => string;
  parseModelOutput: (text: string, currentState: TState) => { cleanText: string; updatedState?: TState };
  RendererComponent: React.ComponentType<{
    state: TState;
    framework?: string;
    onChange: (newState: TState) => void;
    onSendPrompt: (prompt: string) => void;
  }>;
}
