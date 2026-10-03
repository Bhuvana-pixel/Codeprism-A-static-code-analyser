import { IREntity, IRRelationship, SupportedLanguage } from '../types';

export interface ParseResult {
  entities: IREntity[];
  relationships: IRRelationship[];
  unresolvedCalls: Array<{
    sourceEntityId: string;
    targetName: string;
    line: number;
  }>;
  unresolvedImports: Array<{
    sourceEntityId: string;
    importPath: string;
    importedSymbols: string[];
  }>;
}

export abstract class LanguageAdapter {
  abstract readonly language: SupportedLanguage;
  abstract readonly fileExtensions: string[];

  supports(filePath: string): boolean {
    const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
    return this.fileExtensions.includes(ext);
  }

  abstract parseFile(
    filePath: string,
    relativePath: string,
    content: string
  ): ParseResult;

  /**
   * Helper to count lines of code excluding blank lines and standard comments
   */
  protected calculateLOC(content: string): number {
    const lines = content.split(/\r?\n/);
    return lines.filter(line => line.trim().length > 0).length;
  }

  /**
   * Helper to estimate cyclomatic complexity based on control flow keywords
   */
  protected estimateComplexity(content: string): number {
    let complexity = 1;
    const matches = content.match(/\b(if|else\s+if|elif|for|while|case|catch|except|&&|\|\||\?)\b/g);
    if (matches) {
      complexity += matches.length;
    }
    return complexity;
  }
}
