import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodePrismController } from '../controller/codePrismController';

export class CodeMapPanel {
  public static currentPanel: CodeMapPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;

  public static createOrShow(extensionUri: vscode.Uri, controller: CodePrismController) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (CodeMapPanel.currentPanel) {
      CodeMapPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codeprismMap',
      'CodePrism: Code Map',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: false
      }
    );

    CodeMapPanel.currentPanel = new CodeMapPanel(panel, extensionUri, controller);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly controller: CodePrismController
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this.controller.registerWebview(this._panel.webview);

    this._panel.onDidDispose(() => {
      this.controller.unregisterWebview(this._panel.webview);
      CodeMapPanel.currentPanel = undefined;
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const v = Date.now();
    const scriptUri = `${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webviewApp.js'))}?v=${v}`;
    const styleUri = `${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'styles.css'))}?v=${v}`;

    const htmlPath = path.join(this._extensionUri.fsPath, 'dist', 'index.html');
    let htmlContent = fs.readFileSync(htmlPath, 'utf-8');

    htmlContent = htmlContent.replace(
      '</head>',
      `<link rel="stylesheet" type="text/css" href="${styleUri}"></head>`
    );
    htmlContent = htmlContent.replace(
      '<!-- SCRIPT_INJECTION -->',
      `<script src="${scriptUri}"></script>`
    );

    return htmlContent;
  }
}
