import * as vscode from 'vscode';
import { PortApiClient } from './portApiClient';
import { PortDiscoveryService } from './portDiscoveryService';
import { PortTreeProvider, PortTreeItem } from './portTreeProvider';

let portDiscoveryService: PortDiscoveryService | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Distiller Port Manager extension is now active');

    // Get configuration
    const config = vscode.workspace.getConfiguration('distillerPorts');
    const serverUrl = config.get<string>('serverUrl', 'http://127.0.0.1:3000');
    const pollInterval = config.get<number>('pollInterval', 2000);
    const showNotifications = config.get<boolean>('showNotifications', true);

    // Initialize API client
    const apiClient = new PortApiClient(serverUrl);

    // Initialize port discovery service
    portDiscoveryService = new PortDiscoveryService(apiClient, pollInterval, showNotifications);

    // Initialize tree view provider
    const treeProvider = new PortTreeProvider();
    const treeView = vscode.window.createTreeView('distillerPorts', {
        treeDataProvider: treeProvider,
        showCollapseAll: true
    });

    // Initialize status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'distillerPorts.refresh';
    statusBarItem.text = '$(plug) 0 ports';
    statusBarItem.tooltip = 'Click to refresh discovered ports';
    statusBarItem.show();

    // Listen to port changes
    portDiscoveryService.onPortsChanged(ports => {
        treeProvider.updatePorts(ports);
        updateStatusBar(ports.filter(p => !p.isExclude && p.status === 'active').length);
    });

    // Start polling
    portDiscoveryService.start();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.refresh', async () => {
            await portDiscoveryService?.refresh();
            vscode.window.showInformationMessage('Port list refreshed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.openInBrowser', async (item: PortTreeItem) => {
            const portInfo = treeProvider.getPortInfo(item);
            if (portInfo && !portInfo.isExclude) {
                // Get the external URI of a dummy localhost URL to extract the base URL
                // This tells us what the external host is (e.g., https://eva.devices.pamir.ai)
                const dummyUri = await vscode.env.asExternalUri(vscode.Uri.parse('http://localhost:8080'));

                // Extract base URL (protocol + host only, strip any path)
                // authority might include path like "192.168.4.69/proxy/3000/vscode"
                // We only want the host part
                const baseUrl = `${dummyUri.scheme}://${dummyUri.authority.split('/')[0]}`;

                // Construct the distiller proxy URL using the base URL
                const url = `${baseUrl}/distiller/proxy/${portInfo.port}/`;

                await vscode.env.openExternal(vscode.Uri.parse(url));
            } else {
                vscode.window.showWarningMessage('Cannot open excluded or invalid port');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.copyUrl', async (item: PortTreeItem) => {
            const portInfo = treeProvider.getPortInfo(item);
            if (portInfo) {
                // Get base URL from VS Code environment
                const dummyUri = await vscode.env.asExternalUri(vscode.Uri.parse('http://localhost:8080'));
                // Strip any path from authority, keep only host
                const baseUrl = `${dummyUri.scheme}://${dummyUri.authority.split('/')[0]}`;
                const url = `${baseUrl}/distiller/proxy/${portInfo.port}/`;

                await vscode.env.clipboard.writeText(url);
                vscode.window.showInformationMessage(`Copied URL: ${url}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.copyPortNumber', async (item: PortTreeItem) => {
            const portInfo = treeProvider.getPortInfo(item);
            if (portInfo) {
                await vscode.env.clipboard.writeText(portInfo.port.toString());
                vscode.window.showInformationMessage(`Copied port number: ${portInfo.port}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.registerPort', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'Enter port number to register',
                placeHolder: '3000',
                validateInput: (value) => {
                    const port = parseInt(value, 10);
                    if (isNaN(port) || port < 1 || port > 65535) {
                        return 'Please enter a valid port number (1-65535)';
                    }
                    return null;
                }
            });

            if (input) {
                const port = parseInt(input, 10);
                try {
                    await apiClient.registerPort(port);
                    vscode.window.showInformationMessage(`Port ${port} registered successfully`);
                    await portDiscoveryService?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to register port: ${error}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.excludePort', async (item: PortTreeItem) => {
            const portInfo = treeProvider.getPortInfo(item);
            if (portInfo) {
                try {
                    await apiClient.excludePort(portInfo.port);
                    vscode.window.showInformationMessage(`Port ${portInfo.port} excluded`);
                    await portDiscoveryService?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to exclude port: ${error}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('distillerPorts.unexcludePort', async (item: PortTreeItem) => {
            const portInfo = treeProvider.getPortInfo(item);
            if (portInfo) {
                try {
                    await apiClient.unexcludePort(portInfo.port);
                    vscode.window.showInformationMessage(`Port ${portInfo.port} unexcluded`);
                    await portDiscoveryService?.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to unexclude port: ${error}`);
                }
            }
        })
    );

    // Listen to configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('distillerPorts')) {
                const newConfig = vscode.workspace.getConfiguration('distillerPorts');
                const newServerUrl = newConfig.get<string>('serverUrl', 'http://127.0.0.1:3000');
                const newPollInterval = newConfig.get<number>('pollInterval', 2000);
                const newShowNotifications = newConfig.get<boolean>('showNotifications', true);

                apiClient.updateBaseUrl(newServerUrl);
                portDiscoveryService?.updateConfig(newPollInterval, newShowNotifications);
            }
        })
    );

    // Register disposables
    context.subscriptions.push(treeView);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push({
        dispose: () => {
            portDiscoveryService?.dispose();
        }
    });
}

function updateStatusBar(activePortCount: number): void {
    if (statusBarItem) {
        statusBarItem.text = `$(plug) ${activePortCount} port${activePortCount !== 1 ? 's' : ''}`;
    }
}

export function deactivate() {
    portDiscoveryService?.dispose();
    statusBarItem?.dispose();
}
