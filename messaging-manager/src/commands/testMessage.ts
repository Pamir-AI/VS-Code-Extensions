/**
 * Test Message Command
 * Sends a test message with device stats to Slack webhook
 */

import * as vscode from 'vscode';
import { loadWebhookConfig } from '../storage/webhookStorage';
import { getDeviceStats } from '../device/statsReader';

/**
 * Send test message to configured Slack webhook
 */
export async function testMessage(): Promise<void> {
    try {
        // Load webhook configuration
        const config = await loadWebhookConfig();

        if (!config) {
            vscode.window.showWarningMessage(
                'Slack messaging is not configured. Run "Pamir: Setup Slack Messaging" first.'
            );
            return;
        }

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Sending test message...',
                cancellable: false
            },
            async (progress) => {
                // Gather device stats
                progress.report({ message: 'Gathering device stats...' });
                const stats = await getDeviceStats();

                // Build Slack Block Kit message
                const message = {
                    blocks: [
                        {
                            type: 'header',
                            text: {
                                type: 'plain_text',
                                text: `🔔 Test Message from ${config.device_id}`,
                                emoji: true
                            }
                        },
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: '*Device Statistics*'
                            }
                        },
                        {
                            type: 'section',
                            fields: [
                                {
                                    type: 'mrkdwn',
                                    text: `*🌡️ Temperature:*\n${stats.temperatureStr}`
                                },
                                {
                                    type: 'mrkdwn',
                                    text: `*💾 Memory:*\n${stats.memoryStr}`
                                },
                                {
                                    type: 'mrkdwn',
                                    text: `*⏱️ Uptime:*\n${stats.uptimeStr}`
                                },
                                {
                                    type: 'mrkdwn',
                                    text: `*⚡ CPU Usage:*\n${stats.cpuUsageStr}`
                                }
                            ]
                        },
                        {
                            type: 'context',
                            elements: [
                                {
                                    type: 'mrkdwn',
                                    text: `Sent from Pamir Messaging Extension • ${new Date().toLocaleString()}`
                                }
                            ]
                        }
                    ]
                };

                // Send to webhook
                progress.report({ message: 'Sending to Slack...' });
                const response = await fetch(config.webhook_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(message)
                });

                if (!response.ok) {
                    throw new Error(`Slack webhook returned ${response.status}: ${response.statusText}`);
                }

                vscode.window.showInformationMessage(
                    `✅ Test message sent successfully to ${config.channel}!`
                );
            }
        );

    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Failed to send test message: ${message}`);
        console.error('Test message error:', error);
    }
}
