import type { ThreatModelState, ThreatStage, ThreatComponent, ThreatItem } from './types';

const PASTA_STAGES: ThreatStage[] = [
  { id: 1, name: 'Stage 1: Define Business Objectives', framework: 'PASTA', description: 'Identify business goals, compliance requirements, and risk appetite', status: 'pending' },
  { id: 2, name: 'Stage 2: Define Technical Scope', framework: 'PASTA', description: 'Map out boundaries, technologies, cloud assets, and dependencies', status: 'pending' },
  { id: 3, name: 'Stage 3: Application Decomposition & DFD', framework: 'PASTA', description: 'Decompose app into actors, processes, data stores, and data flows', status: 'pending' },
  { id: 4, name: 'Stage 4: Threat Analysis', framework: 'PASTA', description: 'Identify threat intelligence, threat actors, and attack motivations', status: 'pending' },
  { id: 5, name: 'Stage 5: Vulnerability & Flaw Analysis', framework: 'PASTA', description: 'Map weaknesses (CWE, OWASP Top 10) to decomposed components', status: 'pending' },
  { id: 6, name: 'Stage 6: Attack Modeling & Simulation', framework: 'PASTA', description: 'Construct attack trees, assess attack viability and blast radius', status: 'pending' },
  { id: 7, name: 'Stage 7: Risk & Countermeasure Formulation', framework: 'PASTA', description: 'Formulate prioritized mitigations, security controls, and residual risk', status: 'pending' },
];

const STRIDE_STAGES: ThreatStage[] = [
  { id: 1, name: '1. Asset & Boundary Identification', framework: 'STRIDE', description: 'Identify entry points, trust boundaries, and protected data stores', status: 'pending' },
  { id: 2, name: '2. Data Flow Diagramming (DFD)', framework: 'STRIDE', description: 'Diagram processes, inter-service communications, and data in transit', status: 'pending' },
  { id: 3, name: '3. STRIDE Threat Categorization', framework: 'STRIDE', description: 'Apply Spoofing, Tampering, Repudiation, Info Disclosure, DoS, Elevation', status: 'pending' },
  { id: 4, name: '4. Mitigation & Control Planning', framework: 'STRIDE', description: 'Assign security controls (AuthN, AuthZ, Encryption, Rate Limiting)', status: 'pending' },
  { id: 5, name: '5. Validation & Verification', framework: 'STRIDE', description: 'Validate coverage against threat scenarios and verify mitigations', status: 'pending' },
];

const MAESTRO_STAGES: ThreatStage[] = [
  { id: 1, name: '1. Agentic Architecture & Tool Inventory', framework: 'MAESTRO', description: 'Map LLM agents, tools, MCP servers, and external API capabilities', status: 'pending' },
  { id: 2, name: '2. Trust & Prompt Boundary Decomposition', framework: 'MAESTRO', description: 'Establish user input boundaries, system prompts, and tool execution realms', status: 'pending' },
  { id: 3, name: '3. Agentic Threat & Attack Vector Analysis', framework: 'MAESTRO', description: 'Analyze Prompt Injection, Tool Hijacking, Autonomous Loops, Data Poisoning', status: 'pending' },
  { id: 4, name: '4. Blast Radius & Privilege Assessment', framework: 'MAESTRO', description: 'Assess maximum potential damage from compromised tool calls or stolen tokens', status: 'pending' },
  { id: 5, name: '5. Multi-Layer Guardrails & Mitigations', framework: 'MAESTRO', description: 'Implement semantic firewalls, human-in-the-loop gates, and token limiting', status: 'pending' },
];

