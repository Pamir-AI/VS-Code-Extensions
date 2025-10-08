# VS Code Extension Design: Happy Claude Session Manager

## Executive Summary

A VS Code extension that integrates with the happy-cli to display active Claude sessions and enable on-demand session resumption directly from the VS Code interface. The extension will leverage the existing happy-server REST API and happy-cli commands to provide a seamless session management experience.

## Goals

1. **Session Visibility**: Display all tracked Claude sessions in VS Code's sidebar
2. **Quick Resume**: Allow users to resume sessions with a single click
3. **Status Awareness**: Show real-time session status (active, idle, busy, terminated)
4. **Context Integration**: Navigate to session working directories
5. **Minimal Overhead**: Use existing happy-cli infrastructure without reimplementation

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│         VS Code Extension Host                   │
│  ┌───────────────────────────────────────────┐  │
│  │   Happy Session Manager Extension         │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────┐    │  │
│  │  │  Session Tree View Provider      │    │  │
│  │  │  - Refresh sessions              │    │  │
│  │  │  - Display hierarchical tree     │    │  │
│  │  │  - Handle user interactions      │    │  │
│  │  └──────────────────────────────────┘    │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────┐    │  │
│  │  │  Happy API Client                │    │  │
│  │  │  - HTTP REST calls               │    │  │
│  │  │  - Session data fetching         │    │  │
│  │  │  - Error handling                │    │  │
│  │  └──────────────────────────────────┘    │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────┐    │  │
│  │  │  CLI Executor                    │    │  │
│  │  │  - Spawn happy-cli processes     │    │  │
│  │  │  - Parse command output          │    │  │
│  │  │  - Handle terminal integration   │    │  │
│  │  └──────────────────────────────────┘    │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────┐    │  │
│  │  │  Configuration Manager           │    │  │
│  │  │  - Extension settings            │    │  │
│  │  │  - Server URL configuration      │    │  │
│  │  │  - Auto-refresh intervals        │    │  │
│  │  └──────────────────────────────────┘    │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                      │
                      │ HTTP REST API
                      ▼
