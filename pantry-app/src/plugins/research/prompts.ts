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
- **Hypothesis / Goal**: ${canvasState.hypothesis || 'Exploring technical tradeoffs'}
- **Key Questions**:
${questionsSummary || 'None registered.'}
- **Recorded Findings (${(canvasState.findings || []).length})**:
${findingsSummary || 'No findings recorded yet.'}

RESPONSE GUIDELINES:
1. Always write a thorough, insightful, and conversational response in Markdown analyzing the user's inquiry, evidence, and practical takeaways.
2. At the end of your response, output a compact \`\`\`research_patch JSON block to synchronize the canvas with the latest topic, hypothesis, findings, or research questions.
3. If the user introduces a new topic (e.g. quantum computing, caching architecture, AI agents), initialize/update "topicTitle", "hypothesis", and "documentMarkdown", and generate 2-3 relevant "addQuestions" to track open investigations.

COMPACT PATCH FORMAT:
\`\`\`research_patch
{
  "topicTitle": "Impact of Quantum Computing & Cryptography",
  "hypothesis": "Evaluating post-quantum encryption algorithms and practical migration timelines.",
  "addFindings": [
    {
      "topic": "Shor's Algorithm & RSA",
      "insight": "RSA-2048 vulnerable to quantum computers with ~4,000 logical qubits.",
      "confidence": "High",
      "takeaway": "Plan migration to NIST post-quantum standards (ML-KEM / Dilithium)"
    }
  ],
  "addQuestions": [
    { "question": "What are the performance overheads of Kyber/ML-KEM in TLS handshakes?" },
    { "question": "What is the timeline for fault-tolerant commercial quantum hardware?" }
  ]
}
\`\`\`
Always provide your written analysis in normal markdown before the patch.`;
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

  const closedRegex = /```(?:research_patch|json)\s*([\s\S]*?)\s*```/;
  const openRegex = /```(?:research_patch|json)\s*([\s\S]*)$/;

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
    if (!patch || typeof patch !== 'object') {
      console.warn('[parseResearchOutput] Failed to parse JSON patch');
      return { cleanText };
    }

    const nextState: ResearchState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    // Topic & Hypothesis (supports flexible keys)
    const newTopic = patch.topicTitle || patch.topic || patch.title || patch.subject || patch.name;
    if (newTopic && typeof newTopic === 'string') {
      nextState.topicTitle = newTopic;
    }

    const newHypothesis = patch.hypothesis || patch.goal || patch.objective || patch.abstract || patch.summary;
    if (newHypothesis && typeof newHypothesis === 'string') {
      nextState.hypothesis = newHypothesis;
    }

    const newDoc = patch.documentMarkdown || patch.document || patch.markdown || patch.doc || patch.content || patch.researchDocument;
    if (newDoc && typeof newDoc === 'string') {
      nextState.documentMarkdown = newDoc;
    } else if (newTopic && currentState.documentMarkdown.startsWith('# Technical Research Document')) {
      // Auto-update document header if using default template
      nextState.documentMarkdown = `# Research: ${newTopic}\n\n## 1. Objective & Hypothesis\n${nextState.hypothesis || 'Investigate core principles, tradeoffs, and domain impact.'}\n\n## 2. Key Hypotheses & Constraints\n- **Target Domain**: ${newTopic}\n\n## 3. Findings & Evidence Analysis\n*Key synthesized findings and observations will be recorded here.*\n\n## 4. Architectural Tradeoffs\n| Dimension | Current Standard | Emerging Paradigm |\n|---|---|---|\n| Feasibility | High | Active Research |\n\n## 5. Synthesis & Recommended Next Steps\n- Deep dive into registered research questions.\n`;
    }

    const newDiagram = patch.diagramMermaid || patch.diagram || patch.mermaid || patch.chart;
    if (newDiagram && typeof newDiagram === 'string') {
      nextState.diagramMermaid = newDiagram;
    }

    // Add findings (flexible aliases)
    const rawFindings = patch.addFindings || patch.findings || patch.newFindings || patch.keyFindings || patch.evidence;
    const findingsList = Array.isArray(rawFindings) ? rawFindings : (rawFindings && typeof rawFindings === 'object' ? [rawFindings] : []);
    const existingIds = new Set(nextState.findings.map(f => f.id));
    const newFindings: ResearchFinding[] = [];

    for (const f of findingsList) {
      if (!f) continue;
      if (typeof f === 'string') {
        const id = `RF-${String(nextState.findings.length + newFindings.length + 1).padStart(2, '0')}`;
        existingIds.add(id);
        newFindings.push({
          id,
          topic: newTopic || 'General Finding',
          insight: f,
          confidence: 'High',
          evidence: '',
          takeaway: '',
          source: '',
        });
        continue;
      }
      if (typeof f !== 'object') continue;

      let id = f.id;
      if (!id || existingIds.has(id)) {
        id = `RF-${String(nextState.findings.length + newFindings.length + 1).padStart(2, '0')}`;
      }
      existingIds.add(id);

      newFindings.push({
        id,
        topic: f.topic || f.title || f.category || f.area || f.name || 'Research Insight',
        insight: f.insight || f.finding || f.description || f.text || f.summary || f.observation || 'Key observation',
        confidence: f.confidence || (f.certainty ? String(f.certainty) : 'High'),
        evidence: f.evidence || f.proof || f.data || '',
        takeaway: f.takeaway || f.conclusion || f.recommendation || f.action || '',
        source: f.source || f.citation || f.reference || '',
      });
    }

    if (newFindings.length > 0) {
      nextState.findings = [...nextState.findings, ...newFindings];
    }

    // Update existing questions
    if (Array.isArray(patch.updateQuestions) && patch.updateQuestions.length > 0) {
      const qMap = new Map<string, any>(patch.updateQuestions.map((q: any) => [String(q.id || '').toLowerCase(), q]));
      nextState.questions = nextState.questions.map(q => {
        const u = qMap.get(String(q.id).toLowerCase());
        if (u) {
          return {
            ...q,
            status: u.status || q.status,
            findings: u.findings || u.answer || q.findings,
          };
        }
        return q;
      });
    }

    // Add new questions (flexible aliases & string arrays)
    const rawQuestions = patch.addQuestions || patch.questions || patch.newQuestions || patch.openQuestions || patch.hypotheses;
    const questionsList = Array.isArray(rawQuestions) ? rawQuestions : (rawQuestions && typeof rawQuestions === 'object' ? [rawQuestions] : []);
    const existingQIds = new Set(nextState.questions.map(q => q.id));
    const newQs: ResearchQuestion[] = [];

    for (let idx = 0; idx < questionsList.length; idx++) {
      const q = questionsList[idx];
      if (!q) continue;

      if (typeof q === 'string') {
        const id = `q-${Date.now().toString(36)}-${idx}`;
        if (!existingQIds.has(id)) {
          existingQIds.add(id);
          newQs.push({
            id,
            question: q,
            status: 'open',
          });
        }
        continue;
      }

      if (typeof q === 'object' && (q.question || q.title || q.text)) {
        const qText = q.question || q.title || q.text;
        const id = q.id || `q-${Date.now().toString(36)}-${idx}`;
        if (!existingQIds.has(id)) {
          existingQIds.add(id);
          newQs.push({
            id,
            question: qText,
            status: q.status || 'open',
            findings: q.findings || q.answer,
          });
        }
      }
    }

    if (newQs.length > 0) {
      // If we are replacing the default starter questions with new topic-specific questions:
      const hasOnlyDefaultQs = nextState.questions.length === 3 && nextState.questions.every(q => q.id.startsWith('q-') && !q.findings);
      if (hasOnlyDefaultQs && (newTopic || newQs.length >= 2)) {
        nextState.questions = newQs;
      } else {
        nextState.questions = [...nextState.questions, ...newQs];
      }
    }

    // Ensure cleanText is never empty
    if (!cleanText.trim()) {
      const summaryItems: string[] = [];
      if (newTopic) {
        summaryItems.push(`🔬 **Research Objective**: ${newTopic}`);
      }
      if (newHypothesis) {
        summaryItems.push(`💡 **Hypothesis**: ${newHypothesis}`);
      }
      if (newFindings.length > 0) {
        summaryItems.push(`📌 **Recorded Findings (${newFindings.length})**:\n` + newFindings.map(f => `- **${f.topic}**: ${f.insight}`).join('\n'));
      }
      if (newQs.length > 0) {
        summaryItems.push(`❓ **Registered Research Questions (${newQs.length})**:\n` + newQs.map(q => `- ${q.question}`).join('\n'));
      }

      cleanText = summaryItems.length > 0
        ? `I have updated the **Research Studio Canvas** with your topic and structured investigation:\n\n${summaryItems.join('\n\n')}\n\n*You can click **"⚡ Investigate with AI"** on any research question on the canvas or ask questions here in chat to continue exploring.*`
        : `✨ *Research Studio Canvas synchronized with your latest inputs.*`;
    }

    return { cleanText, updatedState: nextState };
  } catch (err) {
    console.warn('[parseResearchOutput] Error merging patch:', err);
    if (!cleanText.trim()) {
      cleanText = `✨ *Research Studio Canvas updated.*`;
    }
    return { cleanText };
  }
}
