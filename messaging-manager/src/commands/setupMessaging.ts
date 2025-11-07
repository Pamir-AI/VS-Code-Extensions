/**
 * Setup Messaging Command
 * Initiates OAuth flow via browser and receives webhook via WebSocket
 */

import * as vscode from 'vscode';
import { getMACAddress } from '../device/macReader';
import { buildSetupURL, healthCheck } from '../api/messagingClient';
import { isWebhookConfigured, saveWebhookConfig } from '../storage/webhookStorage';
import { waitForWebhook } from '../api/websocketClient';
import type { WebhookConfig } from '../types';

/**
 * Setup Slack messaging integration
 *
 * Flow:
 * 1. Check if already configured
 * 2. Get device MAC address
 * 3. Open browser to OAuth URL
 * 4. Wait for webhook data via WebSocket (real-time push from server)
 * 5. Save webhook configuration
 */
export async function setupMessaging(): Promise<void> {
    try {
        // Check if already configured
        const alreadyConfigured = await isWebhookConfigured();
        if (alreadyConfigured) {
            const choice = await vscode.window.showWarningMessage(
                'Slack messaging is already configured. Do you want to reconfigure?',
                'Reconfigure',
                'Cancel'
            );

            if (choice !== 'Reconfigure') {
                return;
            }
        }

        // Check server health
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Checking messaging server...',
                cancellable: false,
            },
            async () => {
                const isHealthy = await healthCheck();
                if (!isHealthy) {
                    throw new Error('Messaging server is not responding. Please try again later.');
                }
            }
        );

        // Get device MAC address
        const macAddress = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Reading device information...',
                cancellable: false,
            },
            async () => {
                return await getMACAddress();
            }
        );

        // Note: We don't need vscode_url parameter anymore since we use WebSocket
        // Build OAuth URL (server doesn't need to redirect back)
        const oauthUrl = buildSetupURL(macAddress);

        // Show instructions and open browser
        vscode.window.showInformationMessage(
            `Opening Slack authorization in your browser...\n\nMAC: ${macAddress}`
        );

        // Open browser - user will authorize on Slack
        await vscode.env.openExternal(vscode.Uri.parse(oauthUrl));

        console.log('OAuth flow initiated, connecting to WebSocket...');

        // Wait for webhook data via WebSocket with progress indicator
        const webhookData = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Waiting for Slack authorization...',
                cancellable: false,
            },
            async () => {
                return await waitForWebhook(macAddress, 300000); // 5 minute timeout
            }
        );

        // Save webhook configuration
        const config: WebhookConfig = {
            device_id: webhookData.device_id,
            webhook_url: webhookData.webhook_url,
            channel: webhookData.channel,
            team_name: webhookData.team_name,
            team_id: '', // Not provided by server
            configured_at: new Date().toISOString()
        };

        await saveWebhookConfig(config);

        // Show success message
        vscode.window.showInformationMessage(
            `✅ Slack connected: ${webhookData.channel} (${webhookData.team_name})`
        );

        console.log('Webhook configuration saved successfully');

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to setup Slack messaging: ${message}`);
        console.error('Setup messaging error:', error);
        // Don't re-throw - we've already shown the error to the user
    }
}
