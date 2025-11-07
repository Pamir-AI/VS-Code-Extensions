/**
 * Messaging Tree View for Sidebar
 * Displays webhook status and provides quick actions
 */

import * as vscode from 'vscode';
import { loadWebhookConfig } from '../storage/webhookStorage';
import { getMACAddress, getIPAddress } from '../device/macReader';

/**
 * Tree item types
 */
enum TreeItemType {
    Status = 'status',
    Device = 'device',
    Slack = 'slack',
    Usage = 'usage',
    Action = 'action',
}

/**
 * Tree item for the sidebar
 */
class MessagingTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly description?: string,
        public readonly iconPath?: vscode.ThemeIcon
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;
        this.contextValue = type;
    }
}

/**
 * Tree data provider for messaging sidebar
 */
export class MessagingTreeDataProvider implements vscode.TreeDataProvider<MessagingTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MessagingTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: MessagingTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children for tree items
     */
    async getChildren(element?: MessagingTreeItem): Promise<MessagingTreeItem[]> {
        if (!element) {
            // Root level - show main sections
            return this.getRootItems();
        }

        // Child items based on parent type
        switch (element.type) {
            case TreeItemType.Device:
                return this.getDeviceItems();
            case TreeItemType.Slack:
                return this.getSlackItems();
            case TreeItemType.Usage:
                return this.getUsageItems();
            default:
                return [];
        }
    }

    /**
     * Get root level items
     */
    private async getRootItems(): Promise<MessagingTreeItem[]> {
        const config = await loadWebhookConfig();
        const items: MessagingTreeItem[] = [];

        // Status indicator
        if (config) {
            items.push(
                new MessagingTreeItem(
                    'Connected',
                    TreeItemType.Status,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    undefined,
                    new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'))
                )
            );
        } else {
            items.push(
                new MessagingTreeItem(
                    'Not Configured',
                    TreeItemType.Status,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    undefined,
                    new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('terminal.ansiYellow'))
                )
            );
        }

        // Device info section
        items.push(
            new MessagingTreeItem(
                'Device',
                TreeItemType.Device,
                vscode.TreeItemCollapsibleState.Expanded,
                undefined,
                undefined,
                new vscode.ThemeIcon('device-desktop')
            )
        );

        // Slack info section (if configured)
        if (config) {
            items.push(
                new MessagingTreeItem(
                    'Slack',
                    TreeItemType.Slack,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    undefined,
                    new vscode.ThemeIcon('symbol-method')
                )
            );

            // Usage guide section
            items.push(
                new MessagingTreeItem(
                    'Usage Guide',
                    TreeItemType.Usage,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    undefined,
                    new vscode.ThemeIcon('info')
                )
            );
        }

        // Action buttons
        if (config) {
            items.push(
                new MessagingTreeItem(
                    'Send Test Message',
                    TreeItemType.Action,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'pamir.testMessage',
                        title: 'Test',
                    },
                    undefined,
                    new vscode.ThemeIcon('send')
                )
            );
            items.push(
                new MessagingTreeItem(
                    'Reconfigure',
                    TreeItemType.Action,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'pamir.setupMessaging',
                        title: 'Setup',
                    },
                    undefined,
                    new vscode.ThemeIcon('refresh')
                )
            );
            items.push(
                new MessagingTreeItem(
                    'Remove Integration',
                    TreeItemType.Action,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'pamir.removeIntegration',
                        title: 'Remove',
                    },
                    undefined,
                    new vscode.ThemeIcon('trash')
                )
            );
        } else {
            items.push(
                new MessagingTreeItem(
                    'Setup Slack Messaging',
                    TreeItemType.Action,
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'pamir.setupMessaging',
                        title: 'Setup',
                    },
                    undefined,
                    new vscode.ThemeIcon('add')
                )
            );
        }

        return items;
    }

    /**
     * Get device information items
     */
    private async getDeviceItems(): Promise<MessagingTreeItem[]> {
        const config = await loadWebhookConfig();
        const items: MessagingTreeItem[] = [];

        // Device ID
        if (config) {
            items.push(
                new MessagingTreeItem(
                    'ID',
                    TreeItemType.Device,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    config.device_id,
                    new vscode.ThemeIcon('tag')
                )
            );
        }

        // MAC Address
        try {
            const mac = await getMACAddress();
            items.push(
                new MessagingTreeItem(
                    'MAC',
                    TreeItemType.Device,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    mac,
                    new vscode.ThemeIcon('circuit-board')
                )
            );
        } catch {
            items.push(
                new MessagingTreeItem(
                    'MAC',
                    TreeItemType.Device,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'N/A',
                    new vscode.ThemeIcon('error')
                )
            );
        }

        // IP Address
        try {
            const ip = await getIPAddress();
            items.push(
                new MessagingTreeItem(
                    'IP',
                    TreeItemType.Device,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    ip,
                    new vscode.ThemeIcon('globe')
                )
            );
        } catch {
            items.push(
                new MessagingTreeItem(
                    'IP',
                    TreeItemType.Device,
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'N/A',
                    new vscode.ThemeIcon('error')
                )
            );
        }

        return items;
    }

    /**
     * Get Slack information items
     */
    private async getSlackItems(): Promise<MessagingTreeItem[]> {
        const config = await loadWebhookConfig();
        if (!config) {
            return [];
        }

        const configPath = require('path').join(require('os').homedir(), '.messaging', 'webhook.json');

        return [
            new MessagingTreeItem(
                'Saved at',
                TreeItemType.Slack,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                configPath,
                new vscode.ThemeIcon('file')
            ),
            new MessagingTreeItem(
                'Channel',
                TreeItemType.Slack,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                config.channel,
                new vscode.ThemeIcon('comment')
            ),
            new MessagingTreeItem(
                'Configured',
                TreeItemType.Slack,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                new Date(config.configured_at).toLocaleString(),
                new vscode.ThemeIcon('calendar')
            ),
        ];
    }

    /**
     * Get usage guide items
     */
    private async getUsageItems(): Promise<MessagingTreeItem[]> {
        const config = await loadWebhookConfig();
        if (!config) {
            return [];
        }

        return [
            new MessagingTreeItem(
                'How to use',
                TreeItemType.Usage,
                vscode.TreeItemCollapsibleState.None,
                undefined,
                'Copy webhook URL and ask your coding agent to send messages to it',
                new vscode.ThemeIcon('lightbulb')
            ),
            new MessagingTreeItem(
                'Webhook URL',
                TreeItemType.Usage,
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'pamir.copyWebhookUrl',
                    title: 'Copy',
                },
                'Click to copy',
                new vscode.ThemeIcon('link')
            ),
        ];
    }
}
