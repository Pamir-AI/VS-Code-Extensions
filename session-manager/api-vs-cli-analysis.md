# API vs CLI: Deep Dive Analysis for VS Code Extension

## Executive Summary

After analyzing the codebase, **the API and CLI are fundamentally different tools serving different purposes**:

- **happy-server REST API**: Read-only data access for displaying session information
- **happy-cli**: Action executor that spawns Claude processes and manages their lifecycle

**For the VS Code extension, you need BOTH**:
- Use **API** for displaying session lists and status
- Use **CLI** for resuming sessions (spawning Claude in terminal)

## The Mobile-to-Desktop Session Resume Flow

### What You Want to Achieve

```
1. User starts Claude session on mobile phone
   ↓
2. Mobile app talks to happy-server via WebSocket
   ↓
3. User wants to continue working on desktop
   ↓
4. VS Code extension shows the session in a list
   ↓
5. User clicks "Resume" in VS Code
   ↓
6. Claude opens in VS Code's integrated terminal
   ↓
7. Full conversation history is available
```

## How It Actually Works

### Architecture: Three Communication Channels

```
┌─────────────────────────────────────────────────────────────┐
│                     happy-server                             │
│                  (http://127.0.0.1:3005)                    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           SQLite Database                          │    │
│  │  - Sessions (Happy sessions)                       │    │
│  │  - Messages (conversation history)                 │    │
│  │  - LocalSessions (Claude session tracking)         │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │           REST API Endpoints                       │    │
│  │  GET  /v1/local-sessions           (list sessions) │    │
│  │  GET  /v1/local-sessions/:id/messages (transcript) │    │
│  │  POST /v1/local-sessions/:id/resume (mobile only)  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         WebSocket Server (/v1/updates)             │    │
│  │  - Real-time message exchange                      │    │
│  │  - Session state updates                           │    │
│  │  - Activity heartbeats                             │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
           │                    │                    │
           │                    │                    │
    REST API              WebSocket            WebSocket
           │                    │                    │
           ▼                    ▼                    ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │ VS Code  │        │  Mobile  │        │happy-cli │
    │Extension │        │  Client  │        │ Process  │
    │          │        │          │        │          │
    │ (reads)  │        │(read/msg)│        │(messages)│
    └──────────┘        └──────────┘        └──────────┘
           │
           │ spawns CLI in terminal
           ▼
    ┌──────────────────────────────────┐
    │  happy-cli (in integrated term)  │
    │  ↓ spawns Claude                 │
    │  ↓ connects via WebSocket        │
    │  ↓ enters local/remote loop      │
    └──────────────────────────────────┘
```

## Key Insight: Three Types of Clients

### 1. Mobile Client (happy-client)
**Communication**: REST API + WebSocket

**Purpose**: Interactive UI for mobile/web users

