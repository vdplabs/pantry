export type LensPreset = 'adr' | 'threat_model' | 'research';
export type LensViewMode = 'architecture' | 'cards' | 'document';

export type ComponentCategory = 'external_network' | 'service_process' | 'database_store';
export type ComponentType = 'client' | 'service' | 'gateway' | 'datastore' | 'security' | 'external' | 'actor' | 'queue' | 'asset';

export interface LensComponent {
  id: string;              // e.g. 'client', 'api_gateway', 'web_server', 'in_memory_cache'
  name: string;            // 'Client', 'API Gateway', 'In Memory Key Storage'
  subtitle?: string;        // 'API Gateway', 'mTLS termination', 'Persistence'
  type: ComponentType;
  category: ComponentCategory;
  boundaryId?: string;     // Parent boundary ID if grouped
  x: number;
  y: number;
  width?: number;
  height?: number;
  threatCount?: number;    // Count of associated threats
  icon?: string;           // Custom icon identifier
  cardSize?: 'compact' | 'standard' | 'wide' | 'large';
  notes?: string;
  metadata?: Record<string, any>;
}

export interface LensBoundary {
  id: string;              // e.g. 'public_dmz', 'internal_mesh', 'trust_boundary'
  title: string;           // 'PUBLIC DMZ INGRESS BOUNDARY'
  subtitle?: string;        // '• Network Perimeter', '• mTLS Zero Trust'
  color: 'orange' | 'blue' | 'purple' | 'green' | 'gray';
  x: number;
  y: number;
  width: number;
  height: number;
  componentIds: string[];
}

export interface LensConnection {
  id: string;
  from: string;            // source componentId
  to: string;              // target componentId
  label?: string;          // 'calls', 'authorizes', 'encrypt call', 'Decrypt KEK', 'exploits'
  style?: 'solid' | 'dashed' | 'dotted';
  color?: string;          // blue (calls), red (exploits), gray (sync)
  bidirectional?: boolean;
  direction?: 'forward' | 'bidirectional' | 'reverse';
  sourceHandle?: string;
  targetHandle?: string;
  routing?: 'straight' | 'angled' | 'curved';
  controlX?: number;
  controlY?: number;
}

export type NoteColor = 'yellow' | 'pink' | 'blue' | 'green' | 'orange' | 'gray';

export interface LensNote {
  id: string;
  text: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: NoteColor;
}

export type ThreatSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type ThreatLikelihood = 'High' | 'Medium' | 'Low';
export type ThreatStatus = 'Open' | 'Mitigated' | 'Accepted';

export interface LensThreat {
  id: string;              // e.g. 'THR-01', 'THR-08'
  title: string;           // 'SQL Injection Attack', 'Privileged access'
  componentId?: string;    // 'client', 'webserver'
  componentName?: string;  // Human-readable target name
  category: string;        // 'Elevation of Privilege', 'Spoofing', 'Info Disclosure', 'Tampering'
  threatActor?: string;    // 'Untrusted Attacker', 'Authenticated Tenant / Rogue User'
  attackVector?: string;    // 'sql injection', 'Arbitrary claim injection / DDoS'
  targetedAsset?: string;   // 'Transaction data in PostgreSQL'
  description: string;
  mitigation: string;
  linkedAdrId?: string;    // e.g. 'ADR-06', 'ADR-03'
  enforcingInvariantId?: string;
  severity: ThreatSeverity;
  likelihood: ThreatLikelihood;
  risk: ThreatSeverity;
  status: ThreatStatus;
  url?: string;
  isPinned?: boolean;
}

export type DecisionStatus = 'Proposed' | 'Approved' | 'Superseded' | 'Rejected';

export interface LensDecision { // ADR
  id: string;              // e.g. 'ADR-01', 'ADR-06'
  title: string;           // 'Cache Defence to mitigate THR-05'
  componentId?: string;
  componentName?: string;
  approach: string;        // 'Approach: Implementing a secure in-memory key storage solution.'
  rationale: string;
  alternatives?: string;    // 'Alternatives: No action, Use less secure in-memory storage'
  tradeoffs?: string;
  status: DecisionStatus;
  url?: string;
  isPinned?: boolean;
}

export interface LensInvariant {
  id: string;              // e.g. 'INV-01', 'INV-06'
  title: string;           // 'State Durability & Write-Ahead Log Integrity'
  componentId?: string;
  componentName?: string;
  statement: string;       // Invariant mathematical/behavioral guarantee
  enforcementMechanism?: string;
  category: string;        // 'Automated Policy / Runtime Verification' or semantic category
  status: 'Enforced' | 'Planned';
  url?: string;
  isPinned?: boolean;
}

export interface LensFinding {
  id: string;
  title: string;
  summary: string;
  componentId?: string;
  severity?: ThreatSeverity;
  status?: string;
  isPinned?: boolean;
}

export interface LensState {
  id: string;
  title: string;           // e.g. 'Architecture Decision (ADR)'
  preset: LensPreset;
  activeView: LensViewMode;
  components: LensComponent[];
  boundaries: LensBoundary[];
  connections: LensConnection[];
  notes: LensNote[];
  threats: LensThreat[];
  decisions: LensDecision[];
  invariants: LensInvariant[];
  findings: LensFinding[];
  documentMarkdown: string;
  selectedComponentId?: string;
  theme?: 'dark' | 'light';
  updatedAt: string;
}
