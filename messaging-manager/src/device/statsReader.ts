/**
 * Device Stats Reader
 * Reads system stats from /proc filesystem
 */

import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);

/**
 * Device statistics
 */
export interface DeviceStats {
    temperature: number | null;  // Celsius
    temperatureStr: string;
    memory: {
        total: number;           // MB
        used: number;            // MB
        available: number;       // MB
        usedPercent: number;     // 0-100
    } | null;
    memoryStr: string;
    uptime: number | null;       // seconds
    uptimeStr: string;
    cpuUsage: number | null;     // percent
    cpuUsageStr: string;
}

/**
 * Get CPU temperature from thermal zone
 */
async function getCPUTemperature(): Promise<number | null> {
    try {
        const tempStr = await readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        const temp = parseInt(tempStr.trim()) / 1000; // Convert from millidegrees
        return temp;
    } catch {
        return null;
    }
}

/**
 * Get memory statistics from /proc/meminfo
 */
async function getMemoryStats(): Promise<DeviceStats['memory']> {
    try {
        const meminfo = await readFile('/proc/meminfo', 'utf8');
        const lines = meminfo.split('\n');

        let total = 0;
        let available = 0;

        for (const line of lines) {
            if (line.startsWith('MemTotal:')) {
                total = parseInt(line.split(/\s+/)[1]) / 1024; // KB to MB
            } else if (line.startsWith('MemAvailable:')) {
                available = parseInt(line.split(/\s+/)[1]) / 1024; // KB to MB
            }
        }

        const used = total - available;
        const usedPercent = total > 0 ? (used / total) * 100 : 0;

        return {
            total: Math.round(total),
            used: Math.round(used),
            available: Math.round(available),
            usedPercent: Math.round(usedPercent)
        };
    } catch {
        return null;
    }
}

/**
 * Get system uptime from /proc/uptime
 */
async function getUptime(): Promise<number | null> {
    try {
        const uptimeStr = await readFile('/proc/uptime', 'utf8');
        const uptime = parseFloat(uptimeStr.split(' ')[0]);
        return uptime;
    } catch {
        return null;
    }
}

/**
 * Get CPU usage from /proc/stat
 * This is a snapshot - for accurate usage, you'd need to sample twice
 */
async function getCPUUsage(): Promise<number | null> {
    try {
        const stat = await readFile('/proc/stat', 'utf8');
        const lines = stat.split('\n');
        const cpuLine = lines[0];

        if (!cpuLine.startsWith('cpu ')) {
            return null;
        }

        const values = cpuLine.split(/\s+/).slice(1).map(v => parseInt(v));
        const [user, nice, system, idle, iowait, irq, softirq] = values;

        const totalIdle = idle + iowait;
        const totalActive = user + nice + system + irq + softirq;
        const total = totalIdle + totalActive;

        const usage = total > 0 ? (totalActive / total) * 100 : 0;
        return usage;
    } catch {
        return null;
    }
}

/**
 * Format uptime into human-readable string
 */
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${days}d`);
    }
    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (mins > 0) {
        parts.push(`${mins}m`);
    }

    return parts.length > 0 ? parts.join(' ') : '< 1m';
}

/**
 * Get all device statistics
 */
export async function getDeviceStats(): Promise<DeviceStats> {
    const [temperature, memory, uptime, cpuUsage] = await Promise.all([
        getCPUTemperature(),
        getMemoryStats(),
        getUptime(),
        getCPUUsage()
    ]);

    return {
        temperature,
        temperatureStr: temperature !== null ? `${temperature.toFixed(1)}°C` : 'N/A',
        memory,
        memoryStr: memory !== null
            ? `${memory.used}MB / ${memory.total}MB (${memory.usedPercent}%)`
            : 'N/A',
        uptime,
        uptimeStr: uptime !== null ? formatUptime(uptime) : 'N/A',
        cpuUsage,
        cpuUsageStr: cpuUsage !== null ? `${cpuUsage.toFixed(1)}%` : 'N/A'
    };
}
