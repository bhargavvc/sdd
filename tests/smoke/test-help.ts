import { execFileSync } from "child_process";

const binary = process.env.SDD_SMOKE_BINARY || "npx";
const args = process.env.SDD_SMOKE_BINARY
  ? ["--help"]
  : ["sdd-pi", "--help"];

const output = execFileSync(binary, args, {
  encoding: "utf8",
  timeout: 30_000,
});

const lower = output.toLowerCase();

if (!lower.includes("sdd")) {
  console.error(`Help output does not contain "sdd": "${output}"`);
  process.exit(1);
}

if (!lower.includes("usage")) {
  console.error(`Help output does not contain "usage": "${output}"`);
  process.exit(1);
}
