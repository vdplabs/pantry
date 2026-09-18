import type { ResearchState, ResearchFinding, ResearchQuestion } from './types';

export function getInitialResearchState(framework: string = 'technical'): ResearchState {
  const isComparison = framework === 'comparison';
  const isSynthesis = framework === 'synthesis';

  let title = 'Technical Architecture & Tradeoff Research';
  let hypothesis = 'Evaluating technical feasibility, latency characteristics, and operational overhead.';
  let defaultDiagram = `graph TD
    User["👤 Client Request"] --> System["⚙️ Architecture / Engine"]
    System --> OptionA["Option A: Distributed Solution"]
    System --> OptionB["Option B: Embedded / In-Memory"]
`;

  let defaultDoc = `# Technical Research Document
## 1. Objective & Hypothesis
Investigate the core architectural tradeoffs, performance profiles, and implementation complexities for the target domain.

## 2. Key Hypotheses & Constraints
- **Primary Goal**: Achieve ultra-low latency and predictable resource consumption.
- **Constraints**: Operational simplicity with local-first compatibility.

## 3. Findings & Evidence Analysis
*As research queries are discussed, key synthesized findings and benchmark observations will be recorded here.*

## 4. Architectural Tradeoffs
| Dimension | Approach A | Approach B |
|---|---|---|
| Latency | Sub-millisecond | Moderate |
| Complexity | Low | Medium |

## 5. Synthesis & Recommended Next Steps
- Validate prototype against realistic workloads.
`;

  if (isComparison) {
    title = 'Technology & Engine Evaluation Matrix';
    hypothesis = 'Comparing candidate technologies across feature completeness, ecosystem maturity, and benchmark throughput.';
    defaultDiagram = `quadrantChart
    title Technology Evaluation Matrix
    x-axis Low Performance --> High Performance
    y-axis High Complexity --> Low Complexity
    quadrant-1 Optimal Choice
    quadrant-2 High Perf / High Effort
    quadrant-3 Sub-optimal
    quadrant-4 Quick Prototype
    "Candidate Alpha": [0.8, 0.75]
    "Candidate Beta": [0.65, 0.4]
    "Legacy Stack": [0.3, 0.3]
`;
  } else if (isSynthesis) {
    title = 'Executive Research Synthesis & Literature Review';
    hypothesis = 'Synthesizing state-of-the-art literature, industry patterns, and actionable takeaways.';
  }

  const defaultQuestions: ResearchQuestion[] = [
    { id: 'q-1', question: 'What are the primary performance bottlenecks and scaling limits?', status: 'open' },
    { id: 'q-2', question: 'What are the main engineering risks and tradeoffs?', status: 'open' },
    { id: 'q-3', question: 'What does the existing ecosystem maturity and tooling look like?', status: 'open' },
  ];

  return {
    topicTitle: title,
    framework: (framework as any) || 'technical',
    hypothesis,
    documentMarkdown: defaultDoc,
    findings: [],
    questions: defaultQuestions,
    diagramMermaid: defaultDiagram,
    updatedAt: new Date().toISOString(),
  };
}

export function buildResearchSystemPrompt(canvasState: ResearchState, framework: string = 'technical'): string {
  const findingsSummary = (canvasState.findings || []).slice(0, 15).map(f =>
    `- [${f.id}] ${f.topic}: "${f.insight}" (Confidence: ${f.confidence}) -> Takeaway: ${f.takeaway || 'N/A'}`
  ).join('\n');

  const questionsSummary = (canvasState.questions || []).map(q =>
    `- [${q.id}] (${q.status.toUpperCase()}): ${q.question}${q.findings ? ` -> Resolved: ${q.findings}` : ''}`
  ).join('\n');

  return `You are a Principal Research Engineer and Technical Fellow collaborating with the user in Pantry's **Research Studio**.

CURRENT RESEARCH CANVAS:
- **Topic**: ${canvasState.topicTitle || 'Technical Research'}
- **Hypothesis**: ${canvasState.hypothesis || 'Exploring technical tradeoffs'}
- **Key Questions**:
${questionsSummary || 'None registered.'}
- **Recorded Findings (${(canvasState.findings || []).length})**:
${findingsSummary || 'No findings recorded yet.'}

RESPONSE GUIDELINES:
1. Deliver rigorous, analytical, and well-reasoned answers grounded in systems engineering and real-world trade-offs.
2. Structure your analysis with clear evidence, benchmark references, and actionable takeaways.
3. Whenever you uncover a new significant insight, resolve a research question, or refine the research document, append a compact JSON block using \`\`\`research_patch.

COMPACT PATCH FORMAT (include only new or updated items):
\`\`\`research_patch
{
  "addFindings": [
    {
      "topic": "Storage & I/O",
      "insight": "Memory-mapped files reduce kernel context switches by 40%",
      "confidence": "High",
      "takeaway": "Adopt mmap for local index files"
    }
  ],
  "updateQuestions": [
    {
      "id": "q-1",
      "status": "resolved",
      "findings": "Bottleneck identified at SQLite write lock serialization."
    }
  ]
}
\`\`\`
Keep the JSON patch concise (1 to 2 items) so responses remain fast and complete.`;
}

