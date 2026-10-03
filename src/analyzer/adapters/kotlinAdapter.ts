import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export class KotlinAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'kotlin';
  readonly fileExtensions = ['.kt', '.kts'];

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
      language: 'kotlin',
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

      const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_.]+)/);
      if (importMatch) {
        const importPath = importMatch[1];
        fileEntity.imports.push({
          symbol: importPath.split('.').pop() || importPath,
          sourceModule: importPath,
          location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath,
          importedSymbols: [importPath.split('.').pop() || importPath]
        });
      }

      const classMatch = trimmed.match(/(?:open|abstract|data|sealed|inner|private|public|protected\s+)*\s*(class|interface|object)\s+([a-zA-Z0-9_]+)(?:\s*:\s*([a-zA-Z0-9_,\s()]+))?/);
      if (classMatch) {
        const kindStr = classMatch[1];
        const className = classMatch[2];
        const bases = classMatch[3];
        const kind = kindStr === 'interface' ? 'interface' : 'class';

        const classId = `${fileId}:${kind}:${className}`;
        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);
        fileEntity.exports.push({ symbol: className, kind });

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind,
          language: 'kotlin',
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
          imports: bases ? bases.split(',').map(b => ({ symbol: b.replace(/\(.*\)/, '').trim(), sourceModule: b.trim() })) : [],
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
              targetName: b.replace(/\(.*\)/, '').trim(),
              line: lineNum
            });
          });
        }
        continue;
      }

      const funMatch = trimmed.match(/(?:override|open|abstract|suspend|private|public|protected|inline\s+)*fun\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (funMatch) {
        const fnName = funMatch[1];
        const params = funMatch[2];
        const parentId = currentClassEntity ? currentClassEntity.id : fileId;
        const kind = currentClassEntity ? 'method' : 'function';
        const fnId = `${parentId}:${kind}:${fnName}`;

        fileEntity.metrics.functionCount++;
        if (!currentClassEntity) {
          fileEntity.childrenIds.push(fnId);
          fileEntity.exports.push({ symbol: fnName, kind: 'function' });
        } else {
          currentClassEntity.exports.push({ symbol: `${fnName}()`, kind: 'method' });
        }

        const fnEntity: IREntity = {
          id: fnId,
          name: fnName,
          kind,
          language: 'kotlin',
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
          signature: `${fnName}(${params.slice(0, 30)})`,
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
