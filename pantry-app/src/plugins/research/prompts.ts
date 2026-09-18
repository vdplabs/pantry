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
1. Write a thorough, insightful, and well-structured response in Markdown with clear sections, comparative tables, and actionable conclusions.
2. At the end of your response, output a compact \`\`\`research_patch JSON block to synchronize the canvas findings and questions.
3. CRITICAL: Fill in realistic values in the patch. NEVER output empty strings like "" or empty template placeholders.

COMPACT PATCH FORMAT:
\`\`\`research_patch
{
  "topicTitle": "Saviynt vs SailPoint IGA Evaluation",
  "hypothesis": "Comparing cloud-native IGA architecture against enterprise legacy identity governance.",
  "addFindings": [
    {
      "topic": "SLA & Cost Efficiency",
      "insight": "SailPoint's SLA pricing favors massive enterprises, whereas Saviynt's SaaS delivers lower TCO for agile deployments.",
      "confidence": "High",
      "takeaway": "Adopt Saviynt for cloud-first infrastructure and SailPoint for deep legacy on-prem directories."
    }
  ],
  "addQuestions": [
    { "question": "How do Saviynt and SailPoint handle automated role mining and AI access certifications?" }
  ]
}
\`\`\`
Always write your full research analysis in normal Markdown before the patch.`;
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

/**
 * Automatically extracts bulleted or numbered findings from markdown text
 */
