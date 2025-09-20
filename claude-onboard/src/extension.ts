import * as vscode from 'vscode';
import { spawn, exec } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TRIAL_STATUS_RETRY_INTERVAL_MS = 5000;
const TRIAL_STATUS_RETRY_ATTEMPTS = 6;

// Types for distiller-update JSON responses
interface Package {
	name: string;
	current_version: string | null;
	new_version: string;
	size?: number;
	update_type?: string;
}

interface ListResponse {
	has_updates: boolean;
	packages: Package[];
	summary: string;
	checked_at: string;
}

interface JobStatus {
	code: number;
	sub: string;
}

class WelcomeViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _trialActive: boolean = false;
	private _trialConfirmed: boolean = false;
	private _isProcessing: boolean = false;
	private _errorState: '404' | '500' | null = null;
	private _showHelp: boolean = false;
	private _deviceMac: string = '';
	private _deviceIp: string = '';
	private _updateStatus: string = '';
	private _updateDetails: string = '';
	private _availableUpdates: Package[] = [];
	private _hasCheckedUpdates: boolean = false;
	private _updateLogOutput: string = '';
	private _updateUnit: string = '';
	private _installRemaining: number = 0;
	private _trialStatusSources: { env: boolean; settings: boolean } = { env: false, settings: false };
	private _trialVerificationTimer: NodeJS.Timeout | undefined;
	private _trialVerificationAttemptsRemaining: number = 0;
	
	// Test mode toggle

	constructor(
		private readonly _extensionUri: vscode.Uri
	) {
		this.checkTrialStatus();
		this.getDeviceInfo();
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		this.updateWebview();

			webviewView.webview.onDidReceiveMessage(async data => {
				switch (data.type) {
					case 'startTrial':
						await this.startTrial();
						break;
					case 'stopTrial':
						await this.stopTrial();
						break;
					case 'checkStatus':
						await this.checkTrialStatus();
						this.updateWebview();
						break;
					case 'createProject':
						await this.createAndOpenProjectFolder();
						break;
					case 'navigateProjects':
						await this.openExistingProject();
						break;
					case 'openEink':
						await vscode.commands.executeCommand('device-manager.openEink');
						break;
				case 'toggleHelp':
					this._showHelp = !this._showHelp;
					this.updateWebview();
					break;
				case 'checkUpdates':
					await this.checkForUpdates();
					break;
				case 'installUpdates':
					await this.runSystemUpdate();
					break;
				case 'viewUpdateLogs':
					await this.showUpdateLogs();
					break;
			}
		});

		// Check status when view becomes visible
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.checkTrialStatus();
				this.getDeviceInfo();
				this.updateWebview();
			}
		});
	}

	private async createAndOpenProjectFolder(): Promise<void> {
		try {
			const projectsRoot = path.join(os.homedir(), 'projects');
			await fsp.mkdir(projectsRoot, { recursive: true });

			const now = new Date();
			const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
			const defaultName = `claude-project-${timestamp}`;
			const inputName = await vscode.window.showInputBox({
				prompt: 'Name your Claude project folder',
				value: defaultName,
				placeHolder: 'e.g. my-great-project',
				ignoreFocusOut: true,
			});
			if (!inputName) {
				return;
			}

			const baseName = this.sanitizeProjectName(inputName, defaultName);
			const folderPath = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Creating Claude project folder…' },
				async () => {
					let candidate = path.join(projectsRoot, baseName);
					let suffix = 1;
					while (await this.pathExists(candidate)) {
						candidate = path.join(projectsRoot, `${baseName}-${suffix++}`);
					}

					await fsp.mkdir(candidate);
					return candidate;
				}
			);

			if (!folderPath) {
				return;
			}

			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), true);
			vscode.window.showInformationMessage(`Opened project folder: ${folderPath}`);
		} catch (err: any) {
			vscode.window.showErrorMessage(`Failed to create project folder: ${err?.message ?? err}`);
		}
	}

	private async openExistingProject(): Promise<void> {
		try {
			const projectsRoot = path.join(os.homedir(), 'projects');
			if (!(await this.pathExists(projectsRoot))) {
				vscode.window.showInformationMessage('No projects folder found yet. Create a project first.');
				return;
			}

		const folderPath = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Loading Claude projects…' },
			async () => {
				const entries = await fsp.readdir(projectsRoot, { withFileTypes: true });
				const directories = entries.filter(entry => entry.isDirectory());
					if (directories.length === 0) {
						vscode.window.showInformationMessage('No saved projects available yet.');
						return undefined;
					}

					const metadata = await Promise.all(directories.map(async dir => {
						const fullPath = path.join(projectsRoot, dir.name);
						let mtime = 0;
						try {
							const stat = await fsp.stat(fullPath);
							mtime = stat.mtimeMs;
						} catch {}
						return { name: dir.name, fullPath, mtime };
					}));

						metadata.sort((a, b) => {
							if (b.mtime !== a.mtime) {
								return b.mtime - a.mtime;
							}
							return a.name.localeCompare(b.name);
						});

					const items: Array<vscode.QuickPickItem & { folder: string }> = metadata.map(item => ({
						label: item.name,
						description: path.relative(os.homedir(), item.fullPath) || item.fullPath,
						detail: item.mtime ? `Last modified: ${new Date(item.mtime).toLocaleString()}` : undefined,
						folder: item.fullPath,
					}));

					const pick = await vscode.window.showQuickPick(items, {
						placeHolder: 'Select a Claude project folder to open',
					});
					return pick?.folder;
				}
			);

				if (!folderPath) {
			return;
		}

		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), true);
		vscode.window.showInformationMessage(`Opened project folder: ${folderPath}`);
	} catch (err: any) {
		vscode.window.showErrorMessage(`Failed to open project folder: ${err?.message ?? err}`);
	}
	}

	private sanitizeProjectName(name: string, fallback: string): string {
		const trimmed = name.trim();
		if (!trimmed) {
			return fallback;
		}

		const normalized = trimmed
			.replace(/[\\/:]+/g, '-')
			.replace(/\s+/g, '-')
			.replace(/[^A-Za-z0-9._-]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^[-.]+|[-.]+$/g, '');

		return normalized || fallback;
	}

	private async pathExists(target: string): Promise<boolean> {
		try {
			await fsp.access(target, fs.constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}

	private async getDeviceInfo(): Promise<void> {
		try {
			// Get MAC address using the Python script
			const { stdout: macOutput } = await execAsync('python3 /opt/distiller-telemetry/get_mac.py');
			const macMatch = macOutput.match(/([0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2})/i);
			if (macMatch) {
				this._deviceMac = macMatch[1];
			}

			// Get IP address
			const { stdout: ipOutput } = await execAsync("hostname -I | awk '{print $1}'");
			this._deviceIp = ipOutput.trim() || 'N/A';
		} catch (error) {
			console.error('Failed to get device info:', error);
			this._deviceMac = 'N/A';
			this._deviceIp = 'N/A';
		}
	}

	public async checkTrialStatus(scheduleFollowUp: boolean = true): Promise<void> {
		try {
			// Check both environment file and settings.json
			const envFile = '/etc/distiller-telemetry/environment';
			const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
			
			let hasEnvToken = false;
			let hasSettingsToken = false;

			// Check environment file
			if (fs.existsSync(envFile)) {
				const envContent = fs.readFileSync(envFile, 'utf-8');
				hasEnvToken = envContent.includes('ANTHROPIC_AUTH_TOKEN') && 
							  envContent.includes('ANTHROPIC_BASE_URL') &&
							  envContent.trim().length > 0;
			}

			// Check settings.json
			if (fs.existsSync(settingsFile)) {
				try {
					const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
					hasSettingsToken = settings.env?.ANTHROPIC_AUTH_TOKEN && 
									   settings.env?.ANTHROPIC_BASE_URL;
				} catch (e) {
					console.error('Failed to parse settings.json:', e);
				}
			}

			this._trialStatusSources = { env: hasEnvToken, settings: hasSettingsToken };
			this._trialActive = hasEnvToken || hasSettingsToken;
			this._trialConfirmed = hasEnvToken && hasSettingsToken;
			
			// Clear error state if trial is active
			if (this._trialActive) {
				this._errorState = null;
			}

			const needsFollowUp = this._trialActive && !this._trialConfirmed;
			if (needsFollowUp) {
				if (scheduleFollowUp) {
					this.scheduleTrialVerification();
				}
			} else {
				this.cancelTrialVerification();
			}
		} catch (error) {
			console.error('Failed to check trial status:', error);
			this._trialActive = false;
			this._trialConfirmed = false;
			this._trialStatusSources = { env: false, settings: false };
			this.cancelTrialVerification();
		}
	}

	private scheduleTrialVerification(): void {
		if (this._trialConfirmed) {
			return;
		}

		if (this._trialVerificationAttemptsRemaining <= 0) {
			this._trialVerificationAttemptsRemaining = TRIAL_STATUS_RETRY_ATTEMPTS;
		}

		if (this._trialVerificationTimer) {
			return;
		}

		this._trialVerificationTimer = setTimeout(() => this.runTrialVerification(), TRIAL_STATUS_RETRY_INTERVAL_MS);
	}

	private cancelTrialVerification(): void {
		if (this._trialVerificationTimer) {
			clearTimeout(this._trialVerificationTimer);
			this._trialVerificationTimer = undefined;
		}
		this._trialVerificationAttemptsRemaining = 0;
	}

	private async runTrialVerification(): Promise<void> {
		this._trialVerificationTimer = undefined;

		if (this._trialConfirmed) {
			this._trialVerificationAttemptsRemaining = 0;
			return;
		}

		if (this._trialVerificationAttemptsRemaining <= 0) {
			return;
		}

		this._trialVerificationAttemptsRemaining--;

		await this.checkTrialStatus(false);
		this.updateWebview();

		if (!this._trialConfirmed && this._trialVerificationAttemptsRemaining > 0) {
			this.scheduleTrialVerification();
		}
	}

	private async startTrial(): Promise<void> {
			if (this._isProcessing) {
				return;
			}
		
		this._isProcessing = true;
		this._errorState = null;
		this.updateWebview();

		return new Promise((resolve) => {
			const process = spawn('python3', ['/opt/distiller-telemetry/device_register.py']);
			
			let output = '';
			let errorOutput = '';
			
			process.stdout.on('data', (data) => {
				output += data.toString();
				console.log('Register output:', data.toString());
			});
			
			process.stderr.on('data', (data) => {
				errorOutput += data.toString();
				console.error('Register error:', data.toString());
			});
			
			process.on('close', async (code) => {
				this._isProcessing = false;
				
				// Parse the output to check for specific error codes
				const fullOutput = output + errorOutput;
				
				if (fullOutput.includes('Device not registered in the system') || 
					fullOutput.includes('404')) {
					this._errorState = '404';
					this._showHelp = true;
					vscode.window.showErrorMessage('Device not registered. Please contact support.');
				} else if (fullOutput.includes('Device trial has expired') || 
						   fullOutput.includes('device_expired') ||
						   (fullOutput.includes('500') && fullOutput.includes('error'))) {
					this._errorState = '500';
					this._showHelp = true;
					vscode.window.showErrorMessage('Trial expired. Please contact support.');
				} else if (code === 0) {
					// Check if registration was successful
					await this.checkTrialStatus();
					if (this._trialActive) {
						this._errorState = null;
						vscode.window.showInformationMessage('Claude Code trial activated successfully!');
					} else {
						// Registration seemed to work but no credentials found
						vscode.window.showWarningMessage('Trial activation completed but credentials not found. Please check your device registration.');
					}
				} else {
					vscode.window.showErrorMessage('Failed to activate trial. Please try again.');
				}
				
				this.updateWebview();
				resolve();
			});
		});
	}

	private async stopTrial(): Promise<void> {
		if (this._isProcessing) {
			return;
		}
		
		this._isProcessing = true;
		this.updateWebview();

		return new Promise((resolve) => {
			const process = spawn('python3', ['/opt/distiller-telemetry/device_unregister.py']);
			
			let output = '';
			
			process.stdout.on('data', (data) => {
				output += data.toString();
				console.log('Unregister output:', data.toString());
			});
			
			process.stderr.on('data', (data) => {
				console.error('Unregister error:', data.toString());
			});
			
			process.on('close', async (code) => {
				this._isProcessing = false;
				
				if (code === 0) {
					await this.checkTrialStatus();
					this._errorState = null;
					vscode.window.showInformationMessage('Claude Code trial stopped successfully.');
					vscode.window.showInformationMessage('Please restart your device for changes to take effect.');
				} else {
					vscode.window.showErrorMessage('Failed to stop trial. Please try again.');
				}
				
				this.updateWebview();
				resolve();
			});
		});
	}

	private async checkForUpdates(): Promise<void> {
		if (this._isProcessing) {
			return;
		}

		// Check for concurrent jobs first
		const hasActiveJob = await this.checkForActiveJobs();
		if (hasActiveJob) {
			this._updateStatus = 'busy';
			this._updateDetails = 'Another update is already running';
			this.updateWebview();
			return;
		}

		this._isProcessing = true;
		this._updateStatus = 'checking';
		this._updateDetails = 'Checking for updates...';
		this.updateWebview();

		try {
			const { stdout } = await execAsync('distiller-update list --json --refresh');
			const result: ListResponse = JSON.parse(stdout);
			
			this._availableUpdates = result.packages;
			this._hasCheckedUpdates = true;
			
			if (result.has_updates) {
				vscode.window.showInformationMessage(`Found ${result.packages.length} update(s) available.`);
			} else {
				vscode.window.showInformationMessage('System is up to date.');
			}
			
		} catch (error: any) {
			vscode.window.showErrorMessage(`Failed to check for updates: ${error.message}`);
			this._availableUpdates = [];
			this._hasCheckedUpdates = true;
		} finally {
			this._isProcessing = false;
			this._updateStatus = '';
			this._updateDetails = '';
			this.updateWebview();
		}
	}

    private async runSystemUpdate(): Promise<void> {
        if (this._isProcessing) {
            return;
        }

        try {
            // Concurrency guard: any active apply units?
            const { stdout: unitsOut } = await execAsync("systemctl list-units --type=service 'distiller-apply-*' --no-legend || true");
            const activeUnitLine = unitsOut.split('\n').find(l => l.trim());
            if (activeUnitLine) {
                const unit = activeUnitLine.split(/\s+/)[0];
                this._updateUnit = unit;
                this._isProcessing = true;
                this._updateStatus = 'running';
                this._updateDetails = `An update is already running: ${unit}`;
                this._updateLogOutput = '';
                this.updateWebview();
                vscode.window.showWarningMessage(`An update is already running (${unit}). Attaching to progress…`);
                this.startUpdateStatusMonitoringSystemd(unit);
                return;
            }

            // Confirm with the user before proceeding
            const choice = await vscode.window.showWarningMessage(
                'System update will restart services and may disconnect the editor temporarily.',
                { modal: true, detail: 'Save your work. The UI may disconnect and reconnect repeatedly during the update. You can view progress via “View Logs”. Proceed with installation?' },
                'Install Now',
                'Cancel'
            );
            if (choice !== 'Install Now') {
                // User cancelled
                return;
            }

            // Start processing only after confirmation
            this._isProcessing = true;
            this._updateStatus = 'starting';
            this._updateDetails = 'Starting Pamir system update...';
            this._updateLogOutput = '';
            this._updateUnit = '';
            this.updateWebview();

            const jobId = Date.now().toString();
            const unit = `distiller-apply-${jobId}`;
            const cmd = `sudo -n systemd-run --unit=${unit} --collect --property=After=network-online.target /usr/bin/distiller-update apply --json --refresh`;
            await execAsync(cmd);
            this._updateUnit = unit;
            vscode.window.showInformationMessage('System update scheduled successfully.');
            this.startUpdateStatusMonitoringSystemd(unit);
        } catch (err: any) {
            this._isProcessing = false;
            this._updateStatus = '';
            this._updateDetails = '';
            vscode.window.showErrorMessage(`Failed to schedule update: ${err?.message ?? err}`);
            this.updateWebview();
        }
    }

	private startUpdateStatusMonitoringSystemd(unit: string): void {
		let checkCount = 0;
		const maxChecks = 240; // ~12 minutes at 3s intervals

		const checkStatus = async () => {
			checkCount++;
			try {
				// Poll unit status
				const { stdout } = await execAsync(`systemctl show ${unit} -p SubState,ExecMainStatus`);
				const subMatch = /SubState=(\S+)/.exec(stdout);
				const codeMatch = /ExecMainStatus=(\d+)/.exec(stdout);
				const sub = subMatch?.[1] ?? '';
				const code = parseInt(codeMatch?.[1] ?? '0', 10);
				this._updateUnit = unit;

				// Update basic status
				this._updateStatus = sub || 'running';
				this._updateDetails = sub === 'running'
					? (this._installRemaining > 0 ? `Installing updates… Remaining: ${this._installRemaining}` : 'Installing updates')
					: `Status: ${sub}`;

				// Refresh remaining count by polling the list
				try {
					const { stdout: listOut } = await execAsync('distiller-update list --json');
					const list = JSON.parse(listOut);
						this._installRemaining = Array.isArray(list?.packages) ? list.packages.length : 0;
						if (Array.isArray(list?.packages)) {
							this._availableUpdates = list.packages;
						}
				} catch {}

				// Tail last few lines of logs for context
				try {
					const { stdout: logs } = await execAsync(`journalctl -u ${unit} --no-pager -n 40`);
					const lines = logs.split('\n').filter(l => l.trim());
					this._updateLogOutput = lines.slice(-12).join('\n');
				} catch {}

				// Completion paths
				if (sub === 'dead' || sub === 'exited' || sub === 'failed') {
					this._isProcessing = false;
					if (code === 0 && sub !== 'failed') {
						vscode.window.showInformationMessage('Pamir system update completed successfully!');
						try { await execAsync('distiller-update list --json'); } catch {}
						this._hasCheckedUpdates = false;
						this._availableUpdates = [];
						this._updateStatus = '';
						this._updateDetails = '';
						this._updateLogOutput = '';
						this._updateUnit = '';
						this._installRemaining = 0;
						this.updateWebview();
						return;
					} else {
						vscode.window.showErrorMessage('System update failed. View logs for details.');
						this.updateWebview();
						return;
					}
				}

				this.updateWebview();
			} catch (e) {
				console.error('Failed to poll systemd status:', e);
			}

			if (this._isProcessing && checkCount < maxChecks) {
				setTimeout(checkStatus, 5000);
			} else if (checkCount >= maxChecks) {
				this._isProcessing = false;
				this._updateStatus = 'timeout';
				this._updateDetails = 'Update process timed out';
				vscode.window.showWarningMessage('System update monitoring timed out. Use journalctl to inspect logs.');
				this.updateWebview();
			}
		};

		setTimeout(checkStatus, 2000);
	}

	private async showUpdateLogs(): Promise<void> {
		try {
			if (!this._updateUnit) {
				vscode.window.showInformationMessage('No update job to show logs for.');
				return;
			}
			const { stdout } = await execAsync(`journalctl -u ${this._updateUnit} --no-pager -n 500`);
			const doc = await vscode.workspace.openTextDocument({ content: stdout, language: 'log' });
			await vscode.window.showTextDocument(doc, { preview: true });
		} catch (e: any) {
			vscode.window.showErrorMessage(`Failed to open logs: ${e?.message ?? e}`);
		}
	}

	private formatBytes(bytes: number): string {
		if (!bytes || bytes < 0) {
			return '';
		}
		const units = ['B','KB','MB','GB','TB'];
		let i = 0; let n = bytes;
		while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
		return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
	}

	private async checkForActiveJobs(): Promise<boolean> {
		try {
			const { stdout } = await execAsync(`systemctl list-units --type=service 'distiller-apply-*' --no-legend`);
			return stdout.trim().length > 0;
		} catch {
			return false;
		}
	}

	private updateWebview() {
		if (this._view) {
			this._view.webview.html = this._getHtmlForWebview(this._view.webview);
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		const effectiveErrorState = this._errorState;
		const statusMeta = this.getStatusMetadata(effectiveErrorState);
		const disableWhileBusy = this._isProcessing ? 'disabled' : '';

		const activationCopy = this._trialActive
			? 'Claude Code is active on this device.'
			: effectiveErrorState === '404'
				? 'Device not registered. Contact support to unlock Claude Code.'
				: effectiveErrorState === '500'
					? 'Trial expired. Contact support to renew your access.'
					: 'Unlock Claude Code on this device.';

		const activationButton = this._trialActive
			? `<button class="btn btn-red" onclick="stopTrial()" ${disableWhileBusy}>DEACTIVATE MEMBERSHIP</button>`
			: `<button class="btn btn-amber btn-fill" onclick="startTrial()" ${disableWhileBusy}>ACTIVATE FREE MEMBERSHIP</button>`;

		const projectButtons = `
			<div class="btn-row">
				<button class="btn btn-amber" onclick="createProject()" ${disableWhileBusy}>NEW PROJECT FOLDER</button>
				<button class="btn btn-amber" onclick="navigateProjects()" ${disableWhileBusy}>NAVIGATE PROJECTS</button>
			</div>
		`;

		const toolActions: string[] = [
			`<button class=\"btn btn-teal\" onclick=\"openEink()\" ${disableWhileBusy}>E-INK WALLPAPER</button>`,
			`<button class=\"btn btn-teal\" onclick=\"checkUpdates()\" ${this._isProcessing ? 'disabled' : ''}>CHECK FOR UPDATES</button>`
		];

		if (this._availableUpdates.length > 0) {
			toolActions.push(`<button class=\"btn btn-teal btn-fill\" onclick=\"installUpdates()\" ${this._isProcessing ? 'disabled' : ''}>INSTALL UPDATES</button>`);
		}

		if (this._updateUnit || this._updateLogOutput) {
			toolActions.push(`<button class=\"btn btn-teal\" onclick=\"viewLogs()\">VIEW LOGS</button>`);
		}

		const toolButtonsMarkup = toolActions.length
			? `<div class="btn-row">${toolActions.join('')}</div>`
			: '';

		let updateDetails = '';
		if (this._isProcessing && (this._updateStatus || this._updateDetails)) {
			updateDetails += `<div class="notice">${this._updateDetails || 'Processing system update…'}</div>`;
		}
		if (!this._isProcessing && this._updateStatus === 'timeout') {
			updateDetails += `<div class="notice warning">${this._updateDetails || 'Update process timed out. Use journalctl to inspect logs.'}</div>`;
		}
		if (this._hasCheckedUpdates) {
			if (this._availableUpdates.length > 0) {
				const total = this._availableUpdates.reduce((sum, pkg) => sum + (pkg.size || 0), 0);
				const list = this._availableUpdates
					.map(pkg => `<li>${pkg.name}: ${pkg.current_version || '(new)'} → ${pkg.new_version}${pkg.size ? ` (${this.formatBytes(pkg.size)})` : ''}</li>`)
					.join('');
				updateDetails += `
					<div class="update-summary">${this._availableUpdates.length} update${this._availableUpdates.length === 1 ? '' : 's'} available — total ${this.formatBytes(total)}</div>
					<ul class="update-list">${list}</ul>
				`;
			} else {
				updateDetails += `<div class="notice">System is up to date.</div>`;
			}
		}

		const updateLogBlock = this._updateLogOutput
			? `<pre class="log-block">${this._updateLogOutput}</pre>`
			: '';

		const helpPanel = `
			<div class="help-panel">
				<div class="label">Support</div>
				<div>Email: founders@pamir.ai</div>
				<div>Discord: discord.gg/qQsuZgScRm</div>
			</div>
		`;

 		return `<!DOCTYPE html>
 			<html lang="en">
 			<head>
 			<meta charset="UTF-8">
 			<meta name="viewport" content="width=device-width, initial-scale=1.0">
 			<style>
 				:root {
 					/* Adaptive theme colors */
 					--bg: var(--vscode-editor-background);
 					--surface: color-mix(in srgb, var(--vscode-sideBar-background) 94%, transparent 6%);
 					--text: var(--vscode-editor-foreground);
 					--muted: var(--vscode-descriptionForeground);
 					--hair: var(--vscode-panel-border);
 					--chip-fill: color-mix(in srgb, var(--vscode-editor-background) 85%, var(--vscode-editor-foreground) 15%);
 					
 					/* Fixed retro accents */
 					--amber: #E58A5A;
 					--teal: #4CC9B0;
 					--green: #58D26E;
 					--red: #FF5E57;
 					--inactive: #C1A89A;
 					--radius: 12px;
 				}
 				
 				/* Theme-specific accent adjustments */
 				.vscode-light {
 					--amber: color-mix(in srgb, #E58A5A 85%, #8B4513 15%);
 					--teal: color-mix(in srgb, #4CC9B0 90%, #2F4F4F 10%);
 				}
 
 				body {
 					margin:0;
 					padding:0;
 					background: var(--bg);
 					color: var(--text);
 					font-family: var(--vscode-font-family), "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
 				}
 
 				.dm {
 					--col: 640px;
 					max-width:960px;
 					margin:0 auto;
 					padding:18px clamp(14px,4vw,28px) 30px;
 					box-sizing:border-box;
 				}
 				
 				.content { max-width: var(--col); }

				h1.dm-title {
					margin:0;
					font-size: clamp(18px, 3.4vw, 30px);
					letter-spacing:.35em;
					font-weight:700;
					text-transform:uppercase;
				}

				.ascii-title {
					margin:8px 0 0;
					color:var(--amber);
					font-weight:600;
					font-size: clamp(11px, 2.2vw, 16px);
					line-height:0.95;
					letter-spacing: 0;
				}

				.lead {
					margin:10px 0 14px;
					color:var(--muted);
					font-size: clamp(12px, 1.6vw, 15px);
				}

				.rule {
					border:none;
					height:1px;
					background:var(--hair);
					margin:22px 0;
				}

				.section { margin-top:10px; }
				.h {
					margin:6px 0 4px;
					font-size: clamp(13px, 1.9vw, 17px);
					letter-spacing:.25em;
					font-weight:700;
					text-transform:uppercase;
				}
				.muted { margin:0 0 12px; color:var(--muted); font-size: clamp(12px,1.6vw,14px); }

				.dm-header {
					display:flex;
					flex-direction:column;
					gap:12px;
				}

				/* Status pill with grid layout matching buttons */
				.status-bar{
					display: grid;
					grid-template-columns: 1fr auto;     /* chips | state */
					align-items: center;
					gap: 8px;
					width: 100%;                         /* matches buttons */
					box-sizing: border-box;
					padding: 10px 12px;
					border: 1px solid var(--hair);
					border-radius: var(--radius);
					background: var(--surface);
				}
				.status-bar .chips{
					display: flex; flex-wrap: wrap; gap: 8px; min-width: 0;
				}
				.status-bar .chip{
					padding: 4px 8px; border-radius: 999px;
					background: var(--chip-fill); color: var(--muted);
					border: 1px solid var(--hair);
					font-size: 12px;
				}
				.status-bar .state{
					font-weight: 800; letter-spacing: .06em;
					color: var(--green);                  
				}
				.status-bar[data-state="inactive"] .state{ color: var(--inactive); }
				.status-bar[data-state="processing"] .state{ color:var(--amber); }
				.status-bar[data-state="error"] .state{ color:var(--red); }

				.btn {
					--c:var(--amber);
					color:var(--c);
					border:2px solid var(--c);
					background:transparent;
					border-radius:var(--radius);
					padding:12px 16px;
					font-weight:700;
					letter-spacing:.12em;
					text-transform:uppercase;
					width: 100%; 
					box-sizing: border-box;
					cursor:pointer;
					transition:all .15s ease;
					height: 44px;
					display: flex;
					align-items: center;
					justify-content: center;
				}
				.btn::before{ content:"[ "; }
				.btn::after { content:" ]"; }
				.btn:hover:not(:disabled) { 
					border-color: color-mix(in srgb, var(--c) 90%, white);
					color: color-mix(in srgb, var(--c) 90%, white);
				}
				.btn:active:not(:disabled) {
					border-color: color-mix(in srgb, var(--c) 80%, black);
					color: color-mix(in srgb, var(--c) 80%, black);
				}
				.btn:disabled { opacity:0.45; cursor:not-allowed; }
				.btn-amber { --c:var(--amber); }
				.btn-teal { --c:var(--teal); }
				.btn-red { --c:var(--red); }
				.btn-fill { background: color-mix(in srgb, var(--c) 25%, transparent); }

				.btn-row { display:grid; gap:10px; grid-template-columns:1fr; }
				@media (min-width:720px){ .btn-row { grid-template-columns:repeat(2,minmax(0,1fr)); } }

				.notice {
					margin-top:12px;
					padding:10px 12px;
					border-radius:8px;
					border:1px solid var(--hair);
					background: var(--surface);
					color:var(--muted);
					font-size:12px;
				}
				.notice.warning { background:rgba(255,94,87,.12); color:var(--red); }

				.update-summary { font-size:12px; margin-top:8px; color:var(--teal); }
				.update-list { margin:6px 0 0; padding-left:18px; font-size:12px; color:var(--muted); }
				.update-list li { margin:3px 0; }

				.log-block {
					margin-top:12px;
					background:rgba(0,0,0,0.5);
					border:1px solid var(--hair);
					border-radius:9px;
					padding:12px;
					font-family:inherit;
					font-size:12px;
					max-height:160px;
					overflow-y:auto;
					white-space:pre-wrap;
				}

				.footer {
					display:flex;
					flex-wrap:wrap;
					gap:12px;
					justify-content:space-between;
					margin-top:24px;
				}
				.help-btn {
					background:transparent;
					border:1px solid var(--hair);
					border-radius:8px;
					color:var(--teal);
					padding:8px 12px;
					font-size:12px;
					letter-spacing:.08em;
					cursor:pointer;
				}
				.help-btn:hover { border-color:rgba(76,201,176,0.6); background:rgba(76,201,176,0.12); }

				.help-panel {
					margin-top:14px;
					padding:14px 16px;
					border-radius:var(--radius);
					border:1px solid var(--hair);
					background: color-mix(in srgb, var(--teal) 8%, var(--surface) 92%);
					font-size:12px;
					color:var(--text);
					line-height:1.6;
				}
				.help-panel .label { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--teal); margin-bottom:4px; }

				@media (max-width: 480px){
					.content{ max-width: 100%; }         /* use full pane width when narrow */
					.status-bar{ grid-template-columns: 1fr; row-gap: 6px; }
					.status-bar .state{ justify-self: start; }
					.dm{ padding:14px 12px 20px; }
				}

			</style>
			</head>
			<body>
				<div class="dm">
					<!-- Header -->
					<header class="dm-header">
						<h1 class="dm-title">
							<pre class="ascii-title">
░█▀▄░█▀▀░█░█░▀█▀░█▀▀░█▀▀    
░█░█░█▀▀░▀▄▀░░█░░█░░░█▀▀    
░▀▀░░▀▀▀░░▀░░▀▀▀░▀▀▀░▀▀▀    
░█▄█░█▀█░█▀█░█▀█░█▀▀░█▀▀░█▀▄
░█░█░█▀█░█░█░█▀█░█░█░█▀▀░█▀▄
░▀░▀░▀░▀░▀░▀░▀░▀░▀▀▀░▀▀▀░▀░▀
							</pre>
						</h1>
					</header>

					<div class="content">
						<span></span>
						<div class="status-bar" data-state="${this.getStateFromStatus(statusMeta)}">
							<div class="chips">
								<span class="chip">MAC ${this._deviceMac}</span>
								<span class="chip">IP ${this._deviceIp}</span>
							</div>
							<span class="state">${statusMeta.label}</span>
						</div>
					</div>

					<p class="lead">${statusMeta.detail}</p>

					<hr class="rule" />

					<!-- A. Get Access -->
					<section class="section">
						<div class="content">
							<h3 class="h">GET ACCESS</h3>
							<p class="muted">${activationCopy}</p>
							${activationButton}
						</div>
					</section>

					<hr class="rule" />

					<!-- B. Start Building -->
					<section class="section">
						<div class="content">
							<h3 class="h">START BUILDING</h3>
							<p class="muted">Launch a fresh workspace or jump back into an existing project.</p>
							${projectButtons}
						</div>
					</section>

					<hr class="rule" />

					<!-- C. Device Tools -->
					<section class="section">
						<div class="content">
							<h3 class="h">DEVICE TOOLS</h3>
							${toolButtonsMarkup}
							${updateDetails}
							${updateLogBlock}
						</div>
					</section>

					<footer class="footer">
						<button class="help-btn" onclick="toggleHelp()">${this._showHelp ? 'HIDE HELP' : 'HELP'}</button>
					</footer>

					${this._showHelp ? helpPanel : ''}
				</div>

				<script>
					const vscode = acquireVsCodeApi();
					
					function startTrial() {
						vscode.postMessage({ type: 'startTrial' });
					}
					
					function stopTrial() {
						vscode.postMessage({ type: 'stopTrial' });
					}
					
					function openEink() {
						vscode.postMessage({ type: 'openEink' });
					}
					
					function toggleHelp() {
						vscode.postMessage({ type: 'toggleHelp' });
					}
					
					
					function createProject() {
						vscode.postMessage({ type: 'createProject' });
					}
					
					function navigateProjects() {
						vscode.postMessage({ type: 'navigateProjects' });
					}
					
					function checkUpdates() {
						vscode.postMessage({ type: 'checkUpdates' });
					}
					
					function installUpdates() {
						vscode.postMessage({ type: 'installUpdates' });
					}

					function viewLogs() {
						vscode.postMessage({ type: 'viewUpdateLogs' });
					}
					
					window.addEventListener('load', () => {
						vscode.postMessage({ type: 'checkStatus' });
					});
				</script>
			</body>
			</html>`;
	}

	private getStateFromStatus(statusMeta: { label: string; className: string; detail: string }): string {
		if (this._isProcessing || statusMeta.className === 'status-processing') {
			return 'processing';
		}
		if (statusMeta.className === 'status-ok') {
			return 'active';
		}
		if (statusMeta.className === 'status-error') {
			return 'error';
		}
		return 'inactive';
	}

	private getStatusMetadata(effectiveErrorState: '404' | '500' | null): { label: string; className: string; detail: string } {
		if (this._isProcessing) {
			return {
				label: (this._updateStatus || 'processing').toUpperCase(),
				className: 'status-processing',
				detail: this._updateDetails || 'Processing tasks…'
			};
		}

		if (this._updateStatus === 'timeout') {
			return {
				label: 'TIMEOUT',
				className: 'status-idle',
				detail: this._updateDetails || 'Update process timed out. View logs for details.'
			};
		}

		if (effectiveErrorState === '404') {
			return {
				label: 'NOT REGISTERED',
				className: 'status-error',
				detail: 'Device not registered with Claude Code.'
			};
		}

		if (effectiveErrorState === '500') {
			return {
				label: 'TRIAL EXPIRED',
				className: 'status-error',
				detail: 'Trial access has ended for this device.'
			};
		}

		if (this._trialActive && !this._trialConfirmed) {
			const sourceStatus = `env ${this._trialStatusSources.env ? 'ready' : 'pending'} / settings ${this._trialStatusSources.settings ? 'ready' : 'pending'}`;
			return {
				label: 'SYNCING',
				className: 'status-processing',
				detail: `Waiting for Claude credentials to finish provisioning (${sourceStatus}).`
			};
		}

		if (this._trialActive) {
			return {
				label: 'ACTIVE',
				className: 'status-ok',
				detail: 'Claude Code is ready on this device.'
			};
		}

		return {
			label: 'INACTIVE',
			className: 'status-idle',
			detail: 'Activate to begin using Claude Code.'
		};
	}

}

export function activate(context: vscode.ExtensionContext) {
  console.log('Claude Onboard extension is now active!');

  const provider = new WelcomeViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('device-manager.welcomeView', provider)
  );

  // Register command for manual refresh
  const refreshCommand = vscode.commands.registerCommand('device-manager.refresh', () => {
    provider.checkTrialStatus();
  });
  
  context.subscriptions.push(refreshCommand);

  // Register E‑ink designer command
  context.subscriptions.push(
    vscode.commands.registerCommand('device-manager.openEink', () => openEinkWizard(context))
  );
}

export function deactivate() {}

// ---------------------------------------------------------------------------
// E‑ink feature: webview UI + SDK TemplateRenderer integration (moved here)
// ---------------------------------------------------------------------------

interface OverlayElement {
  id: string;
  type: 'ip' | 'qr';
  x: number;
  y: number;
  font_size?: number;
  color?: number;  // 0=black, 1=white
  background?: boolean;
  padding?: number;
  width?: number;   // measured placeholder width (device px)
  height?: number;  // measured placeholder height (device px)
}

interface Overlays {
  elements: OverlayElement[];
}

// Create output channel for logging
let einkOutputChannel: vscode.OutputChannel | undefined;

function getEinkLogger(): vscode.OutputChannel {
  if (!einkOutputChannel) {
    einkOutputChannel = vscode.window.createOutputChannel('E-ink Display');
  }
  return einkOutputChannel;
}

function logEink(message: string) {
  const timestamp = new Date().toISOString();
  const logger = getEinkLogger();
  logger.appendLine(`[${timestamp}] ${message}`);
  console.log(`[E-ink] ${message}`);
}

async function openEinkWizard(_ctx: vscode.ExtensionContext) {
  logEink('Opening E-ink wizard');
  
  if (!(process as any).versions?.node) {
    logEink('ERROR: Node extension host not available');
    vscode.window.showErrorMessage('Pamir E‑ink requires the Node extension host (workspace extension).');
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'pamirEink',
    'E‑ink Wallpaper Settings',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  logEink('Webview panel created, loading HTML');
  panel.webview.html = await getEinkHtml(panel.webview);
  logEink('HTML loaded successfully');

  panel.webview.onDidReceiveMessage(async (msg) => {
    const requestId = Date.now();
    logEink(`[${requestId}] Received message: ${msg?.type}`);
    
    try {
      switch (msg?.type) {
        case 'display': {
          logEink(`[${requestId}] Processing display request with ${msg.overlays?.elements?.length || 0} overlays`);
          
          if (!msg.overlays?.elements?.some((e: OverlayElement) => e.type === 'ip')) {
            logEink(`[${requestId}] ERROR: No IP overlay found`);
            throw new Error('At least one IP address overlay is required');
          }
          
          logEink(`[${requestId}] Starting display process`);
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Rendering to E‑ink display…', cancellable: false },
            async () => {
              try {
                await displayOnDevice(msg.png, msg.overlays, requestId);
                logEink(`[${requestId}] Display process completed successfully`);
              } catch (error) {
                logEink(`[${requestId}] Display process failed: ${error}`);
                throw error;
              }
            }
          );
          
          logEink(`[${requestId}] Sending success response to webview`);
          panel.webview.postMessage({ type: 'displayDone', ok: true, requestId });
          break;
        }
        case 'saveTemplate': {
          logEink(`[${requestId}] Processing save template request`);
          
          if (!msg.overlays?.elements?.some((e: OverlayElement) => e.type === 'ip')) {
            logEink(`[${requestId}] ERROR: No IP overlay found for template save`);
            throw new Error('At least one IP address overlay is required');
          }
          
          await saveTemplate(msg.png, msg.overlays);
          logEink(`[${requestId}] Template saved successfully`);
          vscode.window.showInformationMessage('Template saved to ~/template/default/template.json');
          break;
        }
        default: {
          logEink(`[${requestId}] WARNING: Unknown message type: ${msg?.type}`);
        }
      }
    } catch (err: any) {
      logEink(`[${requestId}] ERROR in message handler: ${err?.message ?? err}`);
      logEink(`[${requestId}] Error stack: ${err?.stack || 'No stack trace'}`);
      vscode.window.showErrorMessage(`E‑ink error: ${err?.message ?? err}`);
      panel.webview.postMessage({ type: 'error', message: String(err), requestId });
    }
  });
}

async function createTemplateJson(imagePath: string, overlays: Overlays, requestId?: number): Promise<string> {
  const reqId = requestId || Date.now();
  logEink(`[${reqId}] Creating template JSON for image: ${imagePath}`);
  
  const tmpDir = path.join(os.tmpdir(), 'pamir-eink');
  await fsp.mkdir(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const templatePath = path.join(tmpDir, `template-${timestamp}.json`);
  
  logEink(`[${reqId}] Template path: ${templatePath}`);
  const now = new Date();
  const created = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const layers: any[] = [];

  layers.push({
    id: 'image_background',
    type: 'image',
    visible: true,
    x: 0,
    y: 0,
    image_path: imagePath,
    resize_mode: 'fit',
    dither_mode: 'floyd-steinberg',
    brightness: 1.0,
    contrast: 0.0,
    rotate: 0,
    flip_h: false,
    flip_v: false,
    crop_x: null,
    crop_y: null,
    width: null,
    height: null,
  });

  const M = 10;
  for (const element of overlays.elements) {
    if (element.type === 'ip') {
      const measuredW = Math.max(1, Math.floor(element.width ?? 46));
      const measuredH = Math.max(1, Math.floor(element.height ?? 9));
      const padding = Math.max(0, element.padding ?? 2);
      const measuredWidthWithPad = measuredW + padding * 2;
      const worstChars = 15;
      const pxPerChar = 8;
      const fudge = 1.15;
      const worstCaseWidth = Math.round(worstChars * pxPerChar * fudge) + padding * 2;
      const ipWidth = Math.min(250, Math.max(measuredWidthWithPad, worstCaseWidth));
      const ipTopCore = Math.max(7, Math.ceil(measuredH * 0.78));
      const ipBottomCore = Math.max(2, measuredH - ipTopCore);
      const ipTopOffset = ipTopCore + padding;
      const ipBottomOffset = ipBottomCore + padding;
      const ipX = Math.max(M, Math.min(250 - ipWidth - M, element.x));
      const minBaselineY = ipTopOffset + M;
      const maxBaselineY = 128 - ipBottomOffset - M;
      const ipY = Math.max(minBaselineY, Math.min(maxBaselineY, element.y));

      layers.push({
        id: element.id,
        type: 'text',
        visible: true,
        x: ipX,
        y: ipY,
        text: '$IP_ADDRESS',
        placeholder_type: 'ip',
        color: element.color || 0,
        font_size: Math.round((element.font_size || 1) * 1.1),
        background: element.background || false,
        padding,
        rotate: 0,
        flip_h: false,
        flip_v: false,
      });
    } else if (element.type === 'qr') {
      const qrWidth = element.width || 50;
      const qrHeight = element.height || 50;
      const qrX = Math.max(M, Math.min(250 - qrWidth - M, element.x));
      const qrY = Math.max(M, Math.min(128 - qrHeight - M, element.y));

      layers.push({
        id: element.id,
        type: 'text',
        visible: true,
        x: qrX,
        y: qrY,
        text: '$QR_CODE',
        placeholder_type: 'qr',
        width: element.width || 50,
        height: element.height || 50,
        rotate: 0,
        flip_h: false,
        flip_v: false,
      });
    }
  }

  const template = {
    template_version: '1.0',
    name: `preview_${timestamp}`,
    created,
    width: 250,
    height: 128,
    layers,
  };

  logEink(`[${reqId}] Template JSON has ${layers.length} layers`);
  await fsp.writeFile(templatePath, JSON.stringify(template, null, 2));
  logEink(`[${reqId}] Template JSON written successfully`);
  return templatePath;
}

async function createPythonScript(operation: 'preview' | 'display', templatePath: string, tunnelUrl: string, requestId?: number, outputPath?: string): Promise<string> {
  const reqId = requestId || Date.now();
  logEink(`[${reqId}] Creating Python script for operation: ${operation}`);
  
  const tmpDir = path.join(os.tmpdir(), 'pamir-eink');
  const scriptPath = path.join(tmpDir, `sdk-${operation}-${Date.now()}.py`);
  
  logEink(`[${reqId}] Python script path: ${scriptPath}`);
  logEink(`[${reqId}] Template path: ${templatePath}`);
  logEink(`[${reqId}] Tunnel URL: ${tunnelUrl}`);

  let script = '';
  if (operation === 'preview') {
    script = `#!/usr/bin/env python3
import sys
from distiller_cm5_sdk.hardware.eink.composer import TemplateRenderer

try:
    renderer = TemplateRenderer("${templatePath}")
    renderer.render_and_save('127.0.0.1', '${tunnelUrl}', '${outputPath}')
    print("Preview rendered successfully")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
`;
  } else {
    script = `#!/usr/bin/env python3
import sys
import subprocess
import json
import traceback
import time
import os

print(f"[SCRIPT] Starting e-ink display script - Request ID: ${reqId}", file=sys.stderr)
print(f"[SCRIPT] Python version: {sys.version}", file=sys.stderr)
print(f"[SCRIPT] Current working directory: {os.getcwd()}", file=sys.stderr)
print(f"[SCRIPT] Template file: ${templatePath}", file=sys.stderr)
print(f"[SCRIPT] Tunnel URL: ${tunnelUrl}", file=sys.stderr)

# Check if template file exists
if not os.path.exists("${templatePath}"):
    print(f"ERROR: Template file does not exist: ${templatePath}", file=sys.stderr)
    sys.exit(1)

print(f"[SCRIPT] Template file exists, size: {os.path.getsize('${templatePath}')} bytes", file=sys.stderr)

# Debug: Print template content
try:
    with open("${templatePath}", "r") as f:
        template_data = json.load(f)
        print(f"[SCRIPT] Template layers: {len(template_data.get('layers', []))}", file=sys.stderr)
        for layer in template_data.get('layers', []):
            print(f"[SCRIPT]   Layer: type={layer.get('type')}, id={layer.get('id')}", file=sys.stderr)
except Exception as e:
    print(f"ERROR: Failed to read template file: {e}", file=sys.stderr)
    sys.exit(1)

print(f"[SCRIPT] Importing TemplateRenderer...", file=sys.stderr)
try:
    from distiller_cm5_sdk.hardware.eink.composer import TemplateRenderer
    print(f"[SCRIPT] TemplateRenderer imported successfully", file=sys.stderr)
except ImportError as e:
    print(f"ERROR: Failed to import TemplateRenderer: {e}", file=sys.stderr)
    sys.exit(1)

try:
    print(f"[SCRIPT] Getting device IP address...", file=sys.stderr)
    # Get device IP
    result = subprocess.run(['hostname', '-I'], capture_output=True, text=True)
    ip = result.stdout.split()[0] if result.stdout else '127.0.0.1'
    print(f"[SCRIPT] Using IP: {ip}", file=sys.stderr)
    print(f"[SCRIPT] Using tunnel URL: ${tunnelUrl}", file=sys.stderr)
    
    print(f"[SCRIPT] Creating TemplateRenderer instance...", file=sys.stderr)
    renderer = TemplateRenderer("${templatePath}")
    print(f"[SCRIPT] TemplateRenderer created successfully", file=sys.stderr)
    
    print(f"[SCRIPT] Starting render_and_display...", file=sys.stderr)
    start_time = time.time()
    try:
        renderer.render_and_display(ip, '${tunnelUrl}')
        end_time = time.time()
        print(f"[SCRIPT] render_and_display completed in {end_time - start_time:.2f} seconds", file=sys.stderr)
    except UnboundLocalError as e:
        # Workaround SDK cleanup bug: 'display' referenced before assignment
        if 'display' in str(e):
            print(f"[SCRIPT] WARN: Ignoring SDK cleanup bug: {e}", file=sys.stderr)
        else:
            print(f"ERROR: UnboundLocalError: {e}", file=sys.stderr)
            raise
    print(f"[SCRIPT] Displayed on E-ink successfully", file=sys.stderr)
    print("Displayed on E-ink successfully")
except Exception as e:
    print(f"[SCRIPT] ERROR in main execution: {e}", file=sys.stderr)
    print(f"[SCRIPT] Error type: {type(e).__name__}", file=sys.stderr)
    print(f"[SCRIPT] Traceback: {traceback.format_exc()}", file=sys.stderr)
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    print(f"[SCRIPT] Script execution completed - Request ID: ${reqId}", file=sys.stderr)
`;
  }

  logEink(`[${reqId}] Writing Python script (${script.length} characters)`);
  await fsp.writeFile(scriptPath, script);
  logEink(`[${reqId}] Python script written successfully`);
  return scriptPath;
}

async function saveTemplate(imageBase64: string, overlays: Overlays): Promise<void> {
  const homeDir = os.homedir();
  const templateDir = path.join(homeDir, 'template', 'default');
  await fsp.mkdir(templateDir, { recursive: true });

  const imagePath = path.join(templateDir, 'wallpaper.png');
  await fsp.writeFile(imagePath, Buffer.from(imageBase64, 'base64'));

  const templatePath = await createTemplateJson(imagePath, overlays);
  const templateContent = await fsp.readFile(templatePath, 'utf-8');
  await fsp.writeFile(path.join(templateDir, 'template.json'), templateContent);
}

async function displayOnDevice(imageBase64: string, overlays: Overlays, requestId?: number): Promise<void> {
  const reqId = requestId || Date.now();
  logEink(`[${reqId}] displayOnDevice started`);
  
  const tmpDir = path.join(os.tmpdir(), 'pamir-eink');
  logEink(`[${reqId}] Creating temp directory: ${tmpDir}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  const timestamp = Date.now();
  const inputPath = path.join(tmpDir, `display-${timestamp}.png`);
  const filesToClean: string[] = [];
  
  logEink(`[${reqId}] Image path: ${inputPath}`);
  logEink(`[${reqId}] Base64 length: ${imageBase64.length}`);
  logEink(`[${reqId}] Overlays count: ${overlays.elements?.length || 0}`);

  try {
    logEink(`[${reqId}] Writing PNG file from base64`);
    await fsp.writeFile(inputPath, Buffer.from(imageBase64, 'base64'));
    filesToClean.push(inputPath);
    logEink(`[${reqId}] PNG file written successfully`);

    logEink(`[${reqId}] Creating template JSON`);
    const templatePath = await createTemplateJson(inputPath, overlays, reqId);
    filesToClean.push(templatePath);
    logEink(`[${reqId}] Template created: ${templatePath}`);

    const cfg = vscode.workspace.getConfiguration();
    const tunnelUrl = cfg.get<string>('pamir.eink.tunnelUrl') || 'http://localhost:8080';
    logEink(`[${reqId}] Using tunnel URL: ${tunnelUrl}`);
    
    logEink(`[${reqId}] Creating Python script`);
    const scriptPath = await createPythonScript('display', templatePath, tunnelUrl, reqId);
    filesToClean.push(scriptPath);
    logEink(`[${reqId}] Python script created: ${scriptPath}`);

    logEink(`[${reqId}] Executing Python script`);
    await runPythonScript(scriptPath, reqId);
    logEink(`[${reqId}] Python script completed successfully`);

  } catch (error) {
    logEink(`[${reqId}] ERROR in displayOnDevice: ${error}`);
    logEink(`[${reqId}] Error details: ${(error as Error)?.stack || 'No stack trace'}`);
    throw error;
  } finally {
    const cfg = vscode.workspace.getConfiguration();
    const debugMode = cfg.get<boolean>('pamir.eink.debugMode');
    if (debugMode) {
      logEink(`[${reqId}] Debug mode enabled - keeping temp files: ${filesToClean.join(', ')}`);
    } else {
      logEink(`[${reqId}] Cleaning up ${filesToClean.length} temp files`);
      for (const file of filesToClean) {
        try { 
          await fsp.unlink(file); 
          logEink(`[${reqId}] Deleted: ${file}`);
        } catch (err) {
          logEink(`[${reqId}] Failed to delete ${file}: ${err}`);
        }
      }
    }
    logEink(`[${reqId}] displayOnDevice cleanup completed`);
  }
}

async function runPythonScript(scriptPath: string, requestId?: number): Promise<void> {
  const reqId = requestId || Date.now();
  const cfg = vscode.workspace.getConfiguration();
  const pythonPath = cfg.get<string>('pamir.eink.pythonPath') || '/opt/distiller-cm5-sdk/.venv/bin/python';
  const timeoutMs = cfg.get<number>('pamir.eink.timeoutMs') || 30000;

  logEink(`[${reqId}] Starting Python execution: ${pythonPath} ${scriptPath}`);
  logEink(`[${reqId}] Timeout set to: ${timeoutMs}ms`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const child = spawn(pythonPath, [scriptPath], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    logEink(`[${reqId}] Python process spawned with PID: ${child.pid}`);

    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      logEink(`[${reqId}] Python script TIMEOUT after ${timeoutMs}ms - killing process`);
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`Python script timed out after ${timeoutMs}ms. Script: ${scriptPath}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      const data = d.toString();
      stdout += data;
      logEink(`[${reqId}] Python stdout: ${data.trim()}`);
    });
    
    child.stderr.on('data', (d) => {
      const data = d.toString();
      stderr += data;
      logEink(`[${reqId}] Python stderr: ${data.trim()}`);
    });

    child.on('exit', (code, signal) => {
      const duration = Date.now() - startTime;
      clearTimeout(timeout);
      
      logEink(`[${reqId}] Python process exited with code ${code}, signal ${signal} after ${duration}ms`);
      logEink(`[${reqId}] Final stdout length: ${stdout.length}`);
      logEink(`[${reqId}] Final stderr length: ${stderr.length}`);

      if (stderr.includes('ERROR:')) {
        logEink(`[${reqId}] ERROR detected in stderr`);
        const cfg = vscode.workspace.getConfiguration();
        if (cfg.get<boolean>('pamir.eink.debugMode')) {
          logEink(`[${reqId}] Debug mode - full Python script: ${scriptPath}`);
          logEink(`[${reqId}] Debug mode - full stderr: ${stderr}`);
          logEink(`[${reqId}] Debug mode - full stdout: ${stdout}`);
        }
        reject(new Error(`SDK error: ${stderr}`));
      } else if (code !== 0) {
        logEink(`[${reqId}] Non-zero exit code: ${code}`);
        reject(new Error(`Python exited with code ${code}. Output: ${stdout}\nStderr: ${stderr}`));
      } else {
        if (stderr && !stderr.includes('UserWarning')) {
          logEink(`[${reqId}] Non-fatal stderr: ${stderr}`);
        }
        logEink(`[${reqId}] Python execution completed successfully`);
        resolve();
      }
    });

    child.on('error', (err) => {
      logEink(`[${reqId}] Python process error: ${err.message}`);
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Python at ${pythonPath}: ${err.message}`));
    });
  });
}

async function getEinkHtml(webview: vscode.Webview): Promise<string> {
  const htmlPath = path.join(__dirname, '..', 'src', 'eink-webview.html');
  let html = await fsp.readFile(htmlPath, 'utf-8');

  const nonce = getNonce();
  html = html.replace('<script>', `<script nonce="${nonce}">`);
  html = html.replace(
    '<meta name="viewport"',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data: vscode-resource: vscode-webview-resource:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">\n<meta name=\"viewport\"`
  );

  return html;
}

function getNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
