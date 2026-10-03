import * as vscode from 'vscode';
import { GraphData } from '../analyzer/types';
import { RelationshipEngine } from '../analyzer/relationshipEngine';
import { IntelligenceEngine } from '../analyzer/intelligenceEngine';
import { GitEngine } from '../analyzer/gitEngine';
import { CodePrismExplanationService } from '../explanation/explanationService';
import { ContextBuilder } from '../explanation/contextBuilder';
import { ExplanationService } from '../explanation/types';
import { SnapshotManager } from '../time-machine/snapshotManager';
import { ArchitectureComparer } from '../time-machine/comparisonEngine';
import { TimeMachineExplanationBuilder, TIME_MACHINE_SYSTEM_PROMPT } from '../time-machine/timeMachineExplanation';

export class CodePrismController {
  private engine: RelationshipEngine;
  private snapshotManager: SnapshotManager;
  private currentGraphData: GraphData | null = null;
  private activeWebviews: Set<vscode.Webview> = new Set();
  public readonly explanationService: ExplanationService;

  constructor() {
    this.engine = new RelationshipEngine();
    this.snapshotManager = new SnapshotManager();
    this.explanationService = new CodePrismExplanationService();
  }

  async registerWebview(webview: vscode.Webview) {
    this.activeWebviews.add(webview);
    this.setupMessageListener(webview);
    await this.analyzeWorkspace();
  }

  unregisterWebview(webview: vscode.Webview) {
    this.activeWebviews.delete(webview);
  }

