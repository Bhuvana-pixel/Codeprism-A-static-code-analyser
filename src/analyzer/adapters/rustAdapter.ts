import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export class RustAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'rust';
  readonly fileExtensions = ['.rs'];

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
      language: 'rust',
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

    let currentImplStruct: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//')) continue;

      const useMatch = trimmed.match(/^use\s+([a-zA-Z0-9_:]+)(?:::\s*\{([^}]+)\})?;/);
      if (useMatch) {
        const modPath = useMatch[1];
        const symbols = useMatch[2] ? useMatch[2].split(',').map(s => s.trim()) : [modPath.split('::').pop() || modPath];
        symbols.forEach(sym => {
          fileEntity.imports.push({
            symbol: sym,
            sourceModule: modPath,
            location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
          });
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath: modPath,
          importedSymbols: symbols
        });
      }

      const structMatch = trimmed.match(/(?:pub(?:\(crate\))?\s+)?(struct|trait|enum)\s+([a-zA-Z0-9_]+)/);
      if (structMatch) {
        const kindStr = structMatch[1];
        const name = structMatch[2];
        const kind = kindStr === 'trait' ? 'trait' : 'struct';

        const structId = `${fileId}:${kind}:${name}`;
        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(structId);

        if (trimmed.startsWith('pub')) {
          fileEntity.exports.push({ symbol: name, kind });
        }

        const structEntity: IREntity = {
          id: structId,
          name,
          kind,
          language: 'rust',
          filePath,
          relativePath,
          location: { startLine: lineNum, startColumn: line.indexOf(name) + 1, endLine: lineNum, endColumn: line.length },
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
          exports: [{ symbol: name, kind }]
        };
        entities.push(structEntity);
        relationships.push({
          id: `rel:${fileId}->${structId}`,
          sourceId: fileId,
          targetId: structId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });
        continue;
      }

      const implMatch = trimmed.match(/^impl(?:\s+([a-zA-Z0-9_]+)\s+for)?\s+([a-zA-Z0-9_]+)/);
      if (implMatch) {
        const traitName = implMatch[1];
        const structName = implMatch[2];
        currentImplStruct = structName;

        if (traitName) {
          unresolvedCalls.push({
            sourceEntityId: `${fileId}:struct:${structName}`,
            targetName: traitName,
            line: lineNum
          });
        }
        continue;
      }

      const fnMatch = trimmed.match(/(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (fnMatch) {
        const fnName = fnMatch[1];
        const params = fnMatch[2];
        const parentId = currentImplStruct ? `${fileId}:struct:${currentImplStruct}` : fileId;
        const kind = currentImplStruct ? 'method' : 'function';
        const fnId = `${parentId}:${kind}:${fnName}`;

        fileEntity.metrics.functionCount++;
        if (!currentImplStruct) {
          fileEntity.childrenIds.push(fnId);
          if (trimmed.startsWith('pub')) {
            fileEntity.exports.push({ symbol: fnName, kind: 'function' });
          }
        }

        const fnEntity: IREntity = {
          id: fnId,
          name: fnName,
          kind,
          language: 'rust',
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
