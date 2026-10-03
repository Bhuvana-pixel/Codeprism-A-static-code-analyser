export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'java'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'go'
  | 'kotlin'
  | 'rust'
  | 'php'
  | 'unknown';

export type EntityKind =
  | 'project'
  | 'folder'
  | 'file'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'variable'
  | 'struct'
  | 'trait'
  | 'namespace'
  | 'module';

export type RelationshipKind =
  | 'CONTAINS'
  | 'IMPORTS'
  | 'EXPORTS'
  | 'CALLS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'REFERENCES'
  | 'DEPENDS_ON';

export type ArchitecturalLayer =
  | 'controller'
  | 'service'
  | 'repository'
  | 'model'
  | 'utility'
  | 'config'
  | 'api'
  | 'db'
  | 'view'
  | 'unknown';

export interface LocationRange {
  startLine: number; // 1-indexed
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface ComplexityMetrics {
  loc: number;
  functionCount: number;
  classCount: number;
  cyclomaticComplexity: number;
  incomingDegree: number;
  outgoingDegree: number;
}

export interface IRImport {
  symbol: string;
  sourceModule: string;
  targetEntityId?: string;
  location?: LocationRange;
}

export interface IRExport {
  symbol: string;
  kind: string;
  isDefault?: boolean;
  location?: LocationRange;
}

export interface IREntity {
  id: string;
  name: string;
  kind: EntityKind;
  language: SupportedLanguage;
  filePath: string;
  relativePath: string;
  location: LocationRange;
  parentId?: string;
  childrenIds: string[];
  metrics: ComplexityMetrics;
  archLayer: ArchitecturalLayer;
  archConfidence?: number; // 0-100% confidence
  archRoleOverride?: ArchitecturalLayer; // User manual role override
  healthStatus?: 'healthy' | 'warning' | 'violation';
  statusReason?: string;
  isUnused?: boolean;
  signature?: string;
  docstring?: string;
  imports: IRImport[];
  exports: IRExport[];
}

export interface IRRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationshipKind;
  certainty: 'certain' | 'inferred';
  description?: string;
  trafficStatus?: 'healthy' | 'warning' | 'violation';
}

export interface CircularDependencyCycle {
  id: string;
  cycleNodes: string[]; // Node IDs
  cycleNames: string[]; // Human readable names
  cycleFiles: string[];
}

export interface ArchitectureViolation {
  id: string;
  sourceEntityId: string;
  sourceName: string;
  sourceLayer: ArchitecturalLayer;
  targetEntityId: string;
  targetName: string;
  targetLayer: ArchitecturalLayer;
  violationType: 'bypassed_service' | 'reverse_layer_call' | 'suspicious_dependency';
  description: string;
  expectedDirection: string;
}

export interface ArchitectureSummary {
  likelyPattern: string;
  patternConfidence: number;
  evidence: string;
  totalLayers: number;
  violations: ArchitectureViolation[];
}

export interface WorkspaceStats {
  totalFiles: number;
  totalEntities: number;
  totalLines: number;
  languages: Record<string, number>;
  layerCounts: Record<ArchitecturalLayer, number>;
  circularDependencies: CircularDependencyCycle[];
  unusedEntitiesCount: number;
  architectureSummary?: ArchitectureSummary;
}

export interface GraphData {
  entities: Record<string, IREntity>;
  relationships: IRRelationship[];
  stats: WorkspaceStats;
}

export interface AnalysisOptions {
  workspacePath: string;
  maxFiles?: number;
  excludePatterns?: string[];
}
