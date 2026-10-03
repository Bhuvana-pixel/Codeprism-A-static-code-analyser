import { CircularDependencyCycle, IREntity, IRRelationship } from './types';

export interface ImpactPathStep {
  fromName: string;
  fromId: string;
  relKind: string;
  toName: string;
  toId: string;
}

export interface ImpactItem {
  entity: IREntity;
  depth: number;
  relKind: string;
  path: ImpactPathStep[];
}

export interface ImpactAnalysisResult {
  targetEntity: IREntity;
  impactScore: number;
  scoreBreakdown: {
    directCount: number;
    indirectCount: number;
    layersCrossed: number;
    maxDepth: number;
  };
  directImpact: ImpactItem[];
  indirectImpact: ImpactItem[];
  allAffectedEntityIds: string[];
}

export class IntelligenceEngine {
  /**
   * Detects circular dependencies across files or components using Tarjan's SCC algorithm.
   */
  static findCircularDependencies(
    entities: Record<string, IREntity>,
    relationships: IRRelationship[]
  ): CircularDependencyCycle[] {
    const fileEntities = Object.values(entities).filter(e => e.kind === 'file');
    const fileIds = new Set(fileEntities.map(e => e.id));

    const adj = new Map<string, Set<string>>();
    fileIds.forEach(id => adj.set(id, new Set()));

    relationships.forEach(rel => {
      if (rel.kind === 'IMPORTS' || rel.kind === 'DEPENDS_ON' || rel.kind === 'CALLS') {
        const sourceFile = this.getFileIdOfEntity(entities, rel.sourceId);
        const targetFile = this.getFileIdOfEntity(entities, rel.targetId);

        if (sourceFile && targetFile && sourceFile !== targetFile && fileIds.has(sourceFile) && fileIds.has(targetFile)) {
          adj.get(sourceFile)?.add(targetFile);
        }
      }
    });

    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const sccs: string[][] = [];

    function strongConnect(nodeId: string) {
      indices.set(nodeId, index);
      lowlink.set(nodeId, index);
      index++;
      stack.push(nodeId);
      onStack.add(nodeId);

      const neighbors = adj.get(nodeId) || new Set();
      neighbors.forEach(neighbor => {
        if (!indices.has(neighbor)) {
          strongConnect(neighbor);
          lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, lowlink.get(neighbor)!));
        } else if (onStack.has(neighbor)) {
          lowlink.set(nodeId, Math.min(lowlink.get(nodeId)!, indices.get(neighbor)!));
        }
      });

