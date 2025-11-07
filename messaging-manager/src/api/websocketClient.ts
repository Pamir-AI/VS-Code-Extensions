/**
 * Socket.IO Client for Real-time Webhook Delivery
 * Connects to messaging.pamir.ai Socket.IO server to receive webhook data
 */

import { io, Socket } from 'socket.io-client';

export interface WebhookData {
    webhook_url: string;
    channel: string;
    team_name: string;
    device_id: string;
}

/**
 * Connect to server Socket.IO and wait for webhook data
 *
 * @param macAddress Device MAC address
 * @param timeoutMs Timeout in milliseconds (default 5 minutes)
 * @returns Promise that resolves with webhook data or rejects on timeout/error
 */
export function waitForWebhook(macAddress: string, timeoutMs: number = 300000): Promise<WebhookData> {
    return new Promise((resolve, reject) => {
        const socketUrl = `https://messaging.pamir.ai?mac=${encodeURIComponent(macAddress)}`;

        console.log(`Connecting to Socket.IO: ${socketUrl}`);

        const socket: Socket = io(socketUrl, {
            transports: ['polling', 'websocket'],  // Try polling first, then upgrade to websocket
            reconnection: false
        });

        let isResolved = false;

        // Set timeout
        const timeout = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                socket.disconnect();
                reject(new Error('Timeout waiting for webhook data (5 minutes)'));
            }
        }, timeoutMs);

        socket.on('connect', () => {
            console.log('Socket.IO connected, waiting for webhook data...');
        });

        socket.on('webhook_ready', (data: WebhookData) => {
            console.log('Webhook data received:', data);

            if (data.webhook_url) {
                isResolved = true;
                clearTimeout(timeout);
                socket.disconnect();

                console.log('Webhook data received successfully');
                resolve({
                    webhook_url: data.webhook_url,
                    channel: data.channel,
                    team_name: data.team_name,
                    device_id: data.device_id
                });
            }
        });

        socket.on('connect_error', (error) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                console.error('Socket.IO connection error:', error);
                reject(error);
            }
        });

        socket.on('disconnect', () => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                console.log('Socket.IO connection closed');
                reject(new Error('Socket.IO connection closed unexpectedly'));
            }
        });
    });
}
