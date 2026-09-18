import type { RfcState, RfcDecision, RfcInvariant } from './types';

export function getInitialRfcState(framework: string = 'rfc'): RfcState {
  const isAdr = framework === 'adr';
  const isApiSpec = framework === 'api-spec';

  let title = 'RFC: Distributed Event Streaming & State Synchronization';
  let defaultDiagram = `graph TD
    Client["🌐 Client Applications"] -->|HTTPS / gRPC| Gateway["🛡️ Ingress Gateway"]
    Gateway --> Worker["⚙️ Coordinator Service"]
    Worker --> EventLog[("📬 Replicated Event Log (WAL)")]
    Worker --> StateStore[("🗄️ Local Indexed State")]

    subgraph StorageLayer ["High Performance Storage Zone"]
      EventLog
      StateStore
    end
`;

  let defaultDoc = `# RFC-001: Distributed Event Streaming & State Synchronization
**Status**: Draft
**Date**: ${new Date().toLocaleDateString()}
**Scope**: Core Data Ingestion & State Replication

---

## 1. Context & Problem Statement
The current monolithic data pipeline suffers from high latency and head-of-line blocking under bursty write traffic. We need an asynchronous event-driven architecture that guarantees low-latency ingestion, horizontal scalability, and eventual consistency across replicas.

## 2. Goals & Non-Goals
### Goals
- Sub-50ms p99 write latency for high-throughput events.
- Zero data loss during node restarts or single-replica failover.
- Clear separation between storage engine and query layer.

### Non-Goals
- Real-time global consensus across cross-region clusters.
- Ad-hoc graph queries on raw events (delegated to analytics warehouse).

## 3. Proposed Architecture & Data Flow
1. **Ingress & Validation**: Requests terminate at the ingress gateway for rate limiting and schema validation.
2. **Append-Only WAL**: Events are durably appended to an in-memory ring buffer with background fsync.
3. **Async Projection Engine**: Background workers consume the WAL and project updates into localized read-optimized data stores.

## 4. Cross-Cutting Concerns
- **Security & Authorization**: mTLS between coordinator and storage nodes; field-level encryption for sensitive payloads.
- **Observability**: Distributed tracing via OpenTelemetry with trace-context propagation in message headers.

## 5. Tradeoffs & Alternatives Considered
- *Evaluated Embedded SQLite vs RocksDB vs Dedicated Broker*: RocksDB was selected for write throughput and predictable memory bounds.
`;

  if (isAdr) {
    title = 'ADR: Persistence Engine Selection for Local Cache';
    defaultDoc = `# ADR-001: Persistence Engine Selection for Local State
**Status**: Approved
**Date**: ${new Date().toLocaleDateString()}

## Context
We need a local persistence layer capable of storing 100k+ documents with rapid key-value lookups and low garbage collection pressure.

## Decision
We adopt **RocksDB / LevelDB LSM-Tree** architecture with memory-mapped cache blocks.

## Consequences
- **Positive**: Blazing fast sequential writes, small memory footprint, predictable compaction overhead.
- **Negative**: Range query latency is slightly higher than B-Tree indexes.
`;
  } else if (isApiSpec) {
    title = 'RFC: Public API Contract & Schema Evolution Protocol';
    defaultDoc = `# API Design Spec: Ingestion & Control Plane
**Status**: In Review
**Protocols**: gRPC / Protobuf & HTTP / REST

## Endpoints
- \`POST /v1/events/batch\`: Ingest batch of structured event envelopes.
- \`GET /v1/stream/subscribe\`: Server-Sent Events (SSE) live updates.
`;
  }

  const defaultDecisions: RfcDecision[] = [
    {
      id: 'ADR-01',
      title: 'LSM-Tree vs B-Tree Storage Engine',
      status: 'Approved',
      context: 'Evaluating persistence engine for bursty write workloads.',
      chosenOption: 'LSM-Tree (Log-Structured Merge Tree)',
      alternativesConsidered: 'B-Tree (SQLite), In-memory Hash Ring',
      rationale: 'Append-only sequential disk writes maximize throughput on SSDs without random I/O bottlenecks.',
      tradeoffs: 'Higher compaction CPU overhead during peak load.',
    },
  ];

  const defaultInvariants: RfcInvariant[] = [
    { id: 'INV-01', statement: 'Every acknowledged write must be persisted to the WAL before client response.', category: 'Correctness', status: 'Enforced' },
    { id: 'INV-02', statement: 'All internal inter-service RPCs must require mTLS and JWT signature verification.', category: 'Security', status: 'Enforced' },
  ];

  return {
    title,
    framework: (framework as any) || 'rfc',
    status: 'Draft',
    scope: 'System Architecture & Data Flow',
    rfcMarkdown: defaultDoc,
    decisions: defaultDecisions,
    invariants: defaultInvariants,
    diagramMermaid: defaultDiagram,
    updatedAt: new Date().toISOString(),
  };
}

