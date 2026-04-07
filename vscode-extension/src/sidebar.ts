import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import type { SddClient, AgentEvent } from "./sdd-client.js";

/**
 * Send a message through VS Code's Chat panel so the user sees the response.
 * Opens the Chat panel and pre-fills the @sdd participant with the message.
 */
async function sendViaChat(message: string): Promise<void> {
	await vscode.commands.executeCommand("workbench.action.chat.open", { query: message });
}

/**
 * WebviewViewProvider that renders a compact, card-based sidebar panel.
 * Designed for information density without clutter — collapsible sections,
 * hidden empty data, and consolidated action buttons.
 */
export class GsdSidebarProvider implements vscode.WebviewViewProvider {
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
				case "toggleAutoRetry":
					if (this.client.isConnected) {
						await this.client.setAutoRetry(!this.client.autoRetryEnabled).catch(() => {});
						this.refresh();
					}
					break;
				case "setSessionName":
					await vscode.commands.executeCommand("sdd.setSessionName");
					break;
				case "copyLastResponse":
					await vscode.commands.executeCommand("sdd.copyLastResponse");
					break;
				case "autoMode":
					await sendViaChat("@sdd /sdd auto");
					break;
				case "nextUnit":
					await sendViaChat("@sdd /sdd next");
					break;
				case "quickTask": {
					const quickInput = await vscode.window.showInputBox({
						prompt: "Describe the quick task",
						placeHolder: "e.g. fix the typo in README",
					});
					if (quickInput) {
						await sendViaChat(`@sdd /sdd quick ${quickInput}`);
					}
					break;
				}
				case "capture": {
					const thought = await vscode.window.showInputBox({
						prompt: "Capture a thought",
						placeHolder: "e.g. we should also handle the edge case for...",
					});
					if (thought) {
						await sendViaChat(`@sdd /sdd capture ${thought}`);
					}
					break;
				}
				case "status":
					await sendViaChat("@sdd /sdd status");
					break;
				case "forkSession":
					await vscode.commands.executeCommand("sdd.forkSession");
					break;
				case "toggleSteeringMode":
					await vscode.commands.executeCommand("sdd.toggleSteeringMode");
					break;
				case "toggleFollowUpMode":
					await vscode.commands.executeCommand("sdd.toggleFollowUpMode");
					break;
				case "showHistory":
					await vscode.commands.executeCommand("sdd.showHistory");
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
		if (!this.view) {
			return;
		}

		let modelName = "N/A";
		let modelShort = "";
		let sessionId = "N/A";
		let sessionName = "";
		let messageCount = 0;
		let pendingMessageCount = 0;
		let thinkingLevel: ThinkingLevel = "off";
		let isStreaming = false;
		let isCompacting = false;
		let autoCompaction = false;
		let autoRetry = false;
		let stats: SessionStats | null = null;
		let contextWindow = 0;
		let steeringMode: "all" | "one-at-a-time" = "all";
		let followUpMode: "all" | "one-at-a-time" = "all";

		if (this.client.isConnected) {
			autoRetry = this.client.autoRetryEnabled;
			try {
				const state = await this.client.getState();
				modelName = state.model
					? `${state.model.provider}/${state.model.id}`
					: "Not set";
				modelShort = state.model?.id ?? "";
				sessionId = state.sessionId;
				sessionName = state.sessionName ?? "";
				messageCount = state.messageCount;
				pendingMessageCount = state.pendingMessageCount;
				thinkingLevel = state.thinkingLevel as ThinkingLevel;
				isStreaming = state.isStreaming;
				isCompacting = state.isCompacting;
				autoCompaction = state.autoCompactionEnabled;
				contextWindow = state.model?.contextWindow ?? 0;
				steeringMode = state.steeringMode;
				followUpMode = state.followUpMode;
			} catch {
				// State fetch failed, show defaults
			}

			try {
				stats = await this.client.getSessionStats();
			} catch {
				// Stats fetch failed
			}
		}

		const connected = this.client.isConnected;

