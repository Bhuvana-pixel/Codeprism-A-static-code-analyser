import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export class CCppAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'cpp';
  readonly fileExtensions = ['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx'];

  parseFile(filePath: string, relativePath: string, content: string): ParseResult {
    const isCpp = !filePath.endsWith('.c') && !filePath.endsWith('.h');
    const lang: SupportedLanguage = isCpp ? 'cpp' : 'c';

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
      language: lang,
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

    let currentParentId = fileId;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      const incMatch = trimmed.match(/^#include\s+["<]([^">]+)[">]/);
      if (incMatch) {
        fileEntity.imports.push({
          symbol: incMatch[1],
          sourceModule: incMatch[1],
          location: { startLine: lineNum, startColumn: 1, endLine: lineNum, endColumn: line.length }
        });
        unresolvedImports.push({
          sourceEntityId: fileId,
          importPath: incMatch[1],
          importedSymbols: [incMatch[1]]
        });
      }

      const classMatch = trimmed.match(/(?:class|struct)\s+([a-zA-Z0-9_]+)(?:\s*:\s*(?:public|protected|private)\s+([a-zA-Z0-9_]+))?/);
      if (classMatch) {
        const className = classMatch[1];
        const baseClass = classMatch[2];
        const classId = `${fileId}:class:${className}`;

        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);
        fileEntity.exports.push({ symbol: className, kind: isCpp ? 'class' : 'struct' });

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind: isCpp ? 'class' : 'struct',
          language: lang,
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
          imports: baseClass ? [{ symbol: baseClass, sourceModule: baseClass }] : [],
          exports: []
        };
        entities.push(classEntity);
        relationships.push({
          id: `rel:${fileId}->${classId}`,
          sourceId: fileId,
          targetId: classId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });

        if (baseClass) {
          unresolvedCalls.push({
            sourceEntityId: classId,
            targetName: baseClass,
            line: lineNum
          });
        }
        currentParentId = classId;
        continue;
      }

      const fnMatch = trimmed.match(/(?:[a-zA-Z0-9_*&:]+\s+)+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*\{/);
      if (fnMatch) {
        const fnName = fnMatch[1];
        const params = fnMatch[2];
        const ignore = new Set(['if', 'while', 'for', 'switch', 'catch']);

        if (!ignore.has(fnName)) {
          const fnId = `${currentParentId}:function:${fnName}`;
          fileEntity.metrics.functionCount++;

          if (currentParentId === fileId) {
            fileEntity.exports.push({ symbol: fnName, kind: 'function' });
          }

          const fnEntity: IREntity = {
            id: fnId,
            name: fnName,
            kind: 'function',
            language: lang,
            filePath,
            relativePath,
            location: { startLine: lineNum, startColumn: line.indexOf(fnName) + 1, endLine: lineNum, endColumn: line.length },
            parentId: currentParentId,
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
            signature: `${fnName}(${params})`,
            imports: [],
            exports: [{ symbol: fnName, kind: 'function' }]
          };
          entities.push(fnEntity);
          relationships.push({
            id: `rel:${currentParentId}->${fnId}`,
            sourceId: currentParentId,
            targetId: fnId,
            kind: 'CONTAINS',
            certainty: 'certain'
          });
        }
      }
    }

    return { entities, relationships, unresolvedCalls, unresolvedImports };
  }
}
