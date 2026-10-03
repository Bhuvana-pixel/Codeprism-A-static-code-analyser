import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRImport, IRExport, IRRelationship, SupportedLanguage } from '../types';

export class JavaAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'java';
  readonly fileExtensions = ['.java'];

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
      language: 'java',
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
    let packageName = '';

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      // package com.example.service;
      const pkgMatch = trimmed.match(/^package\s+([a-zA-Z0-9_.]+);/);
      if (pkgMatch) {
        packageName = pkgMatch[1];
      }

      // import com.example.model.User;
      const importMatch = trimmed.match(/^import\s+(?:static\s+)?([a-zA-Z0-9_.]+);/);
      if (importMatch) {
        const importPath = importMatch[1];
        const lastPart = importPath.split('.').pop() || importPath;
        fileEntity.imports.push({
          symbol: lastPart,
          sourceModule: importPath,
          location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath,
          importedSymbols: [lastPart]
        });
      }

      // class or interface declaration
      const classMatch = trimmed.match(/(?:public|protected|private|abstract|final|static)*\s*(class|interface)\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_]+))?(?:\s+implements\s+([a-zA-Z0-9_,\s]+))?/);
      if (classMatch) {
        const isInterface = classMatch[1] === 'interface';
        const className = classMatch[2];
        const extendsClass = classMatch[3];
        const implementsInterfaces = classMatch[4];

        const kind = isInterface ? 'interface' : 'class';
        const classId = `${fileId}:${kind}:${className}`;

        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);

        fileEntity.exports.push({
          symbol: className,
          kind,
          location: { startLine: lineNum, startColumn: line.indexOf(className) + 1, endLine: lineNum, endColumn: line.length }
        });

        const classImports: IRImport[] = [];

        if (extendsClass) {
          classImports.push({ symbol: extendsClass, sourceModule: extendsClass });
          unresolvedCalls.push({
            sourceEntityId: classId,
            targetName: extendsClass,
            line: lineNum
          });
        }

        if (implementsInterfaces) {
          implementsInterfaces.split(',').forEach(iface => {
            const trimmedIface = iface.trim();
            classImports.push({ symbol: trimmedIface, sourceModule: trimmedIface });
            unresolvedCalls.push({
              sourceEntityId: classId,
              targetName: trimmedIface,
              line: lineNum
            });
          });
        }

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind,
          language: 'java',
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
          docstring: packageName ? `package ${packageName}` : undefined,
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

      // Method declaration in Java
      const methodMatch = trimmed.match(/(?:public|protected|private|static|final|synchronized|abstract|\s)+[a-zA-Z0-9_<>,\[\]\s]+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:throws\s+[a-zA-Z0-9_,\s]+)?\s*[\{;]/);
      if (methodMatch && currentClassEntity) {
        const methodName = methodMatch[1];
        const params = methodMatch[2];
        const javaKeywords = new Set(['if', 'while', 'for', 'switch', 'catch', 'synchronized', 'return']);

        if (!javaKeywords.has(methodName)) {
          const methodId = `${currentClassEntity.id}:method:${methodName}`;
          fileEntity.metrics.functionCount++;

          if (trimmed.startsWith('public')) {
            currentClassEntity.exports.push({
              symbol: `${methodName}()`,
              kind: 'method',
              location: { startLine: lineNum, startColumn: line.indexOf(methodName) + 1, endLine: lineNum, endColumn: line.length }
            });
          }

          const methodEntity: IREntity = {
            id: methodId,
            name: methodName,
            kind: 'method',
            language: 'java',
            filePath,
            relativePath,
            location: { startLine: lineNum, startColumn: line.indexOf(methodName) + 1, endLine: lineNum, endColumn: line.length },
            parentId: currentClassEntity.id,
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
            signature: `${methodName}(${params.slice(0, 30)}${params.length > 30 ? '...' : ''})`,
            imports: [],
            exports: [{ symbol: methodName, kind: 'method' }]
          };
          entities.push(methodEntity);
          relationships.push({
            id: `rel:${currentClassEntity.id}->${methodId}`,
            sourceId: currentClassEntity.id,
            targetId: methodId,
            kind: 'CONTAINS',
            certainty: 'certain'
          });
        }
      }
    }

    return { entities, relationships, unresolvedCalls, unresolvedImports };
  }
}
