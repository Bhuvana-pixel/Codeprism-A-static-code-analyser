import { CodeExplanation } from '../explanation/types';
import { ArchitectureComparison, ComparisonContextForLlm } from './types';

export const TIME_MACHINE_SYSTEM_PROMPT = `You are the CodePrism AI Architecture Change Assistant.

CodePrism performs static analysis of software repositories over Git history.

The static analysis comparison engine is the ONLY source of truth.

Your job is ONLY to explain the architecture comparison results that CodePrism provides.

You must NOT perform repository analysis yourself.
You must NOT invent:
- added or removed nodes
- dependency changes
- circular dependency metrics
- complexity metrics
- code changes

Explain the supplied architectural comparison clearly and concisely for a developer.
Always distinguish between detected facts and structural interpretations.
Use phrases such as:
"Static analysis comparison detects..."
"Between commit {from} and commit {to}..."
"CodePrism identifies..."

Never present unsupported assumptions as facts.`;

export class TimeMachineExplanationBuilder {
  /**
   * Build structured comparison context payload for LLM explanation
   */
  static buildComparisonContext(comparison: ArchitectureComparison): ComparisonContextForLlm {
    return {
      fromCommit: `${comparison.fromSnapshot.commitMessage} (${comparison.fromShortHash})`,
      toCommit: `${comparison.toSnapshot.commitMessage} (${comparison.toShortHash})`,
      metricsSummary: comparison.metricChanges,
      addedNodesCount: comparison.addedNodes.length,
      removedNodesCount: comparison.removedNodes.length,
      modifiedNodesCount: comparison.modifiedNodes.length,
      addedNodeNames: comparison.addedNodes.slice(0, 10).map(n => `${n.name} (${n.kind})`),
      removedNodeNames: comparison.removedNodes.slice(0, 10).map(n => `${n.name} (${n.kind})`),
      modifiedNodeNames: comparison.modifiedNodes.slice(0, 10).map(m => m.entity.name),
      architectureEvents: comparison.architectureEvents.map(e => `${e.title}: ${e.description}`),
      regressions: comparison.regressions,
      improvements: comparison.improvements
    };
  }

  /**
   * Generate static fallback explanation for architecture comparison
   */
  static generateFallbackExplanation(comparison: ArchitectureComparison): CodeExplanation {
    const fromStr = `${comparison.fromSnapshot.commitMessage} (${comparison.fromShortHash})`;
    const toStr = `${comparison.toSnapshot.commitMessage} (${comparison.toShortHash})`;

    const addedStr = comparison.addedNodes.length > 0
      ? comparison.addedNodes.slice(0, 5).map(n => n.name).join(', ')
      : 'None';

    const removedStr = comparison.removedNodes.length > 0
      ? comparison.removedNodes.slice(0, 5).map(n => n.name).join(', ')
      : 'None';

    const eventsStr = comparison.architectureEvents.length > 0
      ? comparison.architectureEvents.map(e => e.title).join('; ')
      : 'Clean structural progression without major architectural alerts.';

    return {
      title: `Architecture Change: ${comparison.fromShortHash} ➔ ${comparison.toShortHash}`,
      summary: `Static analysis comparison detected ${comparison.addedNodes.length} added node(s), ${comparison.removedNodes.length} removed node(s), and ${comparison.modifiedNodes.length} modified component(s) between '${comparison.fromShortHash}' and '${comparison.toShortHash}'.`,
      sections: [
        {
          heading: 'Overview of Changes',
          content: `Between commit ${comparison.fromShortHash} ("${comparison.fromSnapshot.commitMessage}") and commit ${comparison.toShortHash} ("${comparison.toSnapshot.commitMessage}"), CodePrism detected ${comparison.metricChanges.find(m => m.metricName === 'Total Files')?.diff || 0} file change(s) and ${comparison.addedEdges.length} new relationship edge(s).`
        },
        {
          heading: 'Added & Removed Components',
          content: `Newly introduced components include: [${addedStr}]. Removed components include: [${removedStr}].`
        },
        {
          heading: 'Architecture Evolution Events',
          content: eventsStr
        },
        {
          heading: 'Structural Metrics Comparison',
          content: `Circular dependencies changed by ${comparison.metricChanges.find(m => m.metricName === 'Circular Dependencies')?.diff || 0}. Average complexity change is ${comparison.metricChanges.find(m => m.metricName === 'Average Complexity')?.diff || 0} pts.`
        }
      ],
      limitations: [
        'Explanation is based only on static-analysis snapshot comparison.',
        'LLM explanation service fallback active. Static analysis snapshot diff remains available.'
      ]
    };
  }
}
