/**
 * Remove Integration Command
 * Deletes local webhook configuration
 */

import * as vscode from 'vscode';
import { deleteWebhookConfig, loadWebhookConfig } from '../storage/webhookStorage';

/**
 * Remove Slack messaging integration
 *
 * This only removes the local webhook configuration.
 * The webhook itself remains active in Slack until revoked by the user.
 */
export async function removeIntegration(): Promise<void> {
    try {
        // Load current config to show details
        const config = await loadWebhookConfig();

        if (!config) {
            vscode.window.showInformationMessage('No Slack integration configured.');
            return;
        }

        // Confirm removal
        const choice = await vscode.window.showWarningMessage(
            `Remove Slack Integration?\n\nThis will delete the local webhook configuration.\n\nWorkspace: ${config.team_name}\nChannel: ${config.channel}\n\nNote: The webhook will remain active in Slack until you revoke it manually in your workspace settings.`,
            { modal: true },
            'Remove',
            'Cancel'
        );

        if (choice !== 'Remove') {
            return;
        }

        // Delete configuration file
        const deleted = await deleteWebhookConfig();

        if (deleted) {
            vscode.window.showInformationMessage(
                '✅ Slack integration removed.\n\nTo revoke the webhook in Slack, go to:\nWorkspace Settings → Apps → Manage → Incoming Webhooks'
            );
        } else {
            vscode.window.showWarningMessage('No configuration file found to remove.');
        }

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to remove integration: ${message}`);
    }
}
