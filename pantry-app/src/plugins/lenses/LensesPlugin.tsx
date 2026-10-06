import React from 'react';
import type { StudioPlugin } from '../types';
import type { LensState, LensPreset } from './types';
import { getInitialLensState } from './presets';
import { buildLensesSystemPrompt, parseLensModelOutput } from './prompts';
import LensesWorkspace from './components/LensesWorkspace';

export const LensesPlugin: StudioPlugin<LensState> = {
  id: 'lenses',
  name: 'Lenses: Architecture, Threats & Invariants',
  shortName: 'Lenses',
  description: 'Canvas-driven architecture design, threat modeling, ADRs, and formal system invariants with AI collaboration.',
  icon: '🔍',
  category: 'architecture',
  frameworks: [
    {
      id: 'adr',
      name: 'Architecture Decision (ADR)',
      description: 'System topology, trade-offs, ADR decisions, and formal invariants',
    },
    {
      id: 'threat_model',
      name: 'Security & Threat Model',
      description: 'Perimeter boundaries, STRIDE threats, mitigations, and attack vectors',
    },
    {
      id: 'research',
      name: 'System Research & Architecture',
      description: 'Exploratory architecture synthesis, datastores, and message flows',
    },
  ],
  defaultFramework: 'adr',

  getInitialState: (framework?: string): LensState => {
    const validPreset: LensPreset =
      framework === 'threat_model' || framework === 'research' || framework === 'adr'
        ? framework
        : 'adr';
    return getInitialLensState(validPreset);
  },

  buildSystemPrompt: (canvasState: LensState): string => {
    return buildLensesSystemPrompt(canvasState);
  },

  parseModelOutput: (
    text: string,
    currentState: LensState,
    userPrompt?: string
  ): { cleanText: string; updatedState?: LensState } => {
    return parseLensModelOutput(text, currentState, userPrompt);
  },

  RendererComponent: ({ state, framework, onChange, onSendPrompt, sidebarOpen, onToggleSidebar, isChatCollapsed, onToggleChat }) => {
    return (
      <LensesWorkspace
        state={state}
        framework={framework}
        onChange={onChange}
        onSendPrompt={onSendPrompt}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        isChatCollapsed={isChatCollapsed}
        onToggleChat={onToggleChat}
      />
    );
  },
};