      if (lowlink.get(nodeId) === indices.get(nodeId)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== nodeId);

        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    }

    fileIds.forEach(id => {
      if (!indices.has(id)) {
        strongConnect(id);
      }
    });

    const cycles: CircularDependencyCycle[] = sccs.map((cycleNodes, idx) => {
      const cycleNames = cycleNodes.map(id => entities[id]?.name || id);
      const cycleFiles = cycleNodes.map(id => entities[id]?.relativePath || id);
      return {
        id: `cycle-${idx + 1}`,
        cycleNodes,
        cycleNames,
        cycleFiles
      };
    });

    return cycles;
  }

  /**
   * Computes multi-level impact analysis, dependency paths, and CodePrism Impact Score
   */
  static analyzeImpact(
    targetEntityId: string,
    entities: Record<string, IREntity>,
    relationships: IRRelationship[],
    maxDepthLimit: number = 2
  ): ImpactAnalysisResult | null {
    const targetEntity = entities[targetEntityId];
    if (!targetEntity) return null;

    // Build reverse adjacency list: targetId -> list of { sourceId, relKind }
    const reverseAdj = new Map<string, Array<{ sourceId: string; kind: string }>>();

    relationships.forEach(rel => {
      if (rel.sourceId !== rel.targetId && rel.kind !== 'CONTAINS') {
        if (!reverseAdj.has(rel.targetId)) reverseAdj.set(rel.targetId, []);
        reverseAdj.get(rel.targetId)!.push({ sourceId: rel.sourceId, kind: rel.kind });
      }
    });

    const visitedDepth = new Map<string, number>();
    const directImpactMap = new Map<string, ImpactItem>();
    const indirectImpactMap = new Map<string, ImpactItem>();
    const layersCrossedSet = new Set<string>();

    if (targetEntity.archLayer) {
      layersCrossedSet.add(targetEntity.archLayer);
    }

    interface BFSNode {
      entityId: string;
      depth: number;
      path: ImpactPathStep[];
    }

    const queue: BFSNode[] = [{ entityId: targetEntityId, depth: 0, path: [] }];
    visitedDepth.set(targetEntityId, 0);

    let maxDepthReached = 0;

    while (queue.length > 0) {
      const { entityId, depth, path } = queue.shift()!;
      const currentEntity = entities[entityId];
      if (currentEntity && currentEntity.archLayer) {
        layersCrossedSet.add(currentEntity.archLayer);
      }

      if (depth > maxDepthReached) {
        maxDepthReached = depth;
      }

      if (depth >= maxDepthLimit) continue;

      const dependents = reverseAdj.get(entityId) || [];

      for (const dep of dependents) {
        const depEntity = entities[dep.sourceId];
        if (!depEntity) continue;

        const nextDepth = depth + 1;
        const newStep: ImpactPathStep = {
          fromId: entityId,
          fromName: currentEntity?.name || entityId,
          relKind: dep.kind,
          toId: dep.sourceId,
          toName: depEntity.name
        };

        const nextPath = [...path, newStep];

        if (!visitedDepth.has(dep.sourceId) || visitedDepth.get(dep.sourceId)! > nextDepth) {
          visitedDepth.set(dep.sourceId, nextDepth);

          const impactItem: ImpactItem = {
            entity: depEntity,
            depth: nextDepth,
            relKind: dep.kind,
            path: nextPath
          };

          if (nextDepth === 1) {
            directImpactMap.set(dep.sourceId, impactItem);
          } else {
            indirectImpactMap.set(dep.sourceId, impactItem);
          }

          queue.push({
            entityId: dep.sourceId,
            depth: nextDepth,
            path: nextPath
          });
        }
      }
    }

    const directImpact = Array.from(directImpactMap.values());
    const indirectImpact = Array.from(indirectImpactMap.values());
    const allAffectedEntityIds = Array.from(visitedDepth.keys()).filter(id => id !== targetEntityId);

    // Calculate transparent CodePrism Impact Score
    const directCount = directImpact.length;
    const indirectCount = indirectImpact.length;
    const layersCount = layersCrossedSet.size;

    const directScore = directCount * 12;
    const indirectScore = indirectCount * 6;
    const layerScore = layersCount * 15;
    const depthScore = maxDepthReached * 5;

    const rawScore = directScore + indirectScore + layerScore + depthScore;
    const impactScore = Math.min(100, Math.round(rawScore));

    return {
      targetEntity,
      impactScore,
      scoreBreakdown: {
        directCount,
        indirectCount,
        layersCrossed: layersCount,
        maxDepth: maxDepthReached
      },
      directImpact,
      indirectImpact,
      allAffectedEntityIds
    };
  }

  /**
   * Identifies potentially unused/unreferenced entities while excluding entry points and configs.
   */
  static markUnusedEntities(entities: Record<string, IREntity>, relationships: IRRelationship[]) {
    const incomingDegrees = new Map<string, number>();

    Object.keys(entities).forEach(id => incomingDegrees.set(id, 0));

    relationships.forEach(rel => {
      if (rel.kind !== 'CONTAINS' && rel.sourceId !== rel.targetId) {
        const count = incomingDegrees.get(rel.targetId) || 0;
        incomingDegrees.set(rel.targetId, count + 1);
      }
    });

    Object.values(entities).forEach(entity => {
      const degree = incomingDegrees.get(entity.id) || 0;
      if (!entity.metrics) {
        entity.metrics = { loc: 0, functionCount: 0, classCount: 0, cyclomaticComplexity: 0, incomingDegree: 0, outgoingDegree: 0 };
      }
      entity.metrics.incomingDegree = degree;

      if (degree === 0 && !this.isEntryPointOrConfig(entity)) {
        entity.isUnused = true;
      } else {
        entity.isUnused = false;
      }
    });
  }

  private static isEntryPointOrConfig(entity: IREntity): boolean {
    const name = entity.name.toLowerCase();
    const relPath = (entity.relativePath || entity.filePath || '').replace(/\\/g, '/').toLowerCase();
    const baseName = relPath.split('/').pop() || name;

    // Dotfiles (like .eslintrc, .prettierrc, .gitignore, etc.)
    if (baseName.startsWith('.')) {
      return true;
    }

    // Common entry point filenames and symbol names
    const entryNames = [
      'main', 'app', 'index', 'server', 'cli', 'bootstrap', 'start', 'init', 'setup',
      'application', 'program', 'core', 'root', 'lib', 'master', 'handler'
    ];

    if (entryNames.some(e => baseName.startsWith(e) || baseName === e || name === e)) {
      return true;
    }

    // React/Vue/Angular App & Component Entry Points
    if (/^(app|index|main|server|bootstrap|root)\.[a-z0-9]+$/i.test(baseName)) {
      return true;
    }

    // Known configuration & tooling files
    const configPatterns = [
      'eslintrc', 'prettierrc', 'tsconfig', 'jsconfig', 'package.json', 'vite.config',
      'webpack.config', 'babel.config', 'rollup.config', 'next.config', 'tailwind.config',
      'jest.config', 'dockerfile', 'makefile', 'cmakelists', 'cargo.toml', 'build.gradle',
      'pom.xml', 'settings.py', 'urls.py', 'go.mod', 'composer.json'
    ];

    if (configPatterns.some(p => relPath.includes(p) || baseName.includes(p))) {
      return true;
    }

    // Config, Controller, View, or API architectural layers
    if (entity.archLayer === 'config' || entity.archLayer === 'controller' || entity.archLayer === 'api' || entity.archLayer === 'view') {
      return true;
    }

    // Non-code configuration or asset file extensions
    if (/\.(json|yaml|yml|toml|xml|env|cjs|mjs|css|scss|less|png|jpg|svg|ico|config\.[a-z]+)$/i.test(baseName) && !baseName.endsWith('.jsx') && !baseName.endsWith('.tsx')) {
      return true;
    }

    // Pages, routes, components, views, or assets directories
    if (relPath.includes('/pages/') || relPath.includes('/routes/') || relPath.includes('/app/') || relPath.includes('/views/') || relPath.includes('/components/') || relPath.includes('/assets/')) {
      return true;
    }

    return false;
  }

  private static getFileIdOfEntity(entities: Record<string, IREntity>, entityId: string): string | null {
    let curr = entities[entityId];
    while (curr) {
      if (curr.kind === 'file') return curr.id;
      if (!curr.parentId) break;
      curr = entities[curr.parentId];
    }
    return null;
  }
}
