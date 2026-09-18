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
    `- ID: "${c.id}" | Name: "${c.name}" (${c.type}) | Boundary: "${c.trustBoundary}" | Tech: "${c.techStack || 'Standard'}"`
  ).join('\n');

  const threatSummary = (canvasState.threats || []).slice(0, 15).map(t =>
    `- [${t.id}] Target: "${t.componentName || t.componentId}" | Threat Actor: ${t.threatActor} | Severity: ${t.severity}`
  ).join('\n');

  const activeFramework = canvasState.framework || framework || 'PASTA';

  return `You are a Principal Security Architect specializing in ${activeFramework} threat modeling in Pantry Studio.

CURRENT SYSTEM ARCHITECTURE:
- Target Application: ${canvasState.appName || 'Target System'}
- Scope: ${canvasState.scope || 'Core Services'}
- Framework: ${activeFramework}
- Components:
${compSummary || 'No components registered yet.'}
- Recorded Threats (${(canvasState.threats || []).length}):
${threatSummary || 'No threats recorded yet.'}

RESPONSE GUIDELINES:
1. Provide a direct, concise security analysis for the target component or question.
2. Clearly identify realistic threat actors (e.g. Credential Stuffers, Malicious Insiders, Automated Botnets), attack vectors, and practical mitigations.
3. If new threats or architecture changes are discovered, append a compact JSON block at the very end using \`\`\`threat_model_patch.

COMPACT PATCH FORMAT (include only new or updated items):
\`\`\`threat_model_patch
{
  "addThreats": [
    {
      "componentId": "comp-id",
      "threatActor": "Adversary name",
      "attackVector": "Vector description",
      "severity": "High",
      "mitigation": "Mitigation steps"
    }
  ]
}
\`\`\`
Keep the JSON patch concise (1 to 2 threats) so responses are fast and never cut off.`;
}

function tryRepairJson(jsonStr: string): any {
  // 1. Direct parse attempt
  try {
    return JSON.parse(jsonStr);
  } catch {}

  // 2. Trim trailing dangling commas, quotes, keys
  let repaired = jsonStr.trim();
  repaired = repaired.replace(/,\s*([\}\]])/g, '$1');

  // Attempt closing unbalanced quotes, braces and brackets
  for (let i = 0; i < 5; i++) {
    try {
      return JSON.parse(repaired);
    } catch {}

    // Check if open quote
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }

    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;

    if (openBrackets > closeBrackets) {
      repaired += ']';
    } else if (openBraces > closeBraces) {
      repaired += '}';
    } else {
      break;
    }
  }

  try {
    return JSON.parse(repaired);
  } catch {}

  return null;
}

