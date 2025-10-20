# VS Code Extension: Phase 1 Implementation Brief

## For the Coding Agent

You are implementing a VS Code extension that displays Claude sessions and enables resuming them via the happy-cli system.

**Read these documents first**:
1. `vscode-extension-design.md` - Complete architecture and design
2. `api-vs-cli-analysis.md` - Deep understanding of API vs CLI usage

## Important Installation Context

**System Setup**:
- All target devices have this repository installed at `/opt/claude-code-web-manager`
- happy-server runs at `http://127.0.0.1:3005` (started by main `claude-code-web-manager` service)
- happy-cli is available at `/opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs`
- Main systemd service (`claude-code-web-manager.service`) spawns happy-server and daemon
- Session monitor systemd service (`happy-sessions-monitor@distiller.service`) runs in background:
  - Watches `~/.claude/projects/*.jsonl` files every 5 seconds
  - Scans `/proc` for running Claude processes
  - Updates session status in happy-server API automatically
  - This is why your extension can just query the API and get fresh session data!

**Extension Distribution**:
- Extension will be packaged as `.vsix` file
- Stored in repository's `extensions/` folder (source)
- Installed to `/usr/share/claude-code-web-manager/extensions/` via .deb package
- Users install to their VS Code from there (manual or scripted)

**Extension should NOT**:
- ❌ Bundle or install happy-cli (already on system)
- ❌ Bundle or install happy-server (already running)
- ❌ Start/stop happy-server (managed by main service)
- ❌ Start/stop session monitor (managed by systemd)
- ✅ Just call the system-installed happy-cli for actions
- ✅ Query the happy-server API for session data (always available)

## Phase 1 Goal: Working MVP

Build a minimal working extension that:
- ✅ Shows Claude sessions in VS Code sidebar
- ✅ Allows resuming sessions in integrated terminal
- ✅ Refreshes session list manually
- ✅ Handles basic errors gracefully

**DO NOT implement** (save for later phases):
- ❌ Auto-refresh
- ❌ WebSocket integration
- ❌ Multiple grouping modes
- ❌ Advanced filtering
- ❌ Status bar integration
- ❌ Webview panels

## Step-by-Step Implementation

### Step 1: Scaffold the Extension

**Task**: Create VS Code extension structure using Yeoman

**NOTE**: User has already run `yo code` to create the scaffolding. Verify the structure exists:

```bash
# Check if extension folder exists
ls -la happy-session-manager/

# Should contain:
# - package.json
# - tsconfig.json
# - src/extension.ts
# - node_modules/ (if npm install was run)
```

If scaffolding doesn't exist, create it:
```bash
yo code
# Choose:
# - New Extension (TypeScript)
# - Extension name: happy-session-manager
# - Identifier: happy-session-manager
# - Description: Manage Happy Claude sessions from VS Code
# - Initialize git: No (already in parent repo)
# - Package manager: npm
```

**Verification**: Extension folder created with basic structure

---

### Step 2: Install Dependencies

**Task**: Add required npm packages

```bash
cd happy-session-manager
npm install axios zod
npm install --save-dev @types/node
```

**Files to create**:

`tsconfig.json` (update if needed):
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

**Verification**: Dependencies installed, no errors

---

### Step 3: Define TypeScript Types

**Task**: Create type definitions matching happy-cli API

**File**: `src/types.ts`

```typescript
/**
 * Copy these types from happy-cli's API responses
 * See: services/happy-cli/src/api/types.ts
 */

export interface LocalSession {
  id: string;
  claudeSessionId: string;
  type: string;
  status: string;
  projectPath: string | null;
  transcriptPath: string | null;
  cwd: string | null;
  summary: string | null;
  pid: number | null;
  command: string | null;
  happySessionId: string | null;
  happySessionTag: string | null;
  startedAt: number | null;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
  busy?: boolean | null;
  recentWrites?: boolean | null;
  lastWriteAt?: number | null;
  cpuBusy?: boolean | null;
}

export interface LocalSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: {
    type: 'text';
    text: string;
  };
  createdAt: number;
}

export interface ApiResponse<T> {
  sessions?: T[];
  messages?: T[];
  error?: string;
}
```

**Verification**: Types compile without errors

---

### Step 4: Create API Client

**Task**: Implement HTTP client for happy-server API

**File**: `src/api/client.ts`

