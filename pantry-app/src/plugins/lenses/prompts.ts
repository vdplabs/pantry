import type { LensState, LensComponent, LensThreat, LensDecision, LensInvariant } from './types';

export function buildLensesSystemPrompt(state: LensState): string {
  const componentSummary = state.components.map(c => 
    `- [${c.id}] "${c.name}" (${c.subtitle || c.type}, category: ${c.category}${c.boundaryId ? `, in boundary: ${c.boundaryId}` : ''})`
  ).join('\n');

  const boundarySummary = state.boundaries.map(b =>
    `- [${b.id}] "${b.title} ${b.subtitle || ''}" (contains: ${b.componentIds.join(', ') || 'none'})`
  ).join('\n');

  const connectionSummary = state.connections.map(w =>
    `- ${w.from} -> ${w.to} [${w.label || 'connected'}]`
  ).join('\n');

  const threatsSummary = state.threats.slice(0, 10).map(t =>
    `- [${t.id}] ${t.title} (Target: ${t.componentName || t.componentId || 'general'}, Severity: ${t.severity})`
  ).join('\n');

  const decisionsSummary = state.decisions.slice(0, 8).map(d =>
    `- [${d.id}] ${d.title} (Approach: ${d.approach})`
  ).join('\n');

  return `You are a Principal Software Architect & Security Engineering Partner embedded directly in the Pantry Lenses Canvas.
The user is inspecting and editing an architectural canvas topology with associated Architecture Decision Records (ADRs), Threat Models, and System Invariants.

CURRENT CANVAS TOPOLOGY:
Components (${state.components.length}):
${componentSummary || 'None'}

Boundaries (${state.boundaries.length}):
${boundarySummary || 'None'}

Connections (${state.connections.length}):
${connectionSummary || 'None'}

Active Threats Register (${state.threats.length}):
${threatsSummary || 'None'}

Active Architecture Decisions / ADRs (${state.decisions.length}):
${decisionsSummary || 'None'}

Active Invariants (${state.invariants.length}):
${state.invariants.slice(0, 6).map(i => `- [${i.id}] ${i.title}: ${i.statement}`).join('\n') || 'None'}

INSTRUCTIONS FOR AI ASSISTANT:
1. Provide concise, expert architectural analysis (tradeoffs, failure modes, trust boundaries, invariants).
2. When the user asks you to add components, modify topology, generate threats, recommend dependencies, or make decisions, answer with clear architectural reasoning AND provide a JSON patch inside a \`\`\`lens_patch code block.
3. The format of the \`\`\`lens_patch block is:
\`\`\`lens_patch
{
  "addComponents": [
    {
      "id": "unique_id",
      "name": "Component Name",
      "subtitle": "Component Subtitle",
      "type": "service|gateway|datastore|security|client|actor",
      "category": "service_process|database_store|external_network",
      "boundaryId": "optional_boundary_id",
      "x": 600,
      "y": 400
    }
  ],
  "addConnections": [
    {
      "from": "source_id",
      "to": "target_id",
      "label": "calls|authorizes|persists|exploits",
      "color": "#3b82f6"
    }
  ],
  "addBoundaries": [],
  "addThreats": [
    {
      "id": "THR-09",
      "title": "Threat Title",
      "componentId": "target_component_id",
      "category": "Spoofing|Tampering|Info Disclosure|Elevation of Privilege",
      "description": "...",
      "mitigation": "...",
      "severity": "Critical|High|Medium|Low",
      "likelihood": "High|Medium|Low",
      "risk": "High"
    }
  ],
  "addDecisions": [
    {
      "id": "ADR-07",
      "title": "Decision Title",
      "componentId": "target_component_id",
      "approach": "Approach: ...",
      "rationale": "...",
      "status": "Proposed"
    }
  ],
  "addInvariants": [
    {
      "id": "INV-07",
      "title": "Invariant Title",
      "statement": "Invariant mathematical statement...",
      "category": "Automated Policy / Runtime Verification"
    }
  ]
}
\`\`\`
Always provide helpful technical commentary explaining why these changes and security safeguards were recommended.`;
}

