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
  const decisionsSummary = (canvasState.decisions || []).map(d =>
    `- [${d.id}] "${d.title}" (${d.status}): Chosen: ${d.chosenOption} | Rationale: ${d.rationale}`
  ).join('\n');

  const invariantsSummary = (canvasState.invariants || []).map(i =>
    `- [${i.id}] [${i.category}] ${i.statement} (${i.status})`
  ).join('\n');

  return `You are a Principal Software Architect collaborating with the user in Pantry's **Architecture RFC & Design Doc Studio**.

CURRENT RFC DESIGN CANVAS:
- **RFC Title**: ${canvasState.title || 'Architecture RFC'}
- **Status**: ${canvasState.status || 'Draft'}
- **Scope**: ${canvasState.scope || 'System Architecture'}
- **Key Architecture Decisions (${(canvasState.decisions || []).length})**:
${decisionsSummary || 'None registered.'}
- **System Invariants (${(canvasState.invariants || []).length})**:
${invariantsSummary || 'None recorded.'}

RESPONSE GUIDELINES:
1. Provide deep, professional software architecture reasoning (tradeoffs, failure modes, data invariants, and operational patterns).
2. Challenge weak assumptions constructively and suggest concrete alternative designs.
3. Whenever you formulate a new architecture decision, identify a critical system invariant, or update the RFC document or diagrams, append a compact JSON block using \`\`\`rfc_patch.

COMPACT PATCH FORMAT (include only new or updated items):
\`\`\`rfc_patch
{
  "addDecisions": [
    {
      "id": "ADR-02",
      "title": "Idempotency Key Strategy",
      "status": "Approved",
      "chosenOption": "Client-generated UUIDv7 with Redis deduplication window",
      "rationale": "Prevents duplicate charge events during transient network retries."
    }
  ],
  "addInvariants": [
    {
      "statement": "State machine transitions must be strictly linear and validated against the schema.",
      "category": "Correctness"
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

export function parseRfcOutput(
  rawText: string,
  currentState: RfcState
): { cleanText: string; updatedState?: RfcState } {
  if (!rawText) return { cleanText: rawText };

  const closedRegex = /```rfc_patch\s*([\s\S]*?)\s*```/;
  const openRegex = /```rfc_patch\s*([\s\S]*)$/;

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
      console.warn('[parseRfcOutput] Failed to parse RFC patch JSON');
      return { cleanText };
    }

    const nextState: RfcState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    if (patch.title) nextState.title = patch.title;
    if (patch.status) nextState.status = patch.status;
    if (patch.scope) nextState.scope = patch.scope;
    if (patch.rfcMarkdown) nextState.rfcMarkdown = patch.rfcMarkdown;
    if (patch.diagramMermaid) nextState.diagramMermaid = patch.diagramMermaid;

    // Add decisions
    if (Array.isArray(patch.addDecisions) && patch.addDecisions.length > 0) {
      const existingIds = new Set(nextState.decisions.map(d => d.id));
      const newDecisions: RfcDecision[] = [];

      for (const d of patch.addDecisions) {
        if (!d || typeof d !== 'object') continue;
        let id = d.id;
        if (!id || existingIds.has(id)) {
          id = `ADR-${String(nextState.decisions.length + newDecisions.length + 1).padStart(2, '0')}`;
        }
        existingIds.add(id);

        newDecisions.push({
          id,
          title: d.title || 'Architecture Decision',
          status: d.status || 'Approved',
          context: d.context || 'Decision context',
          chosenOption: d.chosenOption || d.decision || 'Adopted approach',
          alternativesConsidered: d.alternativesConsidered || d.alternatives,
          rationale: d.rationale || 'Architectural rationale',
          tradeoffs: d.tradeoffs || '',
        });
      }

      if (newDecisions.length > 0) {
        nextState.decisions = [...nextState.decisions, ...newDecisions];
      }
    }

    // Add invariants
    if (Array.isArray(patch.addInvariants) && patch.addInvariants.length > 0) {
      const existingInvIds = new Set(nextState.invariants.map(i => i.id));
      const newInvariants: RfcInvariant[] = [];

      for (const inv of patch.addInvariants) {
        if (!inv || typeof inv !== 'object') continue;
        let id = inv.id;
        if (!id || existingInvIds.has(id)) {
          id = `INV-${String(nextState.invariants.length + newInvariants.length + 1).padStart(2, '0')}`;
        }
        existingInvIds.add(id);

        newInvariants.push({
          id,
          statement: inv.statement || inv.text || 'System Invariant requirement',
          category: inv.category || 'Correctness',
          status: inv.status || 'Enforced',
        });
      }

      if (newInvariants.length > 0) {
        nextState.invariants = [...nextState.invariants, ...newInvariants];
      }
    }

    return { cleanText, updatedState: nextState };
  } catch (err) {
    console.warn('[parseRfcOutput] Failed to process RFC patch:', err);
    return { cleanText };
  }
}
