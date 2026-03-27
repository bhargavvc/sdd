import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import type { SddClient, AgentEvent } from "./sdd-client.js";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

interface MilestoneInfo {
	id: string;
	title: string;
	status: "active" | "complete" | "pending" | "parked";
	slicesDone: number;
	slicesTotal: number;
}

interface ProjectState {
	hasProject: boolean;
	milestones: MilestoneInfo[];
	activeMilestone: MilestoneInfo | null;
}

export class SddSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = "sdd-sidebar";

	private view?: vscode.WebviewView;
	private disposables: vscode.Disposable[] = [];
	private chatMessages: ChatMessage[] = [];
	private outputChannel: vscode.OutputChannel;
	private globalState: vscode.Memento;

	constructor(
		_extensionUri: vscode.Uri,
		private readonly client: SddClient,
		globalState?: vscode.Memento,
	) {
		this.globalState = globalState ?? { get: () => undefined, update: async () => {}, keys: () => [] } as unknown as vscode.Memento;
		this.outputChannel = vscode.window.createOutputChannel("SDD Events");
		this.disposables.push(
			this.outputChannel,
			client.onConnectionChange(() => {
				this.sendToWebview({ type: "statusUpdate", connected: this.client.isConnected });
			}),
			client.onEvent((evt) => this.handleAgentEvent(evt)),
		);
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };

		webviewView.webview.onDidReceiveMessage(async (msg: { command: string; text?: string; label?: string; path?: string }) => {
			switch (msg.command) {
				case "sendMessage":
					if (msg.text) await this.handleUserMessage(msg.text, msg.label);
					break;
				case "openFile":
					if (msg.path) {
						try {
							const uri = vscode.Uri.file(msg.path);
							await vscode.window.showTextDocument(uri);
						} catch { /* file not found, ignore */ }
					}
					break;
				case "start":
					await vscode.commands.executeCommand("sdd.start");
					break;
				case "stop":
					await vscode.commands.executeCommand("sdd.stop");
					break;
				case "newSession":
					this.saveCurrentSession();
					this.chatMessages = [];
					this.currentSessionId = "";
					await vscode.commands.executeCommand("sdd.newSession");
					this.sendToWebview({ type: "clearChat" });
					break;
				case "home":
					this.saveCurrentSession();
					this.chatMessages = [];
					this.currentSessionId = "";
					this.sendToWebview({ type: "clearChat" });
					setTimeout(() => this.pushFullState(), 100);
					break;
				case "getHistory":
					this.sendToWebview({ type: "historyData", sessions: this.getSessionHistory() });
					break;
				case "switchModel":
					await vscode.commands.executeCommand("sdd.switchModel");
					break;
				case "cycleThinking":
					await vscode.commands.executeCommand("sdd.cycleThinking");
					break;
				case "compact":
					await vscode.commands.executeCommand("sdd.compact");
					break;
				case "abort":
					await vscode.commands.executeCommand("sdd.abort");
					this.sendToWebview({ type: "agentEnd" });
					break;
				case "toggleAutoCompaction":
					if (this.client.isConnected) {
						const state = await this.client.getState().catch(() => null);
						if (state) {
							await this.client.setAutoCompaction(!state.autoCompactionEnabled).catch(() => {});
						}
					}
					break;
			}
		});

		webviewView.webview.html = this.getHtml();
		setTimeout(() => this.pushFullState(), 150);
	}

	private scanProjectState(): ProjectState {
		const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!cwd) return { hasProject: false, milestones: [], activeMilestone: null };

		const sddDir = path.join(cwd, ".sdd", "milestones");
		if (!fs.existsSync(sddDir)) return { hasProject: false, milestones: [], activeMilestone: null };

		const milestones: MilestoneInfo[] = [];
		try {
			const entries = fs.readdirSync(sddDir, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory() || !/^M\d{3}/.test(entry.name)) continue;

				const mDir = path.join(sddDir, entry.name);
				const mId = entry.name.match(/^(M\d{3})/)?.[1] ?? entry.name;

				// Determine status
				const hasSummary = fs.existsSync(path.join(mDir, `${mId}-SUMMARY.md`));
				const hasParked = fs.existsSync(path.join(mDir, `${mId}-PARKED.md`));
				const hasRoadmap = fs.existsSync(path.join(mDir, `${mId}-ROADMAP.md`));

				let title = mId;
				let slicesDone = 0;
				let slicesTotal = 0;

				// Parse ROADMAP.md for title and slice progress
				if (hasRoadmap) {
					try {
						const content = fs.readFileSync(path.join(mDir, `${mId}-ROADMAP.md`), "utf-8");
						// Title from first H1
						const titleMatch = content.match(/^#\s+(?:M\d{3}:\s*)?(.+)$/m);
						if (titleMatch) title = titleMatch[1].trim();
						// Count slices
						const sliceLines = content.matchAll(/^-\s+\[([ xX])\]\s+\*\*S\d+:/gm);
						for (const m of sliceLines) {
							slicesTotal++;
							if (m[1] === "x" || m[1] === "X") slicesDone++;
						}
					} catch { /* ignore read errors */ }
				}

				// Also check for CONTEXT.md title as fallback
				if (title === mId) {
					const ctxPath = path.join(mDir, `${mId}-CONTEXT.md`);
					if (fs.existsSync(ctxPath)) {
						try {
							const ctx = fs.readFileSync(ctxPath, "utf-8");
							const ctxTitle = ctx.match(/^#\s+(?:M\d{3}:\s*)?(.+)$/m);
							if (ctxTitle) title = ctxTitle[1].trim();
						} catch { /* ignore */ }
					}
				}

				const status: MilestoneInfo["status"] = hasSummary ? "complete"
					: hasParked ? "parked"
					: hasRoadmap ? "active"
					: "pending";

				milestones.push({ id: mId, title, status, slicesDone, slicesTotal });
			}
		} catch { /* ignore dir read errors */ }

		milestones.sort((a, b) => a.id.localeCompare(b.id));

		const activeMilestone = milestones.find(m => m.status === "active") ?? null;

		return { hasProject: milestones.length > 0, milestones, activeMilestone };
	}

	private async pushFullState(): Promise<void> {
		let modelName = "Not connected";
		const connected = this.client.isConnected;

		if (connected) {
			try {
				const state = await this.client.getState();
				modelName = state.model ? `${state.model.provider}/${state.model.id}` : "Connected";
			} catch { /* ignore */ }
		}

		const projectState = this.scanProjectState();

		this.sendToWebview({
			type: "init",
			connected,
			modelName,
			messages: this.chatMessages,
			project: projectState,
		});
	}

	private async handleUserMessage(text: string, displayLabel?: string): Promise<void> {
		if (!this.client.isConnected) {
			try {
				await this.client.start();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				this.sendToWebview({ type: "error", text: `Failed to start agent: ${msg}` });
				return;
			}
		}

		this.sendToWebview({ type: "userMessage", text: displayLabel ?? text });
		this.bubbleCreated = false;

		try {
			// sendPrompt resolves immediately (acknowledges receipt).
			// Streaming events arrive AFTER via handleAgentEvent.
			await this.client.sendPrompt(text);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			this.sendToWebview({ type: "error", text: msg });
		}
	}

	private handleAgentEvent(evt: AgentEvent): void {
		if (!this.view) return;

		this.outputChannel.appendLine(`[event] ${evt.type}: ${JSON.stringify(evt).slice(0, 300)}`);
		try { fs.appendFileSync(path.join(process.env.USERPROFILE ?? "", "sdd-events.log"), `${evt.type}: ${JSON.stringify(evt).slice(0, 500)}\n`); } catch {}

		switch (evt.type) {
			case "agent_start":
				this.sendToWebview({ type: "agentWorking" });
				break;

			case "tool_execution_start": {
				const toolName = evt.toolName as string | undefined;
				const toolInput = evt.toolInput as Record<string, unknown> | undefined;
				const detail = this.describeToolCall(toolName ?? "", toolInput);
				this.sendToWebview({ type: "toolProgress", text: detail });
				break;
			}

			case "message_update": {
				const ae = evt.assistantMessageEvent as Record<string, unknown> | undefined;
				if (!ae) break;
				if (ae.type === "text_delta" && ae.delta) {
					this.ensureAssistantBubble();
					this.appendDelta(ae.delta as string);
				}
				break;
			}

			case "agent_end":
				this.bubbleCreated = false;
				this.autoSaveSession();
				this.sendToWebview({ type: "agentEnd" });
				break;

			// Ignore: message_start, message_end, turn_start, turn_end,
			// extensions_ready, extension_ui_request, tool_execution_end
		}
	}

	private bubbleCreated = false;

	private ensureAssistantBubble(): void {
		if (!this.bubbleCreated) {
			this.bubbleCreated = true;
			this.chatMessages.push({ role: "assistant", content: "" });
			this.sendToWebview({ type: "assistantStart" });
		}
	}

	private appendDelta(text: string): void {
		const last = this.chatMessages[this.chatMessages.length - 1];
		if (last?.role === "assistant") last.content += text;
		this.sendToWebview({ type: "delta", text });
	}

	private describeToolCall(toolName: string, input?: Record<string, unknown>): string {
		if (!input) return `Running ${toolName}...`;
		switch (toolName) {
			case "Read": return `Reading ${this.shortenPath(String(input.file_path ?? ""))}`;
			case "Write": return `Writing ${this.shortenPath(String(input.file_path ?? ""))}`;
			case "Edit": return `Editing ${this.shortenPath(String(input.file_path ?? ""))}`;
			case "Bash": return `$ ${String(input.command ?? "").slice(0, 60)}`;
			case "Glob": return `Searching ${input.pattern ?? ""}`;
			case "Grep": return `Grep: ${input.pattern ?? ""}`;
			default: return `${toolName}...`;
		}
	}

	private shortenPath(fp: string): string {
		return fp.replace(/\\/g, "/").split("/").slice(-2).join("/");
	}

	private sendToWebview(msg: Record<string, unknown>): void {
		this.view?.webview.postMessage(msg);
	}

	private saveCurrentSession(): void {
		if (this.chatMessages.length === 0) return;
		const firstUserMsg = this.chatMessages.find(m => m.role === "user");
		if (!firstUserMsg) return;
		const history = this.getSessionHistory();
		history.unshift({ text: firstUserMsg.content, time: new Date().toISOString() });
		if (history.length > 20) history.pop();
		this.globalState.update("sdd.sessionHistory", history);
	}

	private getSessionHistory(): { text: string; time: string }[] {
		return this.globalState.get<{ text: string; time: string }[]>("sdd.sessionHistory", []);
	}

	private currentSessionId = "";

	private autoSaveSession(): void {
		const firstUserMsg = this.chatMessages.find(m => m.role === "user");
		if (!firstUserMsg) return;
		const msgCount = this.chatMessages.length;
		const sessionKey = firstUserMsg.content.slice(0, 50);

		// If same session (same first message), update in place
		if (this.currentSessionId === sessionKey) return;
		this.currentSessionId = sessionKey;

		const history = this.getSessionHistory();
		// Don't duplicate if already exists with same text
		if (history.length > 0 && history[0].text === firstUserMsg.content) return;
		history.unshift({
			text: firstUserMsg.content,
			time: new Date().toISOString(),
		});
		if (history.length > 30) history.pop();
		this.globalState.update("sdd.sessionHistory", history);
	}

	async refresh(): Promise<void> {
		await this.pushFullState();
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}

	private getHtml(): string {
		const nonce = getNonce();
		return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root {
	--sdd-navy: #1a1a2e;
	--sdd-navy-light: #222240;
	--sdd-navy-mid: #2a2a48;
	--sdd-coral: #ff6b6b;
	--sdd-coral-dim: #cc5555;
	--sdd-teal: #4ec9b0;
	--sdd-yellow: #e2b93d;
	--sdd-text: #e0e0ec;
	--sdd-text-dim: #8888a8;
	--sdd-border: #333355;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--sdd-text);
	background: var(--sdd-navy);
	height: 100vh;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	position: relative;
}

/* ── Status Bar ─────────────────────────────────── */
#status-bar {
	display: flex; align-items: center; gap: 8px;
	padding: 8px 12px;
	background: var(--sdd-navy-light);
	border-bottom: 1px solid var(--sdd-border);
	flex-shrink: 0;
}
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.dot-on { background: var(--sdd-teal); box-shadow: 0 0 6px var(--sdd-teal); }
.dot-off { background: var(--sdd-coral); box-shadow: 0 0 6px var(--sdd-coral); }
#model-label {
	font-size: 11px; color: var(--sdd-text-dim);
	flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#btn-toggle {
	font-size: 11px; padding: 3px 10px;
	border: 1px solid var(--sdd-coral); border-radius: 3px;
	cursor: pointer; background: transparent; color: var(--sdd-coral);
	flex-shrink: 0; transition: all 0.15s;
}
#btn-toggle:hover { background: var(--sdd-coral); color: #fff; }

