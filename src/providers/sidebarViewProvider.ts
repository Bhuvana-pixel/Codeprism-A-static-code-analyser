import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodePrismController } from '../controller/codePrismController';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codeprism.sidebarView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly controller: CodePrismController
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    this.controller.registerWebview(webviewView.webview);

    webviewView.onDidDispose(() => {
      this.controller.unregisterWebview(webviewView.webview);
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
