import * as vscode from 'vscode';
import * as path from 'path';
import { LocalSession } from '../types';
import { HappyApiClient } from '../api/client';

// Base class for all tree items
type TreeElement = DirectoryTreeItem | SessionTreeItem;

// Directory group item
export class DirectoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly dirPath: string,
    public readonly sessions: LocalSession[],
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    const dirName = path.basename(dirPath) || dirPath;
    const sessionCount = sessions.length;

    super(dirName, collapsibleState);

    // Tooltip shows full path
    this.tooltip = `${dirPath}\n${sessionCount} session${sessionCount !== 1 ? 's' : ''}`;

    // Description shows session count
    this.description = `${sessionCount} session${sessionCount !== 1 ? 's' : ''}`;

    // Use folder icon
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'directory';
    this.id = `dir:${dirPath}`;
  }
}

// Session item
export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly session: LocalSession,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    const sessionId = session.claudeSessionId.slice(0, 8);

    super(sessionId, collapsibleState);

    this.tooltip = this.createTooltip();
    this.description = this.createDescription();
    this.iconPath = this.getStatusIcon();
    this.contextValue = 'session';

    // Store session ID for commands
    this.id = session.claudeSessionId;
  }

  /**
   * Get engine badge (CL for Claude, CX for Codex)
   */
  private getEngineBadge(): string {
    const aiType = this.session.aiType?.toLowerCase() || '';
    if (aiType === 'codex') {
      return 'CX';
    } else if (aiType === 'claude') {
      return 'CL';
    }
    // Fallback to old logic for backward compatibility
    const command = this.session.command?.toLowerCase() || '';
    if (command.includes('codex')) {
      return 'CX';
    }
    return 'CL';
  }

  /**
   * Get platform icon (device-mobile or device-desktop) with status color
   */
  private getStatusIcon(): vscode.ThemeIcon {
    // Determine platform icon
    const iconId = this.session.happySessionId ? 'device-mobile' : 'device-desktop';

    // Determine status color using both status and sessionStatus
    const status = this.session.status.toLowerCase();
    const sessionStatus = this.session.sessionStatus?.toLowerCase();
    let color: vscode.ThemeColor;

    if (status === 'active' || status === 'happy-active') {
      // Session is running - check if busy or idle
      if (sessionStatus === 'busy') {
        color = new vscode.ThemeColor('terminal.ansiGreen');  // Actively processing
      } else {
        color = new vscode.ThemeColor('terminal.ansiYellow'); // Idle but running
      }
    } else if (status === 'terminated' || status === 'error') {
      color = new vscode.ThemeColor('terminal.ansiRed');
    } else {
      color = new vscode.ThemeColor('foreground');
    }

    return new vscode.ThemeIcon(iconId, color);
  }

  private createTooltip(): string {
    const lastSeen = this.formatLastSeen(this.session.lastSeenAt);
    const engine = this.getEngineBadge() === 'CX' ? 'Codex' : 'Claude';
    const platform = this.session.happySessionId ? 'Happy (Mobile)' : 'Desktop (Vanilla)';

    return [
      `Session: ${this.session.claudeSessionId}`,
      `Platform: ${platform}`,
      `Engine: ${engine}`,
      `Status: ${this.session.status}`,
      `CWD: ${this.session.cwd || 'Unknown'}`,
      `Last seen: ${lastSeen}`,
      this.session.pid ? `PID: ${this.session.pid}` : null,
      this.session.summary ? `Summary: ${this.session.summary}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private createDescription(): string {
    // Format: "CL • [active/busy] • 33m ago"
    const engineBadge = this.getEngineBadge();
    const status = this.session.status;
    const sessionStatus = this.session.sessionStatus;
    const lastSeen = this.formatLastSeen(this.session.lastSeenAt);

    // Show sessionStatus (busy/idle) if session is active
    const displayStatus = (status === 'active' || status === 'happy-active')
      ? `${status}/${sessionStatus}`
      : status;

    return `${engineBadge} • [${displayStatus}] • ${lastSeen}`;
  }

  private formatLastSeen(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) {
      return `${seconds}s ago`;
    }
    if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86400) {
      return `${Math.floor(seconds / 3600)}h ago`;
    }
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private apiClient: HappyApiClient) {}

  /**
   * Refresh tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Get tree item
   */
  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  /**
   * Get children
   */
  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!element) {
      // Root level: return directory groups
      return this.getRootChildren();
    }

    // If element is a directory, return its sessions
    if (element instanceof DirectoryTreeItem) {
      // Sort sessions by lastSeenAt (most recent first)
      const sortedSessions = [...element.sessions].sort((a, b) => b.lastSeenAt - a.lastSeenAt);

      return sortedSessions.map(
        (session) => new SessionTreeItem(session, vscode.TreeItemCollapsibleState.None)
      );
    }

    // Sessions have no children
    return [];
  }

  private async getRootChildren(): Promise<TreeElement[]> {
    try {
      const sessions = await this.apiClient.listSessions({ limit: 100 });

      if (sessions.length === 0) {
        return [this.createEmptyStateItem()];
      }

      // Group sessions by CWD
      const sessionsByDir = new Map<string, LocalSession[]>();

      for (const session of sessions) {
        const cwd = session.cwd || 'Unknown Directory';
        if (!sessionsByDir.has(cwd)) {
          sessionsByDir.set(cwd, []);
        }
        sessionsByDir.get(cwd)!.push(session);
      }

      // Create directory tree items
      const dirItems: DirectoryTreeItem[] = [];

      for (const [dirPath, dirSessions] of sessionsByDir.entries()) {
        // Find most recent session in this directory
        const mostRecentTimestamp = Math.max(...dirSessions.map(s => s.lastSeenAt));

        const dirItem = new DirectoryTreeItem(
          dirPath,
          dirSessions,
          vscode.TreeItemCollapsibleState.Expanded
        );

        // Store timestamp for sorting
        (dirItem as any).mostRecentTimestamp = mostRecentTimestamp;

        dirItems.push(dirItem);
      }

      // Sort directories by most recent session (most recent first)
      dirItems.sort((a, b) => {
        const aTime = (a as any).mostRecentTimestamp || 0;
        const bTime = (b as any).mostRecentTimestamp || 0;
        return bTime - aTime;
      });

      return dirItems;
    } catch (error: any) {
      return [this.createErrorItem(error.message)];
    }
  }

  private createEmptyStateItem(): SessionTreeItem {
    const dummySession: LocalSession = {
      id: 'empty',
      claudeSessionId: 'No sessions found',
      aiType: 'info',
      source: 'info',
      status: 'info',
      sessionStatus: 'idle',
      projectPath: null,
      jsonlPath: null,
      cwd: null,
      summary: null,
      pid: null,
      command: null,
      happySessionId: null,
      happySessionTag: null,
      startedAt: null,
      jsonlCreateTime: null,
      jsonlUpdateTime: null,
      revision: 0,
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const item = new SessionTreeItem(
      dummySession,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = 'empty';
    item.command = undefined;
    return item;
  }

  private createErrorItem(message: string): SessionTreeItem {
    const dummySession: LocalSession = {
      id: 'error',
      claudeSessionId: 'Error loading sessions',
      aiType: 'error',
      source: 'error',
      status: 'error',
      sessionStatus: 'idle',
      projectPath: null,
      jsonlPath: null,
      cwd: null,
      summary: message,
      pid: null,
      command: null,
      happySessionId: null,
      happySessionTag: null,
      startedAt: null,
      jsonlCreateTime: null,
      jsonlUpdateTime: null,
      revision: 0,
      lastSeenAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const item = new SessionTreeItem(
      dummySession,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = 'error';
    item.iconPath = new vscode.ThemeIcon('error');
    return item;
  }
}
