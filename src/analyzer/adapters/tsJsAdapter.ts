import * as ts from 'typescript';
import { LanguageAdapter, ParseResult } from './baseAdapter';
import { IREntity, IRImport, IRExport, IRRelationship, SupportedLanguage } from '../types';

export class TSJSAdapter extends LanguageAdapter {
  readonly language: SupportedLanguage = 'typescript';
  readonly fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  parseFile(filePath: string, relativePath: string, content: string): ParseResult {
    const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
    const lang: SupportedLanguage = isTS ? 'typescript' : 'javascript';
    const scriptKind = filePath.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : filePath.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : isTS
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    const entities: IREntity[] = [];
    const relationships: IRRelationship[] = [];
    const unresolvedCalls: ParseResult['unresolvedCalls'] = [];
    const unresolvedImports: ParseResult['unresolvedImports'] = [];

    const fileLoc = this.calculateLOC(content);
    const fileId = `file:${filePath}`;

    const fileEntity: IREntity = {
      id: fileId,
      name: relativePath.split(/[/\\]/).pop() || relativePath,
      kind: 'file',
      language: lang,
      filePath,
      relativePath,
      location: { startLine: 1, startColumn: 1, endLine: sourceFile.getLineAndCharacterOfPosition(content.length).line + 1, endColumn: 1 },
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

    const visitor = (node: ts.Node, currentParentId: string) => {
      const { line: startLine, character: startCol } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const { line: endLine, character: endCol } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const location = { startLine: startLine + 1, startColumn: startCol + 1, endLine: endLine + 1, endColumn: endCol + 1 };

      // Imports
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const importPath = moduleSpecifier.text;
          const symbols: string[] = [];

          if (node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            node.importClause.namedBindings.elements.forEach(el => {
              const sym = el.name.text;
              symbols.push(sym);
              fileEntity.imports.push({
                symbol: sym,
                sourceModule: importPath,
                location
              });
            });
          } else if (node.importClause?.name) {
            const sym = node.importClause.name.text;
            symbols.push(sym);
            fileEntity.imports.push({
              symbol: sym,
              sourceModule: importPath,
              location
            });
          } else {
            fileEntity.imports.push({
              symbol: importPath,
              sourceModule: importPath,
              location
            });
          }

          unresolvedImports.push({
            sourceEntityId: fileId,
            importPath,
            importedSymbols: symbols
          });
        }
      }

      // Classes
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        const classId = `${fileId}:class:${className}`;
        fileEntity.metrics.classCount++;
        fileEntity.childrenIds.push(classId);

        const isExported = Boolean(
          node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        );
        const isDefault = Boolean(
          node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
        );

        if (isExported || isDefault) {
          fileEntity.exports.push({
            symbol: className,
            kind: 'class',
            isDefault,
            location
          });
        }

        const classImports: IRImport[] = [];
        const classExports: IRExport[] = [];

        // Class inheritance & interfaces
        if (node.heritageClauses) {
          node.heritageClauses.forEach(clause => {
            clause.types.forEach(t => {
              const targetName = t.expression.getText(sourceFile);
              classImports.push({
                symbol: targetName,
                sourceModule: targetName,
                location
              });
              unresolvedCalls.push({
                sourceEntityId: classId,
                targetName,
                line: location.startLine
              });
            });
          });
        }

        const classEntity: IREntity = {
          id: classId,
          name: className,
          kind: 'class',
          language: lang,
          filePath,
          relativePath,
          location,
          parentId: currentParentId,
          childrenIds: [],
          metrics: {
            loc: endLine - startLine + 1,
            functionCount: 0,
            classCount: 0,
            cyclomaticComplexity: this.estimateComplexity(node.getText(sourceFile)),
            incomingDegree: 0,
            outgoingDegree: 0
          },
          archLayer: 'unknown',
          imports: classImports,
          exports: classExports
        };
        entities.push(classEntity);
        relationships.push({
          id: `rel:${fileId}->${classId}`,
          sourceId: fileId,
          targetId: classId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });

        ts.forEachChild(node, child => visitor(child, classId));
        return;
      }

      // Interfaces
      if (ts.isInterfaceDeclaration(node)) {
        const ifaceName = node.name.text;
        const ifaceId = `${fileId}:interface:${ifaceName}`;
        fileEntity.childrenIds.push(ifaceId);

        const isExported = Boolean(
          node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        );
        if (isExported) {
          fileEntity.exports.push({
            symbol: ifaceName,
            kind: 'interface',
            location
          });
        }

        const ifaceEntity: IREntity = {
          id: ifaceId,
          name: ifaceName,
          kind: 'interface',
          language: lang,
          filePath,
          relativePath,
          location,
          parentId: currentParentId,
          childrenIds: [],
          metrics: {
            loc: endLine - startLine + 1,
            functionCount: 0,
            classCount: 0,
            cyclomaticComplexity: 1,
            incomingDegree: 0,
            outgoingDegree: 0
          },
          archLayer: 'unknown',
          imports: [],
          exports: [{ symbol: ifaceName, kind: 'interface', location }]
        };
        entities.push(ifaceEntity);
        relationships.push({
          id: `rel:${fileId}->${ifaceId}`,
          sourceId: fileId,
          targetId: ifaceId,
          kind: 'CONTAINS',
          certainty: 'certain'
        });

        ts.forEachChild(node, child => visitor(child, ifaceId));
        return;
      }

