# VS Code Extension Migration Guide

## Overview
This document outlines all changes needed to update the Happy Session Manager extension to work with the current happy-cli and happy-server implementation.

---

## 1. API Response Schema Changes

### Issue
The extension's `LocalSession` type is outdated and missing new fields added to the happy-server response schema.

### Current Extension Type (`src/types.ts`)
```typescript
export interface LocalSession {
  id: string;
  claudeSessionId: string;
  type: string;                    // ❌ Removed
  status: string;
  projectPath: string | null;
  transcriptPath: string | null;   // ❌ Removed (renamed to jsonlPath)
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
  busy?: boolean | null;           // ❌ Removed
  recentWrites?: boolean | null;   // ❌ Removed
  lastWriteAt?: number | null;     // ❌ Removed
  cpuBusy?: boolean | null;        // ❌ Removed
}
```

### Updated Schema (from `happy-server/sources/app/api.ts:1404-1428`)
```typescript
export interface LocalSession {
  id: string;
  claudeSessionId: string;
  aiType: string;                  // ✅ NEW: 'claude' | 'codex' | etc
  source: string;                  // ✅ NEW: 'happy' | 'terminal'
  status: string;                  // e.g., 'active', 'happy-active', 'terminated'
  sessionStatus: string;           // ✅ NEW: 'idle' | 'busy'
  projectPath: string | null;
  jsonlPath: string | null;        // ✅ RENAMED: was transcriptPath
  cwd: string | null;
  summary: string | null;
  pid: number | null;
  command: string | null;
  happySessionId: string | null;
  happySessionTag: string | null;
  startedAt: number | null;
  jsonlCreateTime: number | null;  // ✅ NEW: JSONL file creation time
  jsonlUpdateTime: number | null;  // ✅ NEW: Last JSONL write time
  revision: number;                // ✅ NEW: Version counter for conflict resolution
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}
```

### Changes Required
**File:** `src/types.ts`

1. Remove deprecated fields: `type`, `transcriptPath`, `busy`, `recentWrites`, `lastWriteAt`, `cpuBusy`
2. Add new fields: `aiType`, `source`, `sessionStatus`, `jsonlPath`, `jsonlCreateTime`, `jsonlUpdateTime`, `revision`
3. Update field types to match server response

---

## 2. API Endpoint Behavior Changes

### Issue: Status Filtering Logic Changed

**Current Behavior (Extension):**
- `GET /v1/local-sessions?limit=100` expects all sessions

**New Behavior (Server - `api.ts:1271-1302`):**
- Without `claudeSessionId` query param: Returns ONLY `status IN ['active', 'happy-active']`
- With `claudeSessionId` query param: Returns all statuses (for specific session lookup)

### Impact on Extension

**File:** `src/extension.ts:86-89`
```typescript
// ❌ BROKEN: This will only return active sessions now
const sessions = await apiClient.listSessions({ limit: 100 });
const activeCount = sessions.filter(s =>
  s.status.toLowerCase() === 'active' || s.status.toLowerCase() === 'happy-active'
).length;
```

**File:** `src/tree/provider.ts:179`
```typescript
// ❌ BROKEN: Will only return active sessions, missing terminated/idle ones
const sessions = await this.apiClient.listSessions({ limit: 100 });
```

### Solution Options

#### Option A: Accept the new behavior (recommended)
Only show active sessions in the tree view by default. Add a setting to toggle showing all sessions.

**Changes Required:**
1. Add configuration option in `package.json`:
```json
"happySessions.showAllStatuses": {
  "type": "boolean",
  "default": false,
  "description": "Show sessions with all statuses (active, terminated, etc.)"
}
```

2. Update `src/api/client.ts` to add a new method:
```typescript
/**
 * List all sessions regardless of status (for historical view)
 */
async listAllSessions(limit?: number): Promise<LocalSession[]> {
  // Implementation: Make multiple queries for different statuses
  // OR use a dummy claudeSessionId to bypass the filter (not recommended)
  // OR request a new server endpoint
}
```

