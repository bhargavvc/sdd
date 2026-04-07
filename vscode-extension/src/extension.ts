import * as vscode from "vscode";
import { SddClient, ThinkingLevel } from "./sdd-client.js";
import { registerChatParticipant } from "./chat-participant.js";
import { GsdSidebarProvider } from "./sidebar.js";
import { GsdFileDecorationProvider } from "./file-decorations.js";
import { GsdBashTerminal } from "./bash-terminal.js";
import { GsdSessionTreeProvider } from "./session-tree.js";
import { GsdConversationHistoryPanel } from "./conversation-history.js";
import { GsdSlashCompletionProvider } from "./slash-completion.js";
import { GsdCodeLensProvider } from "./code-lens.js";
import { GsdActivityFeedProvider } from "./activity-feed.js";
import { GsdChangeTracker } from "./change-tracker.js";
import { GsdScmProvider } from "./scm-provider.js";
import { GsdDiagnosticBridge } from "./diagnostics.js";
import { GsdLineDecorationManager } from "./line-decorations.js";
import { GsdGitIntegration } from "./git-integration.js";
import { GsdPermissionManager } from "./permissions.js";

let client: GsdClient | undefined;
let sidebarProvider: GsdSidebarProvider | undefined;
let fileDecorations: GsdFileDecorationProvider | undefined;
let sessionTreeProvider: GsdSessionTreeProvider | undefined;
let activityFeedProvider: GsdActivityFeedProvider | undefined;
let changeTracker: GsdChangeTracker | undefined;
let scmProvider: GsdScmProvider | undefined;
let diagnosticBridge: GsdDiagnosticBridge | undefined;
let lineDecorations: GsdLineDecorationManager | undefined;
let gitIntegration: GsdGitIntegration | undefined;
let permissionManager: GsdPermissionManager | undefined;

function requireConnected(): boolean {
	if (!client?.isConnected) {
		vscode.window.showWarningMessage("SDD agent is not running.");
		return false;
	}
	return true;
}

function handleError(err: unknown, context: string): void {
	const msg = err instanceof Error ? err.message : String(err);
	vscode.window.showErrorMessage(`${context}: ${msg}`);
}

