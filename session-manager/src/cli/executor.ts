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
   * Resume session in integrated terminal
   * For Happy sessions: kills active session on phone first, then resumes locally
   * For vanilla sessions: resumes directly
   * Always uses `claude` CLI to run locally in terminal (not happy CLI which forces remote mode)
   */
  async resumeSessionInTerminal(session: LocalSession): Promise<void> {
    const sessionIdShort = session.claudeSessionId.slice(0, 8);
    const isHappySession = !!session.happySessionId;
    const isActive = session.status === 'active' || session.status === 'happy-active';

    // If it's an active Happy session, kill it first
    if (isHappySession && isActive && session.pid) {
      try {
        vscode.window.showInformationMessage(
          `Moving session ${sessionIdShort} from phone to VS Code...`
        );

        await this.killSessionSilently(session);

        vscode.window.showInformationMessage(
          `Session ${sessionIdShort} terminated. Ready to resume locally.`
        );
      } catch (error: any) {
        vscode.window.showWarningMessage(
          `Failed to kill active session: ${error.message}. Attempting to resume anyway.`
        );
      }
    }

    // Create terminal for resume
    const terminal = vscode.window.createTerminal({
      name: `Claude ${sessionIdShort}`,
      cwd: session.cwd || undefined,
    });

    // Always use vanilla Claude CLI to run locally in terminal
    // (happy CLI forces remote/daemon mode which isn't what we want here)
    terminal.sendText(`claude --resume ${session.claudeSessionId}`);
    terminal.show();

    vscode.window.showInformationMessage(
      `Resuming session ${sessionIdShort} in terminal`
    );
  }

  /**
   * Kill session silently (no user confirmation or messages)
   * Used internally when switching session location
   *
   * Complete flow to move Happy session to local terminal:
   * 1. Kill phone process with targetPid
   * 2. Poll until PID is cleared
   * 3. Clear Happy metadata (happySessionId, happySessionTag) via upsert
   * 4. Now ready for vanilla claude resume in terminal
   */
  private async killSessionSilently(session: LocalSession): Promise<void> {
    const targetPid = session.pid;
    if (!targetPid) {
      throw new Error('Session has no PID to kill');
    }

    // Step 1: Kill the specific PID using Happy API
    await this.apiClient.killSession(session.claudeSessionId, {
      signal: 'term',
      targetPid: targetPid
    });

    // Step 2: Poll until session PID is cleared
    await this.apiClient.pollSession(
      session.claudeSessionId,
      (s) => s.pid === null || s.status === 'terminated',
      { timeout: 10000, interval: 500 }
    );

    // Step 3: Clear Happy metadata so vanilla claude doesn't inherit phone linkage
    await this.apiClient.clearHappyMetadata(session.claudeSessionId);
  }

  /**
   * Kill a session by terminating its process
   * Uses same logic as resume button for consistency:
   * 1. Kill with targetPid
   * 2. Poll until PID cleared
   * 3. Clear Happy metadata if it's a Happy session
   */
  async killSession(session: LocalSession): Promise<void> {
    if (!session.pid) {
      throw new Error('Session has no PID');
    }

    const targetPid = session.pid;
    const isHappySession = !!session.happySessionId;

    // Step 1: Kill the specific PID using Happy API
    await this.apiClient.killSession(session.claudeSessionId, {
      signal: 'term',
      targetPid: targetPid
    });

    // Step 2: Poll until session PID is cleared
    await this.apiClient.pollSession(
      session.claudeSessionId,
      (s) => s.pid === null || s.status === 'terminated',
      { timeout: 10000, interval: 500 }
    );

    // Step 3: If it was a Happy session, clear metadata for consistency
    if (isHappySession) {
      await this.apiClient.clearHappyMetadata(session.claudeSessionId);
    }
  }

  /**
   * Get CLI path for display
   */
  getCliPath(): string | null {
    return this.cliPath;
  }
}
