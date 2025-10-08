import axios, { AxiosInstance } from 'axios';
import { LocalSession, LocalSessionMessage, ApiResponse } from '../types';

export class HappyApiClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:3005', authToken?: string) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
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

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

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
}