/* ── Messages Area ──────────────────────────────── */
#messages {
	flex: 1; overflow-y: auto; padding: 12px;
	display: flex; flex-direction: column; gap: 10px;
}
#messages::-webkit-scrollbar { width: 5px; }
#messages::-webkit-scrollbar-track { background: transparent; }
#messages::-webkit-scrollbar-thumb { background: var(--sdd-border); border-radius: 3px; }

/* ── Empty State / Dashboard ────────────────────── */
.dashboard {
	display: flex; flex-direction: column; gap: 14px; padding: 4px 0;
}
.dash-header {
	text-align: center; padding: 12px 0 4px;
}
.dash-logo {
	font-size: 26px; font-weight: 800; color: var(--sdd-coral); letter-spacing: 2px;
}
.dash-sub {
	font-size: 10px; color: var(--sdd-text-dim); margin-top: 3px;
}
.dash-tips {
	font-size: 10px; color: var(--sdd-text-dim); margin-top: 8px;
	line-height: 1.6; text-align: left; padding: 6px 10px;
	background: rgba(78,201,176,0.06); border: 1px solid var(--sdd-border);
	border-radius: 6px;
}
.tip-icon { margin-right: 2px; }

/* ── Milestone Cards ────────────────────────────── */
.section-label {
	font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
	color: var(--sdd-text-dim); padding: 0 2px; margin-bottom: -6px;
}
.ms-card {
	background: var(--sdd-navy-light); border: 1px solid var(--sdd-border);
	border-radius: 8px; padding: 10px 12px; cursor: default;
}
.ms-card.active { border-left: 3px solid var(--sdd-teal); }
.ms-card.complete { border-left: 3px solid var(--sdd-teal); opacity: 0.55; }
.ms-card.parked { border-left: 3px solid var(--sdd-yellow); opacity: 0.55; }
.ms-card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.ms-id {
	font-size: 10px; font-weight: 700; color: var(--sdd-coral);
	background: rgba(255,107,107,0.12); padding: 1px 5px; border-radius: 3px;
}
.ms-status {
	font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
	padding: 1px 5px; border-radius: 3px; margin-left: auto;
}
.ms-status-active { color: var(--sdd-teal); background: rgba(78,201,176,0.12); }
.ms-status-complete { color: var(--sdd-teal); background: rgba(78,201,176,0.12); }
.ms-status-parked { color: var(--sdd-yellow); background: rgba(226,185,61,0.12); }
.ms-status-pending { color: var(--sdd-text-dim); background: rgba(136,136,168,0.12); }
.ms-title {
	font-size: 12px; color: var(--sdd-text); line-height: 1.3;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ms-progress { margin-top: 6px; }
.ms-bar-bg {
	height: 4px; background: var(--sdd-border); border-radius: 2px; overflow: hidden;
}
.ms-bar-fill {
	height: 100%; border-radius: 2px; transition: width 0.3s;
}
.ms-bar-fill.green { background: var(--sdd-teal); }
.ms-bar-fill.coral { background: var(--sdd-coral); }
.ms-bar-label {
	font-size: 9px; color: var(--sdd-text-dim); margin-top: 3px;
	display: flex; justify-content: space-between;
}

/* ── Workflow Actions Grid ──────────────────────── */
.wf-grid {
	display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
}
.wf-btn {
	display: flex; flex-direction: column; align-items: center;
	gap: 4px; padding: 10px 6px;
	background: var(--sdd-navy-light); border: 1px solid var(--sdd-border);
	border-radius: 8px; cursor: pointer; color: var(--sdd-text);
	font-size: 11px; text-align: center;
	transition: border-color 0.15s, background 0.15s, transform 0.1s;
}
.wf-btn:hover { border-color: var(--sdd-coral-dim); background: var(--sdd-navy-mid); transform: translateY(-1px); }
.wf-btn:active { transform: translateY(0); }
.wf-icon { font-size: 18px; line-height: 1; }
.wf-label { font-size: 10px; color: var(--sdd-text-dim); line-height: 1.2; }
.wf-btn.primary {
	border-color: var(--sdd-coral-dim); background: rgba(255,107,107,0.08);
}
.wf-btn.primary:hover { background: rgba(255,107,107,0.15); }
.wf-btn.wide { grid-column: 1 / -1; flex-direction: row; gap: 8px; padding: 10px 14px; }
.wf-btn.wide .wf-label { text-align: left; }

/* ── No Project State ───────────────────────────── */
.no-project {
	text-align: center; padding: 8px 0;
	color: var(--sdd-text-dim); font-size: 11px; line-height: 1.5;
}

/* ── Chat Bubbles ───────────────────────────────── */
.msg-wrapper { display: flex; flex-direction: column; }
.msg-role {
	font-size: 10px; color: var(--sdd-text-dim); margin-bottom: 3px;
	text-transform: uppercase; letter-spacing: 0.5px;
}
.msg-role-you { text-align: right; }
.bubble-user {
	align-self: flex-end; background: var(--sdd-coral); color: #fff;
	padding: 7px 12px; border-radius: 12px 12px 2px 12px;
	max-width: 88%; word-wrap: break-word; white-space: pre-wrap; font-size: 12.5px;
}
.bubble-assistant {
	align-self: stretch; background: var(--sdd-navy-light);
	border: 1px solid var(--sdd-border); color: var(--sdd-text);
	padding: 10px 14px; border-radius: 6px;
	width: 100%; box-sizing: border-box; word-wrap: break-word;
	overflow-wrap: break-word; overflow-x: hidden;
	line-height: 1.5; font-size: 12.5px;
}
.bubble-assistant br + br { display: none; }
.bubble-assistant .md-h1, .bubble-assistant .md-h2, .bubble-assistant .md-h3 { margin-top: 6px; }
.bubble-assistant .md-hr { margin: 4px 0; }
.bubble-assistant .md-li { padding: 1px 0; }
.bubble-assistant .md-table-row { font-size: 11px; padding: 2px 0; overflow-x: auto; }
.bubble-assistant .inline-code { word-break: break-all; }
.bubble-assistant pre { max-width: 100%; overflow-x: auto; }
.bubble-assistant.streaming { border-color: var(--sdd-coral-dim); }
.bubble-assistant.streaming::after {
	content: '\\25CB'; animation: blink 1s step-end infinite; color: var(--sdd-coral);
}
@keyframes blink { 50% { opacity: 0; } }
.err-msg { color: var(--sdd-coral); font-size: 11px; padding: 3px 0; }

/* ── Input Area ─────────────────────────────────── */
#input-area {
	padding: 8px 12px; border-top: 1px solid var(--sdd-border);
	background: var(--sdd-navy-light); display: flex; gap: 6px;
	align-items: flex-end; flex-shrink: 0;
}
#msg-input {
	flex: 1; background: var(--sdd-navy); color: var(--sdd-text);
	border: 1px solid var(--sdd-border); border-radius: 6px;
	padding: 7px 10px; font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size); resize: none;
	min-height: 34px; max-height: 120px; overflow-y: auto; line-height: 1.4;
}
#msg-input::placeholder { color: var(--sdd-text-dim); }
#msg-input:focus { outline: none; border-color: var(--sdd-coral-dim); }
#msg-input:disabled { opacity: 0.35; }
#btn-send {
	width: 30px; height: 30px; border: none; border-radius: 6px;
	cursor: pointer; background: var(--sdd-coral); color: #fff;
	font-size: 16px; display: flex; align-items: center; justify-content: center;
	flex-shrink: 0; transition: background 0.15s;
}
#btn-send:hover { background: var(--sdd-coral-dim); }
#btn-send:disabled { opacity: 0.25; cursor: default; }

