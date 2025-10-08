/**
 * TypeScript type definitions matching happy-cli API responses
 * Based on: services/happy-cli/src/api/types.ts
 */

export interface LocalSession {
  id: string;
  claudeSessionId: string;
  aiType: string;                  // 'claude' | 'codex' | etc
  source: string;                  // 'happy' | 'terminal'
  status: string;                  // e.g., 'active', 'happy-active', 'terminated'
  sessionStatus: string;           // 'idle' | 'busy'
  projectPath: string | null;
  jsonlPath: string | null;        // Renamed from transcriptPath
  cwd: string | null;
  summary: string | null;
  pid: number | null;
  command: string | null;
  happySessionId: string | null;
  happySessionTag: string | null;
  startedAt: number | null;
  jsonlCreateTime: number | null;  // JSONL file creation time
  jsonlUpdateTime: number | null;  // Last JSONL write time
  revision: number;                // Version counter for conflict resolution
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
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
