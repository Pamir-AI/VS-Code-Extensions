import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LocalSession } from '../types';
import { HappyApiClient } from '../api/client';

export class HappyCliExecutor {
  private cliPath: string | null = null;

  constructor(private apiClient: HappyApiClient) {
    this.detectCliPath();
  }

  /**
   * Detect happy CLI location
   * Priority:
   * 1. User configuration
   * 2. System install location
   * 3. Ask user to configure
   */
  private detectCliPath(): void {
    // Check user config
    const config = vscode.workspace.getConfiguration('happySessions');
    const configuredPath = config.get<string>('cliPath');

    if (configuredPath && fs.existsSync(configuredPath)) {
      this.cliPath = configuredPath;
      return;
    }

    // Check system install
    const systemPath = '/opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs';
    if (fs.existsSync(systemPath)) {
      this.cliPath = systemPath;
      return;
    }

    // Not found - will prompt user later
    this.cliPath = null;
  }

  /**
   * Resume session via Happy API (creates mobile-connected session)
   */
  async resumeSessionInTerminal(session: LocalSession): Promise<void> {
    try {
      // Use Happy's resume API for mobile integration
      await this.apiClient.resumeSession(session.claudeSessionId);
      vscode.window.showInformationMessage(
        `Resuming session ${session.claudeSessionId.slice(0, 8)} via Happy. Check your mobile device.`
      );
    } catch (error: any) {
      // Fallback to vanilla Claude resume if Happy API fails
      vscode.window.showWarningMessage(
        `Happy resume failed: ${error.message}. Falling back to vanilla Claude.`
      );

      const terminal = vscode.window.createTerminal({
        name: `Claude ${session.claudeSessionId.slice(0, 8)}`,
        cwd: session.cwd || undefined,
      });

      terminal.sendText(`claude --resume ${session.claudeSessionId}`);
      terminal.show();
    }
  }

  /**
   * Kill a session by terminating its process using Happy API
   */
  async killSession(session: LocalSession): Promise<void> {
    if (!session.pid) {
      throw new Error('Session has no PID');
    }

    try {
      // Use Happy API for better error handling
      await this.apiClient.killSession(session.claudeSessionId, { signal: 'term' });
    } catch (error: any) {
      // Fallback to CLI if API fails and CLI is available
      if (this.cliPath) {
        vscode.window.showWarningMessage(
          `API kill failed: ${error.message}. Trying CLI fallback.`
        );

        const terminal = vscode.window.createTerminal({
          name: `Kill ${session.claudeSessionId.slice(0, 8)}`,
          cwd: session.cwd || undefined,
        });

        terminal.sendText(
          `node "${this.cliPath}" sessions kill ${session.claudeSessionId}`
        );

        setTimeout(() => terminal.dispose(), 2000);
      } else {
        throw error;
      }
    }
  }

  /**
   * Get CLI path for display
   */
  getCliPath(): string | null {
    return this.cliPath;
  }
}
