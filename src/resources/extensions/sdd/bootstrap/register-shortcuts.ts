import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@sdd/pi-coding-agent";
import { Key } from "@sdd/pi-tui";

import { SDDDashboardOverlay } from "../dashboard-overlay.js";
import { shortcutDesc } from "../../shared/mod.js";

export function registerShortcuts(pi: ExtensionAPI): void {
  pi.registerShortcut(Key.ctrlAlt("g"), {
    description: shortcutDesc("Open SDD dashboard", "/sdd status"),
    handler: async (ctx) => {
      if (!existsSync(join(process.cwd(), ".sdd"))) {
        ctx.ui.notify("No .sdd/ directory found. Run /sdd to start.", "info");
        return;
      }
      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => new SDDDashboardOverlay(tui, theme, () => done()),
        {
          overlay: true,
          overlayOptions: {
            width: "90%",
            minWidth: 80,
            maxHeight: "92%",
            anchor: "center",
          },
        },
      );
    },
  });
}