export function activate(context: vscode.ExtensionContext): void {
	const config = vscode.workspace.getConfiguration("sdd");
	const binaryPath = config.get<string>("binaryPath", "sdd");
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

	client = new SddClient(binaryPath, cwd);
	context.subscriptions.push(client);

	// Log stderr to an output channel
	const outputChannel = vscode.window.createOutputChannel("SDD Agent");
	context.subscriptions.push(outputChannel);

	client.onError((msg) => {
		outputChannel.appendLine(`[stderr] ${msg}`);
	});

	client.onConnectionChange((connected) => {
		if (connected) {
			vscode.window.setStatusBarMessage("$(hubot) SDD connected", 3000);
		} else {
			vscode.window.setStatusBarMessage("$(hubot) SDD disconnected", 3000);
		}
	});

	// -- Sidebar -----------------------------------------------------------

	sidebarProvider = new SddSidebarProvider(context.extensionUri, client, context.globalState);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SddSidebarProvider.viewId,
			sidebarProvider,
		),
	);

	// -- File decorations --------------------------------------------------

	fileDecorations = new GsdFileDecorationProvider(client);
	context.subscriptions.push(
		fileDecorations,
		vscode.window.registerFileDecorationProvider(fileDecorations),
	);

	// -- Bash terminal -----------------------------------------------------

	const bashTerminal = new GsdBashTerminal(client);
	context.subscriptions.push(bashTerminal);

	// -- Session tree view -------------------------------------------------

	sessionTreeProvider = new GsdSessionTreeProvider(client);
	context.subscriptions.push(
		sessionTreeProvider,
		vscode.window.registerTreeDataProvider(GsdSessionTreeProvider.viewId, sessionTreeProvider),
	);

	// -- Activity feed -----------------------------------------------------

	activityFeedProvider = new GsdActivityFeedProvider(client);
	context.subscriptions.push(
		activityFeedProvider,
		vscode.window.registerTreeDataProvider(GsdActivityFeedProvider.viewId, activityFeedProvider),
	);

	// -- Change tracker & SCM provider -------------------------------------

	changeTracker = new GsdChangeTracker(client);
	context.subscriptions.push(changeTracker);

	scmProvider = new GsdScmProvider(changeTracker, cwd);
	context.subscriptions.push(scmProvider);

	// -- Diagnostics -------------------------------------------------------

	diagnosticBridge = new GsdDiagnosticBridge(client);
	context.subscriptions.push(diagnosticBridge);

	// -- Line-level decorations --------------------------------------------

	lineDecorations = new GsdLineDecorationManager(changeTracker!);
	context.subscriptions.push(lineDecorations);

	// -- Git integration ---------------------------------------------------

	gitIntegration = new GsdGitIntegration(changeTracker!, cwd);
	context.subscriptions.push(gitIntegration);

	// -- Permissions -------------------------------------------------------

	permissionManager = new GsdPermissionManager(client);
	context.subscriptions.push(permissionManager);

	// -- Progress notifications --------------------------------------------

	let currentProgress: { resolve: () => void } | undefined;

	client.onEvent((evt) => {
		const showProgress = vscode.workspace.getConfiguration("sdd").get<boolean>("showProgressNotifications", true);
		if (!showProgress) return;

		if (evt.type === "agent_start" && !currentProgress) {
			vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "SDD Agent",
					cancellable: true,
				},
				(progress, token) => {
					token.onCancellationRequested(() => {
						client?.abort().catch(() => {});
					});

					// Listen for tool events to update progress message
					const toolListener = client!.onEvent((toolEvt) => {
						if (toolEvt.type === "tool_execution_start") {
							const toolName = String(toolEvt.toolName ?? "");
							progress.report({ message: `Running ${toolName}...` });
						}
					});

					return new Promise<void>((resolve) => {
						currentProgress = { resolve };
						// Also clean up if disposed
						token.onCancellationRequested(() => {
							toolListener.dispose();
							currentProgress = undefined;
							resolve();
						});
					}).finally(() => {
						toolListener.dispose();
					});
				},
			);
		} else if (evt.type === "agent_end" && currentProgress) {
			currentProgress.resolve();
			currentProgress = undefined;
		}
	});

	// -- Context window warning --------------------------------------------

	let lastContextWarning = 0;
	client.onEvent(async (evt) => {
		if (evt.type !== "message_end") return;
		const showWarning = vscode.workspace.getConfiguration("sdd").get<boolean>("showContextWarning", true);
		if (!showWarning) return;

		// Throttle: at most once per 60 seconds
		if (Date.now() - lastContextWarning < 60_000) return;

		try {
			const [state, stats] = await Promise.all([
				client!.getState().catch(() => null),
				client!.getSessionStats().catch(() => null),
			]);
			const contextWindow = state?.model?.contextWindow ?? 0;
			const totalTokens = (stats?.inputTokens ?? 0) + (stats?.outputTokens ?? 0);
			if (contextWindow <= 0) return;

			const threshold = vscode.workspace.getConfiguration("sdd").get<number>("contextWarningThreshold", 80);
			const pct = Math.round((totalTokens / contextWindow) * 100);
			if (pct >= threshold) {
				lastContextWarning = Date.now();
				const action = await vscode.window.showWarningMessage(
					`Context window ${pct}% full (${Math.round(totalTokens / 1000)}k / ${Math.round(contextWindow / 1000)}k). Consider compacting.`,
					"Compact Now",
				);
				if (action === "Compact Now") {
					await vscode.commands.executeCommand("sdd.compact");
				}
			}
		} catch {
			// ignore
		}
	});

	// -- Chat participant ---------------------------------------------------

	context.subscriptions.push(registerChatParticipant(context, client));

	// -- Commands -----------------------------------------------------------

	// Start
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.start", async () => {
			try {
				await client!.start();
				// Apply auto-compaction setting
				const autoCompaction = vscode.workspace.getConfiguration("sdd").get<boolean>("autoCompaction", true);
				await client!.setAutoCompaction(autoCompaction).catch(() => {});
				sidebarProvider?.refresh();
				vscode.window.setStatusBarMessage("$(hubot) SDD agent started", 3000);
			} catch (err) {
				handleError(err, "Failed to start SDD");
			}
		}),
	);

	// Stop
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.stop", async () => {
			await client!.stop();
			sidebarProvider?.refresh();
			vscode.window.setStatusBarMessage("$(hubot) SDD agent stopped", 3000);
		}),
	);

	// New Session
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.newSession", async () => {
			if (!requireConnected()) return;
			try {
				await client!.newSession();
				sidebarProvider?.refresh();
				vscode.window.setStatusBarMessage("$(hubot) New SDD session", 3000);
			} catch (err) {
				handleError(err, "Failed to start new session");
			}
		}),
	);

	// Send Message
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.sendMessage", async () => {
			if (!requireConnected()) return;
			const message = await vscode.window.showInputBox({
				prompt: "Enter message for SDD",
				placeHolder: "What should I do?",
			});
			if (!message) return;
			try {
				await client!.sendPrompt(message);
			} catch (err) {
				handleError(err, "Failed to send message");
			}
		}),
	);

	// Abort
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.abort", async () => {
			if (!requireConnected()) return;
			try {
				await client!.abort();
				vscode.window.setStatusBarMessage("$(hubot) Operation aborted", 3000);
			} catch (err) {
				handleError(err, "Failed to abort");
			}
		}),
	);

	// Cycle Model
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.cycleModel", async () => {
			if (!requireConnected()) return;
			try {
				const result = await client!.cycleModel();
				if (result) {
					vscode.window.showInformationMessage(
						`Model: ${result.model.provider}/${result.model.id} (thinking: ${result.thinkingLevel})`,
					);
				} else {
					vscode.window.showInformationMessage("No other models available.");
				}
				sidebarProvider?.refresh();
			} catch (err) {
				handleError(err, "Failed to cycle model");
			}
		}),
	);

	// Switch Model (QuickPick)
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.switchModel", async () => {
			if (!requireConnected()) return;
			try {
				const models = await client!.getAvailableModels();
				if (models.length === 0) {
					vscode.window.showInformationMessage("No models available.");
					return;
				}
				const items = models.map((m) => ({
					label: `${m.provider}/${m.id}`,
					description: m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k context` : undefined,
					provider: m.provider,
					modelId: m.id,
				}));
				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: "Select a model",
				});
				if (!selected) return;
				await client!.setModel(selected.provider, selected.modelId);
				vscode.window.showInformationMessage(`Model set to ${selected.label}`);
				sidebarProvider?.refresh();
			} catch (err) {
				handleError(err, "Failed to switch model");
			}
		}),
	);

	// Cycle Thinking Level
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.cycleThinking", async () => {
			if (!requireConnected()) return;
			try {
				const result = await client!.cycleThinkingLevel();
				if (result) {
					vscode.window.showInformationMessage(`Thinking level: ${result.level}`);
				} else {
					vscode.window.showInformationMessage("Cannot change thinking level for this model.");
				}
				sidebarProvider?.refresh();
			} catch (err) {
				handleError(err, "Failed to cycle thinking level");
			}
		}),
	);

	// Set Thinking Level (QuickPick)
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.setThinking", async () => {
			if (!requireConnected()) return;
			const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];
			const selected = await vscode.window.showQuickPick(levels, {
				placeHolder: "Select thinking level",
			});
			if (!selected) return;
			try {
				await client!.setThinkingLevel(selected as ThinkingLevel);
				vscode.window.showInformationMessage(`Thinking level set to ${selected}`);
				sidebarProvider?.refresh();
			} catch (err) {
				handleError(err, "Failed to set thinking level");
			}
		}),
	);

	// Compact Context
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.compact", async () => {
			if (!requireConnected()) return;
			try {
				await client!.compact();
				vscode.window.setStatusBarMessage("$(hubot) Context compacted", 3000);
				sidebarProvider?.refresh();
			} catch (err) {
				handleError(err, "Failed to compact context");
			}
		}),
	);

	// Export HTML
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.exportHtml", async () => {
			if (!requireConnected()) return;
			try {
				const saveUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file("sdd-conversation.html"),
					filters: { "HTML Files": ["html"] },
				});
				const outputPath = saveUri?.fsPath;
				const result = await client!.exportHtml(outputPath);
				vscode.window.showInformationMessage(`Conversation exported to ${result.path}`);
			} catch (err) {
				handleError(err, "Failed to export HTML");
			}
		}),
	);

	// Session Stats
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.sessionStats", async () => {
			if (!requireConnected()) return;
			try {
				const stats = await client!.getSessionStats();
				const lines: string[] = [];
				if (stats.inputTokens !== undefined) lines.push(`Input tokens: ${stats.inputTokens.toLocaleString()}`);
				if (stats.outputTokens !== undefined) lines.push(`Output tokens: ${stats.outputTokens.toLocaleString()}`);
				if (stats.cacheReadTokens !== undefined) lines.push(`Cache read: ${stats.cacheReadTokens.toLocaleString()}`);
				if (stats.cacheWriteTokens !== undefined) lines.push(`Cache write: ${stats.cacheWriteTokens.toLocaleString()}`);
				if (stats.totalCost !== undefined) lines.push(`Cost: $${stats.totalCost.toFixed(4)}`);
				if (stats.turnCount !== undefined) lines.push(`Turns: ${stats.turnCount}`);
				if (stats.messageCount !== undefined) lines.push(`Messages: ${stats.messageCount}`);
				if (stats.duration !== undefined) lines.push(`Duration: ${Math.round(stats.duration / 1000)}s`);

				vscode.window.showInformationMessage(
					lines.length > 0 ? lines.join(" | ") : "No stats available.",
				);
			} catch (err) {
				handleError(err, "Failed to get session stats");
			}
		}),
	);

	// Run Bash Command
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.runBash", async () => {
			if (!requireConnected()) return;
			const command = await vscode.window.showInputBox({
				prompt: "Enter bash command to execute",
				placeHolder: "ls -la",
			});
			if (!command) return;
			try {
				const result = await client!.runBash(command);
				outputChannel.appendLine(`[bash] $ ${command}`);
				if (result.stdout) outputChannel.appendLine(result.stdout);
				if (result.stderr) outputChannel.appendLine(`[stderr] ${result.stderr}`);
				outputChannel.appendLine(`[exit code: ${result.exitCode}]`);
				outputChannel.show(true);

				if (result.exitCode === 0) {
					vscode.window.showInformationMessage("Bash command completed successfully.");
				} else {
					vscode.window.showWarningMessage(`Bash command exited with code ${result.exitCode}`);
				}
			} catch (err) {
				handleError(err, "Failed to run bash command");
			}
		}),
	);

	// Steer Agent
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.steer", async () => {
			if (!requireConnected()) return;
			const message = await vscode.window.showInputBox({
				prompt: "Enter steering message (interrupts current operation)",
				placeHolder: "Focus on the error handling instead",
			});
			if (!message) return;
			try {
				await client!.steer(message);
			} catch (err) {
				handleError(err, "Failed to steer agent");
			}
		}),
	);

	// List Available Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.listCommands", async () => {
			if (!requireConnected()) return;
			try {
				const commands = await client!.getCommands();
				if (commands.length === 0) {
					vscode.window.showInformationMessage("No slash commands available.");
					return;
				}
				const items = commands.map((cmd) => ({
					label: `/${cmd.name}`,
					description: cmd.description ?? "",
					detail: `Source: ${cmd.source}${cmd.location ? ` (${cmd.location})` : ""}`,
				}));
				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: "Available slash commands",
				});
				if (selected) {
					// Send the selected command as a prompt
					await client!.sendPrompt(selected.label);
				}
			} catch (err) {
				handleError(err, "Failed to list commands");
			}
		}),
	);

	// -- Editor Context Menu Actions ----------------------------------------

	const editorActions = [
		{ command: "sdd.explain", label: "Explain", prompt: "Explain this code clearly. What does it do, why, and any edge cases?" },
		{ command: "sdd.fix", label: "Fix", prompt: "Find and fix any bugs in this code. Show what you changed and why." },
		{ command: "sdd.addTests", label: "Add Tests", prompt: "Write comprehensive tests for this code covering happy path, edge cases, and error conditions." },
		{ command: "sdd.refactor", label: "Refactor", prompt: "Refactor this code for better readability, performance, and maintainability." },
		{ command: "sdd.optimize", label: "Optimize", prompt: "Optimize this code for performance. Identify bottlenecks and improve them." },
	];

	for (const action of editorActions) {
		context.subscriptions.push(
			vscode.commands.registerCommand(action.command, async () => {
				const editor = vscode.window.activeTextEditor;
				if (!editor) return;
				const selection = editor.selection;
				const selectedText = editor.document.getText(selection);
				if (!selectedText) {
					vscode.window.showWarningMessage("Select some code first.");
					return;
				}
				const filePath = editor.document.uri.fsPath;
				const relativePath = vscode.workspace.asRelativePath(filePath);
				const startLine = selection.start.line + 1;
				const message = `${action.prompt}\n\nFile: ${relativePath} (line ${startLine})\n\`\`\`\n${selectedText}\n\`\`\``;

				if (!client?.isConnected) {
					try { await client!.start(); } catch { return; }
				}
				try {
					sidebarProvider?.refresh();
					await client!.sendPrompt(message);
				} catch (err) {
					handleError(err, `Failed to ${action.label.toLowerCase()}`);
				}
			}),
		);
	}

	// -- SCM commands -------------------------------------------------------

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.acceptAllChanges", () => {
			changeTracker?.acceptAll();
			vscode.window.showInformationMessage("All agent changes accepted.");
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.discardAllChanges", async () => {
			if (!changeTracker?.hasChanges) {
				vscode.window.showInformationMessage("No agent changes to discard.");
				return;
			}
			const confirm = await vscode.window.showWarningMessage(
				`Discard all agent changes (${changeTracker.modifiedFiles.length} files)?`,
				{ modal: true },
				"Discard",
			);
			if (confirm === "Discard") {
				const count = await changeTracker.discardAll();
				vscode.window.showInformationMessage(`Reverted ${count} file${count !== 1 ? "s" : ""}.`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.discardFileChanges", async (resourceState: vscode.SourceControlResourceState) => {
			if (!changeTracker || !resourceState?.resourceUri) return;
			const filePath = resourceState.resourceUri.fsPath;
			const success = await changeTracker.discardFile(filePath);
			if (success) {
				vscode.window.showInformationMessage(`Reverted ${vscode.workspace.asRelativePath(filePath)}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.acceptFileChanges", (resourceState: vscode.SourceControlResourceState) => {
			if (!changeTracker || !resourceState?.resourceUri) return;
			changeTracker.acceptFile(resourceState.resourceUri.fsPath);
		}),
	);

	// -- Checkpoint commands ------------------------------------------------

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.restoreCheckpoint", async (checkpointId: number) => {
			if (!changeTracker) return;
			const checkpoint = changeTracker.checkpoints.find((c) => c.id === checkpointId);
			if (!checkpoint) return;

			const confirm = await vscode.window.showWarningMessage(
				`Restore to "${checkpoint.label}"? This will revert files to their state at ${new Date(checkpoint.timestamp).toLocaleTimeString()}.`,
				{ modal: true },
				"Restore",
			);
			if (confirm === "Restore") {
				const count = await changeTracker.restoreCheckpoint(checkpointId);
				vscode.window.showInformationMessage(`Restored ${count} file${count !== 1 ? "s" : ""} to checkpoint.`);
			}
		}),
	);

	// -- Diagnostic commands ------------------------------------------------

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.fixProblemsInFile", async () => {
			if (!requireConnected()) return;
			try {
				await diagnosticBridge!.fixProblemsInFile();
			} catch (err) {
				handleError(err, "Failed to fix problems");
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.fixAllProblems", async () => {
			if (!requireConnected()) return;
			try {
				await diagnosticBridge!.fixAllProblems();
			} catch (err) {
				handleError(err, "Failed to fix problems");
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.clearDiagnostics", () => {
			diagnosticBridge?.clearFindings();
		}),
	);

	// -- Permission commands ------------------------------------------------

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.cycleApprovalMode", () => {
			permissionManager?.cycleMode();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.selectApprovalMode", () => {
			permissionManager?.selectMode();
		}),
	);

	// -- Git commands -------------------------------------------------------

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.commitAgentChanges", () => {
			gitIntegration?.commitAgentChanges();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.createAgentBranch", () => {
			gitIntegration?.createAgentBranch();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("sdd.showAgentDiff", () => {
			gitIntegration?.showAgentDiff();
		}),
	);

	// -- Auto-start ---------------------------------------------------------

	if (config.get<boolean>("autoStart", false)) {
		vscode.commands.executeCommand("sdd.start");
	}
}

export function deactivate(): void {
	client?.dispose();
	sidebarProvider?.dispose();
	fileDecorations?.dispose();
	sessionTreeProvider?.dispose();
	activityFeedProvider?.dispose();
	changeTracker?.dispose();
	scmProvider?.dispose();
	diagnosticBridge?.dispose();
	lineDecorations?.dispose();
	gitIntegration?.dispose();
	permissionManager?.dispose();
	client = undefined;
	sidebarProvider = undefined;
	fileDecorations = undefined;
	sessionTreeProvider = undefined;
	activityFeedProvider = undefined;
	changeTracker = undefined;
	scmProvider = undefined;
	diagnosticBridge = undefined;
	lineDecorations = undefined;
	gitIntegration = undefined;
	permissionManager = undefined;
}
