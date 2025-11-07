/**
 * Webhook Storage
 * Manages webhook configuration in ~/.messaging/webhook.json
 */

import * as fs from 'fs';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import { WebhookConfig } from '../types';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// Use home directory for user-accessible storage
const WEBHOOK_DIR = path.join(os.homedir(), '.messaging');
const WEBHOOK_CONFIG_PATH = path.join(WEBHOOK_DIR, 'webhook.json');

/**
 * Save webhook configuration to ~/.messaging/webhook.json
 *
 * @param config Webhook configuration to save
 */
export async function saveWebhookConfig(config: WebhookConfig): Promise<void> {
    try {
        // Ensure directory exists
        await mkdir(WEBHOOK_DIR, { recursive: true });

        // Write configuration
        const json = JSON.stringify(config, null, 2);
        await writeFile(WEBHOOK_CONFIG_PATH, json, 'utf8');
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to save webhook configuration: ${error.message}`);
        }
        throw new Error('Failed to save webhook configuration');
    }
}

/**
 * Load webhook configuration from ~/.messaging/webhook.json
 *
 * @returns Webhook configuration or null if not found
 */
export async function loadWebhookConfig(): Promise<WebhookConfig | null> {
    try {
        const data = await readFile(WEBHOOK_CONFIG_PATH, 'utf8');
        const config: WebhookConfig = JSON.parse(data);
        return config;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // File doesn't exist - not configured yet
            return null;
        }
        throw new Error(`Failed to load webhook configuration: ${error.message}`);
    }
}

/**
 * Delete webhook configuration file
 *
 * @returns true if deleted, false if file didn't exist
 */
export async function deleteWebhookConfig(): Promise<boolean> {
    try {
        await unlink(WEBHOOK_CONFIG_PATH);
        return true;
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // File doesn't exist
            return false;
        }
        throw new Error(`Failed to delete webhook configuration: ${error.message}`);
    }
}

/**
 * Check if webhook is configured
 *
 * @returns true if webhook.json exists
 */
export async function isWebhookConfigured(): Promise<boolean> {
    try {
        await fs.promises.access(WEBHOOK_CONFIG_PATH, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}