export function getInitialThreatModelState(framework: string = 'PASTA'): ThreatModelState {
  let stages = PASTA_STAGES;
  if (framework === 'STRIDE') stages = STRIDE_STAGES;
  else if (framework === 'MAESTRO') stages = MAESTRO_STAGES;

  const defaultDfd = `graph TD
    Client["🌐 Client / User"] -->|HTTPS / TLS| APIGW["🛡️ API Gateway"]
    APIGW -->|gRPC / Internal| AuthSvc["🔑 Auth Service"]
    APIGW -->|HTTP / JSON| CoreApp["⚙️ Core Backend Service"]
    CoreApp -->|Read / Write| MainDB[("🗄️ Primary Database")]
    CoreApp -->|Async Tasks| Queue[("📬 Message Broker / Queue")]
    
    subgraph DMZ ["Public DMZ Zone"]
      APIGW
    end

    subgraph InternalMesh ["Internal Protected Network"]
      AuthSvc
      CoreApp
      MainDB
      Queue
    end
`;

  const defaultComponents: ThreatComponent[] = [
    { id: 'comp-client', name: 'Web / Mobile Client', type: 'actor', trustBoundary: 'Untrusted Internet', techStack: 'Browser / iOS / Android' },
    { id: 'comp-apigw', name: 'API Gateway', type: 'gateway', trustBoundary: 'DMZ Boundary', techStack: 'Envoy / NGINX' },
    { id: 'comp-auth', name: 'Authentication Service', type: 'process', trustBoundary: 'Internal Trust Zone', techStack: 'OAuth2 / JWT' },
    { id: 'comp-backend', name: 'Core Backend Service', type: 'process', trustBoundary: 'Internal Trust Zone', techStack: 'Go / Node / Python' },
    { id: 'comp-db', name: 'Primary Database', type: 'datastore', trustBoundary: 'Internal Data Tier', techStack: 'PostgreSQL' },
  ];

  return {
    appName: 'Target System Architecture',
    framework: (framework as any) || 'PASTA',
    scope: 'Core API, Authentication & Data Layer',
    businessObjectives: [
      'Protect Customer Data & PII from Unauthorized Access',
      'Guarantee 99.99% Availability against Denial of Service',
      'Enforce Zero Trust Communication between Internal Microservices',
    ],
    components: defaultComponents,
    threats: [],
    stages: JSON.parse(JSON.stringify(stages)),
    dfdMermaid: defaultDfd,
    updatedAt: new Date().toISOString(),
  };
}

export function buildThreatModelSystemPrompt(canvasState: ThreatModelState, framework: string = 'PASTA'): string {
  const compSummary = (canvasState.components || []).map(c => 
    `- Component ID: "${c.id}" | Name: "${c.name}" | Type: ${c.type} | Trust Boundary: "${c.trustBoundary}" | Tech: "${c.techStack || 'Unknown'}"`
  ).join('\n');

  const threatSummary = (canvasState.threats || []).map(t =>
    `- [${t.id}] Target: "${t.componentName || t.componentId}" | Category: ${t.category} | Threat Actor: ${t.threatActor} | Severity: ${t.severity} | Status: ${t.status}\n  Description: ${t.description}\n  Mitigation: ${t.mitigation}`
  ).join('\n');

  const activeFramework = canvasState.framework || framework || 'PASTA';

  return `You are a Principal Security Architect and Threat Modeling Expert specialized in the ${activeFramework} framework.
You are collaborating with the user in Pantry's **Threat Modeling Studio**.

### CURRENT CANVAS STATE (Context-Aware Architecture):
- **Target Application**: ${canvasState.appName || 'Target System'}
- **Scope**: ${canvasState.scope || 'General Architecture'}
- **Framework**: ${activeFramework}
- **Registered Architecture Components**:
${compSummary || 'No components registered yet.'}

- **Current Threat Register (${(canvasState.threats || []).length} threats)**:
${threatSummary || 'No threats recorded in register yet.'}

---

### INSTRUCTIONS:
1. **Context Awareness**:
   - When the user asks about specific components (e.g. "What are the threat actors to the API", "Analyze vulnerabilities in the database", "What if Redis is compromised?"), ALWAYS anchor your analysis directly to the registered components, technologies, and trust boundaries shown in the CURRENT CANVAS STATE above.
   - If the user asks about threat actors, break down who the realistic adversaries are for that exact object (e.g. Credential Stuffers, Compromised Internal Services, Script Kiddies, Nation-State Actors, Rogue Insiders).

2. **Dual-Channel Output (Chat + Canvas Patch)**:
   - Deliver clear, insightful, professional security reasoning in the conversational chat.
   - Whenever you identify new components, update diagrams, discover threats, or advance a framework stage, you MUST include a \`\`\`threat_model_patch codeblock containing a valid JSON patch object.

### FORMAT FOR threat_model_patch BLOCK:
\`\`\`threat_model_patch
{
  "appName": "Updated App Name (optional)",
  "scope": "Updated Scope (optional)",
  "addComponents": [
    {
      "id": "unique-slug-id",
      "name": "Component Name",
      "type": "actor" | "process" | "datastore" | "gateway" | "external" | "agent",
      "trustBoundary": "Name of Trust Boundary",
      "techStack": "Technologies used (e.g. Envoy, PostgreSQL, Kafka)",
      "description": "Brief description"
    }
  ],
  "updateComponents": [
    {
      "id": "existing-comp-id",
      "name": "Updated Name",
      "trustBoundary": "New Boundary"
    }
  ],
  "addThreats": [
    {
      "id": "TM-01",
      "componentId": "comp-apigw",
      "componentName": "API Gateway",
      "category": "Spoofing" | "Tampering" | "Repudiation" | "InfoDisclosure" | "DoS" | "Elevation" | "AgenticLoop" | "PromptInjection" | "BusinessLogic",
      "threatActor": "External Botnet / Malicious User",
      "attackVector": "Credential stuffing & token replay over HTTP",
      "description": "Adversary automates stolen credentials against public /login endpoint.",
      "impact": "Account takeover and unauthorized session creation.",
      "severity": "High" | "Critical" | "Medium" | "Low",
      "mitigation": "Enforce mTLS, rate limiting, and adaptive MFA with JWT signature validation.",
      "status": "Open"
    }
  ],
  "dfdMermaid": "graph TD ... (Updated full Mermaid diagram if architecture changed)",
  "updateStages": [
    {
      "id": 1,
      "status": "completed" | "in_progress",
      "findings": "Brief summary of stage completion"
    }
  ]
}
\`\`\`

Always prioritize actionable, high-quality mitigations with realistic security engineering standards.`;
}

