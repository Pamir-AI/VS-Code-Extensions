import * as vscode from 'vscode';
import { HappyApiClient } from './api/client';
import { HappyCliExecutor } from './cli/executor';
import { SessionTreeProvider } from './tree/provider';

let apiClient: HappyApiClient;
let cliExecutor: HappyCliExecutor;
let treeProvider: SessionTreeProvider;
let treeView: vscode.TreeView<any>;
let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  console.log('Happy Session Manager extension is now active');

  // Read configuration
  const config = vscode.workspace.getConfiguration('happySessions');
  const serverUrl = config.get<string>('serverUrl') || 'http://127.0.0.1:3005';
  const authToken = config.get<string>('authToken') || '';

  // Initialize components
  apiClient = new HappyApiClient(serverUrl, authToken);
  cliExecutor = new HappyCliExecutor(apiClient);
  treeProvider = new SessionTreeProvider(apiClient);

  // Create output channel
  outputChannel = vscode.window.createOutputChannel('Happy Sessions');
  context.subscriptions.push(outputChannel);

  // Register tree view
  treeView = vscode.window.createTreeView('happySessions', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'happySessions.refresh';
  context.subscriptions.push(statusBarItem);
  statusBarItem.show();

  // Register commands
  registerCommands(context);

  // Setup auto-refresh
  setupAutoRefresh();

  // Initial refresh and status update
  refreshAndUpdateStatus();

  // Show welcome message if CLI not found
  const cliPath = cliExecutor.getCliPath();
  if (!cliPath) {
    vscode.window.showWarningMessage(
      'Happy CLI not found. Some features may not work. Configure path in settings.',
      'Open Settings'
    ).then((action) => {
      if (action === 'Open Settings') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'happySessions.cliPath'
        );
      }
    });
  }
}

function setupAutoRefresh() {
  // Clear existing timer if any
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  // Setup auto-refresh every 5 seconds
  refreshTimer = setInterval(() => {
    refreshAndUpdateStatus();
  }, 5000);
}

async function refreshAndUpdateStatus() {
  try {
    // Refresh tree view
    treeProvider.refresh();

    // Update status bar
    const sessions = await apiClient.listSessions({ limit: 100 });
    const activeCount = sessions.filter(s =>
      s.status.toLowerCase() === 'active' || s.status.toLowerCase() === 'happy-active'
    ).length;

    if (activeCount > 0) {
      statusBarItem.text = `$(pulse) ${activeCount} Active Session${activeCount !== 1 ? 's' : ''}`;
      statusBarItem.tooltip = `${sessions.length} total sessions`;
    } else {
      statusBarItem.text = `$(circle-outline) ${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`;
      statusBarItem.tooltip = 'No active sessions';
    }
  } catch (error) {
    statusBarItem.text = `$(error) Happy Sessions`;
    statusBarItem.tooltip = 'Cannot connect to happy-server';
  }
}

function registerCommands(context: vscode.ExtensionContext) {
  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.refresh', () => {
      refreshAndUpdateStatus();
    })
  );

  // Resume session command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.resumeSession', async (item) => {
      if (!item || !item.session) {
        vscode.window.showErrorMessage('No session selected');
        return;
      }

      await cliExecutor.resumeSessionInTerminal(item.session);
    })
  );

  // Copy session ID command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.copySessionId', async (item) => {
      if (!item || !item.session) {
        vscode.window.showErrorMessage('No session selected');
        return;
      }

      await vscode.env.clipboard.writeText(item.session.claudeSessionId);
      vscode.window.showInformationMessage('Session ID copied to clipboard');
    })
  );

  // Open session directory command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.openDirectory', async (item) => {
      if (!item || !item.session || !item.session.cwd) {
        vscode.window.showErrorMessage('No working directory available');
        return;
      }

      const uri = vscode.Uri.file(item.session.cwd);
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
    })
  );

  // Preview transcript command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.previewTranscript', async (item) => {
      if (!item || !item.session) {
        vscode.window.showErrorMessage('No session selected');
        return;
      }

      try {
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine(`=== Transcript for Session ${item.session.claudeSessionId} ===\n`);

        const messages = await apiClient.getSessionMessages(item.session.claudeSessionId, 50);

        if (messages.length === 0) {
          outputChannel.appendLine('No messages found in transcript.');
          return;
        }

        for (const msg of messages) {
          const timestamp = new Date(msg.createdAt).toLocaleString();
          const role = msg.role.toUpperCase();
          outputChannel.appendLine(`[${timestamp}] ${role}:`);
          outputChannel.appendLine(msg.content.text);
          outputChannel.appendLine('');
        }

        outputChannel.appendLine(`\n=== End of transcript (showing last ${messages.length} messages) ===`);
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to load transcript: ${error.message}`);
      }
    })
  );

  // Kill session command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.killSession', async (item) => {
      if (!item || !item.session) {
        vscode.window.showErrorMessage('No session selected');
        return;
      }

      const sessionId = item.session.claudeSessionId.slice(0, 8);
      const result = await vscode.window.showWarningMessage(
        `Are you sure you want to kill session ${sessionId}?`,
        { modal: true },
        'Kill Session'
      );

      if (result === 'Kill Session') {
        try {
          await cliExecutor.killSession(item.session);
          vscode.window.showInformationMessage(`Session ${sessionId} killed`);
          refreshAndUpdateStatus();
        } catch (error: any) {
          vscode.window.showErrorMessage(`Failed to kill session: ${error.message}`);
        }
      }
    })
  );

  // Open settings command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'happySessions');
    })
  );
}

export function deactivate() {
  // Clean up timer
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  console.log('Happy Session Manager extension is now deactivated');
}
