import * as vscode from 'vscode';
import { spawn, exec } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import * as https from 'https';
import * as http from 'http';

const execAsync = promisify(exec);

const TRIAL_STATUS_RETRY_INTERVAL_MS = 5000;
const TRIAL_STATUS_RETRY_ATTEMPTS = 6;

// Types for distiller-update JSON responses
interface Package {
	name: string;
	current_version: string | null;
	new_version: string;
	size?: number;
}

interface ListResponse {
	has_updates: boolean;
	packages: Package[];
	summary: string;
	checked_at: string;
}

interface ApplyResult {
	ok: boolean;
	rc: number;
	started_at: string;
	finished_at: string;
	results: Array<{
		name: string;
		installed: string;
		expected: string;
	}>;
	led_status?: 'updating' | 'success' | 'error' | 'idle' | 'disabled';
	error?: string;
}

// Extract JSON object from mixed output (handles log lines before/after JSON)
function extractJson<T>(output: string, requiredKeys: string[] = []): T {
	const lines = output.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		// Skip lines that don't start with '{'
		if (!trimmed.startsWith('{')) {
			continue;
		}

		// Collect lines starting from here, tracking brace depth
		let depth = 0;
		let jsonLines: string[] = [];

		for (let j = i; j < lines.length; j++) {
			const line = lines[j];
			jsonLines.push(line);

			for (const ch of line) {
				if (ch === '{') {
					depth++;
				} else if (ch === '}') {
					depth--;
				}
			}

			// Found complete JSON object
			if (depth === 0) {
				try {
					const parsed = JSON.parse(jsonLines.join('\n'));
					// Verify required keys if specified
					if (requiredKeys.length === 0 || requiredKeys.every(k => k in parsed)) {
						return parsed as T;
					}
				} catch {
					// Invalid JSON, try next candidate
				}
				break;
			}
		}
	}

	throw new Error('No valid JSON found in output');
}

// Check if platform version requires --refresh flag for distiller-update
function needsRefreshFlag(): boolean {
	try {
		const info = fs.readFileSync('/etc/distiller-platform-info', 'utf-8');
		const match = info.match(/DISTILLER_PLATFORM_VERSION=(\d+)\.(\d+)\.(\d+)/);
		if (!match) {
			return true; // Default to old behavior if can't parse
		}
		const major = parseInt(match[1], 10);
		// Version >= 2.0.0 doesn't need --refresh
		return major < 2;
	} catch {
		// File doesn't exist or can't be read - assume old platform
		return true;
	}
}

// NEWS feature constants and types
const NEWS_MAX_SIZE = 4096;
const NEWS_ALLOWED_CONTENT_TYPES = new Set([
	'text/plain',
	'text/html',
	'text/markdown',
	'application/octet-stream'
]);

interface NewsState {
	content: string | null;
	error: string | null;
	fetchedAt: Date | null;
	isLoading: boolean;
}

class WelcomeViewProvider implements vscode.WebviewViewProvider {
	private _view?: vscode.WebviewView;
	private _trialActive: boolean = false;
	private _trialConfirmed: boolean = false;
	private _isProcessing: boolean = false;
	private _errorState: '404' | '500' | 'broken_packages' | null = null;
	private _showHelp: boolean = false;
	private _deviceMac: string = '';
	private _deviceIp: string = '';
	private _updateStatus: string = '';
	private _updateDetails: string = '';
	private _availableUpdates: Package[] = [];
	private _hasCheckedUpdates: boolean = false;
	private _initialUpdateCount: number = 0;
	private _completedPackages: Set<string> = new Set();
	private _currentPackage: string = '';
	private _trialStatusSources: { env: boolean; settings: boolean } = { env: false, settings: false };
	private _trialVerificationTimer: NodeJS.Timeout | undefined;
	private _trialVerificationAttemptsRemaining: number = 0;
	private _updateDebounceTimer: NodeJS.Timeout | undefined;
	// NEWS feature state
	private _newsState: NewsState = { content: null, error: null, fetchedAt: null, isLoading: false };
	private _newsCollapsed: boolean = false;
	// Update polling state for setsid-based updates
	private _updatePollTimer: NodeJS.Timeout | undefined;
	private _updateLogPath: string = '/tmp/distiller-update.log';
	private _lastLogSize: number = 0;