/* ── Footer Controls ────────────────────────────── */
#footer { border-top: 1px solid var(--sdd-border); flex-shrink: 0; background: var(--sdd-navy); }
#footer-toggle {
	width: 100%; padding: 5px 12px; background: none; border: none;
	cursor: pointer; font-size: 10px; color: var(--sdd-text-dim); text-align: left;
}
#footer-toggle:hover { color: var(--sdd-text); }
#footer-inner { display: none; padding: 8px 12px; flex-direction: column; gap: 5px; }
#footer-inner.open { display: flex; }
.btn-row { display: flex; gap: 5px; }
.btn-row button { flex: 1; }
.ctrl {
	padding: 5px 8px; border: 1px solid var(--sdd-border); border-radius: 4px;
	cursor: pointer; font-size: 11px; color: var(--sdd-text-dim);
	background: var(--sdd-navy-light); transition: border-color 0.15s, color 0.15s;
}
.ctrl:hover { border-color: var(--sdd-coral-dim); color: var(--sdd-text); }

/* ── Tool Progress Indicator ────────────────────── */
.tool-progress {
	display: flex; align-items: center; gap: 8px;
	padding: 6px 10px; margin: 4px 0;
	background: rgba(255,107,107,0.06); border: 1px solid var(--sdd-border);
	border-radius: 6px; font-size: 11px; color: var(--sdd-text-dim);
	animation: fadeIn 0.2s;
}
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.progress-spinner {
	display: inline-block; width: 12px; height: 12px;
	border: 2px solid var(--sdd-border); border-top-color: var(--sdd-coral);
	border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Markdown Styles ────────────────────────────── */
.md-h1 { font-size: 15px; font-weight: 700; color: var(--sdd-coral); margin: 10px 0 4px; }
.md-h2 { font-size: 13px; font-weight: 700; color: var(--sdd-text); margin: 8px 0 3px; }
.md-h3 { font-size: 12px; font-weight: 600; color: var(--sdd-text); margin: 6px 0 2px; }
.md-li { padding: 1px 0 1px 4px; }
.md-hr { border: none; border-top: 1px solid var(--sdd-border); margin: 8px 0; }
.inline-code {
	background: var(--sdd-navy-mid); padding: 1px 5px; border-radius: 3px;
	font-family: monospace; font-size: 11px; color: var(--sdd-coral);
}
pre {
	background: var(--sdd-navy); border: 1px solid var(--sdd-border);
	border-radius: 6px; padding: 8px 10px; margin: 6px 0;
	overflow-x: auto; font-size: 11px; line-height: 1.5;
}
pre code { font-family: monospace; color: var(--sdd-text); }
.md-table-row {
	display: flex; gap: 2px; padding: 3px 0;
	border-bottom: 1px solid var(--sdd-border); font-size: 11px;
}
.md-cell {
	flex: 1; padding: 2px 6px; overflow: hidden;
	text-overflow: ellipsis; white-space: nowrap;
}
.bubble-assistant strong { color: var(--sdd-coral); }

/* ── Clickable File References ──────────────────── */
.file-link {
	color: var(--sdd-teal); cursor: pointer; text-decoration: underline;
	text-decoration-style: dotted; text-underline-offset: 2px;
	font-family: monospace; font-size: 11px;
}
.file-link:hover { color: #6eddd0; text-decoration-style: solid; }

/* ── Collapsible Thinking Blocks ────────────────── */
.thinking-block { margin: 4px 0; }
.thinking-toggle {
	display: flex; align-items: center; gap: 5px; cursor: pointer;
	font-size: 10px; color: var(--sdd-text-dim); padding: 3px 0;
	border: none; background: none; width: 100%; text-align: left;
}
.thinking-toggle:hover { color: var(--sdd-text); }
.thinking-arrow { transition: transform 0.15s; display: inline-block; }
.thinking-block.open .thinking-arrow { transform: rotate(90deg); }
.thinking-content {
	display: none; padding: 6px 10px; margin-top: 3px;
	background: rgba(136,136,168,0.06); border-left: 2px solid var(--sdd-border);
	border-radius: 0 4px 4px 0; font-size: 11px; color: var(--sdd-text-dim);
	line-height: 1.4;
}
.thinking-block.open .thinking-content { display: block; }

/* ── Status Bar Nav Buttons ────────────────────── */
.status-nav-btn {
	background: none; border: none; cursor: pointer;
	font-size: 14px; padding: 2px 4px; line-height: 1;
	color: var(--sdd-text-dim); transition: color 0.15s;
	flex-shrink: 0; display: none;
}
.status-nav-btn:hover { color: var(--sdd-text); }
.status-nav-btn.visible { display: inline-block; }

/* ── History Panel ─────────────────────────────── */
#history-panel {
	display: none; position: absolute; top: 38px; left: 0; right: 0; bottom: 0;
	background: var(--sdd-navy); z-index: 100; overflow-y: auto;
	padding: 12px; flex-direction: column; gap: 6px;
}
#history-panel.open { display: flex; }
.history-title {
	font-size: 12px; font-weight: 700; color: var(--sdd-coral);
	margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;
}
.history-close {
	background: none; border: none; cursor: pointer;
	color: var(--sdd-text-dim); font-size: 16px;
}
.history-close:hover { color: var(--sdd-text); }
.history-item {
	padding: 8px 10px; background: var(--sdd-navy-light);
	border: 1px solid var(--sdd-border); border-radius: 6px;
	cursor: pointer; transition: border-color 0.15s;
}
.history-item:hover { border-color: var(--sdd-coral-dim); }
.history-item-time {
	font-size: 9px; color: var(--sdd-text-dim); margin-bottom: 3px;
}
.history-item-text {
	font-size: 11px; color: var(--sdd-text); white-space: nowrap;
	overflow: hidden; text-overflow: ellipsis;
}
.history-empty {
	font-size: 11px; color: var(--sdd-text-dim); text-align: center; padding: 20px 0;
}

/* ── Next-Action Pills ─────────────────────────── */
.next-actions {
	display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px;
	animation: fadeIn 0.3s;
}
.next-action-pill {
	padding: 4px 10px; font-size: 10px;
	background: var(--sdd-navy-light); border: 1px solid var(--sdd-border);
	border-radius: 12px; cursor: pointer; color: var(--sdd-text-dim);
	transition: border-color 0.15s, color 0.15s, background 0.15s;
	white-space: nowrap;
}
.next-action-pill:hover {
	border-color: var(--sdd-coral-dim); color: var(--sdd-text);
	background: var(--sdd-navy-mid);
}
</style>
</head>
<body>

<div id="status-bar">
	<div class="dot dot-off" id="dot"></div>
	<span id="model-label">Not connected</span>
	<button class="status-nav-btn" id="btn-home" title="Home">&#127968;</button>
	<button class="status-nav-btn" id="btn-new-session" title="New Session">&#10010;</button>
	<button class="status-nav-btn visible" id="btn-history" title="Session History">&#128337;</button>
	<button id="btn-toggle">Start</button>
</div>
<div id="history-panel"></div>

<div id="messages">
	<div id="empty"></div>
</div>

<div id="input-area">
	<textarea id="msg-input" placeholder="Message SDD... (Enter to send, Shift+Enter for newline)" rows="1" disabled></textarea>
	<button id="btn-send" disabled title="Send">&uarr;</button>
</div>

<div id="footer">
	<button id="footer-toggle">&#9656; Controls</button>
	<div id="footer-inner">
		<div class="btn-row">
			<button class="ctrl" data-command="newSession">New Session</button>
			<button class="ctrl" data-command="switchModel">Model</button>
		</div>
		<div class="btn-row">
			<button class="ctrl" data-command="cycleThinking">Thinking</button>
			<button class="ctrl" data-command="toggleAutoCompaction">Auto-Compact</button>
		</div>
		<div class="btn-row">
			<button class="ctrl" data-command="compact">Compact</button>
			<button class="ctrl" data-command="abort">Abort</button>
		</div>
	</div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const emptyEl = document.getElementById('empty');
const inputEl = document.getElementById('msg-input');
const sendBtn = document.getElementById('btn-send');
const dot = document.getElementById('dot');
const modelLabel = document.getElementById('model-label');
const toggleBtn = document.getElementById('btn-toggle');
const footerToggle = document.getElementById('footer-toggle');
const footerInner = document.getElementById('footer-inner');
const btnHome = document.getElementById('btn-home');
const btnNewSession = document.getElementById('btn-new-session');
const btnHistory = document.getElementById('btn-history');
const historyPanel = document.getElementById('history-panel');

let connected = false;
let streaming = false;
let currentBubble = null;
let lastUserMessage = '';
let sessionHistory = [];
let hasMessages = false;

footerToggle.addEventListener('click', () => {
	const open = footerInner.classList.toggle('open');
	footerToggle.innerHTML = (open ? '&#9662;' : '&#9656;') + ' Controls';
});

function updateNavButtons() {
	btnHome.className = 'status-nav-btn' + (hasMessages ? ' visible' : '');
	btnNewSession.className = 'status-nav-btn' + (hasMessages ? ' visible' : '');
}

btnHistory.addEventListener('click', () => {
	const isOpen = historyPanel.classList.toggle('open');
	if (isOpen) vscode.postMessage({ command: 'getHistory' });
});

btnHome.addEventListener('click', () => {
	vscode.postMessage({ command: 'home' });
});

btnNewSession.addEventListener('click', () => {
	vscode.postMessage({ command: 'newSession' });
});

function renderHistoryPanel(sessions) {
	var html = '<div class="history-title"><span>Session History</span><button class="history-close" id="history-close-btn">&times;</button></div>';
	if (!sessions || sessions.length === 0) {
		html += '<div class="history-empty">No previous sessions</div>';
	} else {
		for (var i = 0; i < sessions.length; i++) {
			var item = sessions[i];
			var d = new Date(item.time);
			var timeStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
			html += '<div class="history-item" data-history-idx="' + i + '">';
			html += '<div class="history-item-time">' + esc(timeStr) + '</div>';
			html += '<div class="history-item-text">' + esc(item.text.substring(0, 80)) + '</div>';
			html += '</div>';
		}
	}
	historyPanel.innerHTML = html;
	var closeBtn = document.getElementById('history-close-btn');
	if (closeBtn) closeBtn.addEventListener('click', () => { historyPanel.classList.remove('open'); });
}

historyPanel.addEventListener('click', (e) => {
	var item = e.target.closest('[data-history-idx]');
	if (item) {
		historyPanel.classList.remove('open');
	}
});

function getNextActions(userMsg) {
	var lower = (userMsg || '').toLowerCase();
	var actions = [];
	if (lower.indexOf('progress') !== -1 || lower.indexOf('check') !== -1) {
		actions.push({label:'Plan Slice',prompt:'Plan next slice.'});
		actions.push({label:'Execute Slice',prompt:'Execute current slice.'});
		actions.push({label:'Resume Work',prompt:'Resume active slice.'});
	} else if (lower.indexOf('plan') !== -1) {
		actions.push({label:'Execute Slice',prompt:'Execute current slice.'});
		actions.push({label:'Verify Work',prompt:'Verify against success criteria.'});
	} else if (lower.indexOf('execute') !== -1 || lower.indexOf('implement') !== -1) {
		actions.push({label:'Verify Work',prompt:'Verify against success criteria.'});
		actions.push({label:'Check Progress',prompt:'Progress: slices done, next, blocked?'});
	} else if (lower.indexOf('verify') !== -1 || lower.indexOf('test') !== -1) {
		actions.push({label:'New Milestone',prompt:'Define new milestone with slices.'});
		actions.push({label:'Check Progress',prompt:'Progress: slices done, next, blocked?'});
	} else {
		actions.push({label:'Check Progress',prompt:'Progress: slices done, next, blocked?'});
		actions.push({label:'New Session',prompt:''});
		actions.push({label:'Home',prompt:''});
	}
	return actions;
}

function renderNextActions(userMsg) {
	var actions = getNextActions(userMsg);
	var row = document.createElement('div');
	row.className = 'next-actions';
	for (var i = 0; i < actions.length; i++) {
		var a = actions[i];
		var pill = document.createElement('button');
		pill.className = 'next-action-pill';
		pill.textContent = a.label;
		if (a.label === 'New Session') {
			pill.setAttribute('data-command', 'newSession');
		} else if (a.label === 'Home') {
			pill.setAttribute('data-command', 'home');
		} else {
			pill.setAttribute('data-prompt', a.prompt);
			pill.setAttribute('data-label', a.label);
		}
		row.appendChild(pill);
	}
	messagesEl.appendChild(row);
	scrollBottom();
}

document.addEventListener('click', (e) => {
	const fl = e.target.closest('.file-link');
	if (fl) { vscode.postMessage({ command: 'openFile', path: fl.dataset.file }); return; }
	const tb = e.target.closest('.thinking-toggle');
	if (tb) { tb.closest('.thinking-block').classList.toggle('open'); return; }
	const cmd = e.target.closest('[data-command]');
	if (cmd) { vscode.postMessage({ command: cmd.dataset.command }); return; }
	const wf = e.target.closest('[data-prompt]');
	if (wf) {
		const text = wf.dataset.prompt;
		const label = wf.dataset.label || text;
		if (!connected) vscode.postMessage({ command: 'start' });
		setTimeout(() => vscode.postMessage({ command: 'sendMessage', text, label }), connected ? 0 : 1500);
	}
});

toggleBtn.addEventListener('click', () => {
	vscode.postMessage({ command: connected ? 'stop' : 'start' });
});

function sendMessage() {
	const text = inputEl.value.trim();
	if (!text || streaming || !connected) return;
	inputEl.value = '';
	autoResize();
	vscode.postMessage({ command: 'sendMessage', text });
}

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function autoResize() {
	inputEl.style.height = 'auto';
	inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}
inputEl.addEventListener('input', autoResize);

function renderDashboard(project) {
	let html = '<div class="dashboard">';

	// Header
	html += '<div class="dash-header"><div class="dash-logo">SDD</div>';
	html += '<div class="dash-sub">Spec-Driven Development</div>';
	html += '<div class="dash-tips">';
	html += '<strong>Extension</strong> &#8212; progress checks, quick prompts, right-click actions';
	html += '<br><strong>Terminal</strong> &#8212; run <code class="inline-code">sdd</code> for auto mode, long execution, multi-slice work';
	html += '</div></div>';

	if (project && project.hasProject && project.milestones.length > 0) {
		// Active milestone card
		const active = project.activeMilestone;
		if (active) {
			html += '<div class="section-label">ACTIVE MILESTONE</div>';
			html += renderMilestoneCard(active);
		}

		// Other milestones summary
		const others = project.milestones.filter(m => !active || m.id !== active.id);
		if (others.length > 0) {
			html += '<div class="section-label">OTHER MILESTONES</div>';
			for (const m of others.slice(0, 3)) {
				html += renderMilestoneCard(m);
			}
			if (others.length > 3) {
				html += '<div style="font-size:10px;color:var(--sdd-text-dim);text-align:center;">+' + (others.length - 3) + ' more</div>';
			}
		}

		// Contextual workflow actions
		html += '<div class="section-label">WORKFLOW</div>';
		html += '<div class="wf-grid">';

		if (active) {
			html += wfBtn('Progress on ' + active.id + ': slices done, next, blocked?', '&#128200;', 'Check Progress', true, false);
			html += wfBtn('Resume ' + active.id + '. Check CONTINUE-HERE and active slice.', '&#9654;', 'Resume Work', true, false);
			html += wfBtn('Plan next slice in ' + active.id + '.', '&#128203;', 'Plan Slice', false, false);
			html += wfBtn('Execute current slice in ' + active.id + '.', '&#9889;', 'Execute Slice', false, false);
			html += wfBtn('Verify ' + active.id + ' against success criteria. Run tests.', '&#9989;', 'Verify Work', false, false);
			html += wfBtn('Check pending todos and CONTINUE-HERE files.', '&#128221;', 'Check Todos', false, false);
		}

		html += wfBtn('Define a new milestone with slices.', '&#10010;', 'New Milestone', false, false);
		html += wfBtn('Review open issues. Close resolved, flag urgent.', '&#128172;', 'Review Issues', false, false);
		html += '</div>';

	} else {
		// No project initialized
		html += '<div class="no-project">No SDD project found in workspace.<br>Initialize one to get started.</div>';
		html += '<div class="section-label">GET STARTED</div>';
		html += '<div class="wf-grid">';
		html += wfBtn('Initialize SDD project here.', '&#128640;', 'New Project', true, true);
		html += wfBtn('What is SDD? Explain workflow and concepts.', '&#10067;', 'SDD Help', false, true);
		html += wfBtn('Create roadmap with milestones for this codebase.', '&#128506;', 'Create Roadmap', false, false);
		html += wfBtn('Map codebase: architecture, key files, entry points.', '&#128270;', 'Map Codebase', false, false);
		html += '</div>';
	}

	html += '</div>';
	return html;
}

function renderMilestoneCard(m) {
	const pct = m.slicesTotal > 0 ? Math.round((m.slicesDone / m.slicesTotal) * 100) : 0;
	const barColor = m.status === 'complete' ? 'green' : pct > 0 ? 'coral' : 'green';
	let html = '<div class="ms-card ' + m.status + '">';
	html += '<div class="ms-card-top">';
	html += '<span class="ms-id">' + esc(m.id) + '</span>';
	html += '<span class="ms-status ms-status-' + m.status + '">' + m.status + '</span>';
	html += '</div>';
	html += '<div class="ms-title">' + esc(m.title) + '</div>';
	if (m.slicesTotal > 0) {
		html += '<div class="ms-progress">';
		html += '<div class="ms-bar-bg"><div class="ms-bar-fill ' + barColor + '" style="width:' + pct + '%"></div></div>';
		html += '<div class="ms-bar-label"><span>' + m.slicesDone + '/' + m.slicesTotal + ' slices</span><span>' + pct + '%</span></div>';
		html += '</div>';
	}
	html += '</div>';
	return html;
}

function wfBtn(prompt, icon, label, primary, wide) {
	let cls = 'wf-btn';
	if (primary) cls += ' primary';
	if (wide) cls += ' wide';
	return '<button class="' + cls + '" data-prompt="' + esc(prompt) + '" data-label="' + esc(label) + '">'
		+ '<span class="wf-icon">' + icon + '</span>'
		+ '<span class="wf-label">' + esc(label) + '</span>'
		+ '</button>';
}

function esc(s) {
	return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Simple markdown to HTML — all regexes use new RegExp() because
// template literals eat backslashes (e.g. \* becomes * inside backtick strings)
var BS = String.fromCharCode(92);  // backslash
var BT = String.fromCharCode(96);  // backtick
var codeBlockRe = new RegExp(BT+BT+BT+'('+BS+'w*)'+BS+'n(['+BS+'s'+BS+'S]*?)'+BT+BT+BT, 'g');
var inlineCodeRe = new RegExp(BT+'([^'+BT+']+)'+BT, 'g');
var boldRe = new RegExp(BS+'*'+BS+'*(.+?)'+BS+'*'+BS+'*', 'g');
var italicRe = new RegExp(BS+'*(.+?)'+BS+'*', 'g');
var tableSepRe = new RegExp('^'+BS+'|[-|: ]+'+BS+'|$', 'gm');
var tableRowRe = new RegExp('^'+BS+'|(.+)'+BS+'|$', 'gm');
// Match file paths inside inline-code: e.g. <code class="inline-code">src/foo.ts</code>
var fileInCodeRe = new RegExp('<code class="inline-code">([^<]*?'+BS+'.(ts|tsx|js|jsx|json|md|css|html|py|rs|yaml|yml|toml|sh|sql)[^<]*?)</code>', 'g');
// Thinking block markers: lines starting with common thinking phrases
var thinkingPhrases = ['let me ', 'checking ', 'looking at ', 'reading ', 'i need to ', 'i should ', 'let me check', 'confirmed', 'verifying ', 'planning '];
var thinkingId = 0;

function md(raw) {
	var s = esc(raw);
	s = s.replace(codeBlockRe, '<pre><code>$2</code></pre>');
	s = s.replace(inlineCodeRe, '<code class="inline-code">$1</code>');
	s = s.replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>');
	s = s.replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>');
	s = s.replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>');
	s = s.replace(boldRe, '<strong>$1</strong>');
	s = s.replace(italicRe, '<em>$1</em>');
	s = s.replace(/^---$/gm, '<hr class="md-hr">');
	s = s.replace(/^- (.+)$/gm, '<div class="md-li">&#8226; $1</div>');
	s = s.replace(tableSepRe, '');
	s = s.replace(tableRowRe, function(_, row) {
		if (!row) return '';
		var cells = row.split('|').map(function(c){ return c.trim(); }).filter(Boolean);
		return '<div class="md-table-row">' + cells.map(function(c){ return '<span class="md-cell">' + c + '</span>'; }).join('') + '</div>';
	});
	// Make file paths in inline code clickable
	s = s.replace(fileInCodeRe, function(_, fp) {
		return '<span class="file-link" data-file="' + fp + '">' + fp + '</span>';
	});
	s = s.replace(new RegExp(BS+'n','g'), '<br>');
	s = s.replace(new RegExp('(<br>){3,}','g'), '<br><br>');
	s = s.replace(new RegExp('<br>(<div|<pre|<hr)','g'), '$1');
	s = s.replace(new RegExp('(<'+BS+'/div>|<'+BS+'/pre>)<br>','g'), '$1');
	return s;
}

let rawContent = '';
let progressEl = null;

window.addEventListener('message', ({ data: msg }) => {
	switch (msg.type) {
		case 'init':
			setConnected(msg.connected, msg.modelName);
			messagesEl.innerHTML = '';
			if (msg.messages && msg.messages.length > 0) {
				hasMessages = true;
				for (const m of msg.messages) {
					if (m.role === 'user') { appendUser(m.content); lastUserMessage = m.content; }
					else if (m.content) { const b = appendAssistantBubble(); b.innerHTML = md(m.content); }
				}
			} else {
				hasMessages = false;
				emptyEl.innerHTML = renderDashboard(msg.project);
				messagesEl.appendChild(emptyEl);
			}
			updateNavButtons();
			break;

		case 'statusUpdate':
			setConnected(msg.connected, null);
			break;

		case 'historyData':
			renderHistoryPanel(msg.sessions);
			break;

		case 'userMessage':
			emptyEl.remove();
			removeProgress();
			appendUser(msg.text);
			lastUserMessage = msg.text;
			hasMessages = true;
			updateNavButtons();
			break;

		case 'agentWorking':
			showProgress('SDD is thinking...');
			break;

		case 'toolProgress':
			showProgress(msg.text);
			break;

		case 'assistantStart':
			removeProgress();
			rawContent = '';
			currentBubble = appendAssistantBubble();
			currentBubble.classList.add('streaming');
			setStreaming(true);
			break;

		case 'delta':
			if (!currentBubble) {
				rawContent = '';
				currentBubble = appendAssistantBubble();
				currentBubble.classList.add('streaming');
				setStreaming(true);
			}
			rawContent += msg.text;
			appendDelta(msg.text);
			break;

		case 'agentEnd':
			removeProgress();
			finalRender();
			if (currentBubble) {
				currentBubble.classList.remove('streaming');
				currentBubble = null;
			}
			rawContent = '';
			setStreaming(false);
			if (lastUserMessage) renderNextActions(lastUserMessage);
			break;

		case 'clearChat':
			messagesEl.innerHTML = '';
			messagesEl.appendChild(emptyEl);
			currentBubble = null;
			rawContent = '';
			lastUserMessage = '';
			hasMessages = false;
			updateNavButtons();
			removeProgress();
			setStreaming(false);
			break;

		case 'error': {
			removeProgress();
			const err = document.createElement('div');
			err.className = 'err-msg';
			err.textContent = '\\u26A0 ' + msg.text;
			messagesEl.appendChild(err);
			setStreaming(false);
			scrollBottom();
			break;
		}
	}
});

// Fast streaming: append raw text during stream, full markdown parse only on completion
function appendDelta(text) {
	if (currentBubble) {
		// During streaming: just append text node (instant, no parsing)
		currentBubble.appendChild(document.createTextNode(text));
		scrollBottom();
	}
}
function finalRender() {
	if (currentBubble && rawContent) {
		try { currentBubble.innerHTML = md(rawContent); }
		catch(e) { currentBubble.textContent = rawContent; }
		scrollBottom();
	}
}

function showProgress(text) {
	if (!progressEl) {
		progressEl = document.createElement('div');
		progressEl.className = 'tool-progress';
		messagesEl.appendChild(progressEl);
	}
	progressEl.innerHTML = '<span class="progress-spinner"></span> ' + esc(text);
	scrollBottom();
}

function removeProgress() {
	if (progressEl) { progressEl.remove(); progressEl = null; }
}

function setConnected(val, model) {
	connected = val;
	dot.className = 'dot ' + (val ? 'dot-on' : 'dot-off');
	if (model !== null) modelLabel.textContent = model || (val ? 'Connected' : 'Not connected');
	toggleBtn.textContent = val ? 'Stop' : 'Start';
	inputEl.disabled = !val || streaming;
	sendBtn.disabled = !val || streaming;
}

function setStreaming(val) {
	streaming = val;
	inputEl.disabled = !connected || val;
	sendBtn.disabled = !connected || val;
}

function appendUser(text) {
	const w = document.createElement('div');
	w.className = 'msg-wrapper';
	const r = document.createElement('div');
	r.className = 'msg-role msg-role-you';
	r.textContent = 'You';
	const b = document.createElement('div');
	b.className = 'bubble-user';
	b.textContent = text;
	w.append(r, b);
	messagesEl.appendChild(w);
	scrollBottom();
	return b;
}

function appendAssistantBubble(initialHtml) {
	const w = document.createElement('div');
	w.className = 'msg-wrapper';
	const r = document.createElement('div');
	r.className = 'msg-role';
	r.textContent = 'SDD';
	const b = document.createElement('div');
	b.className = 'bubble-assistant';
	if (initialHtml) b.innerHTML = initialHtml;
	w.append(r, b);
	messagesEl.appendChild(w);
	scrollBottom();
	return b;
}

function scrollBottom() {
	messagesEl.scrollTop = messagesEl.scrollHeight;
}
</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let i = 0; i < 32; i++) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	return nonce;
}
