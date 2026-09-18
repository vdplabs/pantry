import type { StudioPlugin } from '../types';
import type { RfcState } from './types';
import { getInitialRfcState, buildRfcSystemPrompt, parseRfcOutput } from './prompts';
import ArchitectureRfcCanvas from './components/ArchitectureRfcCanvas';

export const ArchitectureRfcPlugin: StudioPlugin<RfcState> = {
  id: 'architecture-rfc',
  name: 'Architecture RFC & Design Doc Studio',
  shortName: 'RFC Studio',
  description: 'Structured system design RFCs, Architecture Decision Records (ADRs), tradeoff evaluation, and C4 topology diagrams.',
  icon: '📐',
  category: 'architecture',
  defaultFramework: 'rfc',
  frameworks: [
    {
      id: 'rfc',
      name: 'System Design RFC',
      description: 'Formal design doc: Context, Goals, Architecture, Invariants, Rollout.',
    },
    {
      id: 'adr',
      name: 'Architecture Decision Record',
      description: 'Lightweight decision matrix: Context, Decision, Consequences.',
    },
    {
      id: 'api-spec',
      name: 'API & Data Contract Spec',
      description: 'REST/gRPC contracts, schema evolution, and protocol invariants.',
    },
  ],
  getInitialState: getInitialRfcState,
  buildSystemPrompt: buildRfcSystemPrompt,
  parseModelOutput: parseRfcOutput,
  RendererComponent: ArchitectureRfcCanvas,
};
