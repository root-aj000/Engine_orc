import { NodeVM } from "vm2";
import type { NodeExecutor } from "../../global";

export const codeNode: NodeExecutor = async ({ config, input, context }) => {
  const { code, timeoutMs } = config as { code: string; timeoutMs?: number };
  if (!code) throw new Error("code node requires 'code'");

  const vm = new NodeVM({
    console: "redirect",
    sandbox: { input, env: context.env },
    timeout: timeoutMs ?? 3000,
    eval: false,
    wasm: false,
    require: {
      external: false
    }
  });

  vm.on("console.log", (data: any) => context.logger.info({ data }, "code node log"));
  vm.on("console.error", (data: any) => context.logger.error({ data }, "code node error"));

  // Code should export a default function or return a value.
  // Example:
  // module.exports = (input, env) => { return { foo: input.x + 1 }; }
  const wrapper = `
    const fn = (typeof module.exports === 'function') ? module.exports :
      (typeof exports === 'function' ? exports : null);
    if (fn) {
      module.exports = fn(sandbox.input, sandbox.env);
    } else if (typeof module.exports === 'object') {
      module.exports = module.exports;
    } else {
      module.exports = sandbox.input;
    }
  `;

  // Load user code into VM's module
  const userModule = `
    ${code}
  `;

  const result = vm.run(userModule + "\n" + wrapper, "vm2-code-node.js");
  return result;
};
