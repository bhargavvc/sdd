// Project/App: SDD-2
// File Purpose: Pure spawn planning for the VS Code SDD RPC client.

import type { SpawnOptions } from "node:child_process";

export interface SddClientSpawnPlan {
	command: string;
	args: string[];
	options: SpawnOptions;
}

export function buildSddClientSpawnPlan(
	binaryPath: string,
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): SddClientSpawnPlan {
	return {
		command: binaryPath,
		args: ["--mode", "rpc"],
		options: {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...env },
			shell: platform === "win32",
		},
	};
}