  async analyzeWorkspace(): Promise<GraphData | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showInformationMessage('CodePrism: No workspace folder open in VS Code.');
      return null;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'CodePrism: Analyzing workspace code map...',
        cancellable: false
      },
      async () => {
        const graphData = await this.engine.analyzeWorkspace({ workspacePath: rootPath });
        this.currentGraphData = graphData;

        this.broadcast({
          command: 'updateGraph',
          data: graphData
        });

        vscode.window.showInformationMessage(
          `CodePrism: Analyzed ${graphData.stats.totalFiles} files across ${Object.keys(graphData.stats.languages).length} languages.`
        );
      }
    );

    return this.currentGraphData;
  }

  async highlightActiveFile(document: vscode.TextDocument) {
    if (!this.currentGraphData) return;

    const filePath = document.uri.fsPath;
    this.broadcast({
      command: 'highlightFile',
      filePath
    });
  }

  public getCurrentGraphData(): GraphData | null {
    return this.currentGraphData;
  }

  public async explainNode(entityId: string, webview?: vscode.Webview) {
    if (!this.currentGraphData) {
      await this.analyzeWorkspace();
    }
    if (!this.currentGraphData || !this.currentGraphData.entities[entityId]) {
      vscode.window.showErrorMessage(`CodePrism: Node ID '${entityId}' not found in static analysis.`);
      return;
    }

    const entity = this.currentGraphData.entities[entityId];
    const projectName = vscode.workspace.workspaceFolders?.[0]?.name || 'Workspace';
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const evolution = GitEngine.getEntityEvolution(rootPath, entity.relativePath || '', entity.filePath || '');

    const githubInfo = evolution ? {
      repository: projectName,
      fileLocation: entity.relativePath || entity.filePath,
      createdYear: `${evolution.createdYear || '2024'}`,
      totalCommits: evolution.totalCommits || 0,
      lastModifiedRelative: evolution.lastModifiedRelative || 'Recently',
      coChangedFilesCount: evolution.coChangedFilesCount || 0,
      recentCommits: evolution.recentCommits || [],
      isAvailable: Boolean(evolution.totalCommits && evolution.totalCommits > 0)
    } : undefined;

    const context = ContextBuilder.buildNodeContext(entityId, this.currentGraphData, projectName, githubInfo);

    if (!context) {
      vscode.window.showErrorMessage(`CodePrism: Could not build static-analysis context for node.`);
      return;
    }

    const explanation = await this.explanationService.explainNode(context);

    const messagePayload = {
      command: 'nodeExplanationResult',
      entityId,
      context,
      explanation
    };

    if (webview) {
      this.sendToWebview(webview, messagePayload);
    } else {
      this.broadcast(messagePayload);
    }
  }

  public async explainModule(moduleName: string, webview?: vscode.Webview) {
    if (!this.currentGraphData) {
      await this.analyzeWorkspace();
    }
    if (!this.currentGraphData) {
      vscode.window.showErrorMessage('CodePrism: Workspace static analysis not available.');
      return;
    }

    const projectName = vscode.workspace.workspaceFolders?.[0]?.name || 'Workspace';
    const context = ContextBuilder.buildModuleContext(moduleName, this.currentGraphData, projectName);
    const explanation = await this.explanationService.explainModule(context);

    const messagePayload = {
      command: 'moduleExplanationResult',
      moduleName,
      context,
      explanation
    };

    if (webview) {
      this.sendToWebview(webview, messagePayload);
    } else {
      this.broadcast(messagePayload);
    }
  }

  private setupMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'navigateToFile':
          this.handleNavigateToFile(message.filePath, message.line, message.column);
          break;
        case 'requestAnalysis':
          await this.analyzeWorkspace();
          break;
        case 'overrideRole':
          if (this.currentGraphData && message.entityId && message.newRole) {
            const entity = this.currentGraphData.entities[message.entityId];
            if (entity) {
              entity.archRoleOverride = message.newRole;
              entity.archLayer = message.newRole;
              entity.archConfidence = 100;
              this.broadcast({
                command: 'updateGraph',
                data: this.currentGraphData
              });
              vscode.window.showInformationMessage(`CodePrism: Role for ${entity.name} updated to '${message.newRole}'.`);
            }
          }
          break;
        case 'requestGitHistory':
          if (message.filePath && message.entityId) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
            const entity = this.currentGraphData?.entities[message.entityId];
            const relPath = entity ? entity.relativePath : '';

            const evolution = GitEngine.getEntityEvolution(rootPath, relPath, message.filePath);
            this.sendToWebview(webview, {
              command: 'gitHistoryResult',
              entityId: message.entityId,
              evolution
            });
          }
          break;
        case 'requestImpactAnalysis':
          if (this.currentGraphData && message.entityId) {
            const depthLimit = message.depth === 'all' ? 999 : (parseInt(message.depth, 10) || 2);
            const impact = IntelligenceEngine.analyzeImpact(
              message.entityId,
              this.currentGraphData.entities,
              this.currentGraphData.relationships,
              depthLimit
            );
            this.sendToWebview(webview, {
              command: 'impactAnalysisResult',
              targetEntityId: message.entityId,
              impact,
              depth: message.depth || 2
            });
          }
          break;
        case 'requestNodeExplanation':
          if (message.entityId) {
            await this.explainNode(message.entityId, webview);
          }
          break;
        case 'requestModuleExplanation':
          if (message.moduleName) {
            await this.explainModule(message.moduleName, webview);
          }
          break;

        // --- Time Machine Handlers ---
        case 'requestTimeMachineCommits': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
          const commits = this.snapshotManager.getCommitHistory(rootPath);
          this.sendToWebview(webview, {
            command: 'timeMachineCommitsResult',
            commits
          });
          break;
        }
        case 'requestAnalyzeCommit': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
          if (rootPath && message.commitHash) {
            const snapshot = await this.snapshotManager.getSnapshot(rootPath, message.commitHash, message.commitItem);
            this.sendToWebview(webview, {
              command: 'commitSnapshotResult',
              commitHash: message.commitHash,
              snapshot
            });
          }
          break;
        }
        case 'requestCompareSnapshots': {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          const rootPath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
          if (rootPath && message.fromCommit && message.toCommit) {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `CodePrism Time Machine: Comparing ${message.fromCommit.substring(0, 7)} ➔ ${message.toCommit.substring(0, 7)}...`,
                cancellable: false
              },
              async () => {
                const fromSnapshot = await this.snapshotManager.getSnapshot(rootPath, message.fromCommit, message.fromItem);
                const toSnapshot = await this.snapshotManager.getSnapshot(rootPath, message.toCommit, message.toItem);
                const comparison = ArchitectureComparer.compare(fromSnapshot, toSnapshot);
                this.sendToWebview(webview, {
                  command: 'comparisonResult',
                  fromCommit: message.fromCommit,
                  toCommit: message.toCommit,
                  comparison
                });
              }
            );
          }
          break;
        }
        case 'requestExplainChange': {
          if (message.comparison) {
            const fallback = TimeMachineExplanationBuilder.generateFallbackExplanation(message.comparison);
            this.sendToWebview(webview, {
              command: 'explainChangeResult',
              explanation: fallback
            });
          }
          break;
        }
      }
    });
  }

  private async handleNavigateToFile(filePath: string, line: number = 1, column: number = 1) {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preview: true });

      const targetLine = Math.max(0, line - 1);
      const targetCol = Math.max(0, column - 1);
      const pos = new vscode.Position(targetLine, targetCol);

      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (err) {
      vscode.window.showErrorMessage(`CodePrism: Could not open file ${filePath}`);
    }
  }

  private broadcast(message: any) {
    this.activeWebviews.forEach(webview => {
      this.sendToWebview(webview, message);
    });
  }

  private sendToWebview(webview: vscode.Webview, message: any) {
    webview.postMessage(message);
  }
}

