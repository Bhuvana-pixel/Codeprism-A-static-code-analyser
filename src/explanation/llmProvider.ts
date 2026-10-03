import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { CodeExplanation } from './types';

export interface ILLMProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  generateExplanation(systemPrompt: string, userContextJson: string): Promise<CodeExplanation>;
}

/**
 * VS Code Language Model API Provider (vscode.lm)
 */
export class VscodeLmProvider implements ILLMProvider {
  readonly name = 'VS Code Language Model API (vscode.lm)';

  async isAvailable(): Promise<boolean> {
    try {
      const lm = (vscode as any).lm;
      if (!lm || typeof lm.selectChatModels !== 'function') return false;
      const models = await lm.selectChatModels();
      return Array.isArray(models) && models.length > 0;
    } catch {
      return false;
    }
  }

  async generateExplanation(systemPrompt: string, userContextJson: string): Promise<CodeExplanation> {
    const lm = (vscode as any).lm;
    const models = await lm.selectChatModels();
    if (!models || models.length === 0) {
      throw new Error('No VS Code Language Models available.');
    }

    const model = models[0]; // Select primary chat model (e.g., Copilot / GPT-4)
    const messages = [
      (vscode as any).LanguageModelChatMessage.User(`${systemPrompt}\n\nHere is the static analysis context:\n${userContextJson}`)
    ];

    const requestToken = new vscode.CancellationTokenSource().token;
    const response = await model.sendRequest(messages, {}, requestToken);

    let fullText = '';
    for await (const chunk of response.text) {
      fullText += chunk;
    }

    return parseLlmResponseToJson(fullText);
  }
}

/**
 * Custom LLM Provider (OpenAI, Gemini, Ollama, standard REST endpoint)
 */
export class CustomLlmProvider implements ILLMProvider {
  readonly name = 'Custom LLM Provider API';

  constructor(
    private apiKey: string,
    private apiBaseUrl: string = 'https://api.openai.com/v1',
    private model: string = 'gpt-4o-mini'
  ) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateExplanation(systemPrompt: string, userContextJson: string): Promise<CodeExplanation> {
    const urlString = `${this.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    const payload = JSON.stringify({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Translate this static-analysis context into a structured explanation JSON:\n${userContextJson}`
        }
      ],
      temperature: 0.2
    });

    const responseText = await makeHttpRequest(urlString, payload, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    });

    const parsedData = JSON.parse(responseText);
    const content = parsedData.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('LLM response choice was empty.');
    }

    return parseLlmResponseToJson(content);
  }
}

/**
 * Deterministic Static Fallback Explanation Provider
 * Used when LLM API is unavailable, offline, or returns an error.
 */
export class StaticFallbackProvider implements ILLMProvider {
  readonly name = 'Static Analysis Fallback Explanation Service';

  async isAvailable(): Promise<boolean> {
    return true; // Always available as core fallback
  }

  async generateExplanation(systemPrompt: string, userContextJson: string): Promise<CodeExplanation> {
    const context = JSON.parse(userContextJson);
    const isNode = Boolean(context.node);

    if (isNode) {
      const node = context.node;
      const sa = context.staticAnalysis || {};
      const metrics = sa.metrics || {};

      const title = node.name || 'Component';
      const summary = `Static analysis shows '${node.name}' as a ${node.type} in layer '${node.layer}' (${node.language}).`;

      return {
        title,
        summary,
        sections: [
          {
            heading: 'Purpose',
            content: `This component appears to be a ${node.type} residing at '${node.file}'. Based on detected functions (${sa.functions?.length || 0}) and exports (${sa.exports?.length || 0}), static analysis identifies its architectural layer as '${node.layer}'.`
          },
          {
            heading: 'Components',
            content: `Detected internal structures include ${sa.classes?.length || 0} class(es) [${(sa.classes || []).join(', ') || 'None'}], and ${sa.functions?.length || 0} function(s) [${(sa.functions || []).join(', ') || 'None'}].`
          },
          {
            heading: 'Dependencies',
            content: `The static analysis indicates this component imports/depends on ${sa.dependencies?.length || 0} entity/entities: [${(sa.dependencies || []).join(', ') || 'None'}].`
          },
          {
            heading: 'Relationships',
            content: `This component is imported/referenced by ${sa.importedBy?.length || 0} component(s): [${(sa.importedBy || []).join(', ') || 'None'}]. Outgoing dependency count is ${metrics.dependencyCount || 0}.`
          },
          {
            heading: 'Architectural Role',
            content: `Static analysis classifies this component as part of the ${node.layer} layer with cyclomatic complexity ${metrics.cyclomaticComplexity || 1} and ${metrics.linesOfCode || 1} lines of code.`
          }
        ],
        limitations: [
          'Explanation is based only on static-analysis information.',
          'LLM explanation unavailable. Static analysis results are still available.'
        ]
      };
    } else {
      const mod = context.module || {};
      const sa = context.staticAnalysis || {};
      const metrics = sa.metrics || {};

      const title = `Module: ${mod.name || 'Module'}`;
      const summary = `Static analysis summarizes module '${mod.name}' containing ${sa.files?.length || 0} file(s) in layer '${mod.layer}'.`;

      return {
        title,
        summary,
        sections: [
          {
            heading: 'Purpose',
            content: `This module appears to represent the '${mod.name}' architectural subsystem. It groups ${metrics.filesCount || 0} file(s) with total ${metrics.linesOfCode || 0} lines of code.`
          },
          {
            heading: 'Components',
            content: `Contains ${metrics.classCount || 0} detected class(es) and ${metrics.functionCount || 0} detected function(s) across files: [${(sa.files || []).slice(0, 5).join(', ')}${(sa.files || []).length > 5 ? '...' : ''}].`
          },
          {
            heading: 'Dependencies',
            content: `Static analysis detected ${sa.dependencies?.length || 0} external dependency/dependencies: [${(sa.dependencies || []).join(', ') || 'None'}].`
          },
          {
            heading: 'Relationships',
            content: `Module '${mod.name}' is depended on by ${sa.dependents?.length || 0} external module(s)/component(s): [${(sa.dependents || []).join(', ') || 'None'}].`
          },
          {
            heading: 'Architectural Role',
            content: `Static analysis classifies this group under the '${mod.layer}' architectural layer.`
          }
        ],
        limitations: [
          'Explanation is based only on static-analysis information.',
          'LLM explanation unavailable. Static analysis results are still available.'
        ]
      };
    }
  }
}

/**
 * Helper to strip markdown code blocks and parse raw JSON from LLM outputs
 */
export function parseLlmResponseToJson(text: string): CodeExplanation {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  const obj = JSON.parse(cleaned);

  return {
    title: obj.title || 'Component Explanation',
    summary: obj.summary || 'Static analysis explanation.',
    sections: Array.isArray(obj.sections)
      ? obj.sections.map((s: any) => ({
          heading: String(s.heading || 'Section'),
          content: String(s.content || '')
        }))
      : [],
    limitations: Array.isArray(obj.limitations)
      ? obj.limitations.map((l: any) => String(l))
      : ['Explanation is based only on static-analysis information.']
  };
}

function makeHttpRequest(urlString: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const requester = url.protocol === 'https:' ? https : http;
    const req = requester.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.write(body);
    req.end();
  });
}
