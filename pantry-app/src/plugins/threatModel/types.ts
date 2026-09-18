export type ThreatSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type ThreatStatus = 'Open' | 'Mitigated' | 'Accepted';
export type ComponentType = 'actor' | 'process' | 'datastore' | 'gateway' | 'external' | 'agent';

export interface ThreatComponent {
  id: string;
  name: string;
  type: ComponentType;
  trustBoundary: string;
  techStack?: string;
  description?: string;
}

export interface ThreatItem {
  id: string;
  componentId?: string;
  componentName?: string;
  category: string;
  threatActor: string;
  attackVector: string;
  description: string;
  impact: string;
  severity: ThreatSeverity;
  mitigation: string;
  status: ThreatStatus;
}

export interface ThreatStage {
  id: string | number;
  name: string;
  framework: 'PASTA' | 'STRIDE' | 'MAESTRO' | string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  findings?: string;
}

export interface ThreatModelState {
  appName: string;
  framework: 'PASTA' | 'STRIDE' | 'MAESTRO';
  scope: string;
  businessObjectives: string[];
  components: ThreatComponent[];
  threats: ThreatItem[];
  stages: ThreatStage[];
  dfdMermaid: string;
  updatedAt?: string;
}