export function parseThreatModelOutput(
  rawText: string,
  currentState: ThreatModelState
): { cleanText: string; updatedState?: ThreatModelState } {
  if (!rawText) return { cleanText: rawText };

  const patchRegex = /```threat_model_patch\s*([\s\S]*?)\s*```/;
  const match = rawText.match(patchRegex);

  if (!match) {
    return { cleanText: rawText };
  }

  const patchJsonStr = match[1].trim();
  const cleanText = rawText.replace(patchRegex, '').trim();

  try {
    const patch = JSON.parse(patchJsonStr);
    const nextState: ThreatModelState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    if (patch.appName) nextState.appName = patch.appName;
    if (patch.scope) nextState.scope = patch.scope;
    if (patch.dfdMermaid) nextState.dfdMermaid = patch.dfdMermaid;

    // Add components
    if (Array.isArray(patch.addComponents) && patch.addComponents.length > 0) {
      const existingIds = new Set(nextState.components.map(c => c.id));
      const newComps: ThreatComponent[] = patch.addComponents.filter((c: any) => c && c.id && !existingIds.has(c.id));
      nextState.components = [...nextState.components, ...newComps];
    }

    // Update components
    if (Array.isArray(patch.updateComponents) && patch.updateComponents.length > 0) {
      const updateMap = new Map(patch.updateComponents.map((c: any) => [c.id, c]));
      nextState.components = nextState.components.map(c => {
        const patchComp = updateMap.get(c.id);
        return patchComp ? { ...c, ...patchComp } : c;
      });
    }

    // Add threats
    if (Array.isArray(patch.addThreats) && patch.addThreats.length > 0) {
      const existingThreatIds = new Set(nextState.threats.map(t => t.id));
      const formattedThreats: ThreatItem[] = [];

      for (const t of patch.addThreats) {
        if (!t) continue;
        let id = t.id;
        if (!id || existingThreatIds.has(id)) {
          id = `TM-${String(nextState.threats.length + formattedThreats.length + 1).padStart(2, '0')}`;
        }
        existingThreatIds.add(id);

        let componentName = t.componentName;
        if (!componentName && t.componentId) {
          const comp = nextState.components.find(c => c.id === t.componentId);
          if (comp) componentName = comp.name;
        }

        formattedThreats.push({
          id,
          componentId: t.componentId || 'system',
          componentName: componentName || 'General Architecture',
          category: t.category || 'General',
          threatActor: t.threatActor || 'External Attacker',
          attackVector: t.attackVector || 'Network Exploitation',
          description: t.description || 'Threat description',
          impact: t.impact || 'System compromise',
          severity: t.severity || 'Medium',
          mitigation: t.mitigation || 'Implement defense-in-depth controls',
          status: t.status || 'Open',
        });
      }

      nextState.threats = [...nextState.threats, ...formattedThreats];
    }

    // Update stages
    if (Array.isArray(patch.updateStages) && patch.updateStages.length > 0) {
      const stageUpdates = new Map<string, any>(patch.updateStages.map((s: any) => [String(s.id), s]));
      nextState.stages = nextState.stages.map(stage => {
        const update = stageUpdates.get(String(stage.id));
        if (update) {
          return {
            ...stage,
            status: update.status || stage.status,
            findings: update.findings || stage.findings,
          };
        }
        return stage;
      });
    }

    return { cleanText, updatedState: nextState };
  } catch (err) {
    console.warn('[parseThreatModelOutput] Failed to parse patch JSON:', err);
    return { cleanText };
  }
}