export function parseLensModelOutput(
  text: string,
  currentState: LensState,
  userPrompt?: string
): { cleanText: string; updatedState?: LensState } {
  const patchRegex = /```(?:lens_patch|json)\s*([\s\S]*?)```/i;
  const match = text.match(patchRegex);

  if (!match) {
    return { cleanText: text };
  }

  try {
    const rawJson = match[1].trim();
    const patch = JSON.parse(rawJson);

    let newComponents = [...currentState.components];
    let newConnections = [...currentState.connections];
    let newBoundaries = [...currentState.boundaries];
    let newThreats = [...currentState.threats];
    let newDecisions = [...currentState.decisions];
    let newInvariants = [...currentState.invariants];

    // 1. Add Components
    if (Array.isArray(patch.addComponents)) {
      for (const comp of patch.addComponents) {
        if (!newComponents.some(c => c.id === comp.id)) {
          newComponents.push({
            id: comp.id || `comp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: comp.name || 'New Component',
            subtitle: comp.subtitle || comp.type || 'Service',
            type: comp.type || 'service',
            category: comp.category || 'service_process',
            boundaryId: comp.boundaryId,
            x: comp.x || Math.floor(300 + Math.random() * 300),
            y: comp.y || Math.floor(300 + Math.random() * 300),
            width: comp.width || 200,
            height: comp.height || 85,
            threatCount: 0,
          });
        }
      }
    }

    // 2. Add Connections
    if (Array.isArray(patch.addConnections)) {
      for (const conn of patch.addConnections) {
        if (conn.from && conn.to && !newConnections.some(c => c.from === conn.from && c.to === conn.to)) {
          newConnections.push({
            id: `w_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            from: conn.from,
            to: conn.to,
            label: conn.label || 'calls',
            color: conn.color || '#6b7280',
            style: conn.style || 'solid',
          });
        }
      }
    }

    // 3. Add Boundaries
    if (Array.isArray(patch.addBoundaries)) {
      for (const b of patch.addBoundaries) {
        if (!newBoundaries.some(x => x.id === b.id)) {
          newBoundaries.push({
            id: b.id || `bnd_${Date.now()}`,
            title: b.title || 'BOUNDARY',
            subtitle: b.subtitle || '• Network Perimeter',
            color: b.color || 'blue',
            x: b.x || 200,
            y: b.y || 200,
            width: b.width || 400,
            height: b.height || 300,
            componentIds: Array.isArray(b.componentIds) ? b.componentIds : [],
          });
        }
      }
    }

    // 4. Add Threats
    if (Array.isArray(patch.addThreats)) {
      for (const t of patch.addThreats) {
        const id = t.id || `THR-${String(newThreats.length + 1).padStart(2, '0')}`;
        if (!newThreats.some(x => x.id === id)) {
          const targetComp = newComponents.find(c => c.id === t.componentId);
          newThreats.push({
            id,
            title: t.title || 'Identified Vulnerability',
            componentId: t.componentId,
            componentName: targetComp?.name || t.componentId,
            category: t.category || 'Elevation of Privilege',
            threatActor: t.threatActor || 'Adversary',
            attackVector: t.attackVector || 'Network vector',
            description: t.description || 'Potential security weakness identified during evaluation.',
            mitigation: t.mitigation || 'Implement isolation controls.',
            linkedAdrId: t.linkedAdrId,
            severity: t.severity || 'High',
            likelihood: t.likelihood || 'Medium',
            risk: t.risk || 'High',
            status: 'Open',
            isPinned: false,
          });

          // Update threat count on component
          if (targetComp) {
            targetComp.threatCount = (targetComp.threatCount || 0) + 1;
          }
        }
      }
    }

    // 5. Add Decisions
    if (Array.isArray(patch.addDecisions)) {
      for (const d of patch.addDecisions) {
        const id = d.id || `ADR-${String(newDecisions.length + 1).padStart(2, '0')}`;
        if (!newDecisions.some(x => x.id === id)) {
          newDecisions.push({
            id,
            title: d.title || 'Architectural Decision',
            componentId: d.componentId,
            componentName: newComponents.find(c => c.id === d.componentId)?.name,
            approach: d.approach || 'Approach: Architectural standard implementation.',
            rationale: d.rationale || 'Selected to satisfy system requirements and trade-offs.',
            alternatives: d.alternatives,
            tradeoffs: d.tradeoffs,
            status: d.status || 'Proposed',
            isPinned: false,
          });
        }
      }
    }

    // 6. Add Invariants
    if (Array.isArray(patch.addInvariants)) {
      for (const inv of patch.addInvariants) {
        const id = inv.id || `INV-${String(newInvariants.length + 1).padStart(2, '0')}`;
        if (!newInvariants.some(x => x.id === id)) {
          newInvariants.push({
            id,
            title: inv.title || 'System Guarantee',
            componentId: inv.componentId,
            componentName: newComponents.find(c => c.id === inv.componentId)?.name,
            statement: inv.statement || 'Operation must guarantee invariants across boundaries.',
            category: inv.category || 'Automated Policy / Runtime Verification',
            status: 'Enforced',
            isPinned: false,
          });
        }
      }
    }

    // Recalculate all threat counts on components
    for (const comp of newComponents) {
      comp.threatCount = newThreats.filter(t => t.componentId === comp.id).length;
    }

    const cleanText = text.replace(patchRegex, '').trim();

    return {
      cleanText,
      updatedState: {
        ...currentState,
        components: newComponents,
        connections: newConnections,
        boundaries: newBoundaries,
        threats: newThreats,
        decisions: newDecisions,
        invariants: newInvariants,
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('Failed to parse lens_patch block:', err);
    return { cleanText: text };
  }
}

export function buildComponentContextPrompt(component: LensComponent, state: LensState): string {
  const boundary = state.boundaries.find(b => b.id === component.boundaryId);
  const boundaryContext = boundary ? ` within boundary [${boundary.title}]` : '';

  return `Regarding component [${component.name}] (${component.subtitle || component.type})${boundaryContext}:
What are the primary architectural tradeoffs, failure modes, trust boundaries, and potential invariants for this component?`;
}
