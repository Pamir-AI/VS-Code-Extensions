import * as vscode from 'vscode';
import * as path from 'path';
import { marked } from 'marked';
// Tweak markdown rendering for webview readability
marked.setOptions({ gfm: true, breaks: false });

export function activate(ctx: vscode.ExtensionContext) {
  ensureTerminalVisible();

  ctx.subscriptions.push(
    vscode.commands.registerCommand('pamir.cloneExamples', async () => {
      await vscode.commands.executeCommand('git.clone', 'https://github.com/pamir-ai/distiller-examples.git');
    }),
    vscode.commands.registerCommand('pamir.createProject', async () => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        vscode.window.showWarningMessage('Open a folder first to create the project.');
        return;
      }
      const root = folders[0].uri;
      const name = await vscode.window.showInputBox({ prompt: 'Project name', value: 'my-distiller-app' });
      if (!name) return;

      const project = vscode.Uri.joinPath(root, name);
      await vscode.workspace.fs.createDirectory(project);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(project, 'main.py'), Buffer.from('print("Hello Pamir")\n'));
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(project, 'README.md'), Buffer.from(`# ${name}\n`));

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(project, 'main.py'));
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('pamir.openDocs', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('https://docs.pamir.ai/distiller-cm5'));
    }),
    vscode.commands.registerCommand('pamir.openPasswordConfig', async () => {
      try {
        const configUri = vscode.Uri.file('/opt/claude-code-web-manager/config/production.json');
        const doc = await vscode.workspace.openTextDocument(configUri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Unable to open password configuration: ${message}`);
        console.log('[pamir] Unable to open password configuration', err);
      }
    }),
    vscode.commands.registerCommand('pamir.openHome', () => openWelcome(ctx))
  );

  const shownKey = 'pamir.homeShown';
  if (!ctx.globalState.get(shownKey)) {
    openWelcome(ctx).then(() => ctx.globalState.update(shownKey, true));
  }
}

export function deactivate() {}

function ensureTerminalVisible() {
  try {
    if (vscode.window.terminals.length === 0) {
      const t = vscode.window.createTerminal({ name: 'Pamir' });
      t.show(true);
    } else {
      vscode.window.terminals[0].show(true);
    }
  } catch (e) {
    console.log('[pamir] ensureTerminalVisible error:', e);
  }
}

function openWelcome(ctx: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'pamirWelcome',
    'Welcome',
    { viewColumn: vscode.ViewColumn.One, preserveFocus: false },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: getLocalResourceRoots(ctx)
    }
  );

  // Set icon for the editor tab
  const iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'icon.png');
  panel.iconPath = iconPath;

  panel.webview.html = getHtml(panel.webview, ctx.extensionUri);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || !msg.command) return;
    try {
      await vscode.commands.executeCommand(msg.command);
    } catch (e) {
      vscode.window.showErrorMessage(`Command failed: ${msg.command}`);
      console.log('[pamir] command failed', msg.command, e);
    }
  });
}

function getHtml(webview: vscode.Webview, extUri: vscode.Uri) {
  const nonce = getNonce();
  const markdownContent = getMarkdownContent(webview, extUri);

  const styles = `
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; }
    .wrap { padding: 24px 28px; }
    h1 { font-weight: 600; margin: 0 0 8px; }
    p  { opacity: .8; margin: 0 0 16px; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 16px; }
    .card { border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 16px; background: var(--vscode-editor-background); }
    .btn { display: inline-block; padding: 8px 12px; border-radius: 4px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; text-decoration: none; }
    .btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .muted { opacity: .7; font-size: 12px; margin-top: 8px; }
    .card h2 { font-size: 16px; margin: 0 0 8px; opacity: .9; }
    .card h3 { font-size: 14px; margin: 12px 0 6px; opacity: .9; }
    .card h4 { font-size: 13px; margin: 10px 0 4px; opacity: .85; }
    .card ul { margin: 8px 0; padding-left: 20px; }
    .card li { margin: 4px 0; opacity: .85; }
    .card blockquote { margin: 10px 0; padding: 8px 12px; border-left: 3px solid var(--vscode-textBlockQuote-border); background: var(--vscode-textBlockQuote-background); opacity: .95; border-radius: 4px; }
    .card pre { margin: 10px 0; padding: 10px 12px; background: var(--vscode-textCodeBlock-background); border-radius: 6px; overflow-x: auto; font-size: 12px; border: 1px solid var(--vscode-widget-border); }
    .card code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 4px; font-size: 12px; }
    .card pre code { background: transparent; padding: 0; }
    .card a { color: var(--vscode-textLink-foreground); }
    .card a:hover { color: var(--vscode-textLink-activeForeground); }
    .card hr { border: none; border-top: 1px solid var(--vscode-widget-border); margin: 16px 0; }
    .card img { display: block; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--vscode-widget-border); margin: 8px 0; }
    .card h2, .card h3 { margin-top: 16px; }
  `;

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                  img-src ${webview.cspSource} https: data: vscode-resource: vscode-webview-resource:;
                  style-src ${webview.cspSource} 'unsafe-inline';
                  script-src ${webview.cspSource} 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Distiller Welcome Page</title>
    <style>${styles}</style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
          ${markdownContent}
        </div>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      addEventListener('click', (e) => {
        const el = e.target.closest('[data-cmd]');
        if (!el) return;
        e.preventDefault();
        vscode.postMessage({ command: el.dataset.cmd });
      });
    </script>
  </body>
  </html>`;

  return html;
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function getMarkdownContent(webview: vscode.Webview, extUri: vscode.Uri): string {
  try {
    const mediaRoot = getMediaRoot(extUri);
    const markdownPath = path.join(mediaRoot.fsPath, 'quick_start.md');
    const content = require('fs').readFileSync(markdownPath, 'utf-8');
    let html: string = marked(content);
    // Prefer inlining local images as data URIs for maximum compatibility
    // across desktop VS Code and code-server. Fallback to asWebviewUri.
    html = html.replace(/<img\s+([^>]*?)src=["'](.*?)["']([^>]*?)>/g,
      (_m: string, pre: string, src: string, post: string) => {
        const inline = tryInlineImage(src, mediaRoot);
        const finalSrc = inline ?? resolveImageSrc(src, webview, mediaRoot);
        return `<img ${pre}src="${finalSrc}"${post}>`;
      }
    );
    return html;
  } catch (e) {
    console.log('[pamir] Failed to read markdown:', e);
    return '<p>Unable to load content.</p>';
  }
}

function getMediaRoot(extUri: vscode.Uri): vscode.Uri {
  try {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (ws) {
      const wsMedia = vscode.Uri.joinPath(ws, 'media');
      const md = path.join(wsMedia.fsPath, 'quick_start.md');
      if (require('fs').existsSync(md)) return wsMedia;
    }
  } catch {}
  return vscode.Uri.joinPath(extUri, 'media');
}

function getLocalResourceRoots(ctx: vscode.ExtensionContext): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(ctx.extensionUri, 'media')];
  try {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (ws) roots.push(vscode.Uri.joinPath(ws, 'media'));
  } catch {}
  return roots;
}

function resolveImageSrc(src: string, webview: vscode.Webview, mediaRoot: vscode.Uri): string {
  try {
    if (!src) return src;
    if (/^(https?:|data:)/i.test(src)) return src;
    let rel = src.replace(/^\/*/, '');
    if (rel.startsWith('./')) rel = rel.slice(2);
    const onDisk = vscode.Uri.joinPath(mediaRoot, rel);
    return webview.asWebviewUri(onDisk).toString();
  } catch {
    return src;
  }
}

function tryInlineImage(src: string, mediaRoot: vscode.Uri): string | null {
  try {
    if (!src || /^(https?:|data:|vscode-)/i.test(src)) return null;
    let rel = src.replace(/^\/*/, '');
    if (rel.startsWith('./')) rel = rel.slice(2);
    const onDisk = path.join(mediaRoot.fsPath, rel);
    const buf = require('fs').readFileSync(onDisk);
    const ext = path.extname(onDisk).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png' :
      ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
      ext === '.gif' ? 'image/gif' :
      ext === '.svg' ? 'image/svg+xml' :
      '';
    if (!mime) return null;
    const b64 = buf.toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}
