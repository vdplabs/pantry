import type { StudioPlugin } from './types';
import { ThreatModelPlugin } from './threatModel/ThreatModelPlugin';
import { ResearchPlugin } from './research/ResearchPlugin';
import { ArchitectureRfcPlugin } from './architectureRfc/ArchitectureRfcPlugin';

export const STUDIO_PLUGINS: StudioPlugin[] = [
  ThreatModelPlugin,
  ResearchPlugin,
  ArchitectureRfcPlugin,
];

export function getPluginById(id?: string | null): StudioPlugin | undefined {
  if (!id) return undefined;
  return STUDIO_PLUGINS.find(p => p.id === id);
}
