import test from "node:test";
import assert from "node:assert/strict";

import { registerSDDCommand } from "../commands.ts";
import { handleSDDCommand } from "../commands/dispatcher.ts";

function createMockPi() {
  const commands = new Map<string, any>();
  return {
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    registerTool() {},
    registerShortcut() {},
    on() {},
    sendMessage() {},
    commands,
  };
}

function createMockCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      custom: async () => {},
    },
    shutdown: async () => {},
  };
}

test("/sdd description includes discuss", () => {
  const pi = createMockPi();
  registerSDDCommand(pi as any);

  const sdd = pi.commands.get("sdd");
  assert.ok(sdd, "registerSDDCommand should register /sdd");
  assert.ok(
    sdd.description.includes("discuss"),
    "description should include discuss",
  );
});

test("/sdd next completions include --debug", () => {
  const pi = createMockPi();
  registerSDDCommand(pi as any);

  const sdd = pi.commands.get("sdd");
  const completions = sdd.getArgumentCompletions("next ");
  const debug = completions.find((c: any) => c.value === "next --debug");
  assert.ok(debug, "next --debug should appear in completions");
});

test("/sdd widget completions include full|small|min|off", () => {
  const pi = createMockPi();
  registerSDDCommand(pi as any);

  const sdd = pi.commands.get("sdd");
  const completions = sdd.getArgumentCompletions("widget ");
  const values = completions.map((c: any) => c.value);
  for (const expected of ["widget full", "widget small", "widget min", "widget off"]) {
    assert.ok(values.includes(expected), `missing completion: ${expected}`);
  }
});

test("bare /sdd skip shows usage and does not fall through to unknown-command warning", async () => {
  const ctx = createMockCtx();

  await handleSDDCommand("skip", ctx as any, {} as any);

  assert.ok(
    ctx.notifications.some((n) => n.message.includes("Usage: /sdd skip <unit-id>")),
    "should show skip usage guidance",
  );
  assert.ok(
    !ctx.notifications.some((n) => n.message.startsWith("Unknown: /sdd skip")),
    "should not emit unknown-command warning for bare skip",
  );
});

