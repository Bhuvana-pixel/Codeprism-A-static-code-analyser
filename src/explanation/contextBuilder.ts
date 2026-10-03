import { GraphData, IREntity } from '../analyzer/types';
import { GitHubAnalysisInfo, ModuleAnalysisContext, NodeAnalysisContext } from './types';

export class ContextBuilder {
  /**
   * Build a structured explanation context for a single node/entity strictly from existing static analysis data.
   */
  static buildNodeContext(
    entityId: string,
    graphData: GraphData,
    projectName: string = 'Workspace',
    githubInfo?: GitHubAnalysisInfo
  ): NodeAnalysisContext | null {
    const entity = graphData.entities[entityId];
    if (!entity) return null;

    const allEntities = Object.values(graphData.entities);

    // Find children functions/classes
    const childEntities = allEntities.filter(e => e.parentId === entity.id || (e.filePath === entity.filePath && e.id !== entity.id));
    const functions = childEntities
      .filter(e => e.kind === 'function' || e.kind === 'method')
      .map(e => e.name);

    const classes = childEntities
      .filter(e => e.kind === 'class' || e.kind === 'interface' || e.kind === 'struct')
      .map(e => e.name);

    if (entity.kind === 'class' || entity.kind === 'interface' || entity.kind === 'struct') {
      if (!classes.includes(entity.name)) {
        classes.unshift(entity.name);
      }
    }

    // Outgoing dependencies
    const outgoingRels = graphData.relationships.filter(r => r.sourceId === entity.id);
    const dependencies = Array.from(
      new Set(
        outgoingRels
          .map(r => graphData.entities[r.targetId]?.name)
          .filter((name): name is string => Boolean(name))
      )
    );

    // Incoming dependents
    const incomingRels = graphData.relationships.filter(r => r.targetId === entity.id);
    const dependents = Array.from(
      new Set(
        incomingRels
          .map(r => graphData.entities[r.sourceId]?.name)
          .filter((name): name is string => Boolean(name))
      )
    );

    // Imports
    const directImports = (entity.imports || []).map(i => i.symbol);
    const relImports = outgoingRels
      .filter(r => r.kind === 'IMPORTS')
      .map(r => graphData.entities[r.targetId]?.name)
      .filter((n): n is string => Boolean(n));

    const imports = Array.from(new Set([...directImports, ...relImports]));

    // Imported By
    const importedBy = Array.from(
      new Set(
        incomingRels
          .filter(r => r.kind === 'IMPORTS' || r.kind === 'DEPENDS_ON' || r.kind === 'REFERENCES')
          .map(r => graphData.entities[r.sourceId]?.name)
          .filter((n): n is string => Boolean(n))
      )
    );

    // Exports
    const exports = (entity.exports || []).map(e => e.symbol);

    // Module name / folder path
    const moduleName = entity.relativePath
      ? entity.relativePath.split(/[/\\]/)[0]
      : entity.archLayer;

    // Static Insights
    const insights: string[] = [];
    if (dependencies.length > 3) {
      insights.push(`High dependency count (${dependencies.length} outgoing dependencies)`);
    }
    if (dependents.length > 3) {
      insights.push(`High incoming usage count (${dependents.length} components depend on this)`);
    }
    if (dependents.length === 0) {
      insights.push(`Unreferenced component across workspace (0 incoming references)`);
    }
    insights.push(`Static analysis classifies component as part of the ${entity.archLayer || 'unknown'} layer`);
    if ((entity.metrics?.cyclomaticComplexity || 1) > 3) {
      insights.push(`Elevated cyclomatic complexity (${entity.metrics?.cyclomaticComplexity} logical branches)`);
    }

    const github: GitHubAnalysisInfo = githubInfo || {
      repository: projectName,
      fileLocation: entity.relativePath || entity.filePath,
      isAvailable: false
    };

    return {
      projectName,
      node: {
        name: entity.name,
        type: entity.kind,
        file: entity.relativePath || entity.filePath,
        language: entity.language,
        layer: entity.archLayer || 'unknown',
        moduleName,
        dependencyCount: dependencies.length,
        dependentCount: dependents.length
      },
      staticAnalysis: {
        imports,
        importedBy,
        functions,
        classes,
        dependencies,
        dependents,
        exports,
        metrics: {
          linesOfCode: entity.metrics?.loc || 1,
          dependencyCount: dependencies.length,
          cyclomaticComplexity: entity.metrics?.cyclomaticComplexity || 1,
          incomingDegree: dependents.length,
          outgoingDegree: dependencies.length
        },
        insights
      },
      githubAnalysis: github
    };
  }

