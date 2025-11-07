/**
 * Distiller Messaging Extension
 * Manages Slack webhook integrations for Distiller devices
 */

import * as vscode from 'vscode';
import { setupMessaging } from './commands/setupMessaging';
import { viewStatus } from './commands/viewStatus';
import { removeIntegration } from './commands/removeIntegration';
import { testMessage } from './commands/testMessage';
import { copyWebhookUrl } from './commands/copyWebhookUrl';
import { MessagingTreeDataProvider } from './ui/messagingTreeView';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
	console.log('Distiller Messaging extension activated');

	// Create tree data provider
	const treeDataProvider = new MessagingTreeDataProvider();

	// Register tree view
	const treeView = vscode.window.createTreeView('pamir.messagingView', {
		treeDataProvider: treeDataProvider,
		showCollapseAll: false,
	});

	// Register commands
	const commands = [
		vscode.commands.registerCommand('pamir.setupMessaging', async () => {
			await setupMessaging();
			treeDataProvider.refresh(); // Refresh tree after setup
		}),
		vscode.commands.registerCommand('pamir.viewStatus', viewStatus),
		vscode.commands.registerCommand('pamir.removeIntegration', async () => {
			await removeIntegration();
			treeDataProvider.refresh(); // Refresh tree after removal
		}),
		vscode.commands.registerCommand('pamir.testMessage', testMessage),
		vscode.commands.registerCommand('pamir.copyWebhookUrl', copyWebhookUrl),
		vscode.commands.registerCommand('pamir.refreshView', () => {
			treeDataProvider.refresh();
		}),
	];

	// Add all to subscriptions
	context.subscriptions.push(treeView, ...commands);

	console.log('Distiller Messaging: All commands and views registered');
}

/**
 * Extension deactivation
 */
export function deactivate() {
	console.log('Pamir Messaging Manager extension deactivated');
}