#### Option B: Request server API change
Ask for a new query parameter like `?includeAllStatuses=true` to bypass the filter.

---

## 3. Kill Session API Changes

### Issue: Kill endpoint signature changed

**Current Extension (`src/cli/executor.ts:59-80`):**
```typescript
async killSession(session: LocalSession): Promise<void> {
  // Uses CLI command: `happy sessions kill <sessionId>`
  terminal.sendText(
    `node "${this.cliPath}" sessions kill ${session.claudeSessionId}`
  );
}
```

**New Server API (`api.ts:1733-1793`):**
```http
POST /v1/local-sessions/:claudeSessionId/kill
Content-Type: application/json

{
  "signal": "term" | "kill",      // Optional, default: "term"
  "targetPid": number              // Optional, overrides session.pid
}
```

### Changes Required

**File:** `src/api/client.ts`

Add new method:
```typescript
/**
 * Kill a session by sending signal to its process
 * POST /v1/local-sessions/:id/kill
 */
async killSession(
  claudeSessionId: string,
  options?: {
    signal?: 'term' | 'kill';
    targetPid?: number;
  }
): Promise<{ ok: boolean; signal: string; pid: number }> {
  try {
    const response = await this.client.post(
      `/v1/local-sessions/${encodeURIComponent(claudeSessionId)}/kill`,
      options
    );
    return response.data;
  } catch (error: any) {
    console.error('Failed to kill session:', error.message);
    throw new Error(`Cannot kill session ${claudeSessionId}`);
  }
}
```

**File:** `src/cli/executor.ts`

Update `killSession` method:
```typescript
async killSession(session: LocalSession): Promise<void> {
  // Option 1: Use API directly (recommended)
  // Requires injecting HappyApiClient into constructor
  await this.apiClient.killSession(session.claudeSessionId, { signal: 'term' });

  // Option 2: Keep using CLI (fallback)
  // CLI command is still valid: `happy sessions kill <uuid>`
}
```

**Recommendation:** Use API directly for better error handling and faster response.

---

## 4. Session Resume Changes

### Issue: Resume now uses dedicated worker process

**Current Extension (`src/cli/executor.ts:44-54`):**
```typescript
async resumeSessionInTerminal(session: LocalSession): Promise<void> {
  const terminal = vscode.window.createTerminal({
    name: `Claude ${session.claudeSessionId.slice(0, 8)}`,
    cwd: session.cwd || undefined,
  });

  // ❌ This bypasses Happy integration entirely
  terminal.sendText(`claude --resume ${session.claudeSessionId}`);
  terminal.show();
}
```

**New Server Behavior (`api.ts:1795-1840`):**
```http
POST /v1/local-sessions/:claudeSessionId/resume
```