function extractFindingsFromText(text: string, defaultTopic: string = 'Key Insight'): ResearchFinding[] {
  const findings: ResearchFinding[] = [];
  if (!text) return findings;

  // Match numbered items like: 1. **Title**: Description or 1. Title: Description
  const numberedRegex = /(?:^|\n)\s*(?:\d+[\.\)]|\-|\*)\s+(?:\*\*(.+?)\*\*|([A-Za-z0-9\s\-_/&]+):)\s*([^\n]+(?:\n(?!\s*(?:\d+[\.\)]|\-|\*|\#))[^\n]+)*)/g;
  let match: RegExpExecArray | null;

  while ((match = numberedRegex.exec(text)) !== null && findings.length < 5) {
    const rawTopic = (match[1] || match[2] || '').trim();
    let body = (match[3] || '').trim();
    if (!body || body.length < 15) continue;
    if (rawTopic.toLowerCase().includes('step') || rawTopic.toLowerCase().includes('section')) continue;

    const topic = rawTopic ? rawTopic.replace(/[:\-]/g, '').trim() : defaultTopic;
    let takeaway = '';
    const takeawayMatch = body.match(/(?:takeaway|recommendation|next step|action)[\s:]+([^\.\n]+)/i);
    if (takeawayMatch) {
      takeaway = takeawayMatch[1].trim();
    }

    findings.push({
      id: `RF-${Date.now().toString(36).slice(-4)}-${findings.length + 1}`,
      topic: topic.slice(0, 40),
      insight: body.slice(0, 300),
      confidence: 'High',
      takeaway: takeaway || 'Evaluate during architectural review',
      evidence: '',
      source: 'AI Research Synthesis',
    });
  }

  return findings;
}

/**
 * Extracts questions from text
 */
function extractQuestionsFromText(text: string): string[] {
  const questions: string[] = [];
  if (!text) return questions;

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith('?') && trimmed.length > 20 && trimmed.length < 180) {
      const clean = trimmed.replace(/^[\d\.\-\*\#\s]+/, '').replace(/^\*\*|\*\*$/g, '').trim();
      if (clean && !questions.includes(clean)) {
        questions.push(clean);
      }
    }
  }
  return questions.slice(0, 4);
}

export function parseResearchOutput(
  rawText: string,
  currentState: ResearchState
): { cleanText: string; updatedState?: ResearchState } {
  if (!rawText) return { cleanText: rawText };

  const closedRegex = /```(?:research_patch|json)\s*([\s\S]*?)\s*```/g;
  let patchJsonStr = '';
  let cleanText = rawText;

  let match: RegExpExecArray | null;
  while ((match = closedRegex.exec(rawText)) !== null) {
    const candidate = match[1].trim();
    if (candidate.includes('topicTitle') || candidate.includes('addFindings') || candidate.includes('findings') || candidate.includes('hypothesis')) {
      patchJsonStr = candidate;
    }
  }

  // If not matched via closed loop, try open unclosed block
  if (!patchJsonStr) {
    const openRegex = /```(?:research_patch|json)\s*([\s\S]*)$/;
    const openMatch = rawText.match(openRegex);
    if (openMatch) {
      patchJsonStr = openMatch[1].trim();
    }
  }

  // Clean out patch blocks from visible text
  cleanText = rawText
    .replace(/```(?:research_patch|json)\s*[\s\S]*?```/g, '')
    .replace(/```(?:research_patch|json)\s*[\s\S]*$/g, '')
    .replace(/Final Research Patch:?/gi, '')
    .trim();

  let patch: any = {};
  if (patchJsonStr) {
    patch = tryRepairJson(patchJsonStr) || {};
  }

  try {
    const nextState: ResearchState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    // 1. Topic & Hypothesis
    const newTopic = (patch.topicTitle || patch.topic || patch.title || patch.subject || patch.name || '').trim();
    if (newTopic && newTopic.length > 1) {
      nextState.topicTitle = newTopic;
    }

    const newHypothesis = (patch.hypothesis || patch.goal || patch.objective || patch.abstract || patch.summary || '').trim();
    if (newHypothesis && newHypothesis.length > 3) {
      nextState.hypothesis = newHypothesis;
    }

    // 2. Document Markdown:
    // If patch provided explicit doc, use it. Otherwise, if cleanText has substantial analysis and the doc is still placeholder, synthesize!
    const explicitDoc = (patch.documentMarkdown || patch.document || patch.markdown || patch.doc || patch.content || '').trim();
    const isPlaceholderDoc = currentState.documentMarkdown.startsWith('# Technical Research Document') ||
      currentState.documentMarkdown.startsWith('# Technology & Engine') ||
      currentState.documentMarkdown.includes('*As research queries are discussed') ||
      currentState.documentMarkdown.includes('*Key synthesized findings and observations');

    if (explicitDoc && explicitDoc.length > 20) {
      nextState.documentMarkdown = explicitDoc;
    } else if (cleanText.length > 120 && isPlaceholderDoc) {
      // Build a rich structured research document from the assistant's analysis
      const displayTitle = nextState.topicTitle || 'Technical Research Document';
      nextState.documentMarkdown = `# Research Report: ${displayTitle}\n\n## 1. Executive Summary & Objective\n${nextState.hypothesis || 'Comprehensive technical assessment and comparative tradeoff analysis.'}\n\n## 2. Core Analysis & Findings\n${cleanText}\n\n## 3. Next Steps & Active Investigations\n- Deep-dive into open research questions on the Studio Canvas.\n`;
    } else if (newTopic && isPlaceholderDoc) {
      nextState.documentMarkdown = `# Research: ${newTopic}\n\n## 1. Objective & Hypothesis\n${nextState.hypothesis || 'Investigate core architectural tradeoffs, performance profiles, and implementation complexities.'}\n\n## 2. Key Hypotheses & Constraints\n- **Target Domain**: ${newTopic}\n\n## 3. Findings & Evidence Analysis\n*Key synthesized findings and observations will be recorded here.*\n\n## 4. Architectural Tradeoffs\n| Dimension | Current Standard | Emerging Paradigm |\n|---|---|---|\n| Feasibility | High | Active Research |\n\n## 5. Synthesis & Recommended Next Steps\n- Deep dive into registered research questions.\n`;
    }

    // 3. Diagram
    const newDiagram = (patch.diagramMermaid || patch.diagram || patch.mermaid || patch.chart || '').trim();
    if (newDiagram && newDiagram.length > 10) {
      nextState.diagramMermaid = newDiagram;
    }

    // 4. Add Findings:
    const rawFindings = patch.addFindings || patch.findings || patch.newFindings || patch.keyFindings || patch.evidence;
    const findingsList = Array.isArray(rawFindings) ? rawFindings : (rawFindings && typeof rawFindings === 'object' ? [rawFindings] : []);
    const existingIds = new Set(nextState.findings.map(f => f.id));
    const newFindings: ResearchFinding[] = [];

    for (const f of findingsList) {
      if (!f) continue;
      if (typeof f === 'string' && f.trim()) {
        const id = `RF-${String(nextState.findings.length + newFindings.length + 1).padStart(2, '0')}`;
        existingIds.add(id);
        newFindings.push({
          id,
          topic: nextState.topicTitle || 'General Finding',
          insight: f.trim(),
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

      const insight = (f.insight || f.finding || f.description || f.text || f.summary || f.observation || '').trim();
      if (!insight) continue;

      newFindings.push({
        id,
        topic: (f.topic || f.title || f.category || f.area || f.name || 'Research Insight').trim(),
        insight,
        confidence: f.confidence || (f.certainty ? String(f.certainty) : 'High'),
        evidence: f.evidence || f.proof || f.data || '',
        takeaway: f.takeaway || f.conclusion || f.recommendation || f.action || '',
        source: f.source || f.citation || f.reference || '',
      });
    }

    // If no findings were in the patch JSON, auto-extract from markdown text!
    if (newFindings.length === 0 && cleanText.length > 100) {
      const extracted = extractFindingsFromText(cleanText, nextState.topicTitle);
      for (const ef of extracted) {
        if (!existingIds.has(ef.id)) {
          existingIds.add(ef.id);
          newFindings.push(ef);
        }
      }
    }

    if (newFindings.length > 0) {
      nextState.findings = [...nextState.findings, ...newFindings];
    }

    // 5. Update & Add Questions:
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

    const rawQuestions = patch.addQuestions || patch.questions || patch.newQuestions || patch.openQuestions || patch.hypotheses;
    const questionsList = Array.isArray(rawQuestions) ? rawQuestions : (rawQuestions && typeof rawQuestions === 'object' ? [rawQuestions] : []);
    const existingQIds = new Set(nextState.questions.map(q => q.id));
    const newQs: ResearchQuestion[] = [];

    for (let idx = 0; idx < questionsList.length; idx++) {
      const q = questionsList[idx];
      if (!q) continue;

      if (typeof q === 'string' && q.trim()) {
        const id = `q-${Date.now().toString(36)}-${idx}`;
        if (!existingQIds.has(id)) {
          existingQIds.add(id);
          newQs.push({
            id,
            question: q.trim(),
            status: 'open',
          });
        }
        continue;
      }

      if (typeof q === 'object' && (q.question || q.title || q.text)) {
        const qText = (q.question || q.title || q.text || '').trim();
        if (!qText) continue;
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

    // If questions list was empty, extract questions ending with ? from text
    if (newQs.length === 0 && cleanText.length > 100) {
      const textQuestions = extractQuestionsFromText(cleanText);
      for (let idx = 0; idx < textQuestions.length; idx++) {
        const tq = textQuestions[idx];
        const id = `q-ext-${Date.now().toString(36)}-${idx}`;
        if (!existingQIds.has(id)) {
          existingQIds.add(id);
          newQs.push({
            id,
            question: tq,
            status: 'open',
          });
        }
      }
    }

    if (newQs.length > 0) {
      const hasOnlyDefaultQs = nextState.questions.length === 3 && nextState.questions.every(q => q.id.startsWith('q-') && !q.findings);
      if (hasOnlyDefaultQs && (newTopic || newQs.length >= 2)) {
        nextState.questions = newQs;
      } else {
        nextState.questions = [...nextState.questions, ...newQs];
      }
    }

    // 6. Ensure cleanText is not empty
    if (!cleanText.trim()) {
      const summaryItems: string[] = [];
      if (newTopic) summaryItems.push(`🔬 **Research Objective**: ${newTopic}`);
      if (newHypothesis) summaryItems.push(`💡 **Hypothesis**: ${newHypothesis}`);
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