export function parseThreatModelOutput(
  rawText: string,
  currentState: ThreatModelState
): { cleanText: string; updatedState?: ThreatModelState } {
  if (!rawText) return { cleanText: rawText };

  // Match either closed or unclosed/truncated threat_model_patch block
  const closedRegex = /```threat_model_patch\s*([\s\S]*?)\s*```/;
  const openRegex = /```threat_model_patch\s*([\s\S]*)$/;

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

  if (!patchJsonStr) {
    return { cleanText };
  }

  try {
    const patch = tryRepairJson(patchJsonStr);
    if (!patch) {
      console.warn('[parseThreatModelOutput] Could not repair patch JSON:', patchJsonStr);
      return { cleanText };
    }

    const nextState: ThreatModelState = {
      ...currentState,
      updatedAt: new Date().toISOString(),
    };

    if (patch.appName) nextState.appName = patch.appName;
    if (patch.scope) nextState.scope = patch.scope;
    if (patch.dfdMermaid) nextState.dfdMermaid = patch.dfdMermaid;

    // Add components (flexible aliases)
    const rawComponents = patch.addComponents || patch.components || patch.newComponents;
    const compsList = Array.isArray(rawComponents) ? rawComponents : (rawComponents && typeof rawComponents === 'object' ? [rawComponents] : []);
    const existingIds = new Set(nextState.components.map(c => c.id));
    const newComps: ThreatComponent[] = [];

    for (let idx = 0; idx < compsList.length; idx++) {
      const c = compsList[idx];
      if (!c) continue;
      const compName = typeof c === 'string' ? c : (c.name || c.title || 'New Component');
      const id = (typeof c === 'object' && c.id) ? c.id : `comp-${Date.now()}-${idx}`;
      if (!existingIds.has(id)) {
        existingIds.add(id);
        newComps.push({
          id,
          name: compName,
          type: (typeof c === 'object' && c.type) ? c.type : 'process',
          trustBoundary: (typeof c === 'object' && c.trustBoundary) ? c.trustBoundary : 'Internal Trust Zone',
          techStack: (typeof c === 'object' && (c.techStack || c.tech || c.technology)) ? (c.techStack || c.tech || c.technology) : 'Standard',
          description: (typeof c === 'object' && c.description) ? c.description : '',
        });
      }
    }
    if (newComps.length > 0) {
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

    // Add threats (flexible aliases)
    const rawThreats = patch.addThreats || patch.threats || patch.newThreats;
    const threatsList = Array.isArray(rawThreats) ? rawThreats : (rawThreats && typeof rawThreats === 'object' ? [rawThreats] : []);
    const existingThreatIds = new Set(nextState.threats.map(t => t.id));
    const formattedThreats: ThreatItem[] = [];

    for (const t of threatsList) {
      if (!t || typeof t !== 'object') continue;
      let id = t.id;
      if (!id || existingThreatIds.has(id)) {
        id = `TM-${String(nextState.threats.length + formattedThreats.length + 1).padStart(2, '0')}`;
      }
      existingThreatIds.add(id);

      let compId = t.componentId || t.component_id || t.component || 'system';
      let componentName = t.componentName || t.component_name;
      if (!componentName && compId) {
        const comp = nextState.components.find(c => c.id === compId || c.name.toLowerCase() === compId.toLowerCase());
        if (comp) {
          componentName = comp.name;
          compId = comp.id;
        }
      }

      formattedThreats.push({
        id,
        componentId: compId,
        componentName: componentName || 'General Architecture',
        category: t.category || t.strideCategory || 'Threat Analysis',
        threatActor: t.threatActor || t.threat_actor || t.actor || 'Adversary / Threat Actor',
        attackVector: t.attackVector || t.attack_vector || t.vector || t.title || 'Targeted Exploitation',
        description: t.description || `${t.threatActor || 'Adversary'} targeting ${componentName || compId}`,
        impact: t.impact || 'Service disruption or unauthorized data access',
        severity: t.severity || 'High',
        mitigation: t.mitigation || t.countermeasure || t.remediation || 'Implement defense-in-depth controls',
        status: t.status || 'Open',
      });
    }

    if (formattedThreats.length > 0) {
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

    // Ensure cleanText is never empty
    if (!cleanText.trim()) {
      const summaryItems: string[] = [];
      if (formattedThreats.length > 0) {
        summaryItems.push(`🛡️ **Security Findings Identified (${formattedThreats.length})**:\n` + formattedThreats.map(t => `- **[${t.severity}] ${t.threatActor}**: ${t.attackVector} -> *${t.mitigation}*`).join('\n'));
      }
      if (newComps.length > 0) {
        summaryItems.push(`⚙️ **Registered Components (${newComps.length})**:\n` + newComps.map(c => `- **${c.name}** (${c.type} • ${c.techStack})`).join('\n'));
      }
      cleanText = summaryItems.length > 0
        ? `I have updated the **Threat Model Studio Canvas** with security analysis:\n\n${summaryItems.join('\n\n')}`
        : `✨ *Threat Model Canvas synchronized with your latest inputs.*`;
    }

    return { cleanText, updatedState: nextState };
  } catch (err) {
    console.warn('[parseThreatModelOutput] Failed to process patch JSON:', err);
    if (!cleanText.trim()) {
      cleanText = `✨ *Threat Model Canvas updated.*`;
    }
    return { cleanText };
  }
}
