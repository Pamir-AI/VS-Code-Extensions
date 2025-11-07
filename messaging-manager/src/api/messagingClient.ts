/**
 * API Client for messaging.pamir.ai
 * Handles communication with the stateless OAuth server
 */

const MESSAGING_API_BASE = 'https://messaging.pamir.ai';

/**
 * Check if server is healthy
 *
 * @returns true if server is responding
 */
export async function healthCheck(): Promise<boolean> {
    try {
        const response = await fetch(`${MESSAGING_API_BASE}/health`);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Build OAuth setup URL for device
 *
 * @param macAddress Device MAC address
 * @returns Full OAuth setup URL
 */
export function buildSetupURL(macAddress: string): string {
    return `${MESSAGING_API_BASE}/setup?mac=${encodeURIComponent(macAddress)}`;
}
