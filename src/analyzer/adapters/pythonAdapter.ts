import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRImport, IRExport, IRRelationship, SupportedLanguage } from '../types';

export class PythonAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'python';
  readonly fileExtensions = ['.py'];

  parseFile(filePath: string, relativePath: string, content: string): ParseResult {
    const entities: IREntity[] = [];
    const relationships: IRRelationship[] = [];
    const unresolvedCalls: ParseResult['unresolvedCalls'] = [];
    const unresolvedImports: ParseResult['unresolvedImports'] = [];

    const lines = content.split(/\r?\n/);
    const fileLoc = this.calculateLOC(content);
    const fileId = `file:${filePath}`;

    const fileEntity: IREntity = {
      id: fileId,
      name: relativePath.split(/[/\\]/).pop() || relativePath,
      kind: 'file',
      language: 'python',
      filePath,
      relativePath,
      location: { startLine: 1, startColumn: 1, endLine: lines.length || 1, endColumn: 1 },
      childrenIds: [],
      metrics: {
        loc: fileLoc,
        functionCount: 0,
        classCount: 0,
        cyclomaticComplexity: this.estimateComplexity(content),
        incomingDegree: 0,
        outgoingDegree: 0
      },
      archLayer: 'unknown',
      imports: [],
      exports: []
    };
    entities.push(fileEntity);

    let currentClassEntity: IREntity | null = null;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) continue;

      // import math, os
      const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_.,\s]+)/);
      if (importMatch) {
        const modules = importMatch[1].split(',').map(m => m.trim());
        modules.forEach(m => {
          fileEntity.imports.push({
            symbol: m,
            sourceModule: m,
            location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
          });
          unresolvedImports.push({
            sourceEntityId: fileId,
            importPath: m,
            importedSymbols: [m]
          });
        });
      }

      // from pkg.mod import Foo, Bar
      const fromImportMatch = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+([a-zA-Z0-9_.,\s*()]+)/);
      if (fromImportMatch) {
        const pkg = fromImportMatch[1];
        const symbols = fromImportMatch[2].replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean);
        symbols.forEach(sym => {
          fileEntity.imports.push({
            symbol: sym,
            sourceModule: pkg,
            location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
          });
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath: pkg,
          importedSymbols: symbols
        });
      }

      // Class declaration: class Foo(Bar, Baz):
      const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\(([^)]+)\))?:/);
      if (classMatch) {
        const className = classMatch[1];
        const baseClassesStr = classMatch[2];
        const classId = `${fileId}:class:${className}`;

        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);

        fileEntity.exports.push({
          symbol: className,
          kind: 'class',
          location: { startLine: lineNum, startColumn: line.indexOf(className) + 1, endLine: lineNum, endColumn: line.length }
        });

        const classImports: IRImport[] = [];

        if (baseClassesStr) {
          const baseClasses = baseClassesStr.split(',').map(b => b.trim()).filter(Boolean);
          baseClasses.forEach(base => {
            classImports.push({
              symbol: base,
              sourceModule: base
            });
            unresolvedCalls.push({
              sourceEntityId: classId,
              targetName: base,
              line: lineNum
            });
          });
        }

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind: 'class',
          language: 'python',
          filePath,
          relativePath,
          location: { startLine: lineNum, startColumn: line.indexOf(className) + 1, endLine: lineNum, endColumn: line.length },
          parentId: fileId,
          childrenIds: [],
          metrics: {
            loc: 1,
            functionCount: 0,
            classCount: 0,
            cyclomaticComplexity: 1,
            incomingDegree: 0,
            outgoingDegree: 0
          },
          archLayer: 'unknown',
          imports: classImports,
          exports: []
        };
        currentClassEntity = classEntity;
        entities.push(classEntity);
        relationships.push({
          id: `rel:${fileId}->${classId}`,
          sourceId: fileId,
          targetId: classId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });

        continue;
      }

      // Reset class context if indentation goes back to top-level
      if (!line.startsWith(' ') && !line.startsWith('\t') && !trimmed.startsWith('@')) {
        currentClassEntity = null;
      }

      // Function or method: def foo(bar):
      const defMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (defMatch) {
        const fnName = defMatch[1];
        const params = defMatch[2];
        const isMethod = Boolean(currentClassEntity);
        const kind = isMethod ? 'method' : 'function';
        const parentId = currentClassEntity ? currentClassEntity.id : fileId;
        const fnId = `${parentId}:${kind}:${fnName}`;

        fileEntity.metrics.functionCount++;
        if (!isMethod) {
          fileEntity.childrenIds.push(fnId);
          if (!fnName.startsWith('_')) {
            fileEntity.exports.push({
              symbol: fnName,
              kind: 'function',
              location: { startLine: lineNum, startColumn: line.indexOf(fnName) + 1, endLine: lineNum, endColumn: line.length }
            });
          }
        } else if (currentClassEntity) {
          currentClassEntity.exports.push({
            symbol: `${fnName}()`,
            kind: 'method',
            location: { startLine: lineNum, startColumn: line.indexOf(fnName) + 1, endLine: lineNum, endColumn: line.length }
          });
        }

        const fnEntity: IREntity = {
          id: fnId,
          name: fnName,
          kind,
          language: 'python',
          filePath,
          relativePath,
          location: { startLine: lineNum, startColumn: line.indexOf(fnName) + 1, endLine: lineNum, endColumn: line.length },
          parentId,
          childrenIds: [],
          metrics: {
            loc: 1,
            functionCount: 0,
            classCount: 0,
            cyclomaticComplexity: 1,
            incomingDegree: 0,
            outgoingDegree: 0
          },
          archLayer: 'unknown',
          signature: `${fnName}(${params.slice(0, 30)}${params.length > 30 ? '...' : ''})`,
          imports: [],
          exports: [{ symbol: fnName, kind }]
        };
        entities.push(fnEntity);
        relationships.push({
          id: `rel:${parentId}->${fnId}`,
          sourceId: parentId,
          targetId: fnId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });
      }
    }

    return { entities, relationships, unresolvedCalls, unresolvedImports };
  }
}
