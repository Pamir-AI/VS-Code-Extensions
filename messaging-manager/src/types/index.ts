/**
 * Types for Pamir Messaging Manager Extension
 */

/**
 * Webhook configuration stored on device
 */
export interface WebhookConfig {
    device_id: string;
    webhook_url: string;
    channel: string;
    team_name: string;
    team_id: string;
    configured_at: string;
}

/**
 * Response from /device/webhook/<device_id> endpoint
 */
export interface WebhookResponse {
    webhook_url: string;
    channel: string;
    team_name: string;
}

/**
 * Device information
 */
export interface DeviceInfo {
    mac_address: string;
    ip_address: string;
    device_id?: string;
}

/**
 * API error response
 */
export interface ApiError {
    error: string;
    message?: string;
}
