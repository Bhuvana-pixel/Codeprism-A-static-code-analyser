import { ArchitecturalLayer, EntityKind, SupportedLanguage } from '../analyzer/types';

export interface NodeSummary {
  name: string;
  type: EntityKind | string;
  file?: string;
  language?: SupportedLanguage | string;
  layer?: ArchitecturalLayer | string;
  moduleName?: string;
  dependencyCount: number;
  dependentCount: number;
}

export interface GitHubAnalysisInfo {
  repository?: string;
  fileLocation?: string;
  githubUrl?: string;
  createdYear?: string;
  totalCommits?: number;
  lastModifiedRelative?: string;
  coChangedFilesCount?: number;
  recentCommits?: Array<{ shortHash: string; author: string; relativeDate: string; message: string }>;
  isAvailable: boolean;
}

export interface NodeStaticAnalysis {
  imports: string[];
  importedBy: string[];
  functions: string[];
  classes: string[];
  dependencies: string[];
  dependents: string[];
  exports?: string[];
  metrics: {
    linesOfCode: number;
    dependencyCount: number;
    cyclomaticComplexity?: number;
    incomingDegree?: number;
    outgoingDegree?: number;
  };
  insights?: string[];
}

export interface NodeAnalysisContext {
  projectName: string;
  node: NodeSummary;
  staticAnalysis: NodeStaticAnalysis;
  githubAnalysis?: GitHubAnalysisInfo;
}

export interface ModuleSummary {
  name: string;
  type: 'module' | 'folder' | 'layer' | 'package' | string;
  filesCount: number;
  layer: ArchitecturalLayer | string;
}

export interface ModuleStaticAnalysis {
  files: string[];
  classes: string[];
  functions: string[];
  dependencies: string[];
  dependents: string[];
  imports: string[];
  exports: string[];
  layer: string;
  metrics: {
    linesOfCode: number;
    filesCount: number;
    classCount: number;
    functionCount: number;
    dependencyCount: number;
  };
  insights?: string[];
}

export interface ModuleAnalysisContext {
  projectName: string;
  module: ModuleSummary;
  staticAnalysis: ModuleStaticAnalysis;
  githubAnalysis?: GitHubAnalysisInfo;
}

export interface ExplanationSection {
  heading: string;
  content: string;
}

export interface CodeExplanation {
  title: string;
  summary: string;
  sections: ExplanationSection[];
  limitations: string[];
}

export type NodeExplanation = CodeExplanation;
export type ModuleExplanation = CodeExplanation;

export interface ExplanationService {
  explainNode(context: NodeAnalysisContext): Promise<NodeExplanation>;
  explainModule(context: ModuleAnalysisContext): Promise<ModuleExplanation>;
}

export const EXPLANATION_SYSTEM_PROMPT = `You are the CodePrism AI Explanation Assistant.

CodePrism performs static analysis of software repositories.

The static analysis engine is the ONLY source of truth.

Your job is ONLY to explain the analysis results that CodePrism provides.

You must NOT perform repository analysis yourself.

You must NOT invent:
- dependencies
- relationships
- functions
- classes
- modules
- architectural layers
- metrics
- GitHub information
- code behavior
- design patterns

You must not override the static-analysis results.

You must not calculate architecture metrics.

You must not claim that a component performs a specific behavior unless that behavior is supported by the supplied context.

Explain the supplied information clearly and concisely for a developer.

If information is missing, explicitly say that the information is not available in the provided static-analysis context.

Always distinguish between:
1. Detected facts
2. Reasonable structural interpretation

Use phrases such as:
"Static analysis detected..."
"CodePrism identifies..."
"Based on the detected structure..."
"This component appears to..."

Never present unsupported assumptions as facts.

Your output should help a developer understand the selected node/module.`;
