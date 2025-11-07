/**
 * Copy Webhook URL Command
 * Copies the webhook URL to clipboard
 */

import * as vscode from 'vscode';
import { loadWebhookConfig } from '../storage/webhookStorage';

/**
 * Copy webhook URL to clipboard
 */
export async function copyWebhookUrl(): Promise<void> {
    try {
        const config = await loadWebhookConfig();

        if (!config) {
            vscode.window.showWarningMessage(
                'Slack messaging is not configured. Run "Pamir: Setup Slack Messaging" first.'
            );
            return;
        }

        // Copy to clipboard
        await vscode.env.clipboard.writeText(config.webhook_url);

        vscode.window.showInformationMessage('✅ Webhook URL copied to clipboard!');

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to copy webhook URL: ${message}`);
        console.error('Copy webhook URL error:', error);
    }
}