┌─────────────────────────────────────────────────┐
│              happy-server                        │
│         (http://127.0.0.1:3005)                 │
│                                                  │
│  GET  /v1/local-sessions                        │
│  POST /v1/local-sessions/:id/resume             │
│  GET  /v1/local-sessions/:id/messages           │
└─────────────────────────────────────────────────┘
                      │
                      │ Managed by
                      ▼
┌─────────────────────────────────────────────────┐
│         Session Monitor (systemd)                │
│      Watches ~/.claude/projects/*.jsonl         │
└─────────────────────────────────────────────────┘
```

## Integration Strategy: API-First Approach

**Key Decision**: Use happy-server REST API directly instead of spawning CLI commands for data fetching.

### Why API-First?

1. **Performance**: Direct HTTP calls are faster than spawning Node processes
2. **Type Safety**: API returns JSON that can be strongly typed
3. **Real-time**: Can poll API efficiently without subprocess overhead
4. **Reliability**: No need to parse console output or handle CLI formatting changes
5. **Consistency**: Same data source as mobile client

### When to Use CLI

Use `happy-cli` commands ONLY for actions that require:
- Terminal integration (resuming sessions in user's shell)
- Authentication flows
- Configuration changes

## Core Components

### 1. Session Tree View Provider

**Responsibility**: Display sessions in VS Code's Explorer sidebar

**Tree Structure**:
```
Happy Claude Sessions
├── 📁 Active Sessions (3)
│   ├── 🟢 Session abc-123 [busy]
│   │   ├── 📂 /home/user/project-a
│   │   ├── 🕐 Last seen: 2s ago
│   │   └── 🔄 Resume Session
│   ├── 🟡 Session def-456 [idle]
│   │   ├── 📂 /home/user/project-b
│   │   ├── 🕐 Last seen: 5m ago
│   │   └── 🔄 Resume Session
│   └── 🟢 Session ghi-789 [active]
│       ├── 📂 /home/user/project-c
│       ├── 🕐 Last seen: 1m ago
│       └── 🔄 Resume Session
├── 📁 Idle Sessions (2)
│   └── ...
└── 📁 Terminated Sessions (5)
    └── ...
```

**Key Methods**:
- `getChildren()`: Fetch and organize sessions
- `getTreeItem()`: Convert session data to TreeItem
- `refresh()`: Reload session data from API

**Data Model**:
```typescript
interface SessionTreeItem {
  type: 'group' | 'session' | 'action';
  label: string;
  claudeSessionId?: string;
  status?: string;
  cwd?: string;
  lastSeenAt?: number;
  busy?: boolean;
  iconPath?: vscode.ThemeIcon;
}
```

### 2. Happy API Client

**Responsibility**: Direct communication with happy-server

**Implementation Approach**:
```typescript
class HappyApiClient {
  private baseUrl: string;
  private timeout: number = 5000;

  async listLocalSessions(options?: {
    limit?: number;
    status?: string;
  }): Promise<LocalSession[]> {
    // Direct HTTP GET to /v1/local-sessions
    // Use axios or native fetch
    // Parse response with Zod schema validation
  }

  async getSessionDetails(claudeSessionId: string): Promise<LocalSession | null> {
    // GET /v1/local-sessions with filter
  }

  async resumeSession(claudeSessionId: string): Promise<void> {
    // POST /v1/local-sessions/:id/resume
  }

  async getSessionMessages(
    claudeSessionId: string,
    limit?: number
  ): Promise<LocalSessionMessage[]> {
    // GET /v1/local-sessions/:id/messages
  }
}
```

**Configuration**:
- Read `HAPPY_SERVER_URL` from environment or extension settings
- Default: `http://127.0.0.1:3005`
- Configurable via VS Code settings: `happySessions.serverUrl`

**Error Handling**:
- Connection failures → Show "Cannot connect to Happy server" message
- Timeout → Retry with exponential backoff
- Authentication errors → Check if happy-server is running

### 3. CLI Executor

**Responsibility**: Execute happy-cli commands for terminal-based actions

**Use Cases**:
1. Resume session in integrated terminal
2. Kill session
3. Preview transcript in output channel

**Implementation**:
```typescript
class HappyCliExecutor {
  private cliPath: string;

  constructor() {
    // Detect happy CLI location:
    // 1. Check extension configuration
    // 2. Check /opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs
    // 3. Check `which happy`
    // 4. Fallback to asking user
  }

  async resumeSessionInTerminal(
    claudeSessionId: string,
    cwd: string
  ): Promise<void> {
    // Create new integrated terminal
    const terminal = vscode.window.createTerminal({
      name: `Claude Session ${claudeSessionId.slice(0, 8)}`,
      cwd: cwd
    });

    // Send resume command
    terminal.sendText(
      `node ${this.cliPath} sessions resume ${claudeSessionId} --local`
    );
    terminal.show();
  }

  async killSession(claudeSessionId: string): Promise<void> {
    // Execute: happy sessions kill <uuid>
    // Show confirmation dialog first
  }

  async previewTranscript(claudeSessionId: string): Promise<string> {
    // Execute: happy sessions preview <uuid> --limit 50
    // Parse output and display in Output Channel
  }
}
```

### 4. Configuration Manager

**Extension Settings** (`package.json` contribution):

```json
{
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
      },
      "happySessions.refreshInterval": {
        "type": "number",
        "default": 5000,
        "description": "Auto-refresh interval in milliseconds (0 to disable)"
      },
      "happySessions.showTerminatedSessions": {
        "type": "boolean",
        "default": false,
        "description": "Show terminated sessions in the tree view"
      },
      "happySessions.groupBy": {
        "type": "string",
        "enum": ["status", "cwd", "time"],
        "default": "status",
        "description": "How to group sessions in tree view"
      },
      "happySessions.enableNotifications": {
        "type": "boolean",
        "default": true,
        "description": "Show notifications for session events"
      }
    }
  }
}
```

## User Interactions & Commands

### VS Code Commands

Register these commands in `package.json`:

```json
{
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
      "command": "happySessions.openSessionDirectory",
      "title": "Open in Explorer"
    },
    {
      "command": "happySessions.previewTranscript",
      "title": "Preview Transcript"
    },
    {
      "command": "happySessions.killSession",
      "title": "Kill Session"
    },
    {
      "command": "happySessions.copySessionId",
      "title": "Copy Session ID"
    },
    {
      "command": "happySessions.openSettings",
      "title": "Open Happy Sessions Settings"
    }
  ]
}
```

### Context Menu Actions

When user right-clicks on a session:
- **Resume Session** → Opens in integrated terminal with happy CLI
- **Open in Explorer** → Opens working directory in VS Code
- **Preview Transcript** → Shows messages in Output Channel
- **Copy Session ID** → Copies Claude session UUID
- **Kill Session** → Terminates the process (with confirmation)

### Status Bar Integration

Show current session count in status bar:
```
$(pulse) 3 Active Sessions
```

Click to:
- Open tree view
- Quick pick to jump to session

## Data Flow

### Session List Refresh Flow

```
1. User opens VS Code / Timer triggers
   ↓
2. TreeDataProvider.refresh() called
   ↓
3. HappyApiClient.listLocalSessions()
   ↓
4. HTTP GET http://127.0.0.1:3005/v1/local-sessions
   ↓
5. Parse response with Zod schema
   ↓
6. Transform to SessionTreeItem[]
   ↓
7. Group by status/cwd/time (based on config)
   ↓
8. Update tree view
   ↓
9. Update status bar count
```

### Resume Session Flow

```
1. User clicks "Resume Session" on tree item
   ↓
2. Show quick pick: "Resume in Terminal" | "Resume in Background"
   ↓
3a. Terminal Mode:
    └─> CLIExecutor.resumeSessionInTerminal()
        └─> Create integrated terminal
        └─> Send: node .../happy.mjs sessions resume <uuid> --local
        └─> Terminal shows Claude interaction

3b. Background Mode:
    └─> HappyApiClient.resumeSession()
        └─> POST /v1/local-sessions/:id/resume
        └─> Show notification: "Session resumed"
        └─> Auto-refresh tree view after 2s
```

### Auto-Refresh Mechanism

```typescript
class SessionRefreshManager {
  private intervalId?: NodeJS.Timer;

  start(intervalMs: number) {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      this.treeDataProvider.refresh();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }
}
```

## Type Definitions

**Copy from happy-cli types**:

```typescript
// Import these directly from happy-cli or redefine
interface LocalSession {
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

interface LocalSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: {
    type: 'text';
    text: string;
  };
  createdAt: number;
}
```

## Error Handling & Edge Cases

### Server Connection Failures

**Scenario**: happy-server is not running

**Handling**:
```typescript
try {
  const sessions = await apiClient.listLocalSessions();
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    vscode.window.showWarningMessage(
      'Cannot connect to Happy server. Is it running?',
      'Start Server',
      'Settings'
    ).then(selection => {
      if (selection === 'Start Server') {
        // Attempt to start via systemd or suggest command
      }
    });

    // Show empty state in tree with helpful message
    return [];
  }
}
```

### CLI Not Found

**Scenario**: Extension can't locate happy CLI

**Handling**:
- Check common locations: `/opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs`
- Check PATH for `happy` command
- If not found, prompt user to configure `happySessions.cliPath`
- Disable CLI-dependent features gracefully

### Session Resume Failures

**Scenario**: Resume request fails (CWD doesn't exist, session deleted, etc.)

**Handling**:
```typescript
try {
  await apiClient.resumeSession(claudeSessionId);
  vscode.window.showInformationMessage('Session resumed successfully');
} catch (error) {
  const message = error.response?.data?.error || error.message;
  vscode.window.showErrorMessage(`Failed to resume session: ${message}`);

  // Offer to remove stale session from view
  vscode.window.showWarningMessage(
    'This session may no longer exist. Refresh session list?',
    'Refresh'
  ).then(selection => {
    if (selection === 'Refresh') {
      treeDataProvider.refresh();
    }
  });
}
```

### Stale Data

**Problem**: Tree view shows outdated session status

**Solution**:
- Auto-refresh every 5 seconds (configurable)
- Manual refresh button always available
- Show "last updated" timestamp in tree view header

## Implementation Phases

### Phase 1: Core Functionality (MVP)
- [ ] Extension scaffolding (Yeoman generator)
- [ ] Happy API Client with session listing
- [ ] Basic Tree View Provider with status-based grouping
- [ ] Manual refresh command
- [ ] Resume session in terminal
- [ ] Configuration: server URL, CLI path

### Phase 2: Enhanced UX
- [ ] Auto-refresh mechanism
- [ ] Status bar integration
- [ ] Context menu actions (open directory, copy ID)
- [ ] Session preview in Output Channel
- [ ] Kill session command
- [ ] Error handling and user notifications

### Phase 3: Advanced Features
- [ ] Multiple grouping modes (status/cwd/time)
- [ ] Search/filter sessions
- [ ] Session details webview panel
- [ ] Quick pick for fast session switching
- [ ] Resume in background mode (via API)
- [ ] Show transcript preview inline

### Phase 4: Polish
- [ ] Custom icons for different states
- [ ] Keyboard shortcuts
- [ ] Session activity notifications
- [ ] Performance optimizations (caching)
- [ ] Comprehensive error recovery
- [ ] Testing suite

## Security Considerations

### API Communication
- **Authentication**: Currently single-user mode, no auth required
- **Future**: Support token-based auth when multi-user mode is implemented
- **Transport**: Local HTTP (127.0.0.1) - no TLS needed for localhost

### CLI Execution
- **Injection Prevention**: Always use parameterized execution, never string concatenation
- **Path Validation**: Verify CLI binary path before execution
- **CWD Validation**: Ensure working directory exists and is accessible

### Data Privacy
- **Transcript Data**: Stored locally, never sent to external services
- **Session IDs**: Treat as sensitive, don't log in telemetry
- **User Consent**: Document what data is accessed in extension README

## Testing Strategy

### Unit Tests
- API client methods (mock HTTP responses)
- Data transformation logic
- Configuration parsing
- Error handling paths

### Integration Tests
- End-to-end session refresh
- Resume command execution
- Tree view rendering

### Manual Testing Scenarios
1. Fresh install with no sessions
2. Server not running
3. CLI not found
4. Resume active session
5. Resume idle session
6. Kill running session
7. Multiple sessions with different statuses
8. Large number of sessions (200+)

## Dependencies

**Required NPM Packages**:
- `axios` or `node-fetch` - HTTP client for API calls
- `zod` - Runtime type validation (match happy-cli schemas)

**VS Code API Used**:
- `vscode.window.createTreeView()`
- `vscode.TreeDataProvider`
- `vscode.commands.registerCommand()`
- `vscode.window.createTerminal()`
- `vscode.workspace.getConfiguration()`
- `vscode.StatusBarItem`

**Optional**:
- `ws` - If implementing WebSocket updates in future

## File Structure

```
happy-session-manager/
├── src/
│   ├── extension.ts              # Main entry point
│   ├── api/
│   │   ├── client.ts             # HappyApiClient
│   │   └── types.ts              # TypeScript interfaces
│   ├── tree/
│   │   ├── provider.ts           # TreeDataProvider
│   │   ├── items.ts              # TreeItem classes
│   │   └── grouping.ts           # Grouping strategies
│   ├── cli/
│   │   ├── executor.ts           # CLIExecutor
│   │   └── detector.ts           # CLI path detection
│   ├── config/
│   │   └── manager.ts            # ConfigurationManager
│   ├── commands/
│   │   ├── resume.ts
│   │   ├── kill.ts
│   │   ├── preview.ts
│   │   └── refresh.ts
│   └── utils/
│       ├── formatters.ts         # Time formatting, etc.
│       └── icons.ts              # Icon management
├── package.json
├── tsconfig.json
├── .vscodeignore
└── README.md
```

## Critical Implementation Notes for Coding Agent

### DO:
1. **Use REST API for data fetching** - Never spawn CLI for `sessions list`
2. **Validate all API responses with Zod** - Prevent runtime errors
3. **Handle connection failures gracefully** - Don't crash on server down
4. **Use integrated terminal for resume** - Better UX than background spawn
5. **Respect user configuration** - Always read from VS Code settings
6. **Implement proper cleanup** - Dispose timers and subscriptions in `deactivate()`

### DON'T:
1. **Don't parse CLI stdout** - Use API JSON responses instead
2. **Don't hardcode paths** - Always make configurable
3. **Don't block on API calls** - Use async/await properly
4. **Don't ignore errors** - Show meaningful messages to user
5. **Don't poll too frequently** - Respect configurable interval (default 5s)
6. **Don't spawn CLI unnecessarily** - Only for terminal-based actions

### Edge Cases to Handle:
1. Server not running → Show empty state with instructions
2. No sessions found → Show welcome message
3. Session deleted during refresh → Remove from tree
4. Resume fails → Show error, offer to refresh
5. Multiple rapid refresh clicks → Debounce
6. CLI path changes → Re-detect on settings change
7. Working directory deleted → Disable "Open in Explorer" action

## Future Enhancements

### WebSocket Integration
- Real-time session updates without polling
- Instant status changes (idle → active)
- Live transcript streaming

### Smart Recommendations
- "Continue last session" quick action
- Suggest resuming idle sessions in current workspace
- Detect context and recommend relevant sessions

### Multi-Machine Support
- Show sessions from multiple machines (when connected to remote happy-server)
- Filter by machine hostname

### Advanced Filtering
- Search by project path
- Filter by time range
- Show only sessions in current workspace

---

## Summary for Coding Agent

You are building a VS Code extension that:
1. **Shows Claude sessions** in a tree view (sidebar)
2. **Fetches data via HTTP** from `http://127.0.0.1:3005/v1/local-sessions`
3. **Resumes sessions** by spawning happy CLI in integrated terminal
4. **Auto-refreshes** every 5 seconds (configurable)
5. **Groups sessions** by status (active/idle/terminated)

**Key architectural decisions**:
- API-first approach (not CLI parsing)
- Use existing happy-server infrastructure
- Minimal dependencies (axios + zod)
- Graceful degradation when server unavailable
- Focus on UX (responsive, informative, error-tolerant)

**Start with Phase 1 (MVP)**, get it working, then iterate. Prioritize correctness and error handling over features.
