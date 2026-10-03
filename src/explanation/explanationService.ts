import * as vscode from 'vscode';
import {
  CodeExplanation,
  EXPLANATION_SYSTEM_PROMPT,
  ExplanationService,
  ModuleAnalysisContext,
  ModuleExplanation,
  NodeAnalysisContext,
  NodeExplanation
} from './types';
import { CustomLlmProvider, ILLMProvider, StaticFallbackProvider, VscodeLmProvider } from './llmProvider';

export class CodePrismExplanationService implements ExplanationService {
  private fallbackProvider: StaticFallbackProvider;

  constructor() {
    this.fallbackProvider = new StaticFallbackProvider();
  }

  /**
   * Explain a selected node using supplied static-analysis context
   */
  async explainNode(context: NodeAnalysisContext): Promise<NodeExplanation> {
    const userPrompt = JSON.stringify(context, null, 2);
    return this.executeExplanation(EXPLANATION_SYSTEM_PROMPT, userPrompt, context);
  }

  /**
   * Explain a selected module using supplied static-analysis context
   */
  async explainModule(context: ModuleAnalysisContext): Promise<ModuleExplanation> {
    const userPrompt = JSON.stringify(context, null, 2);
    return this.executeExplanation(EXPLANATION_SYSTEM_PROMPT, userPrompt, context);
  }

  private async executeExplanation(
    systemPrompt: string,
    userPrompt: string,
    context: NodeAnalysisContext | ModuleAnalysisContext
  ): Promise<CodeExplanation> {
    let enabled = true;
    let preferredProvider = 'auto';
    let apiKey = '';
    let apiBaseUrl = 'https://api.openai.com/v1';
    let modelName = 'gpt-4o-mini';

    try {
      if (typeof vscode !== 'undefined' && vscode.workspace && typeof vscode.workspace.getConfiguration === 'function') {
        const config = vscode.workspace.getConfiguration('codeprism');
        enabled = config.get<boolean>('llm.enabled', true);
        preferredProvider = config.get<string>('llm.provider', 'auto');
        apiKey = config.get<string>('llm.apiKey', '');
        apiBaseUrl = config.get<string>('llm.apiBaseUrl', 'https://api.openai.com/v1');
        modelName = config.get<string>('llm.model', 'gpt-4o-mini');
      }
    } catch {
      // Standalone or test environment
    }

    if (!enabled) {
      return this.fallbackProvider.generateExplanation(systemPrompt, userPrompt);
    }

    let providerToUse: ILLMProvider | null = null;

    if (preferredProvider === 'vscode-lm' || preferredProvider === 'auto') {
      const vscodeLm = new VscodeLmProvider();
      if (await vscodeLm.isAvailable()) {
        providerToUse = vscodeLm;
      }
    }

    if (!providerToUse && (preferredProvider === 'custom' || preferredProvider === 'auto') && apiKey) {
      const customLm = new CustomLlmProvider(apiKey, apiBaseUrl, modelName);
      if (await customLm.isAvailable()) {
        providerToUse = customLm;
      }
    }

    if (!providerToUse) {
      // Use fallback provider when no LLM is available or configured
      return this.fallbackProvider.generateExplanation(systemPrompt, userPrompt);
    }

    try {
      const explanation = await providerToUse.generateExplanation(systemPrompt, userPrompt);

      // Enforce mandatory limitation notice requirement
      if (!explanation.limitations.some(l => l.toLowerCase().includes('static-analysis'))) {
        explanation.limitations.unshift('Explanation is based only on static-analysis information.');
      }

      return explanation;
    } catch (err: any) {
      console.warn(`[CodePrism LLM Explanation Warning]: ${err?.message || err}. Falling back to static analyzer explanation.`);
      const fallbackResult = await this.fallbackProvider.generateExplanation(systemPrompt, userPrompt);
      return fallbackResult;
    }
  }
}
