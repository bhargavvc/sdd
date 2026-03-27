import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTaskCommitMessage } from "../../sdd/git-service.ts";

describe("commit linking", () => {
  it("appends Resolves #N when issueNumber is set", () => {
    const msg = buildTaskCommitMessage({
      taskId: "S01/T02",
      taskTitle: "implement auth",
      issueNumber: 43,
    });
    assert.ok(msg.includes("Resolves #43"), "should include Resolves trailer");
    assert.ok(msg.startsWith("feat:"), "subject line has no scope");
    assert.ok(msg.includes("SDD-Task: S01/T02"), "SDD-Task trailer present");
  });

  it("includes both key files and Resolves #N", () => {
    const msg = buildTaskCommitMessage({
      taskId: "S01/T02",
      taskTitle: "implement auth",
      keyFiles: ["src/auth.ts"],
      issueNumber: 43,
    });
    assert.ok(msg.includes("- src/auth.ts"), "key files present");
    assert.ok(msg.includes("Resolves #43"), "Resolves trailer present");
    assert.ok(msg.includes("SDD-Task: S01/T02"), "SDD-Task trailer present");
    // SDD-Task should come after key files but before Resolves
    const keyFilesIdx = msg.indexOf("- src/auth.ts");
    const taskIdx = msg.indexOf("SDD-Task: S01/T02");
    const resolvesIdx = msg.indexOf("Resolves #43");
    assert.ok(taskIdx > keyFilesIdx, "SDD-Task after key files");
    assert.ok(resolvesIdx > taskIdx, "Resolves after SDD-Task");
  });

  it("no Resolves trailer when issueNumber is not set", () => {
    const msg = buildTaskCommitMessage({
      taskId: "S01/T02",
      taskTitle: "implement auth",
    });
    assert.ok(!msg.includes("Resolves"), "no Resolves when no issueNumber");
    assert.ok(msg.includes("SDD-Task: S01/T02"), "SDD-Task trailer still present");
  });
});
