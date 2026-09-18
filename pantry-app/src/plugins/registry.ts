import type { StudioPlugin } from './types';
import { ThreatModelPlugin } from './threatModel/ThreatModelPlugin';

export const STUDIO_PLUGINS: StudioPlugin[] = [
  ThreatModelPlugin,
];

export function getPluginById(id?: string | null): StudioPlugin | undefined {
  if (!id) return undefined;
  return STUDIO_PLUGINS.find(p => p.id === id);
}
