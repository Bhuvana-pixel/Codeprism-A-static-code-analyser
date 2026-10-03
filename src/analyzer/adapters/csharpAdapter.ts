import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export class CSharpAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'csharp';
  readonly fileExtensions = ['.cs'];

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
      language: 'csharp',
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

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

      const usingMatch = trimmed.match(/^using\s+([a-zA-Z0-9_.]+);/);
      if (usingMatch) {
        fileEntity.imports.push({
          symbol: usingMatch[1].split('.').pop() || usingMatch[1],
          sourceModule: usingMatch[1],
          location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath: usingMatch[1],
          importedSymbols: [usingMatch[1]]
        });
      }

      const classMatch = trimmed.match(/(?:public|protected|private|internal|abstract|sealed|static\s+)*\s*(class|interface|struct)\s+([a-zA-Z0-9_]+)(?:\s*:\s*([a-zA-Z0-9_,\s]+))?/);
      if (classMatch) {
        const kindStr = classMatch[1];
        const className = classMatch[2];
        const bases = classMatch[3];
        const kind = kindStr === 'interface' ? 'interface' : kindStr === 'struct' ? 'struct' : 'class';

        const classId = `${fileId}:${kind}:${className}`;
        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);
        fileEntity.exports.push({ symbol: className, kind });

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind,
          language: 'csharp',
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
          imports: bases ? bases.split(',').map(b => ({ symbol: b.trim(), sourceModule: b.trim() })) : [],
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

        if (bases) {
          bases.split(',').forEach(b => {
            unresolvedCalls.push({
              sourceEntityId: classId,
              targetName: b.trim(),
              line: lineNum
            });
          });
        }
        continue;
      }

      const methodMatch = trimmed.match(/(?:public|protected|private|internal|static|async|virtual|override\s+)+[a-zA-Z0-9_<>,\[\]\s]+\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (methodMatch && currentClassEntity) {
        const methodName = methodMatch[1];
        const params = methodMatch[2];
        const csKeywords = new Set(['if', 'while', 'for', 'switch', 'catch', 'lock']);

        if (!csKeywords.has(methodName)) {
          const methodId = `${currentClassEntity.id}:method:${methodName}`;
          fileEntity.metrics.functionCount++;

          if (trimmed.startsWith('public')) {
            currentClassEntity.exports.push({ symbol: `${methodName}()`, kind: 'method' });
          }

          const methodEntity: IREntity = {
            id: methodId,
            name: methodName,
            kind: 'method',
            language: 'csharp',
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
            signature: `${methodName}(${params.slice(0, 30)})`,
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
