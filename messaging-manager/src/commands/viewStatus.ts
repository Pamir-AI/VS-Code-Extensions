/**
 * View Status Command
 * Displays current webhook configuration
 */

import * as vscode from 'vscode';
import { loadWebhookConfig } from '../storage/webhookStorage';
import { getMACAddress, getIPAddress } from '../device/macReader';

/**
 * View current Slack messaging status
 */
export async function viewStatus(): Promise<void> {
    try {
        const config = await loadWebhookConfig();

        if (!config) {
            vscode.window.showInformationMessage(
                'Slack messaging is not configured.\n\nRun "Pamir: Setup Slack Messaging" to configure.'
            );
            return;
        }

        // Get device info
        let macAddress = 'N/A';
        let ipAddress = 'N/A';
        try {
            macAddress = await getMACAddress();
            ipAddress = await getIPAddress();
        } catch (error) {
            // Ignore errors, show N/A
        }

        // Format configuration date
        const configDate = new Date(config.configured_at);
        const dateStr = configDate.toLocaleString();

        // Build status message
        const message = `
Slack Messaging Status

✅ Configured

Device Information:
  • Device ID: ${config.device_id}
  • MAC Address: ${macAddress}
  • IP Address: ${ipAddress}

Slack Configuration:
  • Workspace: ${config.team_name}
  • Channel: ${config.channel}
  • Configured: ${dateStr}

Webhook URL:
  ${maskWebhookUrl(config.webhook_url)}
        `.trim();

        // Show in information message
        const choice = await vscode.window.showInformationMessage(
            message,
            'Reconfigure',
            'Remove',
            'Close'
        );

        if (choice === 'Reconfigure') {
            await vscode.commands.executeCommand('pamir.setupMessaging');
        } else if (choice === 'Remove') {
            await vscode.commands.executeCommand('pamir.removeIntegration');
        }

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to load status: ${message}`);
    }
}

/**
 * Mask webhook URL for security
 * Shows only the last 8 characters
 *
 * @param url Full webhook URL
 * @returns Masked URL
 */
function maskWebhookUrl(url: string): string {
    if (url.length <= 8) {
        return '***';
    }
    const visible = url.slice(-8);
    return `...${visible}`;
}