```typescript
import axios, { AxiosInstance } from 'axios';
import { LocalSession, LocalSessionMessage, ApiResponse } from '../types';

export class HappyApiClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:3005') {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * List all local Claude sessions
   * GET /v1/local-sessions
   */
  async listSessions(options?: {
    limit?: number;
    claudeSessionId?: string;
  }): Promise<LocalSession[]> {
    try {
      const response = await this.client.get<ApiResponse<LocalSession>>(
        '/v1/local-sessions',
        { params: options }
      );

      return response.data.sessions || [];
    } catch (error: any) {
      console.error('Failed to fetch sessions:', error.message);
      throw new Error(`Cannot connect to Happy server at ${this.baseUrl}`);
    }
  }

  /**
   * Get messages for a specific session
   * GET /v1/local-sessions/:id/messages
   */
  async getSessionMessages(
    claudeSessionId: string,
    limit?: number
  ): Promise<LocalSessionMessage[]> {
    try {
      const response = await this.client.get<ApiResponse<LocalSessionMessage>>(
        `/v1/local-sessions/${encodeURIComponent(claudeSessionId)}/messages`,
        { params: { limit } }
      );

      return response.data.messages || [];
    } catch (error: any) {
      console.error('Failed to fetch messages:', error.message);
      throw new Error(`Cannot load transcript for session ${claudeSessionId}`);
    }
  }

  /**
   * Update base URL (from settings)
   */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
    this.client.defaults.baseURL = url;
  }
}
```

**Verification**: File compiles without errors

---

### Step 5: Create CLI Executor

**Task**: Implement CLI command executor for happy-cli

**File**: `src/cli/executor.ts`

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LocalSession } from '../types';

export class HappyCliExecutor {
  private cliPath: string | null = null;

  constructor() {
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
   * Resume session in integrated terminal (local mode)
   */
  async resumeSessionInTerminal(session: LocalSession): Promise<void> {
    if (!this.cliPath) {
      const action = await vscode.window.showErrorMessage(
        'Happy CLI not found. Please configure the path.',
        'Open Settings'
      );
      if (action === 'Open Settings') {
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'happySessions.cliPath'
        );
      }
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: `Claude ${session.claudeSessionId.slice(0, 8)}`,
      cwd: session.cwd || undefined,
    });

    // Send resume command
    terminal.sendText(
      `node "${this.cliPath}" sessions resume ${session.claudeSessionId} --local`
    );

    terminal.show();
  }

  /**
   * Get CLI path for display
   */
  getCliPath(): string | null {
    return this.cliPath;
  }
}
```

**Verification**: File compiles without errors

---

### Step 6: Create Tree Data Provider

**Task**: Implement VS Code TreeDataProvider for sessions

**File**: `src/tree/provider.ts`

```typescript
import * as vscode from 'vscode';
import { LocalSession } from '../types';
import { HappyApiClient } from '../api/client';

