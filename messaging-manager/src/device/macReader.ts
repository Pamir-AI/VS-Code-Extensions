/**
 * MAC Address Reader
 * Retrieves device MAC address using system Python script
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get MAC address from device using Python script
 *
 * Uses the same method as claude-onboard extension:
 * Executes /opt/distiller-telemetry/get_mac.py
 *
 * @returns MAC address in format XX:XX:XX:XX:XX:XX
 * @throws Error if MAC address cannot be retrieved
 */
export async function getMACAddress(): Promise<string> {
    try {
        const { stdout } = await execAsync('python3 /opt/distiller-telemetry/get_mac.py');

        // Extract MAC address using regex (case-insensitive)
        const macMatch = stdout.match(/([0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2})/i);

        if (!macMatch || !macMatch[1]) {
            throw new Error('MAC address not found in output');
        }

        return macMatch[1].toLowerCase();
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to retrieve MAC address: ${error.message}`);
        }
        throw new Error('Failed to retrieve MAC address: Unknown error');
    }
}

/**
 * Get IP address from device
 *
 * @returns IP address or 'N/A' if not found
 */
export async function getIPAddress(): Promise<string> {
    try {
        const { stdout } = await execAsync("hostname -I | awk '{print $1}'");
        return stdout.trim() || 'N/A';
    } catch (error) {
        return 'N/A';
    }
}
