import type { NodeExecutor } from "../global";
import { httpNode } from "./node-types/http-node";
import { codeNode } from "./node-types/code-node";
import { webhookNode } from "./node-types/webhook-node";

class NodeRegistry {
  private registry = new Map<string, NodeExecutor>();

  register(type: string, executor: NodeExecutor) {
    this.registry.set(type, executor);
  }

  get(type: string): NodeExecutor {
    const exec = this.registry.get(type);
    if (!exec) throw new Error(`Node type not registered: ${type}`);
    return exec;
  }

  has(type: string) {
    return this.registry.has(type);
  }
}

export const nodeRegistry = new NodeRegistry();

// Register built-in nodes
nodeRegistry.register("http", httpNode);
nodeRegistry.register("code", codeNode);
nodeRegistry.register("webhook", webhookNode);