export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly session: LocalSession,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(
      `${session.claudeSessionId.slice(0, 8)} [${session.status}]`,
      collapsibleState
    );

    this.tooltip = this.createTooltip();
    this.description = this.createDescription();
    this.iconPath = this.getIcon();
    this.contextValue = 'session';

    // Store session ID for commands
    this.id = session.claudeSessionId;
  }

  private createTooltip(): string {
    const lastSeen = this.formatLastSeen(this.session.lastSeenAt);
    return [
      `Session: ${this.session.claudeSessionId}`,
      `Status: ${this.session.status}`,
      `CWD: ${this.session.cwd || 'Unknown'}`,
      `Last seen: ${lastSeen}`,
      this.session.summary ? `Summary: ${this.session.summary}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private createDescription(): string {
    const lastSeen = this.formatLastSeen(this.session.lastSeenAt);
    return lastSeen;
  }

  private getIcon(): vscode.ThemeIcon {
    const status = this.session.status.toLowerCase();

    if (status === 'active' || status === 'happy-active') {
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('terminal.ansiGreen'));
    }
    if (status === 'idle') {
      return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('terminal.ansiYellow'));
    }
    if (status === 'terminated') {
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('terminal.ansiRed'));
    }

    return new vscode.ThemeIcon('circle-outline');
  }

  private formatLastSeen(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | null>();
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
  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children (root level = sessions)
   */
  async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
    if (element) {
      // No children for individual sessions in Phase 1
      return [];
    }

    try {
      const sessions = await this.apiClient.listSessions({ limit: 50 });

      if (sessions.length === 0) {
        // Show empty state message
        return [this.createEmptyStateItem()];
      }

      // Sort by last seen (most recent first)
      sessions.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

      return sessions.map(
        (session) =>
          new SessionTreeItem(session, vscode.TreeItemCollapsibleState.None)
      );
    } catch (error: any) {
      // Show error state
      return [this.createErrorItem(error.message)];
    }
  }

  private createEmptyStateItem(): SessionTreeItem {
    const dummySession: LocalSession = {
      id: 'empty',
      claudeSessionId: 'No sessions found',
      type: 'info',
      status: 'info',
      projectPath: null,
      transcriptPath: null,
      cwd: null,
      summary: null,
      pid: null,
      command: null,
      happySessionId: null,
      happySessionTag: null,
      startedAt: null,
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
      type: 'error',
      status: 'error',
      projectPath: null,
      transcriptPath: null,
      cwd: null,
      summary: message,
      pid: null,
      command: null,
      happySessionId: null,
      happySessionTag: null,
      startedAt: null,
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
```

**Verification**: File compiles without errors

---

### Step 7: Create Extension Entry Point

**Task**: Wire everything together in main extension file

**File**: `src/extension.ts`

```typescript
import * as vscode from 'vscode';
import { HappyApiClient } from './api/client';
import { HappyCliExecutor } from './cli/executor';
import { SessionTreeProvider } from './tree/provider';

let apiClient: HappyApiClient;
let cliExecutor: HappyCliExecutor;
let treeProvider: SessionTreeProvider;
let treeView: vscode.TreeView<any>;

export function activate(context: vscode.ExtensionContext) {
  console.log('Happy Session Manager extension is now active');

  // Read configuration
  const config = vscode.workspace.getConfiguration('happySessions');
  const serverUrl = config.get<string>('serverUrl') || 'http://127.0.0.1:3005';

  // Initialize components
  apiClient = new HappyApiClient(serverUrl);
  cliExecutor = new HappyCliExecutor();
  treeProvider = new SessionTreeProvider(apiClient);

  // Register tree view
  treeView = vscode.window.createTreeView('happySessions', {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  // Register commands
  registerCommands(context);

  // Show welcome message
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

function registerCommands(context: vscode.ExtensionContext) {
  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.refresh', () => {
      treeProvider.refresh();
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

  // Open settings command
  context.subscriptions.push(
    vscode.commands.registerCommand('happySessions.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'happySessions');
    })
  );
}

export function deactivate() {
  console.log('Happy Session Manager extension is now deactivated');
}
```

**Verification**: File compiles without errors

---

### Step 8: Configure package.json

**Task**: Define extension metadata, commands, and configuration

**File**: `package.json` (merge with generated file)

```json
{
  "name": "happy-session-manager",
  "displayName": "Happy Session Manager",
  "description": "Manage Happy Claude sessions from VS Code",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.80.0"
  },
  "categories": ["Other"],
  "activationEvents": ["onView:happySessions"],
  "main": "./out/extension.js",
  "contributes": {
    "configuration": {
      "title": "Happy Sessions",
      "properties": {
        "happySessions.serverUrl": {
          "type": "string",
          "default": "http://127.0.0.1:3005",
          "description": "Happy server URL for API requests"
        },
        "happySessions.cliPath": {
          "type": "string",
          "default": "",
          "description": "Path to happy CLI binary (auto-detected if empty)"
        }
      }
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "happy-sessions-container",
          "title": "Happy Sessions",
          "icon": "resources/icon.svg"
        }
      ]
    },
    "views": {
      "happy-sessions-container": [
        {
          "id": "happySessions",
          "name": "Claude Sessions"
        }
      ]
    },
    "commands": [
      {
        "command": "happySessions.refresh",
        "title": "Refresh Sessions",
        "icon": "$(refresh)"
      },
      {
        "command": "happySessions.resumeSession",
        "title": "Resume Session"
      },
      {
        "command": "happySessions.copySessionId",
        "title": "Copy Session ID"
      },
      {
        "command": "happySessions.openDirectory",
        "title": "Open in Explorer"
      },
      {
        "command": "happySessions.openSettings",
        "title": "Open Happy Sessions Settings"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "happySessions.refresh",
          "when": "view == happySessions",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "happySessions.resumeSession",
          "when": "view == happySessions && viewItem == session",
          "group": "inline"
        },
        {
          "command": "happySessions.copySessionId",
          "when": "view == happySessions && viewItem == session"
        },
        {
          "command": "happySessions.openDirectory",
          "when": "view == happySessions && viewItem == session"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.80.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "zod": "^3.22.0"
  }
}
```

**Verification**: package.json is valid JSON

---

### Step 9: Create Icon (Optional)

**Task**: Add a simple icon for the sidebar

**File**: `resources/icon.svg`

```svg
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
  <path d="M8 12h8M12 8v8" stroke="currentColor" stroke-width="2"/>
</svg>
```

**Verification**: Icon displays in sidebar

---

### Step 10: Build and Test

**Task**: Compile TypeScript and test in VS Code

```bash
# Compile
npm run compile

# Test (press F5 in VS Code)
# This opens Extension Development Host
```

**Manual testing checklist**:
- [ ] Extension loads without errors
- [ ] Sidebar view appears under Happy Sessions icon
- [ ] Sessions list loads (or shows "No sessions" if none exist)
- [ ] Right-click on session shows context menu
- [ ] "Resume Session" opens integrated terminal with happy command
- [ ] "Copy Session ID" copies to clipboard
- [ ] "Refresh" button reloads session list
- [ ] Error message shows if server is not running

**Verification**: All checks pass

---

## Troubleshooting Common Issues

### Issue: "Cannot connect to Happy server"

**Check**:
1. Is happy-server running? `systemctl status happy-server` or check port 3005
2. Is server URL correct in settings? Check `happySessions.serverUrl`
3. Try: `curl http://127.0.0.1:3005/v1/local-sessions`

**Fix**:
- Start happy-server if not running
- Update server URL in VS Code settings

---

### Issue: "Happy CLI not found"

**Check**:
1. Does file exist? `ls /opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs`
2. Is custom path set in settings?

**Fix**:
- Set `happySessions.cliPath` to correct location
- Or install happy-cli to system location

---

### Issue: Sessions list is empty

**Check**:
1. Is session monitor running? `systemctl status happy-sessions-monitor@distiller`
2. Are there any Claude sessions? Check `~/.claude/projects/`
3. Try running: `node /path/to/happy.mjs sessions list`

**Fix**:
- Start session monitor
- Create a Claude session to test with

---

### Issue: TypeScript compilation errors

**Check**:
1. All dependencies installed? `npm install`
2. TypeScript version? `npx tsc --version` (should be 5.x)

**Fix**:
- Delete `node_modules` and `package-lock.json`
- Run `npm install` again
- Check tsconfig.json settings

---

## Acceptance Criteria

Phase 1 is complete when:

- [x] Extension installs and activates without errors
- [x] Sidebar view shows list of Claude sessions
- [x] Clicking "Refresh" updates the session list
- [x] Right-clicking a session shows context menu with actions
- [x] "Resume Session" opens integrated terminal with happy-cli command
- [x] Session resumes successfully and user can interact with Claude
- [x] "Copy Session ID" works
- [x] Error handling works (shows message when server is down)
- [x] Settings page allows configuring server URL and CLI path

## Next Steps (After Phase 1)

Once Phase 1 is working, you can add:

**Phase 2**:
- Auto-refresh every 5 seconds
- Status bar showing session count
- Session grouping by status

**Phase 3**:
- Preview transcript in output channel
- Kill session command
- Open in external terminal option

**Phase 4**:
- WebSocket for real-time updates
- Advanced filtering
- Session search

---

## Key Reference Files

When implementing, refer to these files in the happy-cli codebase:

**Type definitions**:
- `services/happy-cli/src/api/types.ts` - LocalSession type

**API examples**:
- `services/happy-cli/src/api/api.ts` - ApiClient implementation
- `services/happy-client/sources/sync/sync.ts` - Mobile client API usage

**CLI examples**:
- `services/happy-cli/src/index.ts` - CLI commands (sessions list, resume, etc.)

**Configuration**:
- `services/happy-cli/src/configuration.ts` - Server URL and paths

---

## Final Notes

**Keep it simple**: Phase 1 should be ~500 lines of code total
**Test frequently**: Press F5 to test after each step
**Handle errors**: Show user-friendly messages, don't crash
**Follow patterns**: Look at VS Code extension samples for best practices

Good luck! 🚀