	constructor(
		private readonly _extensionUri: vscode.Uri
	) {
		this.checkTrialStatus();
		this.getDeviceInfo();
		this.fetchNews();
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
				case 'configurePendingPackages':
					await this.configurePendingPackages();
					break;
				case 'clearPackageCache':
					await this.clearPackageCache();
					break;
				case 'toggleNewsCollapsed':
					this._newsCollapsed = !this._newsCollapsed;
					this.updateWebview();
					break;
				case 'refreshNews':
					await this.fetchNews();
					break;
			}
		});

		// Check status when view becomes visible
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.checkTrialStatus();
				this.getDeviceInfo();
				this.fetchNews();
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
			const { stdout: macOutput } = await execAsync('python3 /usr/lib/distiller-telemetry/get_mac.py');
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

	private async fetchNews(): Promise<void> {
		const config = vscode.workspace.getConfiguration();
		const enabled = config.get<boolean>('pamir.news.enabled', true);

		if (!enabled) {
			this._newsState = { content: null, error: null, fetchedAt: null, isLoading: false };
			return;
		}

		// Prevent concurrent fetches
		if (this._newsState.isLoading) {
			return;
		}

		this._newsState.isLoading = true;
		this.updateWebview();

		const newsUrl = config.get<string>('pamir.news.url', 'https://apt.pamir.ai/NEWS');
		const timeout = config.get<number>('pamir.news.timeout', 5000);

		try {
			const content = await this.fetchNewsContent(newsUrl, timeout);
			this._newsState = {
				content,
				error: null,
				fetchedAt: new Date(),
				isLoading: false,
			};
		} catch (error: any) {
			console.error('Failed to fetch news:', error);
			this._newsState = {
				content: this._newsState.content, // Keep previous content if available
				error: error?.message || 'Failed to fetch news',
				fetchedAt: this._newsState.fetchedAt, // Keep previous timestamp
				isLoading: false,
			};
		}

		this.updateWebview();
	}

	private fetchNewsContent(urlString: string, timeout: number): Promise<string> {
		return new Promise((resolve, reject) => {
			const url = new URL(urlString);
			const transport = url.protocol === 'https:' ? https : http;

			const req = transport.get(url, {
				timeout,
				headers: {
					'User-Agent': 'device-manager/1.1.0',
				},
			}, (res) => {
				// Check status code
				if (res.statusCode !== 200) {
					reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
					return;
				}

				// Validate content type (warning only, don't fail)
				const contentType = res.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
				if (contentType && !NEWS_ALLOWED_CONTENT_TYPES.has(contentType)) {
					console.warn(`Unexpected content type for news: ${contentType}`);
				}

				let data = '';
				let bytesRead = 0;

				res.on('data', (chunk: Buffer) => {
					bytesRead += chunk.length;
					if (bytesRead > NEWS_MAX_SIZE) {
						res.destroy();
						// Still resolve with truncated content
						data = data.slice(0, NEWS_MAX_SIZE);
						console.warn(`News content truncated at ${NEWS_MAX_SIZE} bytes`);
						resolve(data.trim());
						return;
					}
					data += chunk.toString('utf-8');
				});

				res.on('end', () => {
					resolve(data.trim());
				});

				res.on('error', (err) => {
					reject(err);
				});
			});

			req.on('timeout', () => {
				req.destroy();
				reject(new Error(`Request timed out after ${timeout}ms`));
			});

			req.on('error', (err) => {
				reject(err);
			});
		});
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
			const process = spawn('python3', ['/usr/lib/distiller-telemetry/device_register.py']);
			
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
			const process = spawn('python3', ['/usr/lib/distiller-telemetry/device_unregister.py']);
			
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
			const refreshFlag = needsRefreshFlag() ? ' --refresh' : '';
			const { stdout } = await execAsync(`sudo distiller-update list --json${refreshFlag}`);
			const result: ListResponse = extractJson(stdout, ['has_updates', 'packages']);
			
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
            // Confirm with the user before proceeding
            const choice = await vscode.window.showWarningMessage(
                'System update will restart services and may disconnect the editor temporarily.',
                { modal: true, detail: 'Save your work. The UI may disconnect and reconnect repeatedly during the update. Proceed with installation?' },
                'Install Now',
                'Cancel'
            );
            if (choice !== 'Install Now') {
                return;
            }

            // Start processing
            this._isProcessing = true;
            this._updateStatus = 'starting';
            this._updateDetails = 'Starting Pamir system update...';
            this._initialUpdateCount = this._availableUpdates.length;
            this._completedPackages.clear();
            this._currentPackage = '';
            this._lastLogSize = 0;
            this.updateWebview();

            // Clear any existing log file
            try {
                fs.unlinkSync(this._updateLogPath);
            } catch {}

            // Run update in separate systemd transient unit so it survives code-server restart
            const refreshFlag = needsRefreshFlag() ? ' --refresh' : '';
            const jobId = Date.now().toString();
            const unit = `distiller-apply-${jobId}`;
            const cmd = `sudo -n systemd-run --unit=${unit} --collect --property=StandardOutput=file:${this._updateLogPath} --property=StandardError=file:${this._updateLogPath} /usr/bin/distiller-update apply --json${refreshFlag}`;
            await execAsync(cmd);

            vscode.window.showInformationMessage('System update started.');

            // Start polling the log file for progress
            this.startLogPolling();

        } catch (err: any) {
            this._isProcessing = false;
            this._updateStatus = '';
            this._updateDetails = '';
            vscode.window.showErrorMessage(`Failed to start update: ${err?.message ?? err}`);
            this.updateWebview();
        }
    }

    private startLogPolling(): void {
        // Poll every 1 second
        this._updatePollTimer = setInterval(() => {
            this.pollUpdateLog();
        }, 1000);
    }

    private stopLogPolling(): void {
        if (this._updatePollTimer) {
            clearInterval(this._updatePollTimer);
            this._updatePollTimer = undefined;
        }
    }

    private pollUpdateLog(): void {
        try {
            if (!fs.existsSync(this._updateLogPath)) {
                return;
            }

            const stat = fs.statSync(this._updateLogPath);
            if (stat.size === this._lastLogSize) {
                // No new data, check if process finished
                this.checkIfUpdateFinished();
                return;
            }

            // Read new content from log file
            const fd = fs.openSync(this._updateLogPath, 'r');
            const buffer = Buffer.alloc(stat.size - this._lastLogSize);
            fs.readSync(fd, buffer, 0, buffer.length, this._lastLogSize);
            fs.closeSync(fd);
            this._lastLogSize = stat.size;

            const newContent = buffer.toString('utf-8');
            this.parseAptOutput(newContent);

            // Check if we have the final JSON result
            this.checkIfUpdateFinished();

        } catch (err) {
            console.error('Error polling update log:', err);
        }
    }

    private checkIfUpdateFinished(): void {
        try {
            if (!fs.existsSync(this._updateLogPath)) {
                return;
            }

            const content = fs.readFileSync(this._updateLogPath, 'utf-8');

            // Try to extract final JSON result
            try {
                const result = extractJson<ApplyResult>(content, ['ok', 'rc']);
                // Found valid result JSON - update is complete
                this.stopLogPolling();
                this.handleUpdateComplete(result);
                return;
            } catch {
                // No complete JSON yet, update still running
            }

        } catch (err) {
            console.error('Error checking update status:', err);
        }
    }

    private handleUpdateComplete(result: ApplyResult): void {
        this._isProcessing = false;

        if (result.ok) {
            const ledMsg = result.led_status === 'success' ? ' (LED: Green)' : '';
            vscode.window.showInformationMessage(`System update completed successfully!${ledMsg}`);
            this._hasCheckedUpdates = false;
            this._availableUpdates = [];
            this._completedPackages.clear();
            this._currentPackage = '';
            this._updateStatus = '';
            this._updateDetails = '';
        } else {
            this._errorState = this.detectBrokenPackages(result.rc, result.error || '');
            if (this._errorState === 'broken_packages') {
                this._updateStatus = 'Package installation failed. Use recovery options below to fix.';
            } else {
                this._updateStatus = result.error || 'Update failed';
            }
            const ledMsg = result.led_status === 'error' ? ' (LED: Red)' : '';
            vscode.window.showErrorMessage(`System update failed${ledMsg}. ${this._updateStatus}`);
            this._updateDetails = '';
        }

        // Clean up log file
        try {
            fs.unlinkSync(this._updateLogPath);
        } catch {}

        this.updateWebview();
    }

	private parseAptOutput(text: string): void {
		const setupRegex = /Setting up ([a-z0-9][a-z0-9+.-]+) \(/g;
		let match;
		while ((match = setupRegex.exec(text)) !== null) {
			this._completedPackages.add(match[1]);
			this._currentPackage = match[1];
		}

		const unpackRegex = /Unpacking ([a-z0-9][a-z0-9+.-]+) \(/g;
		while ((match = unpackRegex.exec(text)) !== null) {
			this._currentPackage = match[1];
		}

		// Debounce webview updates to prevent race conditions
		if (this._updateDebounceTimer) {
			clearTimeout(this._updateDebounceTimer);
		}
		this._updateDebounceTimer = setTimeout(() => {
			this.updateWebview();
			this._updateDebounceTimer = undefined;
		}, 100); // 100ms debounce
	}

	private detectBrokenPackages(code: number | null, output: string): 'broken_packages' | null {
		const DPKG_ERROR_EXIT_CODE = 100;
		const lowerOutput = output.toLowerCase();

		const errorPatterns = [
			'dpkg was interrupted',
			'errors were encountered',
			'sub-process /usr/bin/dpkg returned an error',
			'dpkg: error processing',
			'e: sub-process',
		];

		const hasErrorPattern = errorPatterns.some(pattern => lowerOutput.includes(pattern));

		if (hasErrorPattern || code === DPKG_ERROR_EXIT_CODE) {
			return 'broken_packages';
		}

		return null;
	}


	private async configurePendingPackages(): Promise<void> {
		this._isProcessing = true;
		this._updateStatus = 'Configuring pending packages...';
		this.updateWebview();

		try {
			await execAsync('sudo dpkg --configure -a');

			// Verify recovery succeeded
			const { stdout: dpkgStatus } = await execAsync('dpkg --audit');
			if (dpkgStatus.trim().length > 0) {
				throw new Error('Some packages remain unconfigured. Check package status manually.');
			}

			// Clear all error-related state
			this._errorState = null;
			this._completedPackages.clear();
			this._currentPackage = '';
			this._initialUpdateCount = 0;
			this._updateStatus = 'Package configuration completed';

			vscode.window.showInformationMessage('Successfully configured pending packages');
		} catch (error: any) {
			console.error('Failed to configure packages:', error);
			// Keep error state since recovery failed
			this._updateStatus = `Configuration failed: ${error.message}`;
			vscode.window.showErrorMessage(`Failed to configure packages: ${error.message}`);
		} finally {
			this._isProcessing = false;
			this.updateWebview();
		}
	}

	private async clearPackageCache(): Promise<void> {
		this._isProcessing = true;
		this._updateStatus = 'Clearing package cache...';
		this.updateWebview();

		try {
			await execAsync('sudo apt-get clean');

			// Clear update-related state
			this._completedPackages.clear();
			this._currentPackage = '';
			this._initialUpdateCount = 0;
			this._updateStatus = 'Package cache cleared';

			vscode.window.showInformationMessage('Successfully cleared package cache');
		} catch (error: any) {
			console.error('Failed to clear cache:', error);
			this._updateStatus = `Failed to clear cache: ${error.message}`;
			vscode.window.showErrorMessage(`Failed to clear package cache: ${error.message}`);
		} finally {
			this._isProcessing = false;
			this.updateWebview();
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

		const toolButtonsMarkup = toolActions.length
			? `<div class="btn-row">${toolActions.join('')}</div>`
			: '';

		let updateDetails = '';

		// Show progress bar if update is running
		if (this._isProcessing && this._initialUpdateCount > 0) {
			const completed = this._completedPackages.size;
			const total = this._initialUpdateCount;
			const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
			updateDetails += `
				<div class="progress-container">
					<div class="progress-label">${this._updateDetails || 'Installing updates...'}</div>
					<div class="progress-bar">
						<div class="progress-fill" style="width: ${percent}%"></div>
					</div>
					<div class="progress-text">${completed}/${total} packages (${percent}%)</div>
				</div>
			`;
		} else if (this._isProcessing && (this._updateStatus || this._updateDetails)) {
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

		// Recovery section for broken packages
		let recoverySection = '';
		if (this._errorState === 'broken_packages') {
			recoverySection = `
				<div class="recovery-section">
					<div class="alert alert-warning">
						<strong>[!] Package Installation Failed</strong>
						<p>The system detected errors during package installation. Use the recovery options below to fix the issue.</p>
					</div>
					<div class="btn-row">
						<button class="btn btn-primary" onclick="configurePendingPackages()" ${this._isProcessing ? 'disabled' : ''}>
							CONFIGURE PENDING PACKAGES
						</button>
						<button class="btn btn-secondary" onclick="clearPackageCache()" ${this._isProcessing ? 'disabled' : ''}>
							CLEAR PACKAGE CACHE
						</button>
					</div>
					<p class="recovery-help">
						<strong>What do these do?</strong><br>
						• <strong>Configure Pending:</strong> Completes interrupted package installations (dpkg --configure -a)<br>
						• <strong>Clear Cache:</strong> Removes downloaded package files that may be corrupted (apt-get clean)
					</p>
				</div>
			`;
		}

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

				.progress-container {
					margin-top: 14px;
					padding: 12px;
					border-radius: var(--radius);
					border: 1px solid var(--hair);
					background: var(--surface);
				}
				.progress-label {
					font-size: 12px;
					color: var(--teal);
					margin-bottom: 8px;
					font-weight: 600;
				}
				.progress-bar {
					width: 100%;
					height: 8px;
					background: color-mix(in srgb, var(--teal) 20%, var(--surface));
					border-radius: 999px;
					overflow: hidden;
					margin-bottom: 6px;
				}
				.progress-fill {
					height: 100%;
					background: var(--teal);
					transition: width 0.3s ease;
					border-radius: 999px;
				}
				.progress-text {
					font-size: 11px;
					color: var(--muted);
					text-align: center;
				}

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

				/* Recovery UI styles */
				.recovery-section {
					margin: 20px 0;
					padding: 16px;
					background: var(--surface);
					border-radius: var(--radius);
					border: 1px solid var(--hair);
				}
				.alert {
					padding: 14px;
					border-radius: var(--radius);
					margin-bottom: 16px;
					line-height: 1.5;
				}
				.alert-warning {
					background: color-mix(in srgb, var(--amber) 15%, var(--surface) 85%);
					border-left: 4px solid var(--amber);
				}
				.alert-warning strong {
					color: var(--amber);
					display: block;
					margin-bottom: 6px;
				}
				.alert-warning p {
					margin: 0;
					font-size: 13px;
					color: var(--text);
				}
				.recovery-help {
					margin-top: 16px;
					padding-top: 12px;
					border-top: 1px solid var(--hair);
					font-size: 12px;
					color: var(--muted);
					line-height: 1.6;
				}
				.recovery-help strong {
					color: var(--text);
				}
				.btn-secondary {
					background: color-mix(in srgb, var(--text) 10%, var(--surface) 90%);
					color: var(--text);
				}
				.btn-secondary:hover:not(:disabled) {
					background: color-mix(in srgb, var(--text) 20%, var(--surface) 80%);
				}

				/* News section styles */
				.news-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
				}
				.news-header .h {
					margin: 0;
					flex: 1;
				}
				.collapse-icon {
					font-family: monospace;
					color: var(--teal);
				}
				.news-refresh-btn {
					background: transparent;
					border: 1px solid var(--hair);
					border-radius: 6px;
					color: var(--teal);
					padding: 4px 8px;
					font-size: 10px;
					letter-spacing: .08em;
					cursor: pointer;
				}
				.news-refresh-btn:hover:not(:disabled) {
					border-color: rgba(76,201,176,0.6);
					background: rgba(76,201,176,0.12);
				}
				.news-refresh-btn:disabled {
					opacity: 0.5;
					cursor: not-allowed;
				}
				.news-timestamp {
					margin: 4px 0 8px;
					font-size: 10px;
					color: var(--muted);
				}
				.news-content {
					padding: 12px;
					border-radius: var(--radius);
					border: 1px solid var(--hair);
					background: var(--surface);
					font-size: 12px;
					line-height: 1.6;
					color: var(--text);
					max-height: 200px;
					overflow-y: auto;
				}
				.news-loading {
					padding: 12px;
					font-size: 12px;
					color: var(--muted);
					font-style: italic;
				}
				.news-error {
					padding: 12px;
					font-size: 12px;
					color: var(--muted);
				}

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
							${recoverySection}
						</div>
					</section>

					${this._getNewsSection()}

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

					function configurePendingPackages() {
						vscode.postMessage({ type: 'configurePendingPackages' });
					}

					function clearPackageCache() {
						vscode.postMessage({ type: 'clearPackageCache' });
					}

					function toggleNewsCollapsed() {
						vscode.postMessage({ type: 'toggleNewsCollapsed' });
					}

					function refreshNews() {
						vscode.postMessage({ type: 'refreshNews' });
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

	private getStatusMetadata(effectiveErrorState: '404' | '500' | 'broken_packages' | null): { label: string; className: string; detail: string } {
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

		if (effectiveErrorState === 'broken_packages') {
			return {
				label: 'UPDATE FAILED',
				className: 'status-error',
				detail: 'Package installation encountered errors. Use recovery options below.'
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

	private _getNewsSection(): string {
		const config = vscode.workspace.getConfiguration();
		const enabled = config.get<boolean>('pamir.news.enabled', true);

		if (!enabled) {
			return '';
		}

		const hasContent = this._newsState.content && this._newsState.content.length > 0;
		const hasError = this._newsState.error && !hasContent;
		const isLoading = this._newsState.isLoading;

		// Format timestamp
		let timestampStr = '';
		if (this._newsState.fetchedAt) {
			timestampStr = this._newsState.fetchedAt.toLocaleString();
		}

		// Collapse toggle icon
		const collapseIcon = this._newsCollapsed ? '+' : '-';

		// Content or placeholder
		let contentHtml = '';
		if (isLoading) {
			contentHtml = `<div class="news-loading">Loading news...</div>`;
		} else if (hasError && !hasContent) {
			contentHtml = `<div class="news-error">Unable to load news</div>`;
		} else if (hasContent && !this._newsCollapsed) {
			// Escape HTML to prevent XSS (news is plain text)
			const escapedContent = this._newsState.content!
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/\n/g, '<br>');
			contentHtml = `<div class="news-content">${escapedContent}</div>`;
		}

		return `
			<hr class="rule" />
			<section class="section">
				<div class="content">
					<div class="news-header">
						<h3 class="h" onclick="toggleNewsCollapsed()" style="cursor: pointer;">
							<span class="collapse-icon">[${collapseIcon}]</span> NEWS
						</h3>
						<button class="news-refresh-btn" onclick="refreshNews()" ${isLoading ? 'disabled' : ''}>
							REFRESH
						</button>
					</div>
					${timestampStr ? `<p class="news-timestamp">Last updated: ${timestampStr}</p>` : ''}
					${contentHtml}
				</div>
			</section>
		`;
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

export function deactivate() {
	if (einkOutputChannel) {
		einkOutputChannel.dispose();
	}
}

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

const CANVAS_WIDTH = 250;
const CANVAS_HEIGHT = 128;
const EDGE_PADDING = 6;
const QR_DEFAULT_SIZE = 50;
const MAX_IP_SAMPLE_LENGTH = '255.255.255.255'.length;
const FONT_WIDTH = 6;
const FONT_HEIGHT = 8;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function computeIpBox(element: OverlayElement) {
  const rawPadding = Math.max(0, element.padding ?? 1);
  const padding = element.background === false ? 0 : rawPadding;
  const fontSize = Math.max(1, Math.round(element.font_size ?? 1));
  const textWidth = MAX_IP_SAMPLE_LENGTH * FONT_WIDTH * fontSize;
  const textHeight = FONT_HEIGHT * fontSize;
  const boxWidth = textWidth + padding * 2;
  const boxHeight = textHeight + padding * 2;
  return { padding, fontSize, textWidth, textHeight, boxWidth, boxHeight };
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
  panel.webview.html = await getEinkHtml(panel.webview, _ctx.extensionUri);
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

  for (const element of overlays.elements) {
    if (element.type === 'ip') {
      const dims = computeIpBox(element);
      const minX = EDGE_PADDING;
      const maxX = Math.max(minX, CANVAS_WIDTH - dims.boxWidth - EDGE_PADDING);
      const minY = EDGE_PADDING;
      const maxY = Math.max(minY, CANVAS_HEIGHT - dims.boxHeight - EDGE_PADDING);
      const ipX = clamp(element.x, minX, maxX);
      const ipY = clamp(element.y, minY, maxY);
      const textX = ipX + dims.padding;
      const textY = ipY + dims.padding;

      const includeBackground = element.background ?? true;
      if (includeBackground) {
        layers.push({
          id: `${element.id}_background`,
          type: 'rectangle',
          visible: true,
          x: ipX,
          y: ipY,
          width: Math.round(dims.boxWidth),
          height: Math.round(dims.boxHeight),
          filled: true,
          color: 255,
        });
      }

      layers.push({
        id: element.id,
        type: 'text',
        visible: true,
        x: Math.round(textX),
        y: Math.round(textY),
        text: '$IP_ADDRESS',
        placeholder_type: 'ip',
        color: element.color ?? 0,
        font_size: Math.round((element.font_size ?? 1) * 1.1),
        background: false,
        padding: 0,
        rotate: 0,
        flip_h: false,
        flip_v: false,
        width: Math.round(dims.textWidth),
        height: Math.round(dims.textHeight),
        box_width: Math.round(dims.boxWidth),
        box_height: Math.round(dims.boxHeight),
        box_padding: dims.padding,
      });
    } else if (element.type === 'qr') {
      const qrWidth = element.width || QR_DEFAULT_SIZE;
      const qrHeight = element.height || QR_DEFAULT_SIZE;
      const minQrX = EDGE_PADDING;
      const maxQrX = Math.max(minQrX, CANVAS_WIDTH - qrWidth - EDGE_PADDING);
      const minQrY = EDGE_PADDING;
      const maxQrY = Math.max(minQrY, CANVAS_HEIGHT - qrHeight - EDGE_PADDING);
      const qrX = clamp(element.x, minQrX, maxQrX);
      const qrY = clamp(element.y, minQrY, maxQrY);

      layers.push({
        id: element.id,
        type: 'text',
        visible: true,
        x: qrX,
        y: qrY,
        text: '$QR_CODE',
        placeholder_type: 'qr',
        width: qrWidth,
        height: qrHeight,
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
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
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
from distiller_sdk.hardware.eink.composer import TemplateRenderer

MAX_IP_LEN = 15

def center_ip(ip: str) -> str:
    return ip.center(MAX_IP_LEN)

try:
    renderer = TemplateRenderer("${templatePath}")
    centered_ip = center_ip('127.0.0.1')
    renderer.render_and_save(centered_ip, '${tunnelUrl}', '${outputPath}')
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
    from distiller_sdk.hardware.eink.composer import TemplateRenderer
    print(f"[SCRIPT] TemplateRenderer imported successfully", file=sys.stderr)
except ImportError as e:
    print(f"ERROR: Failed to import TemplateRenderer: {e}", file=sys.stderr)
    sys.exit(1)

MAX_IP_LEN = 15

def center_ip(ip: str) -> str:
    return ip.center(MAX_IP_LEN)

try:
    print(f"[SCRIPT] Getting device IP address...", file=sys.stderr)
    # Get device IP
    result = subprocess.run(['hostname', '-I'], capture_output=True, text=True)
    ip = result.stdout.split()[0] if result.stdout else '127.0.0.1'
    centered_ip = center_ip(ip)
    print(f"[SCRIPT] Using IP: {ip}", file=sys.stderr)
    print(f"[SCRIPT] Padded IP for centering: '{centered_ip}'", file=sys.stderr)
    print(f"[SCRIPT] Using tunnel URL: ${tunnelUrl}", file=sys.stderr)

    print(f"[SCRIPT] Creating TemplateRenderer instance...", file=sys.stderr)
    renderer = TemplateRenderer("${templatePath}")
    print(f"[SCRIPT] TemplateRenderer created successfully", file=sys.stderr)
    
    print(f"[SCRIPT] Starting render_and_display...", file=sys.stderr)
    start_time = time.time()
    try:
        renderer.render_and_display(centered_ip, '${tunnelUrl}')
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
  const pythonPath = cfg.get<string>('pamir.eink.pythonPath') || '/opt/distiller-sdk/.venv/bin/python';
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

async function getEinkHtml(webview: vscode.Webview, extUri: vscode.Uri): Promise<string> {
  const htmlPath = vscode.Uri.joinPath(extUri, 'media', 'eink-webview.html').fsPath;
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
