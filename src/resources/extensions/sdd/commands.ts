export { registerSDDCommand } from "./commands/index.js";

export async function handleSDDCommand(
  ...args: Parameters<typeof import("./commands/dispatcher.js").handleSDDCommand>
) {
  const { handleSDDCommand: dispatch } = await import("./commands/dispatcher.js");
  return dispatch(...args);
}

export async function fireStatusViaCommand(
  ...args: Parameters<typeof import("./commands/handlers/core.js").fireStatusViaCommand>
) {
  const { fireStatusViaCommand: fireStatus } = await import(
    "./commands/handlers/core.js"
  );
  return fireStatus(...args);
}