export function buildRfcSystemPrompt(canvasState: RfcState, framework: string = 'rfc'): string {
  const decisionsSummary = (canvasState.decisions || []).slice(0, 10).map(d =>
    `- [${d.id}] ${d.title} (${d.status}): Chosen -> ${d.chosenOption} | Tradeoffs: ${d.tradeoffs || 'None specified'}`
  ).join('\n');

  const invariantsSummary = (canvasState.invariants || []).map(i =>
    `- [${i.id}] [${i.category}] (${i.status}): ${i.statement}`
  ).join('\n');

  return `You are a Principal Enterprise Architect and Systems Designer collaborating with the user in Pantry's **Architecture RFC Studio**.

CURRENT RFC DESIGN STATE:
- **Title**: ${canvasState.title || 'System Architecture RFC'}
- **Status**: ${canvasState.status || 'Draft'}
- **Scope**: ${canvasState.scope || 'Platform Architecture'}
- **Key Decisions (ADRs)**:
${decisionsSummary || 'None registered.'}
- **System Invariants & Non-negotiables**:
${invariantsSummary || 'None recorded.'}

RESPONSE GUIDELINES:
1. Provide deep, professional software architecture reasoning (tradeoffs, failure modes, data invariants, and operational patterns).
2. Challenge weak assumptions constructively and suggest concrete alternative designs.
3. Always write your detailed architectural analysis in Markdown first.
4. At the end of your response, output a compact \`\`\`rfc_patch JSON block to synchronize the canvas with the latest RFC title, decisions, or system invariants.

COMPACT PATCH FORMAT:
\`\`\`rfc_patch
{
  "title": "Distributed Task Queue & Event Pipeline",
  "scope": "High-throughput asynchronous processing with exactly-once delivery guarantees",
  "addDecisions": [
    {
      "title": "Idempotency Key Strategy",
      "status": "Approved",
      "chosenOption": "Client-generated UUIDv7 with Redis deduplication window",
      "rationale": "Prevents duplicate charge events during transient network retries."
    }
  ],
  "addInvariants": [
    {
      "statement": "State machine transitions must be strictly linear and validated against schema.",
      "category": "Correctness"
    }
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

export function parseRfcOutput(
  rawText: string,
  currentState: RfcState
): { cleanText: string; updatedState?: RfcState } {
  if (!rawText) return { cleanText: rawText };

  const closedRegex = /```(?:rfc_patch|json)\s*([\s\S]*?)\s*```/;
  const openRegex = /```(?:rfc_patch|json)\s*([\s\S]*)$/;

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
      console.warn('[parseRfcOutput] Failed to parse RFC patch JSON');
      return { cleanText };
    }

    const nextState: RfcState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    const newTitle = patch.title || patch.topicTitle || patch.name || patch.topic || patch.subject;
    if (newTitle && typeof newTitle === 'string') {
      nextState.title = newTitle;
    }

    if (patch.status && typeof patch.status === 'string') {
      nextState.status = patch.status as any;
    }

    const newScope = patch.scope || patch.hypothesis || patch.summary || patch.context || patch.objective;
    if (newScope && typeof newScope === 'string') {
      nextState.scope = newScope;
    }

    const newDoc = patch.rfcMarkdown || patch.documentMarkdown || patch.document || patch.doc || patch.markdown || patch.content;
    if (newDoc && typeof newDoc === 'string') {
      nextState.rfcMarkdown = newDoc;
    } else if (newTitle && currentState.rfcMarkdown.startsWith('# RFC:')) {
      nextState.rfcMarkdown = `# RFC: ${newTitle}\n\n## 1. Context and Problem Statement\n${nextState.scope || 'Define the architectural motivation and objectives.'}\n\n## 2. Goals & Non-Goals\n- **Goals**: Deliver robust, scalable architecture with clear invariants.\n- **Non-Goals**: Scope creep outside core system requirements.\n\n## 3. Proposed Architecture & System Boundaries\n*Refer to C4 Topology diagram in Studio Canvas.*\n\n## 4. Key Architectural Decisions (ADRs)\n*Refer to ADR register table in Studio Canvas.*\n\n## 5. System Invariants & SLIs\n*Refer to Invariants tracker.*\n\n## 6. Migration, Rollout & Rollback Strategy\n- Phase 1: Canary verification\n- Phase 2: Production traffic rollout\n`;
    }

    const newDiagram = patch.diagramMermaid || patch.diagram || patch.mermaid || patch.c4Diagram;
    if (newDiagram && typeof newDiagram === 'string') {
      nextState.diagramMermaid = newDiagram;
    }

    // Add decisions
    const rawDecisions = patch.addDecisions || patch.decisions || patch.newDecisions || patch.adrs;
    const decisionsList = Array.isArray(rawDecisions) ? rawDecisions : (rawDecisions && typeof rawDecisions === 'object' ? [rawDecisions] : []);
    const existingIds = new Set(nextState.decisions.map(d => d.id));
    const newDecisions: RfcDecision[] = [];

    for (const d of decisionsList) {
      if (!d) continue;
      if (typeof d === 'string') {
        const id = `ADR-${String(nextState.decisions.length + newDecisions.length + 1).padStart(2, '0')}`;
        existingIds.add(id);
        newDecisions.push({
          id,
          title: d,
          status: 'Approved',
          context: 'Architectural requirement',
          chosenOption: d,
          rationale: 'Standard pattern for target requirements',
          tradeoffs: '',
        });
        continue;
      }
      if (typeof d !== 'object') continue;

      let id = d.id;
      if (!id || existingIds.has(id)) {
        id = `ADR-${String(nextState.decisions.length + newDecisions.length + 1).padStart(2, '0')}`;
      }
      existingIds.add(id);

      newDecisions.push({
        id,
        title: d.title || d.name || d.decision || 'Architecture Decision',
        status: d.status || 'Approved',
        context: d.context || d.description || d.background || 'Decision context',
        chosenOption: d.chosenOption || d.decision || d.approach || 'Adopted approach',
        alternativesConsidered: d.alternativesConsidered || d.alternatives,
        rationale: d.rationale || d.reason || 'Architectural rationale',
        tradeoffs: d.tradeoffs || d.consequences || '',
      });
    }

    if (newDecisions.length > 0) {
      nextState.decisions = [...nextState.decisions, ...newDecisions];
    }

    // Add invariants
    const rawInvariants = patch.addInvariants || patch.invariants || patch.rules || patch.constraints;
    const invariantsList = Array.isArray(rawInvariants) ? rawInvariants : (rawInvariants && typeof rawInvariants === 'object' ? [rawInvariants] : []);
    const existingInvIds = new Set(nextState.invariants.map(i => i.id));
    const newInvariants: RfcInvariant[] = [];

    for (const inv of invariantsList) {
      if (!inv) continue;
      if (typeof inv === 'string') {
        const id = `INV-${String(nextState.invariants.length + newInvariants.length + 1).padStart(2, '0')}`;
        existingInvIds.add(id);
        newInvariants.push({
          id,
          statement: inv,
          category: 'Correctness',
          status: 'Enforced',
        });
        continue;
      }
      if (typeof inv !== 'object') continue;

      let id = inv.id;
      if (!id || existingInvIds.has(id)) {
        id = `INV-${String(nextState.invariants.length + newInvariants.length + 1).padStart(2, '0')}`;
      }
      existingInvIds.add(id);

      newInvariants.push({
        id,
        statement: inv.statement || inv.text || inv.rule || inv.constraint || 'System Invariant requirement',
        category: inv.category || inv.type || 'Correctness',
        status: inv.status || 'Enforced',
      });
    }

    if (newInvariants.length > 0) {
      nextState.invariants = [...nextState.invariants, ...newInvariants];
    }

    // Ensure cleanText is never empty
    if (!cleanText.trim()) {
      const summaryItems: string[] = [];
      if (newTitle) {
        summaryItems.push(`📐 **RFC Title**: ${newTitle}`);
      }
      if (newScope) {
        summaryItems.push(`🎯 **Scope**: ${newScope}`);
      }
      if (newDecisions.length > 0) {
        summaryItems.push(`⚖️ **Architectural Decisions (${newDecisions.length})**:\n` + newDecisions.map(d => `- **${d.title}** (${d.status}): ${d.chosenOption}`).join('\n'));
      }
      if (newInvariants.length > 0) {
        summaryItems.push(`🛡️ **System Invariants (${newInvariants.length})**:\n` + newInvariants.map(i => `- [${i.category}] ${i.statement}`).join('\n'));
      }

      cleanText = summaryItems.length > 0
        ? `I have updated the **Architecture RFC Canvas** with your specifications:\n\n${summaryItems.join('\n\n')}\n\n*Review the decisions and invariants on the canvas or ask questions to refine the design.*`
        : `✨ *Architecture RFC Canvas synchronized with your latest inputs.*`;
    }

    return { cleanText, updatedState: nextState };
  } catch (err) {
    console.warn('[parseRfcOutput] Failed to process RFC patch:', err);
    if (!cleanText.trim()) {
      cleanText = `✨ *Architecture RFC Canvas updated.*`;
    }
    return { cleanText };
  }
}
