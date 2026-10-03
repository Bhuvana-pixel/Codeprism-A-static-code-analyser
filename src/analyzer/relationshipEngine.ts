import * as fs from 'fs';
import * as path from 'path';
import { AnalysisOptions, ArchitecturalLayer, GraphData, IREntity, IRRelationship, WorkspaceStats } from './types';
import { LanguageAdapter } from './adapters/baseAdapter';
import { TSJSAdapter } from './adapters/tsJsAdapter';
import { PythonAdapter } from './adapters/pythonAdapter';
import { JavaAdapter } from './adapters/javaAdapter';
import { CCppAdapter } from './adapters/cCppAdapter';
import { CSharpAdapter } from './adapters/csharpAdapter';
import { GoAdapter } from './adapters/goAdapter';
import { KotlinAdapter } from './adapters/kotlinAdapter';
import { RustAdapter } from './adapters/rustAdapter';
import { PHPAdapter } from './adapters/phpAdapter';
import { ArchitectureDetector } from './architectureDetector';
import { IntelligenceEngine } from './intelligenceEngine';

export class RelationshipEngine {
  private adapters: LanguageAdapter[];

  constructor() {
    this.adapters = [
      new TSJSAdapter(),
      new PythonAdapter(),
      new JavaAdapter(),
      new CCppAdapter(),
      new CSharpAdapter(),
      new GoAdapter(),
      new KotlinAdapter(),
      new RustAdapter(),
      new PHPAdapter()
    ];
  }

  async analyzeWorkspace(options: AnalysisOptions): Promise<GraphData> {
    const { workspacePath, maxFiles = 2000, excludePatterns = ['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '__pycache__', 'target', '.vs', '.vscode'] } = options;

    const filePaths = this.collectFiles(workspacePath, excludePatterns).slice(0, maxFiles);

    const entities: Record<string, IREntity> = {};
    const relationships: IRRelationship[] = [];
    const unresolvedCalls: Array<{ sourceEntityId: string; targetName: string; line: number }> = [];
    const unresolvedImports: Array<{ sourceEntityId: string; importPath: string; importedSymbols: string[] }> = [];

    const langCounts: Record<string, number> = {};
    let totalLines = 0;

    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const adapter = this.adapters.find(a => a.fileExtensions.includes(ext));
      if (!adapter) continue;

      const relativePath = path.relative(workspacePath, filePath);
      let content = '';
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        continue;
      }

      totalLines += content.split(/\r?\n/).length;
      langCounts[adapter.language] = (langCounts[adapter.language] || 0) + 1;

      const parseResult = adapter.parseFile(filePath, relativePath, content);

      parseResult.entities.forEach(entity => {
        entities[entity.id] = entity;
      });

      parseResult.relationships.forEach(rel => relationships.push(rel));

      unresolvedCalls.push(...parseResult.unresolvedCalls);
      unresolvedImports.push(...parseResult.unresolvedImports);
    }

    // Resolve cross-file imports & dependencies
    this.resolveImports(entities, relationships, unresolvedImports);

    // Resolve cross-file symbol calls
    this.resolveCalls(entities, relationships, unresolvedCalls);

    // Run Architecture Detector FIRST (Pattern detection, layer classification, violations)
    const archSummary = ArchitectureDetector.analyzeWorkspaceArchitecture(entities, relationships);

    // Run Intelligence Engine algorithms AFTER architectural layers are classified
    IntelligenceEngine.markUnusedEntities(entities, relationships);
    const circularDependencies = IntelligenceEngine.findCircularDependencies(entities, relationships);

    // Compute layer counts
    const layerCounts: Record<ArchitecturalLayer, number> = {
      controller: 0, service: 0, repository: 0, model: 0,
      utility: 0, config: 0, api: 0, db: 0, view: 0, unknown: 0
    };

    let unusedCount = 0;
    Object.values(entities).forEach(e => {
      layerCounts[e.archLayer] = (layerCounts[e.archLayer] || 0) + 1;
      if (e.isUnused) unusedCount++;
    });

    const stats: WorkspaceStats = {
      totalFiles: filePaths.length,
      totalEntities: Object.keys(entities).length,
      totalLines,
      languages: langCounts,
      layerCounts,
      circularDependencies,
      unusedEntitiesCount: unusedCount,
      architectureSummary: archSummary
    };

    return { entities, relationships, stats };
  }