**Capabilities**:
- ✅ List sessions via REST API
- ✅ Send messages via WebSocket
- ✅ Receive real-time responses via WebSocket
- ✅ Request server-side resume (spawns happy-cli on server)
- ❌ Cannot spawn local Claude processes (it's on a phone!)

**Code Location**: `services/happy-client/sources/sync/`

**Key Methods**:
```typescript
// Mobile client can:
sync.fetchLocalSessions()          // GET /v1/local-sessions
sync.resumeLocalSession(uuid)      // POST /v1/local-sessions/:uuid/resume
                                   // → Server spawns happy-cli process
```

### 2. Happy-CLI (desktop process)
**Communication**: REST API + WebSocket

**Purpose**: Run Claude locally and bridge to server

**Capabilities**:
- ✅ Spawn Claude processes (local mode: interactive terminal)
- ✅ Connect Claude to happy-server via WebSocket
- ✅ Switch between local (interactive) and remote (background) modes
- ✅ Read session data from API
- ✅ Execute resume commands

**Code Location**: `services/happy-cli/src/`

**Key Methods**:
```typescript
// CLI can:
api.listLocalSessions()                   // GET /v1/local-sessions (read-only)
start(credentials, { claudeArgs: [...] }) // Spawn Claude process + WebSocket
```

### 3. VS Code Extension (what you're building)
**Communication**: REST API (read) + CLI executor (actions)

**Purpose**: Display sessions in VS Code and enable resume

**Capabilities**:
- ✅ List sessions via REST API (same as mobile)
- ✅ Display session status/info
- ✅ Spawn happy-cli in integrated terminal
- ❌ Cannot send messages via WebSocket (not needed for basic use)
- ❌ Cannot be a "session-scoped" WebSocket client (that's happy-cli's job)

## The Critical Difference: Who Spawns Claude?

### Mobile App Resume Flow

```
Mobile UI: User clicks "Resume"
    ↓
Mobile Client: POST /v1/local-sessions/:id/resume
    ↓
happy-server: Spawns detached happy-cli process on server
    ↓
happy-cli:
    - Changes to session CWD
    - Executes: claude --resume <uuid>
    - Connects to happy-server via WebSocket
    - Runs in "remote" mode (no terminal UI)
    ↓
Mobile UI: Receives messages via WebSocket
```

**Key Point**: Mobile triggers a **server-side** happy-cli spawn. The CLI runs on the server machine (where the code lives), not on the phone.

### VS Code Extension Resume Flow (What You Want)

```
VS Code UI: User clicks "Resume" in tree view
    ↓
Extension: Opens integrated terminal
    ↓
Extension: Sends command to terminal
    node /path/to/happy.mjs sessions resume <uuid> --local
    ↓
happy-cli:
    - Changes to session CWD
    - Executes: claude --resume <uuid>
    - Connects to happy-server via WebSocket
    - Runs in "local" mode (interactive terminal)
    ↓
User interacts with Claude directly in VS Code terminal
```

**Key Point**: VS Code triggers a **local** happy-cli spawn in the integrated terminal. The user sees Claude's UI and interacts directly.

## CLI Does Not Poll - It Uses WebSocket

**Important Discovery**: happy-cli does NOT poll the API for messages.

### How happy-cli Actually Works

1. **Session Creation** (via REST API):
```typescript
// One-time REST call to register session
const session = await api.getOrCreateSession({ tag, metadata, state });
```

2. **Message Exchange** (via WebSocket):
```typescript
// Persistent WebSocket connection for bidirectional communication
this.socket = io(configuration.serverUrl, {
    auth: { clientType: 'session-scoped', sessionId: this.sessionId },
    path: '/v1/updates',
    transports: ['websocket']
});

// Listen for incoming messages
socket.on('update', (update) => {
    // Process user message from mobile
});

// Send responses back
socket.emit('message', { sid: sessionId, message: ... });
```

3. **Mode Loop** (local vs remote):
```typescript
// happy-cli runs in a loop
while (true) {
    if (mode === 'local') {
        // Claude runs in interactive terminal
        // User types directly to Claude
        await claudeLocalLauncher(session);
    } else if (mode === 'remote') {
        // Claude runs in background
        // Listens for messages from WebSocket
        await claudeRemoteLauncher(session);
    }
}
```

### Mobile Client DOES Poll for Session List

```typescript
// Mobile client polls REST API for session list
async fetchLocalSessions() {
    const response = await fetch(`${API}/v1/local-sessions`);
    const sessions = await response.json();
    storage.applyLocalSessions(sessions);
}

// Triggered by:
// 1. User opens sessions screen
// 2. Pull-to-refresh
// 3. After resume request
this.localSessionsSync.invalidate(); // Marks stale, will re-fetch
```

**Why?** Because mobile needs to show session status (active/idle/busy) without maintaining a WebSocket for every potential session. Only active conversations get WebSocket connections.

## What the VS Code Extension Should Do

### Use REST API For:

1. **Display Session List** (same as mobile):
```typescript
async function fetchSessions() {
    const response = await fetch('http://127.0.0.1:3005/v1/local-sessions');
    const data = await response.json();
    return data.sessions; // Array of LocalSession objects
}
```

2. **Show Session Details**:
```typescript
async function getSessionMessages(claudeSessionId: string) {
    const response = await fetch(
        `http://127.0.0.1:3005/v1/local-sessions/${claudeSessionId}/messages`
    );
    return await response.json();
}
```

3. **Poll for Updates** (optional):
```typescript
// Refresh every 5 seconds to show status changes
setInterval(() => {
    fetchSessions().then(updateTreeView);
}, 5000);
```

### Use happy-cli For:

1. **Resume Session in Terminal**:
```typescript
function resumeSessionInTerminal(claudeSessionId: string, cwd: string) {
    const terminal = vscode.window.createTerminal({
        name: `Claude ${claudeSessionId.slice(0, 8)}`,
        cwd: cwd
    });

    terminal.sendText(
        `node /opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs ` +
        `sessions resume ${claudeSessionId} --local`
    );

    terminal.show();
}
```

2. **Kill Session**:
```typescript
async function killSession(claudeSessionId: string) {
    await execAsync(
        `node /path/to/happy.mjs sessions kill ${claudeSessionId}`
    );
}
```

## Why Not Use WebSocket in VS Code Extension?

You **could** implement WebSocket support, but it's not necessary for the initial version:

### Pros of Adding WebSocket:
- ✅ Real-time session status updates (no polling)
- ✅ Could receive messages without CLI running
- ✅ More like mobile client

### Cons of Adding WebSocket:
- ❌ More complex implementation
- ❌ VS Code extension must maintain persistent connection
- ❌ Still need CLI to spawn Claude anyway
- ❌ Polling every 5 seconds is "good enough" for desktop use
- ❌ happy-server would need to support "extension-scoped" client type

**Recommendation**: Start with REST API + polling. Add WebSocket in Phase 3 if needed.

## The Session Monitor's Role

There's a fourth component you should be aware of:

### Session Monitor (systemd service)

**Purpose**: Passive watcher that detects Claude sessions

**How it works**:
```
1. Polls ~/.claude/projects/*.jsonl every 5 seconds
2. Parses transcript files to extract metadata
3. Scans /proc to detect running Claude processes
4. Upserts data to happy-server via REST API
   POST /v1/local-sessions
```

**Why it matters**: This is how the server knows about Claude sessions that were started **outside** of happy-cli (e.g., direct `claude` command).

**Impact on VS Code extension**:
- Sessions will appear in your list even if user runs `claude` directly
- Status tracking (active/idle/busy) happens automatically
- You don't need to implement process detection yourself

## Updated Data Flow for Your Use Case

### Scenario: Start on Mobile, Resume on Desktop

```
┌────────────────────────────────────────────────────────────┐
│ Step 1: Mobile User Starts Session                        │
└────────────────────────────────────────────────────────────┘

Mobile App
  ↓ Opens new conversation
  ↓ Enters message: "help me debug my code"

happy-client
  ↓ Creates session via REST
  ↓ POST /v1/sessions

happy-server
  ↓ Creates Happy session record in DB
  ↓ Returns sessionId: "happy-abc-123"

Mobile App
  ↓ happy-cli NOT running yet (mobile-only mode)
  ↓ Message queued in database
  ↓ UI shows "Waiting for machine connection..."

┌────────────────────────────────────────────────────────────┐
│ Step 2: User Opens VS Code Extension on Desktop           │
└────────────────────────────────────────────────────────────┘

VS Code Extension
  ↓ Polls REST API every 5s
  ↓ GET /v1/local-sessions

happy-server
  ↓ Returns: []  (no Claude sessions detected yet)
  ↓ (because Claude hasn't started on this machine)

VS Code Tree View
  ↓ Shows: "No active sessions"

┌────────────────────────────────────────────────────────────┐
│ Step 3: User Taps "Resume" in Mobile App                  │
└────────────────────────────────────────────────────────────┘

Mobile App
  ↓ User taps "Resume on Desktop"
  ↓ POST /v1/local-sessions/:uuid/resume

happy-server
  ↓ Spawns: node happy.mjs sessions resume <uuid> --force --remote
  ↓ (detached process on server machine)

happy-cli (spawned on server)
  ↓ Changes to project CWD
  ↓ Reads transcript from ~/.claude/projects/
  ↓ Creates Happy session with rehydration
  ↓ Spawns: claude --resume <claude-uuid>
  ↓ Connects to happy-server via WebSocket
  ↓ Enters "remote" mode (background, no terminal)

Claude Process
  ↓ Starts running
  ↓ Creates/updates ~/.claude/projects/<uuid>.jsonl

Session Monitor (systemd)
  ↓ Detects new .jsonl file
  ↓ Scans /proc, finds Claude PID
  ↓ POST /v1/local-sessions (upsert)

happy-server
  ↓ LocalSession record created:
  ↓ {
  ↓   claudeSessionId: "claude-xyz-789",
  ↓   happySessionId: "happy-abc-123",  // linked!
  ↓   status: "happy-active",
  ↓   cwd: "/home/user/project",
  ↓   pid: 12345,
  ↓   ...
  ↓ }

┌────────────────────────────────────────────────────────────┐
│ Step 4: VS Code Extension Detects Session                 │
└────────────────────────────────────────────────────────────┘

VS Code Extension
  ↓ Next poll cycle (5s later)
  ↓ GET /v1/local-sessions

happy-server
  ↓ Returns: [{ claudeSessionId: "claude-xyz-789", ... }]

VS Code Tree View
  ↓ Shows:
  ↓   🟢 Session xyz-789 [active]
  ↓      📂 /home/user/project
  ↓      🕐 Last seen: 2s ago
  ↓      🔄 Resume Session (action button)

┌────────────────────────────────────────────────────────────┐
│ Step 5: User Clicks "Resume" in VS Code                   │
└────────────────────────────────────────────────────────────┘

VS Code Extension
  ↓ User right-clicks → "Resume Session"
  ↓ Opens integrated terminal
  ↓ terminal.sendText(
  ↓   "node happy.mjs sessions resume claude-xyz-789 --local"
  ↓ )

happy-cli (in terminal)
  ↓ Detects existing happy-abc-123 mapping
  ↓ Changes to /home/user/project
  ↓ Spawns: claude --resume claude-xyz-789
  ↓ Connects to happy-server WebSocket
  ↓ Enters "local" mode (interactive terminal)

Claude Process (NEW)
  ↓ User now has TWO Claude processes:
  ↓   1. PID 12345 - background (mobile's remote mode)
  ↓   2. PID 67890 - terminal (VS Code's local mode)

happy-cli (detects conflict)
  ↓ Signals old process to terminate
  ↓ Takes over WebSocket connection
  ↓ User now controls session from VS Code

┌────────────────────────────────────────────────────────────┐
│ Step 6: User Interacts in VS Code Terminal                │
└────────────────────────────────────────────────────────────┘

User Types in Terminal
  ↓ "fix the bug on line 42"

happy-cli (local mode)
  ↓ Sends to Claude process via stdin

Claude Process
  ↓ Processes request
  ↓ Writes to transcript
  ↓ Returns response to stdout

User Sees Response
  ↓ Claude's response in terminal

happy-cli
  ↓ Also sends to happy-server via WebSocket

Mobile App
  ↓ Receives update via WebSocket
  ↓ Shows same response in mobile UI
```

## Key Takeaways

### 1. API vs CLI Roles

| Task | Use API | Use CLI | Why |
|------|---------|---------|-----|
| List sessions | ✅ | ❌ | API is read-only data source |
| Show session status | ✅ | ❌ | Real-time data in DB |
| Display transcript | ✅ | ❌ | Server has parsed messages |
| Resume session | ❌ | ✅ | Need to spawn Claude process |
| Kill session | ❌ | ✅ | Need process control |
| Monitor sessions | ❌ | ❌ | Systemd service does this |

### 2. Communication Patterns

- **Mobile Client**: REST API (list) + WebSocket (messages)
- **happy-cli**: REST API (register) + WebSocket (messages)
- **VS Code Extension**: REST API (list) + CLI exec (actions)
- **Session Monitor**: REST API (upsert session data)

### 3. Why Extension Uses API Instead of CLI for Listing

**Original design considered**:
```bash
# Parse CLI output
$ happy sessions list --output json
```

**Why API is better**:
- ✅ Faster (no process spawn overhead)
- ✅ Type-safe (JSON schema validation)
- ✅ Reliable (no CLI output parsing)
- ✅ Same data source as mobile
- ✅ Real-time (session monitor updates DB)

### 4. The Extension is NOT a Full Client

The extension does NOT need to:
- ❌ Maintain persistent WebSocket connection
- ❌ Encrypt/decrypt messages
- ❌ Handle session lifecycle
- ❌ Process Claude tool calls

The extension ONLY needs to:
- ✅ Display session list (read-only)
- ✅ Trigger resume via CLI
- ✅ Show session working directory
- ✅ Provide quick access

**It's a launcher/viewer, not a full client.**

## Implementation Guidance for VS Code Extension

### Phase 1: Basic Integration

```typescript
// 1. Fetch sessions from API
async function fetchSessions(): Promise<LocalSession[]> {
    const response = await fetch('http://127.0.0.1:3005/v1/local-sessions');
    const data = await response.json();
    return data.sessions;
}

// 2. Display in tree view
class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
    async getChildren(): Promise<SessionItem[]> {
        const sessions = await fetchSessions();
        return sessions.map(s => new SessionItem(s));
    }
}

// 3. Resume via CLI in terminal
async function resumeSession(session: LocalSession) {
    const terminal = vscode.window.createTerminal({
        name: `Claude ${session.claudeSessionId.slice(0, 8)}`,
        cwd: session.cwd ?? undefined
    });

    terminal.sendText(
        `node /opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs ` +
        `sessions resume ${session.claudeSessionId} --local`
    );

    terminal.show();
}
```

### Phase 2: Add Polling

```typescript
class SessionRefreshManager {
    private intervalId?: NodeJS.Timer;

    start(provider: SessionTreeProvider) {
        this.intervalId = setInterval(() => {
            provider.refresh();
        }, 5000); // Poll every 5 seconds
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
}
```

### Phase 3: Advanced Features (Optional WebSocket)

```typescript
// Only if you want real-time updates without polling
import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:3005', {
    path: '/v1/updates',
    auth: { clientType: 'vscode-extension' } // Need server support
});

socket.on('update', (update) => {
    if (update.body.t === 'local-session-update') {
        treeProvider.refresh();
    }
});
```

## Summary

**The key insight**: The VS Code extension is a **hybrid** that uses:

1. **API for reading** (like mobile client)
   - Session lists, statuses, transcripts
   - Leverages existing server infrastructure
   - No process spawn overhead

2. **CLI for actions** (like terminal user)
   - Resume sessions in integrated terminal
   - Direct user interaction with Claude
   - Full control over spawned processes

**This is the best of both worlds**:
- Efficient data access (API)
- Native desktop experience (CLI in terminal)
- No need for complex WebSocket management
- Reuses all existing infrastructure

Your original design was actually **correct** - you just needed to understand *why* it's the right approach!
