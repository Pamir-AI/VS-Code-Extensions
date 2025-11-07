import axios, { AxiosInstance } from 'axios';
import { PortDiscoveryResponse, PortActionRequest } from './types';

export class PortApiClient {
    private client: AxiosInstance;

    constructor(private baseUrl: string) {
        this.client = axios.create({
            baseURL: baseUrl,
            timeout: 5000,
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
        this.client = axios.create({
            baseURL: baseUrl,
            timeout: 5000,
        });
    }
}
