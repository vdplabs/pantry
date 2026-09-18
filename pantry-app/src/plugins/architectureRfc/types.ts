export type RfcStatus = 'Draft' | 'In Review' | 'Approved' | 'Superseded';

export interface RfcDecision {
  id: string;
  title: string;
  status: 'Draft' | 'Approved' | 'Superseded' | 'Rejected';
  context: string;
  chosenOption: string;
  alternativesConsidered?: string;
  rationale: string;
  tradeoffs?: string;
}

export interface RfcInvariant {
  id: string;
  statement: string;
  category: 'Correctness' | 'Security' | 'Availability' | 'Performance';
  status: 'Enforced' | 'Planned';
}

export interface RfcState {
  title: string;
  framework: 'rfc' | 'adr' | 'api-spec';
  status: RfcStatus;
  scope: string;
  rfcMarkdown: string;
  decisions: RfcDecision[];
  invariants: RfcInvariant[];
  diagramMermaid: string;
  updatedAt: string;
}