      // Functions & Methods
      if (
        (ts.isFunctionDeclaration(node) && node.name) ||
        (ts.isMethodDeclaration(node) && node.name) ||
        (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer) && ts.isIdentifier(node.name))
      ) {
        let fnName = '';
        if (ts.isFunctionDeclaration(node) && node.name) fnName = node.name.text;
        else if (ts.isMethodDeclaration(node)) fnName = node.name.getText(sourceFile);
        else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) fnName = node.name.text;

        if (fnName) {
          const kind = ts.isMethodDeclaration(node) ? 'method' : 'function';
          const fnId = `${currentParentId}:${kind}:${fnName}`;
          fileEntity.metrics.functionCount++;
          if (currentParentId === fileId) {
            fileEntity.childrenIds.push(fnId);
          }

          const isExported = Boolean(
            (node as any).modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword)
          );

          if (isExported && currentParentId === fileId) {
            fileEntity.exports.push({
              symbol: fnName,
              kind,
              location
            });
          }

          const fnImports: IRImport[] = [];
          const fnExports: IRExport[] = isExported ? [{ symbol: fnName, kind, location }] : [];

            // Function calls & JSX Elements within this function/method
            const findCalls = (innerNode: ts.Node) => {
              if (ts.isCallExpression(innerNode)) {
                let callName = innerNode.expression.getText(sourceFile);
                if (callName.includes('.')) {
                  callName = callName.split('.').pop() || callName;
                }
                fnImports.push({
                  symbol: callName,
                  sourceModule: callName,
                  location: {
                    startLine: sourceFile.getLineAndCharacterOfPosition(innerNode.getStart()).line + 1,
                    startColumn: 1,
                    endLine: sourceFile.getLineAndCharacterOfPosition(innerNode.getEnd()).line + 1,
                    endColumn: 1
                  }
                });
                unresolvedCalls.push({
                  sourceEntityId: fnId,
                  targetName: callName,
                  line: sourceFile.getLineAndCharacterOfPosition(innerNode.getStart()).line + 1
                });
              } else if (ts.isJsxElement(innerNode) || ts.isJsxSelfClosingElement(innerNode)) {
                const tagName = ts.isJsxElement(innerNode)
                  ? innerNode.openingElement.tagName.getText(sourceFile)
                  : innerNode.tagName.getText(sourceFile);

                if (tagName && /^[A-Z]/.test(tagName)) {
                  fnImports.push({
                    symbol: tagName,
                    sourceModule: tagName,
                    location: {
                      startLine: sourceFile.getLineAndCharacterOfPosition(innerNode.getStart()).line + 1,
                      startColumn: 1,
                      endLine: sourceFile.getLineAndCharacterOfPosition(innerNode.getEnd()).line + 1,
                      endColumn: 1
                    }
                  });
                  unresolvedCalls.push({
                    sourceEntityId: fnId,
                    targetName: tagName,
                    line: sourceFile.getLineAndCharacterOfPosition(innerNode.getStart()).line + 1
                  });
                }
              }
              ts.forEachChild(innerNode, findCalls);
            };
            ts.forEachChild(node, findCalls);

          const fnEntity: IREntity = {
            id: fnId,
            name: fnName,
            kind,
            language: lang,
            filePath,
            relativePath,
            location,
            parentId: currentParentId,
            childrenIds: [],
            metrics: {
              loc: endLine - startLine + 1,
              functionCount: 0,
              classCount: 0,
              cyclomaticComplexity: this.estimateComplexity(node.getText(sourceFile)),
              incomingDegree: 0,
              outgoingDegree: 0
            },
            archLayer: 'unknown',
            signature: `${fnName}(...)`,
            imports: fnImports,
            exports: fnExports
          };

          // If parent is a class, register as a class export/method
          const parentEntity = entities.find(e => e.id === currentParentId);
          if (parentEntity && parentEntity.kind === 'class') {
            parentEntity.exports.push({
              symbol: `${fnName}()`,
              kind: 'method',
              location
            });
          }

          entities.push(fnEntity);
          relationships.push({
            id: `rel:${currentParentId}->${fnId}`,
            sourceId: currentParentId,
            targetId: fnId,
            kind: 'CONTAINS',
            certainty: 'certain'
          });
          return;
        }
      }

      ts.forEachChild(node, child => visitor(child, currentParentId));
    };

    ts.forEachChild(sourceFile, child => visitor(child, fileId));

    return { entities, relationships, unresolvedCalls, unresolvedImports };
  }
}
