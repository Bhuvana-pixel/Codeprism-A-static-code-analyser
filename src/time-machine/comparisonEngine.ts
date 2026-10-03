import { GraphData, IREntity, IRRelationship } from '../analyzer/types';
import {
  ArchitectureComparison,
  ArchitectureEvent,
  ArchitectureSnapshot,
  MetricChange,
  ModifiedNodeDetail
} from './types';

export class ArchitectureComparer {
  /**
   * Compare two Architecture Snapshots (From -> To) and generate a detailed structural diff
   */
  static compare(fromSnapshot: ArchitectureSnapshot, toSnapshot: ArchitectureSnapshot): ArchitectureComparison {
    const fromGraph = fromSnapshot.graphData;
    const toGraph = toSnapshot.graphData;

    const fromEntitiesMap = fromGraph.entities;
    const toEntitiesMap = toGraph.entities;

    const fromEntitiesList = Object.values(fromEntitiesMap);
    const toEntitiesList = Object.values(toEntitiesMap);

    // Build unique keys based on relativePath + entity name + kind
    const getEntityKey = (e: IREntity) => `${e.relativePath || e.name}:${e.name}:${e.kind}`;

    const fromKeyMap = new Map<string, IREntity>();
    fromEntitiesList.forEach(e => fromKeyMap.set(getEntityKey(e), e));

    const toKeyMap = new Map<string, IREntity>();
    toEntitiesList.forEach(e => toKeyMap.set(getEntityKey(e), e));

    const addedNodes: IREntity[] = [];
    const removedNodes: IREntity[] = [];
    const modifiedNodes: ModifiedNodeDetail[] = [];
    const unchangedNodes: IREntity[] = [];

    // Find added & modified
    toEntitiesList.forEach(toEnt => {
      const key = getEntityKey(toEnt);
      const fromEnt = fromKeyMap.get(key);

      if (!fromEnt) {
        addedNodes.push(toEnt);
      } else {
        const changes: string[] = [];
        if (fromEnt.archLayer !== toEnt.archLayer) {
          changes.push(`Layer changed: '${fromEnt.archLayer}' ➔ '${toEnt.archLayer}'`);
        }
        if ((fromEnt.metrics?.loc || 0) !== (toEnt.metrics?.loc || 0)) {
          changes.push(`LOC changed: ${fromEnt.metrics?.loc || 0} ➔ ${toEnt.metrics?.loc || 0}`);
        }
        if ((fromEnt.metrics?.cyclomaticComplexity || 0) !== (toEnt.metrics?.cyclomaticComplexity || 0)) {
          changes.push(`Complexity changed: ${fromEnt.metrics?.cyclomaticComplexity || 0} ➔ ${toEnt.metrics?.cyclomaticComplexity || 0}`);
        }
        if ((fromEnt.metrics?.incomingDegree || 0) !== (toEnt.metrics?.incomingDegree || 0)) {
          changes.push(`Dependents count: ${fromEnt.metrics?.incomingDegree || 0} ➔ ${toEnt.metrics?.incomingDegree || 0}`);
        }

        if (changes.length > 0) {
          modifiedNodes.push({
            entity: toEnt,
            beforeEntity: fromEnt,
            changes
          });
        } else {
          unchangedNodes.push(toEnt);
        }
      }
    });

    // Find removed
    fromEntitiesList.forEach(fromEnt => {
      const key = getEntityKey(fromEnt);
      if (!toKeyMap.has(key)) {
        removedNodes.push(fromEnt);
      }
    });

    // Compare Edges (Relationships)
    const getEdgeKey = (r: IRRelationship, entities: Record<string, IREntity>) => {
      const sName = entities[r.sourceId]?.name || r.sourceId;
      const tName = entities[r.targetId]?.name || r.targetId;
      return `${sName}->${r.kind}->${tName}`;
    };

    const fromEdgeMap = new Map<string, IRRelationship>();
    fromGraph.relationships.forEach(r => fromEdgeMap.set(getEdgeKey(r, fromEntitiesMap), r));

    const toEdgeMap = new Map<string, IRRelationship>();
    toGraph.relationships.forEach(r => toEdgeMap.set(getEdgeKey(r, toEntitiesMap), r));

    const addedEdges: IRRelationship[] = [];
    const removedEdges: IRRelationship[] = [];
    const unchangedEdges: IRRelationship[] = [];

    toGraph.relationships.forEach(toRel => {
      const key = getEdgeKey(toRel, toEntitiesMap);
      if (fromEdgeMap.has(key)) {
        unchangedEdges.push(toRel);
      } else {
        addedEdges.push(toRel);
      }
    });

    fromGraph.relationships.forEach(fromRel => {
      const key = getEdgeKey(fromRel, fromEntitiesMap);
      if (!toEdgeMap.has(key)) {
        removedEdges.push(fromRel);
      }
    });

    // Compare Metrics
    const fm = fromSnapshot.metrics;
    const tm = toSnapshot.metrics;

    const metricChanges: MetricChange[] = [
      {
        metricName: 'Total Files',
        before: fm.totalFiles,
        after: tm.totalFiles,
        diff: tm.totalFiles - fm.totalFiles,
        status: tm.totalFiles >= fm.totalFiles ? 'improved' : 'regressed'
      },
      {
        metricName: 'Total Entities',
        before: fm.totalNodes,
        after: tm.totalNodes,
        diff: tm.totalNodes - fm.totalNodes,
        status: 'improved'
      },
      {
        metricName: 'Total Dependencies',
        before: fm.totalEdges,
        after: tm.totalEdges,
        diff: tm.totalEdges - fm.totalEdges,
        status: tm.totalEdges > fm.totalEdges ? 'regressed' : 'improved'
      },
      {
        metricName: 'Circular Dependencies',
        before: fm.circularDependenciesCount,
        after: tm.circularDependenciesCount,
        diff: tm.circularDependenciesCount - fm.circularDependenciesCount,
        status: tm.circularDependenciesCount > fm.circularDependenciesCount ? 'regressed' : (tm.circularDependenciesCount < fm.circularDependenciesCount ? 'improved' : 'unchanged')
      },
      {
        metricName: 'Unreferenced Dead Code',
        before: fm.deadCodeCount,
        after: tm.deadCodeCount,
        diff: tm.deadCodeCount - fm.deadCodeCount,
        status: tm.deadCodeCount < fm.deadCodeCount ? 'improved' : (tm.deadCodeCount > fm.deadCodeCount ? 'regressed' : 'unchanged')
      },
      {
        metricName: 'Average Complexity',
        before: fm.averageComplexity,
        after: tm.averageComplexity,
        diff: Math.round((tm.averageComplexity - fm.averageComplexity) * 10) / 10,
        status: tm.averageComplexity > fm.averageComplexity ? 'regressed' : 'improved',
        unit: 'pts'
      },
      {
        metricName: 'Dependency Hotspots',
        before: fm.hotspotsCount,
        after: tm.hotspotsCount,
        diff: tm.hotspotsCount - fm.hotspotsCount,
        status: tm.hotspotsCount > fm.hotspotsCount ? 'regressed' : 'improved'
      }
    ];

    // Detect Architecture Events, Regressions, and Improvements
    const architectureEvents: ArchitectureEvent[] = [];
    const regressions: string[] = [];
    const improvements: string[] = [];

    // Module / Layer added or removed
    const fromLayers = new Set(fromEntitiesList.map(e => e.archLayer).filter(Boolean));
    const toLayers = new Set(toEntitiesList.map(e => e.archLayer).filter(Boolean));

    toLayers.forEach(l => {
      if (!fromLayers.has(l)) {
        architectureEvents.push({
          type: 'module_added',
          title: `New Layer Introduced: '${l.toUpperCase()}'`,
          description: `Static analysis detected introduction of the '${l}' architectural layer.`,
          severity: 'info'
        });
      }
    });

    fromLayers.forEach(l => {
      if (!toLayers.has(l)) {
        architectureEvents.push({
          type: 'module_removed',
          title: `Layer Removed: '${l.toUpperCase()}'`,
          description: `Layer '${l}' is no longer present in the target snapshot.`,
          severity: 'warning'
        });
      }
    });

    // Circular dependency events
    if (tm.circularDependenciesCount > fm.circularDependenciesCount) {
      const diffCount = tm.circularDependenciesCount - fm.circularDependenciesCount;
      architectureEvents.push({
        type: 'circular_introduced',
        title: `Circular Dependency Loop Introduced (+${diffCount})`,
        description: `${diffCount} new circular dependency loop(s) detected in the target snapshot.`,
        severity: 'critical'
      });
      regressions.push(`Circular dependency count increased from ${fm.circularDependenciesCount} to ${tm.circularDependenciesCount}`);
    } else if (tm.circularDependenciesCount < fm.circularDependenciesCount) {
      const diffCount = fm.circularDependenciesCount - tm.circularDependenciesCount;
      architectureEvents.push({
        type: 'circular_resolved',
        title: `Circular Dependency Loop Resolved (-${diffCount})`,
        description: `Successfully resolved ${diffCount} circular dependency loop(s).`,
        severity: 'positive'
      });
      improvements.push(`Circular dependency count reduced from ${fm.circularDependenciesCount} to ${tm.circularDependenciesCount}`);
    }

    // Dead code improvements / regressions
    if (tm.deadCodeCount < fm.deadCodeCount) {
      improvements.push(`Dead-code components reduced from ${fm.deadCodeCount} to ${tm.deadCodeCount}`);
    } else if (tm.deadCodeCount > fm.deadCodeCount) {
      regressions.push(`Dead-code components increased from ${fm.deadCodeCount} to ${tm.deadCodeCount}`);
    }

    // Total dependency growth
    if (tm.totalEdges > fm.totalEdges + 10) {
      architectureEvents.push({
        type: 'refactoring',
        title: `Significant Coupling Expansion (+${tm.totalEdges - fm.totalEdges} Edges)`,
        description: `Total relationship edges increased significantly from ${fm.totalEdges} to ${tm.totalEdges}.`,
        severity: 'warning'
      });
      regressions.push(`Total dependency relationships expanded from ${fm.totalEdges} to ${tm.totalEdges}`);
    }

    if (addedNodes.length > 0) {
      architectureEvents.push({
        type: 'module_added',
        title: `${addedNodes.length} New Component(s) Added`,
        description: `New files/classes introduced: ${addedNodes.slice(0, 3).map(n => n.name).join(', ')}${addedNodes.length > 3 ? '...' : ''}`,
        severity: 'positive'
      });
    }

    return {
      fromCommit: fromSnapshot.commitHash,
      fromShortHash: fromSnapshot.shortHash,
      toCommit: toSnapshot.commitHash,
      toShortHash: toSnapshot.shortHash,
      fromSnapshot,
      toSnapshot,
      addedNodes,
      removedNodes,
      modifiedNodes,
      unchangedNodes,
      addedEdges,
      removedEdges,
      unchangedEdges,
      metricChanges,
      architectureEvents,
      regressions,
      improvements
    };
  }
}
