import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import { PortDiscoveryResponse, PortActionRequest } from './types';

const INTERNAL_SECRET_PATH = '/etc/claude-code-web-manager/internal-secret';

export class PortApiClient {
    private client: AxiosInstance;
    private internalSecret: string | null = null;

    constructor(private baseUrl: string) {
        this.loadInternalSecret();
        this.client = this.createClient(baseUrl);
    }

    private loadInternalSecret(): void {
        try {
            this.internalSecret = fs.readFileSync(INTERNAL_SECRET_PATH, 'utf8').trim();
        } catch {
            console.warn('Could not read internal secret, requests may fail auth');
        }
    }

    private createClient(baseUrl: string): AxiosInstance {
        const headers: Record<string, string> = {};
        if (this.internalSecret) {
            headers['X-Internal-Secret'] = this.internalSecret;
        }
        return axios.create({
            baseURL: baseUrl,
            timeout: 5000,
            headers,
        });
    }

    /**
     * Fetch all discovered ports
     */
    async getPorts(): Promise<PortDiscoveryResponse> {
        const response = await this.client.get<PortDiscoveryResponse>('/distiller/proxy/info');
        return response.data;
    }

    /**
     * Register a custom port for forwarding
     */
    async registerPort(port: number): Promise<void> {
        const payload: PortActionRequest = { port };
        await this.client.post('/distiller/proxy/register', payload);
    }

    /**
     * Unregister a custom port
     */
    async unregisterPort(port: number): Promise<void> {
        const payload: PortActionRequest = { port };
        await this.client.post('/distiller/proxy/unregister', payload);
    }

    /**
     * Exclude a port from auto-forwarding
     */
    async excludePort(port: number): Promise<void> {
        const payload: PortActionRequest = { port };
        await this.client.post('/distiller/proxy/exclude', payload);
    }

    /**
     * Unexclude a previously excluded port
     */
    async unexcludePort(port: number): Promise<void> {
        const payload: PortActionRequest = { port };
        await this.client.post('/distiller/proxy/unexclude', payload);
    }

    /**
     * Update base URL (for configuration changes)
     */
    updateBaseUrl(baseUrl: string): void {
        this.baseUrl = baseUrl;
        this.client = this.createClient(baseUrl);
    }
}
