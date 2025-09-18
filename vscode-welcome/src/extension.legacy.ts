import * as vscode from 'vscode';

export function activate(ctx: vscode.ExtensionContext) {
  // 0) Ensure a terminal is visible on startup (only if none exist)
  ensureTerminalVisible();

  // 1) Commands used by the Welcome page
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

    // open the custom Welcome on demand
    vscode.commands.registerCommand('pamir.openHome', () => openWelcome(ctx))
  );

  // 2) Show the custom Welcome once per machine
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
      // Optional: seed a command
      // t.sendText('echo "Pamir terminal ready"');
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
    { enableScripts: true, retainContextWhenHidden: true }
  );

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

function getHtml(webview: vscode.Webview, _extUri: vscode.Uri) {
  // Generate a nonce so our inline script passes the CSP
  const nonce = getNonce();

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
  `;

  // Use <button> elements to avoid anchor default navigation
  const html = 
  `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8"/>
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                  img-src ${webview.cspSource} https: data:;
                  style-src ${webview.cspSource} 'unsafe-inline';
                  script-src ${webview.cspSource} 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>Distiller Welcome Page</title>
    <style>${styles}</style>
  </head>
  <body>
    <div class="wrap">
      <h1>Getting Started...</h1>
      <p>Spin up a Distiller CM5 project, clone examples, or open the docs—your fastest path to running code on hardware.</p>

      <div class="grid">
        <div class="card">
          <h3>Start</h3>
          <div class="row">
            <button class="btn" data-cmd="workbench.action.files.newUntitledFile">New File</button>
            <button class="btn secondary" data-cmd="workbench.action.files.openFolder">Open Folder…</button>
            <button class="btn secondary" data-cmd="git.clone">Clone Git Repository…</button>
          </div>
          
          <div class="muted">You can always reopen this page via <b>Pamir: Open Welcome</b>.</div>
        </div>

        <div class="card">
          <h3>Next up</h3>
          <p>Open a folder to begin, or scaffold a project to try the SDK.</p>
          <div class="row" style="margin-top:12px">
            <button class="btn secondary" data-cmd="pamir.openDocs">Open Pamir Docs</button>
          </div>
        </div>
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

