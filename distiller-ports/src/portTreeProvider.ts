import * as vscode from 'vscode';
import { PortInfo, PortOrigin } from './types';

export class PortTreeItem extends vscode.TreeItem {
    constructor(
        public readonly portInfo: PortInfo,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(`Port ${portInfo.port}`, collapsibleState);

        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = portInfo.isExclude ? 'excludedPort' : 'port';

        // Set icon based on status
        this.iconPath = new vscode.ThemeIcon(
            portInfo.isExclude ? 'circle-slash' :
            portInfo.status === 'active' ? 'circle-filled' : 'circle-outline',
            portInfo.status === 'active' && !portInfo.isExclude
                ? new vscode.ThemeColor('charts.green')
                : undefined
        );
    }

    private buildDescription(): string {
        const parts: string[] = [];

        if (this.portInfo.runningProcess) {
            parts.push(this.portInfo.runningProcess);
        }

        if (this.portInfo.isExclude) {
            parts.push('(excluded)');
        } else if (this.portInfo.status === 'inactive') {
            parts.push('(inactive)');
        }

        return parts.join(' ');
    }

    private buildTooltip(): string {
        const lines: string[] = [
            `Port: ${this.portInfo.port}`,
            `Status: ${this.portInfo.status}`,
            `Origin: ${this.portInfo.origin}`,
        ];

        if (this.portInfo.runningProcess) {
            lines.push(`Process: ${this.portInfo.runningProcess}`);
        }

        if (this.portInfo.isExclude) {
            lines.push('⚠️ This port is excluded from forwarding');
        } else {
            lines.push(`Proxy URL: ${this.portInfo.url}`);
        }

        return lines.join('\n');
    }
}

export class OriginGroupItem extends vscode.TreeItem {
    constructor(
        public readonly origin: PortOrigin,
        public readonly count: number,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(origin, collapsibleState);
        this.description = `${count} port${count !== 1 ? 's' : ''}`;
        this.contextValue = 'originGroup';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export class PortTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private ports: PortInfo[] = [];
    private groupByOrigin = true;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    updatePorts(ports: PortInfo[]): void {
        this.ports = ports;
        this.refresh();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!element) {
            // Root level
            if (this.groupByOrigin) {
                return this.getOriginGroups();
            } else {
                return this.ports.map(p => new PortTreeItem(p, vscode.TreeItemCollapsibleState.None));
            }
        }

        // Children of origin groups
        if (element instanceof OriginGroupItem) {
            const portsInGroup = this.ports.filter(p => p.origin === element.origin);
            return portsInGroup.map(p => new PortTreeItem(p, vscode.TreeItemCollapsibleState.None));
        }

        return [];
    }

    private getOriginGroups(): OriginGroupItem[] {
        // Group ports by origin
        const groups = new Map<PortOrigin, PortInfo[]>();

        for (const port of this.ports) {
            const existing = groups.get(port.origin) || [];
            existing.push(port);
            groups.set(port.origin, existing);
        }

        // Convert to tree items
        const items: OriginGroupItem[] = [];
        const originOrder: PortOrigin[] = ['Auto Forwarded', 'User Forwarded', 'Initial Snapshot', 'User Excluded'];

        for (const origin of originOrder) {
            const portsInGroup = groups.get(origin);
            if (portsInGroup && portsInGroup.length > 0) {
                items.push(
                    new OriginGroupItem(
                        origin,
                        portsInGroup.length,
                        vscode.TreeItemCollapsibleState.Collapsed
                    )
                );
            }
        }

        return items;
    }

    /**
     * Get port info from tree item
     */
    getPortInfo(element: vscode.TreeItem): PortInfo | undefined {
        if (element instanceof PortTreeItem) {
            return element.portInfo;
        }
        return undefined;
    }
}
