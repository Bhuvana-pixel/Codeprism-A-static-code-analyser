import * as vscode from 'vscode';
import { CodePrismController } from './controller/codePrismController';
import { SidebarViewProvider } from './providers/sidebarViewProvider';
import { CodeMapPanel } from './providers/codeMapPanel';

export function activate(context: vscode.ExtensionContext) {
  console.log('CodePrism Extension activated!');

  const controller = new CodePrismController();

  // Register Activity Bar Sidebar View Provider
  const sidebarProvider = new SidebarViewProvider(context.extensionUri, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  );

  // Command: Analyze Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.analyzeWorkspace', async () => {
      await controller.analyzeWorkspace();
    })
  );

  // Command: Open Code Map
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.openCodeMap', () => {
      CodeMapPanel.createOrShow(context.extensionUri, controller);
    })
  );

  // Command: Analyze Current File
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.analyzeCurrentFile', async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        await controller.highlightActiveFile(activeEditor.document);
        vscode.window.showInformationMessage(
          `CodePrism: Analyzing ${activeEditor.document.fileName}`
        );
      }
    })
  );

  // Command: Find Symbol
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.findSymbol', async () => {
      const symbol = await vscode.window.showInputBox({
        prompt: 'CodePrism: Enter class, function, or file symbol name to highlight in Code Map',
        placeHolder: 'e.g. OrderService, getUserById, app.py'
      });
      if (symbol) {
        vscode.commands.executeCommand('codeprism.openCodeMap');
      }
    })
  );

  // Command: Show Dependencies
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.showDependencies', () => {
      CodeMapPanel.createOrShow(context.extensionUri, controller);
    })
  );

  // Command: Show Call Graph
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.showCallGraph', () => {
      CodeMapPanel.createOrShow(context.extensionUri, controller);
    })
  );

  // Command: Refresh Analysis
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.refreshAnalysis', async () => {
      await controller.analyzeWorkspace();
    })
  );

  // Command: Explain Node (LLM)
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.explainNode', async (entityId?: string) => {
      CodeMapPanel.createOrShow(context.extensionUri, controller);
      if (entityId) {
        await controller.explainNode(entityId);
      } else {
        const graphData = controller.getCurrentGraphData();
        if (!graphData) {
          vscode.window.showInformationMessage('CodePrism: Please analyze workspace first.');
          return;
        }
        const items = Object.values(graphData.entities).map(e => ({
          label: e.name,
          description: `${e.kind} (${e.archLayer}) - ${e.relativePath}`,
          id: e.id
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select component to explain with LLM...'
        });
        if (picked) {
          await controller.explainNode(picked.id);
        }
      }
    })
  );

  // Command: Explain Module (LLM)
  context.subscriptions.push(
    vscode.commands.registerCommand('codeprism.explainModule', async (moduleName?: string) => {
      CodeMapPanel.createOrShow(context.extensionUri, controller);
      if (moduleName) {
        await controller.explainModule(moduleName);
      } else {
        const graphData = controller.getCurrentGraphData();
        if (!graphData) {
          vscode.window.showInformationMessage('CodePrism: Please analyze workspace first.');
          return;
        }
        const layers = Array.from(new Set(Object.values(graphData.entities).map(e => e.archLayer)));
        const picked = await vscode.window.showQuickPick(layers, {
          placeHolder: 'Select module or architectural layer to explain with LLM...'
        });
        if (picked) {
          await controller.explainModule(picked);
        }
      }
    })
  );

  // Synchronize Active Text Editor with Code Map
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        controller.highlightActiveFile(editor.document);
      }
    })
  );

  // File System Watcher for Incremental Re-analysis
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,py,java,c,cpp,h,hpp,cs,go,kt,rs,php}');
  watcher.onDidChange(() => controller.analyzeWorkspace());
  watcher.onDidCreate(() => controller.analyzeWorkspace());
  watcher.onDidDelete(() => controller.analyzeWorkspace());
  context.subscriptions.push(watcher);
}

export function deactivate() {}
