import * as vscode from 'vscode';
import { PortApiClient } from './portApiClient';
import { PortInfo } from './types';

export class PortDiscoveryService {
    private pollInterval: NodeJS.Timeout | undefined;
    private previousPorts: Set<number> = new Set();
    private onPortsChangedEmitter = new vscode.EventEmitter<PortInfo[]>();
    private lastKnownPorts: PortInfo[] = [];

    readonly onPortsChanged = this.onPortsChangedEmitter.event;

    constructor(
        private apiClient: PortApiClient,
        private pollIntervalMs: number,
        private showNotifications: boolean
    ) {}

    /**
     * Start polling for port changes
     */
    start(): void {
        if (this.pollInterval) {
            return; // Already running
        }

        // Initial fetch
        this.fetchPorts();

        // Set up polling
        this.pollInterval = setInterval(() => {
            this.fetchPorts();
        }, this.pollIntervalMs);
    }

    /**
     * Stop polling
     */
    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = undefined;
        }
    }

    /**
     * Manually refresh ports
     */
    async refresh(): Promise<void> {
        await this.fetchPorts();
    }

    /**
     * Get the last known ports
     */
    getLastKnownPorts(): PortInfo[] {
        return this.lastKnownPorts;
    }

    /**
     * Update configuration
     */
    updateConfig(pollIntervalMs: number, showNotifications: boolean): void {
        this.pollIntervalMs = pollIntervalMs;
        this.showNotifications = showNotifications;

        // Restart polling with new interval
        if (this.pollInterval) {
            this.stop();
            this.start();
        }
    }

    /**
     * Fetch ports from API and detect changes
     */
    private async fetchPorts(): Promise<void> {
        try {
            const response = await this.apiClient.getPorts();
            const ports = response.ports || [];

            // Update last known state
            this.lastKnownPorts = ports;

            // Detect new ports for notifications
            const currentPortNumbers = new Set(
                ports.filter(p => !p.isExclude && p.status === 'active').map(p => p.port)
            );

            // Find newly discovered ports (Auto Forwarded only)
            const newPorts = ports.filter(
                p => p.origin === 'Auto Forwarded' &&
                     !p.isExclude &&
                     p.status === 'active' &&
                     !this.previousPorts.has(p.port)
            );

            // Show notifications for new ports
            if (this.showNotifications && newPorts.length > 0) {
                for (const port of newPorts) {
                    this.showNewPortNotification(port);
                }
            }

            // Update tracking set
            this.previousPorts = currentPortNumbers;

            // Emit change event
            this.onPortsChangedEmitter.fire(ports);

        } catch (error) {
            if (axios.isAxiosError(error)) {
                // Silently fail if server is not reachable (user might be offline)
                console.error('Failed to fetch ports:', error.message);
            } else {
                console.error('Unexpected error fetching ports:', error);
            }
        }
    }

    /**
     * Show notification for newly discovered port
     */
    private async showNewPortNotification(port: PortInfo): Promise<void> {
        const processInfo = port.runningProcess ? ` (${port.runningProcess})` : '';
        const selection = await vscode.window.showInformationMessage(
            `New port discovered: ${port.port}${processInfo}`,
            'Open',
            'Dismiss'
        );

        if (selection === 'Open') {
            // Get base URL from VS Code environment
            const dummyUri = await vscode.env.asExternalUri(vscode.Uri.parse('http://localhost:8080'));
            // Strip any path from authority, keep only host
            const baseUrl = `${dummyUri.scheme}://${dummyUri.authority.split('/')[0]}`;
            const url = `${baseUrl}/distiller/proxy/${port.port}/`;

            await vscode.env.openExternal(vscode.Uri.parse(url));
        }
    }

    dispose(): void {
        this.stop();
        this.onPortsChangedEmitter.dispose();
    }
}

// Import axios for error checking
import axios from 'axios';