function tryRepairJson(jsonStr: string): any {
  try {
    return JSON.parse(jsonStr);
  } catch {}

  let repaired = jsonStr.trim();
  repaired = repaired.replace(/,\s*([\}\]])/g, '$1');

  for (let i = 0; i < 5; i++) {
    try {
      return JSON.parse(repaired);
    } catch {}

    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';

    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    if (openBrackets > closeBrackets) repaired += ']';
    else if (openBraces > closeBraces) repaired += '}';
    else break;
  }

  try {
    return JSON.parse(repaired);
  } catch {}

  return null;
}

export function parseResearchOutput(
  rawText: string,
  currentState: ResearchState
): { cleanText: string; updatedState?: ResearchState } {
  if (!rawText) return { cleanText: rawText };

  const closedRegex = /```research_patch\s*([\s\S]*?)\s*```/;
  const openRegex = /```research_patch\s*([\s\S]*)$/;

  let patchJsonStr = '';
  let cleanText = rawText;

  const closedMatch = rawText.match(closedRegex);
  if (closedMatch) {
    patchJsonStr = closedMatch[1].trim();
    cleanText = rawText.replace(closedRegex, '').trim();
  } else {
    const openMatch = rawText.match(openRegex);
    if (openMatch) {
      patchJsonStr = openMatch[1].trim();
      cleanText = rawText.replace(openRegex, '').trim();
    }
  }

  if (!patchJsonStr) return { cleanText };

  try {
    const patch = tryRepairJson(patchJsonStr);
    if (!patch) {
      console.warn('[parseResearchOutput] Failed to parse JSON patch');
      return { cleanText };
    }

    const nextState: ResearchState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    if (patch.topicTitle) nextState.topicTitle = patch.topicTitle;
    if (patch.hypothesis) nextState.hypothesis = patch.hypothesis;
    if (patch.documentMarkdown) nextState.documentMarkdown = patch.documentMarkdown;
    if (patch.diagramMermaid) nextState.diagramMermaid = patch.diagramMermaid;

    // Add findings
    if (Array.isArray(patch.addFindings) && patch.addFindings.length > 0) {
      const existingIds = new Set(nextState.findings.map(f => f.id));
      const newFindings: ResearchFinding[] = [];

      for (const f of patch.addFindings) {
        if (!f || typeof f !== 'object') continue;
        let id = f.id;
        if (!id || existingIds.has(id)) {
          id = `RF-${String(nextState.findings.length + newFindings.length + 1).padStart(2, '0')}`;
        }
        existingIds.add(id);

        newFindings.push({
          id,
          topic: f.topic || 'General Analysis',
          insight: f.insight || f.finding || 'Key research observation',
          confidence: f.confidence || 'High',
          evidence: f.evidence || '',
          takeaway: f.takeaway || '',
          source: f.source || '',
        });
      }

      if (newFindings.length > 0) {
        nextState.findings = [...nextState.findings, ...newFindings];
      }
    }

    // Update questions
    if (Array.isArray(patch.updateQuestions) && patch.updateQuestions.length > 0) {
      const qMap = new Map<string, any>(patch.updateQuestions.map((q: any) => [String(q.id), q]));
      nextState.questions = nextState.questions.map(q => {
        const u = qMap.get(String(q.id));
        if (u) {
          return {
            ...q,
            status: u.status || q.status,
            findings: u.findings || q.findings,
          };
        }
        return q;
      });
    }

    // Add new questions
    if (Array.isArray(patch.addQuestions) && patch.addQuestions.length > 0) {
      const existingQIds = new Set(nextState.questions.map(q => q.id));
      const newQs: ResearchQuestion[] = patch.addQuestions
        .filter((q: any) => q && q.question)
        .map((q: any, idx: number) => ({
          id: q.id || `q-${Date.now().toString(36)}-${idx}`,
          question: q.question,
          status: q.status || 'open',
          findings: q.findings,
        }))
        .filter((q: ResearchQuestion) => !existingQIds.has(q.id));

      if (newQs.length > 0) {
        nextState.questions = [...nextState.questions, ...newQs];
      }
    }

    return { cleanText, updatedState: nextState };
  } catch (err) {
    console.warn('[parseResearchOutput] Error merging patch:', err);
    return { cleanText };
  }
}
