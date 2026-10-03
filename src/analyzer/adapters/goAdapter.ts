import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export class GoAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'go';
  readonly fileExtensions = ['.go'];

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
      language: 'go',
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

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//')) continue;

      const importMatch = trimmed.match(/^import\s+(?:\(\s*)?["']([^"']+)["']/);
      if (importMatch) {
        const pkg = importMatch[1];
        fileEntity.imports.push({
          symbol: pkg.split('/').pop() || pkg,
          sourceModule: pkg,
          location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath: pkg,
          importedSymbols: [pkg.split('/').pop() || pkg]
        });
      }

      const typeMatch = trimmed.match(/^type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/);
      if (typeMatch) {
        const typeName = typeMatch[1];
        const kindStr = typeMatch[2];
        const kind = kindStr === 'interface' ? 'interface' : 'struct';
        const typeId = `${fileId}:${kind}:${typeName}`;

        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(typeId);

        if (typeName[0] === typeName[0].toUpperCase()) {
          fileEntity.exports.push({ symbol: typeName, kind });
        }

        const typeEntity: IREntity = {
          id: typeId,
          name: typeName,
          kind,
          language: 'go',
          filePath,
          relativePath,
          location: { startLine: lineNum, startColumn: line.indexOf(typeName) + 1, endLine: lineNum, endColumn: line.length },
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
          imports: [],
          exports: [{ symbol: typeName, kind }]
        };
        entities.push(typeEntity);
        relationships.push({
          id: `rel:${fileId}->${typeId}`,
          sourceId: fileId,
          targetId: typeId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });
        continue;
      }

      const funcMatch = trimmed.match(/^func\s+(?:\((?:[a-zA-Z0-9_]+\s+\*?([a-zA-Z0-9_]+))\)\s+)?([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (funcMatch) {
        const receiverType = funcMatch[1];
        const funcName = funcMatch[2];
        const params = funcMatch[3];

        const isMethod = Boolean(receiverType);
        const parentId = receiverType ? `${fileId}:struct:${receiverType}` : fileId;
        const fnId = `${parentId}:${isMethod ? 'method' : 'function'}:${funcName}`;

        fileEntity.metrics.functionCount++;
        if (!isMethod) {
          fileEntity.childrenIds.push(fnId);
          if (funcName[0] === funcName[0].toUpperCase()) {
            fileEntity.exports.push({ symbol: funcName, kind: 'function' });
          }
        }

        const fnEntity: IREntity = {
          id: fnId,
          name: funcName,
          kind: isMethod ? 'method' : 'function',
          language: 'go',
          filePath,
          relativePath,
          location: { startLine: lineNum, startColumn: line.indexOf(funcName) + 1, endLine: lineNum, endColumn: line.length },
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
          signature: `${funcName}(${params.slice(0, 30)})`,
          imports: [],
          exports: [{ symbol: funcName, kind: isMethod ? 'method' : 'function' }]
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
