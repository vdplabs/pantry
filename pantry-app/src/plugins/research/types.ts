export interface ResearchFinding {
  id: string;
  topic: string;
  insight: string;
  confidence: 'High' | 'Medium' | 'Low';
  evidence?: string;
  takeaway?: string;
  source?: string;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  status: 'open' | 'investigating' | 'resolved';
  findings?: string;
}

export interface ResearchState {
  topicTitle: string;
  framework: 'technical' | 'comparison' | 'synthesis';
  hypothesis: string;
  documentMarkdown: string;
  findings: ResearchFinding[];
  questions: ResearchQuestion[];
  diagramMermaid?: string;
  updatedAt: string;
}
