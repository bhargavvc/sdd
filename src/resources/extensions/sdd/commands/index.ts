import type { ExtensionAPI, ExtensionCommandContext } from "@sdd/pi-coding-agent";

import { SDD_COMMAND_DESCRIPTION, getSddArgumentCompletions } from "./catalog.js";

export function registerSDDCommand(pi: ExtensionAPI): void {
  pi.registerCommand("sdd", {
    description: SDD_COMMAND_DESCRIPTION,
    getArgumentCompletions: getSddArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const { handleSDDCommand } = await import("./dispatcher.js");
      await handleSDDCommand(args, ctx, pi);
    },
  });
}