		this.view.webview.html = this.getHtml({
			connected,
			modelName,
			modelShort,
			sessionId,
			sessionName,
			messageCount,
			pendingMessageCount,
			thinkingLevel,
			isStreaming,
			isCompacting,
			autoCompaction,
			autoRetry,
			stats,
			contextWindow,
			steeringMode,
			followUpMode,
		});
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
	}

	private getHtml(info: {
		connected: boolean;
		modelName: string;
		modelShort: string;
		sessionId: string;
		sessionName: string;
		messageCount: number;
		pendingMessageCount: number;
		thinkingLevel: ThinkingLevel;
		isStreaming: boolean;
		isCompacting: boolean;
		autoCompaction: boolean;
		autoRetry: boolean;
		stats: SessionStats | null;
		contextWindow: number;
		steeringMode: "all" | "one-at-a-time";
		followUpMode: "all" | "one-at-a-time";
	}): string {
		const statusColor = info.connected ? "#4ec9b0" : "#f44747";
		const statusLabel = info.isStreaming ? "Working" : info.isCompacting ? "Compacting" : info.connected ? "Connected" : "Disconnected";

		// Model short name for header
		const modelDisplay = info.modelShort || "N/A";

		// Session display — name or truncated ID
		const sessionDisplay = info.sessionName || (info.sessionId !== "N/A" ? info.sessionId.slice(0, 8) : "N/A");

		// Cost for header
		const costDisplay = info.stats?.totalCost !== undefined && info.stats.totalCost > 0
			? `$${info.stats.totalCost.toFixed(4)}`
			: "";

		// Context window
		const totalTokens = (info.stats?.inputTokens ?? 0) + (info.stats?.outputTokens ?? 0);
		const contextPct = info.contextWindow > 0 ? Math.min(100, Math.round((totalTokens / info.contextWindow) * 100)) : 0;
		const contextColor = contextPct > 80 ? "#f44747" : contextPct > 50 ? "#cca700" : "#4ec9b0";

		// Only show stats that have real data
		const hasStats = info.stats && (
			(info.stats.inputTokens !== undefined && info.stats.inputTokens > 0) ||
			(info.stats.outputTokens !== undefined && info.stats.outputTokens > 0)
		);

		const nonce = getNonce();

		// Build stat rows only for non-zero values
		let statRows = "";
		if (hasStats && info.stats) {
			const pairs: [string, string][] = [];
			if (info.stats.inputTokens) pairs.push(["In", formatNum(info.stats.inputTokens)]);
			if (info.stats.outputTokens) pairs.push(["Out", formatNum(info.stats.outputTokens)]);
			if (info.stats.cacheReadTokens) pairs.push(["Cache R", formatNum(info.stats.cacheReadTokens)]);
			if (info.stats.cacheWriteTokens) pairs.push(["Cache W", formatNum(info.stats.cacheWriteTokens)]);
			if (info.stats.turnCount) pairs.push(["Turns", String(info.stats.turnCount)]);
			if (info.stats.duration) pairs.push(["Time", `${Math.round(info.stats.duration / 1000)}s`]);
			if (info.stats.totalCost !== undefined && info.stats.totalCost > 0) pairs.push(["Cost", `$${info.stats.totalCost.toFixed(4)}`]);

			statRows = pairs.map(([k, v]) =>
				`<span class="stat-label">${k}</span><span class="stat-value">${v}</span>`
			).join("");
		}

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			color: var(--vscode-foreground);
			padding: 8px;
		}

		/* ---- Header card ---- */
		.header {
			padding: 10px 12px;
			border-radius: 6px;
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			margin-bottom: 8px;
		}
		.header-top {
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: ${statusColor};
			flex-shrink: 0;
		}
		.status-label {
			font-size: 11px;
			opacity: 0.7;
			flex-shrink: 0;
		}
		.header-model {
			margin-left: auto;
			font-size: 11px;
			font-weight: 600;
			opacity: 0.85;
			cursor: pointer;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.header-model:hover { opacity: 1; }
		.header-cost {
			font-size: 11px;
			font-variant-numeric: tabular-nums;
			opacity: 0.6;
			flex-shrink: 0;
		}
		.header-sub {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-top: 6px;
			font-size: 11px;
			opacity: 0.6;
		}
		.header-sub .sep { opacity: 0.3; }
		.session-name {
			cursor: pointer;
			max-width: 120px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.session-name:hover { opacity: 1; text-decoration: underline; }

		/* ---- Streaming banner ---- */
		.streaming {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px 10px;
			margin-bottom: 8px;
			background: color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent);
			border: 1px solid var(--vscode-focusBorder);
			border-radius: 6px;
			font-size: 12px;
		}
		.spinner {
			width: 10px; height: 10px;
			border: 2px solid var(--vscode-focusBorder);
			border-top-color: transparent;
			border-radius: 50%;
			animation: spin 0.8s linear infinite;
			flex-shrink: 0;
		}
		@keyframes spin { to { transform: rotate(360deg); } }
		.streaming-abort {
			margin-left: auto;
			font-size: 10px;
			padding: 2px 8px;
			border: 1px solid var(--vscode-foreground);
			background: transparent;
			color: var(--vscode-foreground);
			border-radius: 3px;
			cursor: pointer;
			opacity: 0.6;
		}
		.streaming-abort:hover { opacity: 1; }

		/* ---- Context bar (inline in header) ---- */
		.context-bar {
			margin-top: 8px;
		}
		.context-track {
			width: 100%;
			height: 3px;
			background: var(--vscode-panel-border);
			border-radius: 2px;
			overflow: hidden;
		}
		.context-fill {
			height: 100%;
			border-radius: 2px;
			transition: width 0.3s ease;
		}
		.context-text {
			font-size: 10px;
			opacity: 0.5;
			margin-top: 2px;
		}

		/* ---- Collapsible section ---- */
		.section {
			margin-bottom: 6px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			overflow: hidden;
		}
		.section-header {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 10px;
			cursor: pointer;
			user-select: none;
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.5px;
			opacity: 0.7;
			background: var(--vscode-editor-background);
		}
		.section-header:hover { opacity: 1; }
		.chevron {
			font-size: 10px;
			transition: transform 0.15s;
		}
		.section.collapsed .section-body { display: none; }
		.section.collapsed .chevron { transform: rotate(-90deg); }
		.section-body {
			padding: 6px 10px 8px;
		}

		/* ---- Stats grid ---- */
		.stats-grid {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 2px 10px;
			font-size: 11px;
		}
		.stat-label { opacity: 0.6; }
		.stat-value {
			text-align: right;
			font-variant-numeric: tabular-nums;
		}

		/* ---- Toggle row ---- */
		.toggle-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 3px 0;
			font-size: 11px;
		}
		.toggle-label { opacity: 0.7; }
		.toggle-pill {
			display: inline-block;
			padding: 1px 8px;
			border-radius: 10px;
			font-size: 10px;
			cursor: pointer;
			transition: all 0.15s;
			border: 1px solid transparent;
		}
		.toggle-pill.on {
			background: color-mix(in srgb, var(--vscode-focusBorder) 30%, transparent);
			border-color: var(--vscode-focusBorder);
			color: var(--vscode-foreground);
		}
		.toggle-pill.off {
			background: transparent;
			border-color: var(--vscode-panel-border);
			opacity: 0.5;
		}
		.toggle-pill:hover { opacity: 1; }

		/* ---- Buttons ---- */
		.actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 4px;
		}
		.actions.three-col {
			grid-template-columns: 1fr 1fr 1fr;
		}
		.action-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 4px;
			padding: 5px 6px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: transparent;
			color: var(--vscode-foreground);
			font-size: 11px;
			cursor: pointer;
			white-space: nowrap;
			width: auto;
		}
		.action-btn:hover {
			background: var(--vscode-list-hoverBackground);
			border-color: var(--vscode-focusBorder);
		}
		.action-btn.primary {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: var(--vscode-button-background);
			font-weight: 600;
		}
		.action-btn.primary:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.action-btn.danger {
			border-color: #f44747;
			color: #f44747;
		}
		.action-btn.danger:hover {
			background: color-mix(in srgb, #f44747 15%, transparent);
		}
		.action-btn.full {
			grid-column: 1 / -1;
		}

		/* ---- Disconnected state ---- */
		.disconnected {
			text-align: center;
			padding: 20px 12px;
		}
		.disconnected p {
			opacity: 0.5;
			font-size: 12px;
			margin-bottom: 12px;
		}
		.start-btn {
			padding: 8px 24px;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			font-size: var(--vscode-font-size);
			font-weight: 600;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			width: auto;
			display: inline-block;
		}
		.start-btn:hover {
			background: var(--vscode-button-hoverBackground);
		}
	</style>
</head>
<body>
	${info.connected ? this.getConnectedHtml(info, {
			statusLabel,
			modelDisplay,
			sessionDisplay,
			costDisplay,
			contextPct,
			contextColor,
			hasStats: !!hasStats,
			statRows,
			nonce,
		}) : `
	<div class="header">
		<div class="header-top">
			<div class="status-dot"></div>
			<span class="status-label">Disconnected</span>
		</div>
	</div>
	<div class="disconnected">
		<p>Agent is not running</p>
		<button class="start-btn" data-command="start">Start Agent</button>
	</div>
	`}

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const stored = vscode.getState() || {};

		// Restore collapsed state
		document.querySelectorAll('.section').forEach(s => {
			const id = s.dataset.section;
			if (id && stored[id] === 'collapsed') s.classList.add('collapsed');
		});

		document.addEventListener('click', (e) => {
			// Section toggle
			const header = e.target.closest('.section-header');
			if (header) {
				const section = header.parentElement;
				section.classList.toggle('collapsed');
				const id = section.dataset.section;
				if (id) {
					const state = vscode.getState() || {};
					state[id] = section.classList.contains('collapsed') ? 'collapsed' : 'open';
					vscode.setState(state);
				}
				return;
			}
			// Button/command click
			const btn = e.target.closest('[data-command]');
			if (btn) {
				vscode.postMessage({ command: btn.dataset.command });
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

	private getConnectedHtml(
		info: {
			connected: boolean;
			modelName: string;
			modelShort: string;
			sessionId: string;
			sessionName: string;
			messageCount: number;
			pendingMessageCount: number;
			thinkingLevel: ThinkingLevel;
			isStreaming: boolean;
			isCompacting: boolean;
			autoCompaction: boolean;
			autoRetry: boolean;
			stats: SessionStats | null;
			contextWindow: number;
			steeringMode: "all" | "one-at-a-time";
			followUpMode: "all" | "one-at-a-time";
		},
		ui: {
			statusLabel: string;
			modelDisplay: string;
			sessionDisplay: string;
			costDisplay: string;
			contextPct: number;
			contextColor: string;
			hasStats: boolean;
			statRows: string;
			nonce: string;
		},
	): string {
		const pendingBadge = info.pendingMessageCount > 0
			? ` <span style="opacity:0.5">+${info.pendingMessageCount}</span>`
			: "";

		return `
	<!-- Header card -->
	<div class="header">
		<div class="header-top">
			<div class="status-dot"></div>
			<span class="status-label">${ui.statusLabel}</span>
			<span class="header-model" data-command="switchModel" title="${escapeHtml(info.modelName)}">${escapeHtml(ui.modelDisplay)}</span>
			${ui.costDisplay ? `<span class="header-cost">${ui.costDisplay}</span>` : ""}
		</div>
		<div class="header-sub">
			<span class="session-name" data-command="setSessionName" title="${escapeHtml(info.sessionId)}">${escapeHtml(ui.sessionDisplay)}</span>
			<span class="sep">/</span>
			<span>${info.messageCount} msg${pendingBadge}</span>
			<span class="sep">/</span>
			<span data-command="cycleThinking" style="cursor:pointer" title="Click to cycle thinking level">${info.thinkingLevel === "off" ? "no think" : info.thinkingLevel}</span>
		</div>
		${info.contextWindow > 0 ? `
		<div class="context-bar">
			<div class="context-track">
				<div class="context-fill" style="width:${ui.contextPct}%;background:${ui.contextColor}"></div>
			</div>
			<div class="context-text">${ui.contextPct}% context (${formatNum((info.stats?.inputTokens ?? 0) + (info.stats?.outputTokens ?? 0))} / ${formatNum(info.contextWindow)})</div>
		</div>
		` : ""}
	</div>

	${info.isStreaming ? `
	<div class="streaming">
		<span class="spinner"></span>
		<span>Agent is working...</span>
		<button class="streaming-abort" data-command="abort">Stop</button>
	</div>
	` : ""}

	<!-- Workflow -->
	<div class="section" data-section="workflow">
		<div class="section-header"><span class="chevron">&#9660;</span> Workflow</div>
		<div class="section-body">
			<div class="actions">
				<button class="action-btn primary" data-command="autoMode">Auto</button>
				<button class="action-btn" data-command="nextUnit">Next</button>
				<button class="action-btn" data-command="quickTask">Quick</button>
				<button class="action-btn" data-command="capture">Capture</button>
			</div>
		</div>
	</div>

	${ui.hasStats ? `
	<!-- Stats -->
	<div class="section" data-section="stats">
		<div class="section-header"><span class="chevron">&#9660;</span> Stats</div>
		<div class="section-body">
			<div class="stats-grid">${ui.statRows}</div>
		</div>
	</div>
	` : ""}

	<!-- Actions -->
	<div class="section" data-section="actions">
		<div class="section-header"><span class="chevron">&#9660;</span> Actions</div>
		<div class="section-body">
			<div class="actions three-col">
				<button class="action-btn" data-command="newSession">New</button>
				<button class="action-btn" data-command="compact">Compact</button>
				<button class="action-btn" data-command="copyLastResponse">Copy</button>
				<button class="action-btn" data-command="status">Status</button>
				<button class="action-btn" data-command="fixProblemsInFile">Fix Errs</button>
				<button class="action-btn" data-command="showHistory">History</button>
			</div>
			<div style="margin-top:6px">
				<button class="action-btn danger full" data-command="stop">Stop Agent</button>
			</div>
		</div>
	</div>

	<!-- Settings (collapsed by default) -->
	<div class="section collapsed" data-section="settings">
		<div class="section-header"><span class="chevron">&#9660;</span> Settings</div>
		<div class="section-body">
			<div class="toggle-row">
				<span class="toggle-label">Auto-compact</span>
				<span class="toggle-pill ${info.autoCompaction ? "on" : "off"}" data-command="toggleAutoCompaction">${info.autoCompaction ? "on" : "off"}</span>
			</div>
			<div class="toggle-row">
				<span class="toggle-label">Auto-retry</span>
				<span class="toggle-pill ${info.autoRetry ? "on" : "off"}" data-command="toggleAutoRetry">${info.autoRetry ? "on" : "off"}</span>
			</div>
			<div class="toggle-row">
				<span class="toggle-label">Steering</span>
				<span class="toggle-pill ${info.steeringMode === "one-at-a-time" ? "on" : "off"}" data-command="toggleSteeringMode">${info.steeringMode === "one-at-a-time" ? "1-at-a-time" : "all"}</span>
			</div>
			<div class="toggle-row">
				<span class="toggle-label">Follow-up</span>
				<span class="toggle-pill ${info.followUpMode === "one-at-a-time" ? "on" : "off"}" data-command="toggleFollowUpMode">${info.followUpMode === "one-at-a-time" ? "1-at-a-time" : "all"}</span>
			</div>
			<div class="toggle-row">
				<span class="toggle-label">Approval</span>
				<span class="toggle-pill on" data-command="selectApprovalMode">change</span>
			</div>
		</div>
	</div>`;
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function formatNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function getNonce(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let i = 0; i < 32; i++) nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	return nonce;
}