  private collectFiles(dir: string, exclude: string[]): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const list = fs.readdirSync(dir);
    list.forEach(file => {
      if (exclude.includes(file)) return;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(this.collectFiles(fullPath, exclude));
      } else {
        const ext = path.extname(file).toLowerCase();
        if (this.adapters.some(a => a.fileExtensions.includes(ext))) {
          results.push(fullPath);
        }
      }
    });
    return results;
  }

  private resolveImports(
    entities: Record<string, IREntity>,
    relationships: IRRelationship[],
    unresolvedImports: Array<{ sourceEntityId: string; importPath: string; importedSymbols: string[] }>
  ) {
    const fileEntities = Object.values(entities).filter(e => e.kind === 'file');

    const cleanPath = (p: string) => {
      let norm = p.replace(/\\/g, '/').toLowerCase();
      norm = norm.split('?')[0].split('#')[0];
      norm = norm.replace(/^(\.\/|\.\.\/|@\/|~\/)+/, '');
      norm = norm.replace(/\.(js|jsx|ts|tsx|mjs|cjs|vue|json|css|scss|less|py|java|cs|go|rs|php|cpp|c|h|hpp|kt)$/, '');
      return norm;
    };

    unresolvedImports.forEach(imp => {
      const sourceEntity = entities[imp.sourceEntityId];
      if (!sourceEntity) return;

      const normImport = cleanPath(imp.importPath);
      if (!normImport) return;

      const importBase = normImport.split('/').pop();

      const matchedFile = fileEntities.find(f => {
        if (f.id === sourceEntity.id) return false;

        const normRel = cleanPath(f.relativePath);
        const fileBase = normRel.split('/').pop();

        if (normRel === normImport || normRel.endsWith('/' + normImport)) {
          return true;
        }

        if (normRel.endsWith('/' + normImport + '/index') || (importBase && normRel.endsWith('/' + normImport + '/' + importBase))) {
          return true;
        }

        if (fileBase && importBase && fileBase === importBase && (normRel.includes(normImport) || normImport.includes(fileBase))) {
          return true;
        }

        return false;
      });

      if (matchedFile && matchedFile.id !== sourceEntity.id) {
        relationships.push({
          id: `rel:${sourceEntity.id}->${matchedFile.id}`,
          sourceId: sourceEntity.id,
          targetId: matchedFile.id,
          kind: 'IMPORTS',
          certainty: 'certain',
          description: `Imports ${imp.importedSymbols.join(', ') || 'module'}`
        });

        if (sourceEntity.metrics) sourceEntity.metrics.outgoingDegree = (sourceEntity.metrics.outgoingDegree || 0) + 1;
        if (matchedFile.metrics) matchedFile.metrics.incomingDegree = (matchedFile.metrics.incomingDegree || 0) + 1;
      }
    });
  }

  private resolveCalls(
    entities: Record<string, IREntity>,
    relationships: IRRelationship[],
    unresolvedCalls: Array<{ sourceEntityId: string; targetName: string; line: number }>
  ) {
    const allEntities = Object.values(entities);

    unresolvedCalls.forEach(call => {
      const source = entities[call.sourceEntityId];
      if (!source) return;

      const targets = allEntities.filter(e => e.id !== source.id && e.name === call.targetName);

      targets.forEach(target => {
        const isInheritance = call.targetName === target.name && (target.kind === 'class' || target.kind === 'interface');
        const kind = isInheritance ? (target.kind === 'interface' ? 'IMPLEMENTS' : 'EXTENDS') : 'CALLS';

        relationships.push({
          id: `rel:${source.id}->${target.id}`,
          sourceId: source.id,
          targetId: target.id,
          kind,
          certainty: 'inferred'
        });
      });
    });
  }
}
