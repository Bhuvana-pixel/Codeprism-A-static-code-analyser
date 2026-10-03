import { GraphData, IREntity, IRRelationship } from '../analyzer/types';
import { GitCommitItem } from '../analyzer/gitEngine';

export interface ArchitectureMetricsSnapshot {
  totalFiles: number;
  totalNodes: number;
  totalEdges: number;
  circularDependenciesCount: number;
  deadCodeCount: number;
  averageComplexity: number;
  hotspotsCount: number;
}

export interface ArchitectureSnapshot {
  repositoryId: string;
  commitHash: string;
  shortHash: string;
  commitMessage: string;
  author: string;
  timestamp: string;
  relativeDate: string;
  analyzerVersion: string;
  graphData: GraphData;
  metrics: ArchitectureMetricsSnapshot;
  insights: string[];
}

export interface MetricChange {
  metricName: string;
  before: number;
  after: number;
  diff: number;
  status: 'improved' | 'regressed' | 'unchanged';
  unit?: string;
}

export interface ArchitectureEvent {
  type: 'module_added' | 'module_removed' | 'refactoring' | 'dependency_added' | 'dependency_removed' | 'circular_introduced' | 'circular_resolved';
  title: string;
  description: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
}

export interface ModifiedNodeDetail {
  entity: IREntity;
  beforeEntity?: IREntity;
  changes: string[];
}

export interface ArchitectureComparison {
  fromCommit: string;
  fromShortHash: string;
  toCommit: string;
  toShortHash: string;
  fromSnapshot: ArchitectureSnapshot;
  toSnapshot: ArchitectureSnapshot;

  addedNodes: IREntity[];
  removedNodes: IREntity[];
  modifiedNodes: ModifiedNodeDetail[];
  unchangedNodes: IREntity[];

  addedEdges: IRRelationship[];
  removedEdges: IRRelationship[];
  unchangedEdges: IRRelationship[];

  metricChanges: MetricChange[];
  architectureEvents: ArchitectureEvent[];

  regressions: string[];
  improvements: string[];
}

export interface ComparisonContextForLlm {
  fromCommit: string;
  toCommit: string;
  metricsSummary: MetricChange[];
  addedNodesCount: number;
  removedNodesCount: number;
  modifiedNodesCount: number;
  addedNodeNames: string[];
  removedNodeNames: string[];
  modifiedNodeNames: string[];
  architectureEvents: string[];
  regressions: string[];
  improvements: string[];
}