  /**
   * Build a structured explanation context for an entire module or architectural layer strictly from static analysis data.
   */
  static buildModuleContext(
    moduleIdentifier: string,
    graphData: GraphData,
    projectName: string = 'Workspace',
    githubInfo?: GitHubAnalysisInfo
  ): ModuleAnalysisContext {
    const allEntities = Object.values(graphData.entities);
    const identifierLower = moduleIdentifier.toLowerCase();

    // Filter entities belonging to the module (by layer name or folder path)
    const moduleEntities = allEntities.filter(e => {
      const isLayerMatch = e.archLayer.toLowerCase() === identifierLower;
      const isPathMatch = e.relativePath.toLowerCase().includes(identifierLower);
      return isLayerMatch || isPathMatch;
    });

    const fileEntities = moduleEntities.filter(e => e.kind === 'file');
    const targetEntities = fileEntities.length > 0 ? fileEntities : moduleEntities;

    const moduleEntityIds = new Set(targetEntities.map(e => e.id));

    const files = Array.from(new Set(targetEntities.map(e => e.relativePath || e.name)));

    const classes = Array.from(
      new Set(
        moduleEntities
          .filter(e => e.kind === 'class' || e.kind === 'interface' || e.kind === 'struct')
          .map(e => e.name)
      )
    );

    const functions = Array.from(
      new Set(
        moduleEntities
          .filter(e => e.kind === 'function' || e.kind === 'method')
          .map(e => e.name)
      )
    );

    // Module outgoing dependencies (external to module)
    const outgoingRels = graphData.relationships.filter(
      r => moduleEntityIds.has(r.sourceId) && !moduleEntityIds.has(r.targetId)
    );
    const dependencies = Array.from(
      new Set(
        outgoingRels
          .map(r => graphData.entities[r.targetId]?.name)
          .filter((n): n is string => Boolean(n))
      )
    );

    // Module incoming dependents (external to module)
    const incomingRels = graphData.relationships.filter(
      r => moduleEntityIds.has(r.targetId) && !moduleEntityIds.has(r.sourceId)
    );
    const dependents = Array.from(
      new Set(
        incomingRels
          .map(r => graphData.entities[r.sourceId]?.name)
          .filter((n): n is string => Boolean(n))
      )
    );

    // Aggregated imports
    const imports = Array.from(
      new Set(
        moduleEntities
          .flatMap(e => (e.imports || []).map(i => i.symbol))
          .concat(dependencies)
      )
    );

    // Aggregated exports
    const exports = Array.from(
      new Set(
        moduleEntities.flatMap(e => (e.exports || []).map(ex => ex.symbol))
      )
    );

    const totalLoc = targetEntities.reduce((sum, e) => sum + (e.metrics?.loc || 1), 0);
    const layerName = targetEntities[0]?.archLayer || moduleIdentifier;

    const insights: string[] = [
      `Module '${moduleIdentifier}' contains ${files.length} file(s) with ${totalLoc} total lines of code`,
      `Static analysis detects ${classes.length} class(es) and ${functions.length} function(s)`,
      `Connected to ${dependencies.length} external module dependency/dependencies`
    ];

    const github: GitHubAnalysisInfo = githubInfo || {
      repository: projectName,
      fileLocation: moduleIdentifier,
      isAvailable: false
    };

    return {
      projectName,
      module: {
        name: moduleIdentifier,
        type: 'module',
        filesCount: files.length,
        layer: layerName
      },
      staticAnalysis: {
        files,
        classes,
        functions,
        dependencies,
        dependents,
        imports,
        exports,
        layer: layerName,
        metrics: {
          linesOfCode: totalLoc,
          filesCount: files.length,
          classCount: classes.length,
          functionCount: functions.length,
          dependencyCount: dependencies.length
        },
        insights
      },
      githubAnalysis: github
    };
  }
}
