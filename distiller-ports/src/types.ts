// Types for port discovery API

export type PortOrigin = 'Initial Snapshot' | 'Auto Forwarded' | 'User Forwarded' | 'User Excluded';
export type PortStatus = 'active' | 'inactive';

export interface PortInfo {
    port: number;
    origin: PortOrigin;
    status: PortStatus;
    runningProcess?: string;
    url: string;
    isExclude: boolean;
}

export interface PortDiscoveryResponse {
    ports: PortInfo[];
}

export interface PortActionRequest {
    port: number;
}