The server now:
1. Spawns a detached worker process (`resume-worker.mjs`)
2. Worker creates Happy session
3. Updates `LocalSession` with `happySessionId`
4. Returns immediately (doesn't wait for Claude to start)

### Impact
- Current implementation bypasses Happy entirely (uses vanilla Claude)
- Users lose mobile integration when resuming from VS Code
- Need to integrate with Happy's resume flow

### Changes Required

**File:** `src/api/client.ts`

Add resume method:
```typescript
/**
 * Resume session via Happy (creates mobile-connected session)
 * POST /v1/local-sessions/:id/resume
 */
async resumeSession(claudeSessionId: string): Promise<{ ok: boolean; pid: number }> {
  try {
    const response = await this.client.post(
      `/v1/local-sessions/${encodeURIComponent(claudeSessionId)}/resume`
    );
    return response.data;
  } catch (error: any) {
    console.error('Failed to resume session:', error.message);
    throw new Error(`Cannot resume session ${claudeSessionId}`);
  }
}
```

**File:** `src/cli/executor.ts`

Update resume method:
```typescript
async resumeSessionInTerminal(session: LocalSession): Promise<void> {
  // Option 1: Use Happy's resume API (recommended for mobile integration)
  await this.apiClient.resumeSession(session.claudeSessionId);
  vscode.window.showInformationMessage(
    `Resuming session ${session.claudeSessionId.slice(0, 8)} via Happy. Check your mobile device.`
  );

  // Option 2: Keep vanilla Claude resume (current behavior)
  // Use this if user wants desktop-only sessions
  const terminal = vscode.window.createTerminal({
    name: `Claude ${session.claudeSessionId.slice(0, 8)}`,
    cwd: session.cwd || undefined,
  });
  terminal.sendText(`claude --resume ${session.claudeSessionId}`);
  terminal.show();
}
```

**Recommendation:**
- Add a setting to choose between Happy resume (mobile) vs vanilla resume (desktop-only)
- Default to Happy resume to match the extension's purpose

---

## 5. Tree View Display Updates

### Issue: Status detection logic outdated

**File:** `src/tree/provider.ts:75-83`

Current status color logic:
```typescript
if (status === 'active' || status === 'happy-active') {
  color = new vscode.ThemeColor('terminal.ansiGreen');
} else if (status === 'idle') {  // ❌ 'idle' is now sessionStatus, not status
  color = new vscode.ThemeColor('terminal.ansiYellow');
}
```

### Changes Required

**File:** `src/tree/provider.ts`

1. Update status icon logic to use both `status` and `sessionStatus`:
```typescript
private getStatusIcon(): vscode.ThemeIcon {
  const iconId = this.session.happySessionId ? 'device-mobile' : 'device-desktop';

  // Use sessionStatus for busy/idle, status for active/terminated
  const status = this.session.status.toLowerCase();
  const sessionStatus = this.session.sessionStatus?.toLowerCase();
  let color: vscode.ThemeColor;

  if (status === 'active' || status === 'happy-active') {
    // Session is running
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
```

2. Update description to show `sessionStatus` when active:
```typescript
private createDescription(): string {
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
```

3. Update engine badge to use `aiType` field:
```typescript
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
```

---

## 6. Transcript/Messages Field Rename

### Issue: Field renamed from `transcriptPath` to `jsonlPath`

**File:** `src/extension.ts:163`

Current reference to old field:
```typescript
const messages = await apiClient.getSessionMessages(item.session.claudeSessionId, 50);
```

This actually works because `getSessionMessages` doesn't use the field from the client-side session object - it queries the server. However, any local checks will fail.

### Changes Required

**File:** `src/types.ts`
- Already covered in section #1

**File:** `src/tree/provider.ts:98-99` (tooltip)
```typescript
// No changes needed - cwd is still used, not jsonlPath
```

---

## 7. CLI Command Path Changes

### Issue: CLI location detection may fail

**File:** `src/cli/executor.ts:31`

Current hardcoded path:
```typescript
const systemPath = '/opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs';
```

**Actual location verification:**
- ✅ Path exists and is correct
- Binary name is `happy.mjs` (correct)

### No Changes Required
The path is still valid. However, consider adding fallback paths:

**Optional Enhancement:**
```typescript
private detectCliPath(): void {
  const config = vscode.workspace.getConfiguration('happySessions');
  const configuredPath = config.get<string>('cliPath');

  if (configuredPath && fs.existsSync(configuredPath)) {
    this.cliPath = configuredPath;
    return;
  }

  // Try multiple locations
  const candidatePaths = [
    '/opt/claude-code-web-manager/services/happy-cli/bin/happy.mjs',
    '/usr/local/bin/happy',
    '/usr/bin/happy',
    // Development build path
    '/home/distiller/projects/vibe-code-distiller-ui/services/happy-cli/bin/happy.mjs'
  ];

  for (const path of candidatePaths) {
    if (fs.existsSync(path)) {
      this.cliPath = path;
      return;
    }
  }

  this.cliPath = null;
}
```

---

## 8. Authentication Requirement

### Issue: All API endpoints require authentication

**Current Implementation (`api.ts:1278`):**
```typescript
preHandler: app.authenticate
```

Every endpoint now requires authentication via JWT token.

### Impact
The extension currently makes unauthenticated requests:

**File:** `src/api/client.ts:10-16`
```typescript
this.client = axios.create({
  baseURL: baseUrl,
  timeout: 5000,
  headers: {
    'Content-Type': 'application/json',
    // ❌ Missing: Authorization header
  },
});
```

### Changes Required

**File:** `package.json`

Add authentication settings:
```json
"happySessions.authToken": {
  "type": "string",
  "default": "",
  "description": "Happy authentication token (JWT)"
}
```

**File:** `src/api/client.ts`

1. Update constructor to accept auth token:
```typescript
constructor(baseUrl: string = 'http://127.0.0.1:3005', authToken?: string) {
  this.baseUrl = baseUrl;
  this.client = axios.create({
    baseURL: baseUrl,
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
    },
  });
}
```

2. Add method to update auth token:
```typescript
setAuthToken(token: string): void {
  this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}
```

**File:** `src/extension.ts`

Update initialization:
```typescript
const config = vscode.workspace.getConfiguration('happySessions');
const serverUrl = config.get<string>('serverUrl') || 'http://127.0.0.1:3005';
const authToken = config.get<string>('authToken') || '';

apiClient = new HappyApiClient(serverUrl, authToken);
```

**Alternative Solution:**
The server may have a development mode that bypasses authentication for localhost connections. Check with the server team if this is available.

---

## 9. New Resume Queue Feature

### New Feature Available
The server now has a resume queue system for queueing resume requests when sessions are busy.

**New Endpoints:**
- `GET /v1/local-sessions/resume-queue` - List queued resume requests
- `POST /v1/local-sessions/:id/resume-when-idle` - Queue resume when session becomes idle

### Optional Enhancement

**File:** `src/api/client.ts`

Add new methods:
```typescript
/**
 * Queue a resume request to execute when session becomes idle
 */
async resumeWhenIdle(claudeSessionId: string): Promise<{ ok: boolean }> {
  const response = await this.client.post(
    `/v1/local-sessions/${encodeURIComponent(claudeSessionId)}/resume-when-idle`
  );
  return response.data;
}

/**
 * Get resume queue status
 */
async getResumeQueue(status?: string, limit?: number): Promise<any[]> {
  const response = await this.client.get('/v1/local-sessions/resume-queue', {
    params: { status, limit }
  });
  return response.data.requests || [];
}
```

**File:** `package.json`

Add new command:
```json
{
  "command": "happySessions.resumeWhenIdle",
  "title": "Resume When Idle"
}
```

---

## 10. Summary of Breaking Changes

### Must Fix (High Priority)
1. ✅ **Update `LocalSession` type** - Missing critical fields (`aiType`, `source`, `sessionStatus`, `jsonlPath`, `revision`)
2. ✅ **Handle API status filtering** - Endpoint now filters by status, only returns active sessions by default
3. ✅ **Add authentication** - All endpoints require JWT token
4. ✅ **Update status display logic** - Use `sessionStatus` field for busy/idle state

### Should Fix (Medium Priority)
5. ✅ **Migrate to API-based kill** - Use REST API instead of CLI for better error handling
6. ✅ **Update resume flow** - Integrate with Happy's resume worker for mobile support
7. ✅ **Update engine badge logic** - Use `aiType` field instead of parsing command string

### Nice to Have (Low Priority)
8. ⚪ **Add resume queue support** - Implement "Resume When Idle" feature
9. ⚪ **Add CLI path detection fallbacks** - Support multiple installation locations
10. ⚪ **Add settings for resume mode** - Let users choose between Happy (mobile) vs vanilla (desktop) resume

---

## Implementation Checklist

### Phase 1: Critical Fixes (Required for basic functionality)
- [ ] Update `src/types.ts` with new schema
- [ ] Add authentication token support to `src/api/client.ts`
- [ ] Update `src/extension.ts` to pass auth token to client
- [ ] Add auth token setting to `package.json`
- [ ] Fix status filtering in tree provider (show only active sessions or add toggle)

### Phase 2: Feature Parity (Restore full functionality)
- [ ] Implement API-based kill in `src/api/client.ts`
- [ ] Update `src/cli/executor.ts` to use API kill method
- [ ] Implement API-based resume in `src/api/client.ts`
- [ ] Update resume flow to use Happy integration
- [ ] Update status icon logic to use `sessionStatus`
- [ ] Update engine badge to use `aiType` field

### Phase 3: Enhancements (Optional improvements)
- [ ] Add resume queue support
- [ ] Add setting to choose resume mode (Happy vs vanilla)
- [ ] Add setting to show all session statuses
- [ ] Add CLI path fallback detection
- [ ] Add better error handling for auth failures
- [ ] Add visual indicator for queued resume requests

---

## Testing Checklist

After implementing changes, test:

1. **Authentication**
   - [ ] Extension loads without errors
   - [ ] API calls include auth token
   - [ ] Sessions list populates correctly

2. **Session Listing**
   - [ ] Active sessions appear in tree view
   - [ ] Sessions grouped by directory
   - [ ] Status colors correct (green=active/busy, yellow=idle, red=terminated)
   - [ ] Engine badges show correctly (CL for Claude, CX for Codex)

3. **Session Actions**
   - [ ] Resume session works and creates Happy session
   - [ ] Kill session terminates the process
   - [ ] Copy session ID copies correct UUID
   - [ ] Open directory opens correct folder
   - [ ] Preview transcript shows messages

4. **Edge Cases**
   - [ ] Handle empty session list gracefully
   - [ ] Handle API connection failures
   - [ ] Handle missing auth token
   - [ ] Handle sessions without PID (can't kill)
   - [ ] Handle sessions without jsonlPath (can't preview)

---

## Migration Notes

### Backward Compatibility
The extension will NOT be backward compatible with older happy-server versions due to:
- Authentication requirement
- Changed API response schema
- Status filtering behavior

### Version Requirements
- **Minimum happy-server version:** Unknown (check with team)
- **Minimum happy-cli version:** 0.9.1 (based on package.json)

### Configuration Migration
If users have existing settings:
- `happySessions.serverUrl` - No changes needed
- `happySessions.cliPath` - No changes needed
- New setting required: `happySessions.authToken`

Users will need to obtain an auth token via:
```bash
happy auth login
# Token stored in ~/.happy/auth.json
```

Consider adding a command to help users extract their token:
```json
{
  "command": "happySessions.setupAuth",
  "title": "Setup Authentication"
}
```

Implementation:
```typescript
vscode.commands.registerCommand('happySessions.setupAuth', async () => {
  const token = await vscode.window.showInputBox({
    prompt: 'Enter your Happy authentication token',
    password: true,
    placeHolder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  });

  if (token) {
    await vscode.workspace.getConfiguration('happySessions')
      .update('authToken', token, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Authentication token saved');
    apiClient.setAuthToken(token);
    refreshAndUpdateStatus();
  }
});
```

---

## Questions for Happy Team

1. **Authentication:** Is there a development/localhost bypass for authentication? Or should we always require a token?

2. **API Filtering:** Would you accept a PR to add `?includeAllStatuses=true` query parameter to bypass the status filter?

3. **Resume Behavior:** Should VS Code extension default to Happy resume (mobile) or vanilla Claude resume (desktop-only)?

4. **Token Management:** What's the recommended way to obtain and store auth tokens for third-party integrations like this extension?

5. **API Versioning:** Is there a versioned API endpoint (e.g., `/v1/`, `/v2/`) to handle future breaking changes?

6. **Session Monitoring:** Does the sessions monitor (daemon) need to be running for the API to return session data? Or is the database query sufficient?
