import React from 'react';
import type { StudioPlugin } from '../types';
import type { ThreatModelState } from './types';
import { getInitialThreatModelState, buildThreatModelSystemPrompt, parseThreatModelOutput } from './prompts';
import ThreatModelCanvas from './components/ThreatModelCanvas';

export const ThreatModelPlugin: StudioPlugin<ThreatModelState> = {
  id: 'threat-model',
  name: 'Security & Threat Modeling Studio',
  shortName: 'Threat Studio',
  description: 'Collaborative living canvas for PASTA, STRIDE, and MAESTRO threat modeling with DFDs and mitigation registers.',
  icon: '🛡️',
  category: 'security',
  frameworks: [
    { id: 'PASTA', name: 'PASTA (Process for Attack Simulation & Threat Analysis)', description: 'Risk-centric 7-stage threat modeling methodology.' },
    { id: 'STRIDE', name: 'STRIDE Matrix', description: 'Developer-centric threat categorization across assets and trust boundaries.' },
    { id: 'MAESTRO', name: 'MAESTRO (Agentic & LLM Threat Modeling)', description: 'Security analysis for AI agents, prompt boundaries, and tool calling.' },
  ],
  defaultFramework: 'PASTA',
  getInitialState: (framework) => getInitialThreatModelState(framework || 'PASTA'),
  buildSystemPrompt: (canvasState, framework) => buildThreatModelSystemPrompt(canvasState, framework || 'PASTA'),
  parseModelOutput: (text, currentState) => parseThreatModelOutput(text, currentState),
  RendererComponent: ({ state, framework, onChange, onSendPrompt }) => (
    <ThreatModelCanvas state={state} framework={framework} onChange={onChange} onSendPrompt={onSendPrompt} />
  ),
};
