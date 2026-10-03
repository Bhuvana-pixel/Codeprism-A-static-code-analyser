import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export class PHPAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'php';
  readonly fileExtensions = ['.php'];

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
      language: 'php',
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

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;

      const useMatch = trimmed.match(/^use\s+([a-zA-Z0-9_\\]+)(?:\s+as\s+([a-zA-Z0-9_]+))?;/);
      if (useMatch) {
        const usePath = useMatch[1];
        const alias = useMatch[2] || usePath.split('\\').pop() || usePath;
        fileEntity.imports.push({
          symbol: alias,
          sourceModule: usePath,
          location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath: usePath,
          importedSymbols: [alias]
        });
      }

      const classMatch = trimmed.match(/(?:abstract|final\s+)*\s*(class|interface|trait)\s+([a-zA-Z0-9_]+)(?:\s+extends\s+([a-zA-Z0-9_]+))?(?:\s+implements\s+([a-zA-Z0-9_,\s]+))?/);
      if (classMatch) {
        const kindStr = classMatch[1];
        const className = classMatch[2];
        const extendsClass = classMatch[3];
        const implementsInterfaces = classMatch[4];
        const kind = kindStr === 'interface' ? 'interface' : kindStr === 'trait' ? 'trait' : 'class';

        const classId = `${fileId}:${kind}:${className}`;
        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);
        fileEntity.exports.push({ symbol: className, kind });

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind,
          language: 'php',
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
          imports: extendsClass ? [{ symbol: extendsClass, sourceModule: extendsClass }] : [],
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

        if (extendsClass) {
          unresolvedCalls.push({
            sourceEntityId: classId,
            targetName: extendsClass,
            line: lineNum
          });
        }
        continue;
      }

      const fnMatch = trimmed.match(/(?:public|protected|private|static|abstract|final\s+)*function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/);
      if (fnMatch) {
        const fnName = fnMatch[1];
        const params = fnMatch[2];
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
          language: 'php',
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
