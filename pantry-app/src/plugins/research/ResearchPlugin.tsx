import type { StudioPlugin } from '../types';
import type { ResearchState } from './types';
import { getInitialResearchState, buildResearchSystemPrompt, parseResearchOutput } from './prompts';
import ResearchCanvas from './components/ResearchCanvas';

export const ResearchPlugin: StudioPlugin<ResearchState> = {
  id: 'research-studio',
  name: 'Research & Technical Deep-Dive Studio',
  shortName: 'Research',
  description: 'Iterative technical investigation, tradeoff analysis, and live synthesized research document canvas.',
  icon: '🔬',
  category: 'research',
  defaultFramework: 'technical',
  frameworks: [
    {
      id: 'technical',
      name: 'Technical Investigation',
      description: 'In-depth systems research, bottlenecks, algorithms, and tradeoffs.',
    },
    {
      id: 'comparison',
      name: 'Technology Comparison',
      description: 'Side-by-side technology matrix, benchmark analysis, and evaluation.',
    },
    {
      id: 'synthesis',
      name: 'Executive Synthesis',
      description: 'Industry patterns, literature review, and executive summaries.',
    },
  ],
  getInitialState: getInitialResearchState,
  buildSystemPrompt: buildResearchSystemPrompt,
  parseModelOutput: parseResearchOutput,
  RendererComponent: ResearchCanvas,
};
