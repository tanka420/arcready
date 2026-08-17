import { AsyncLocalStorage } from "node:async_hooks";

const ruleExecutionScopes = new AsyncLocalStorage<object>();

export function runInRuleExecutionScope<T>(
  operation: () => Promise<T>
): Promise<T> {
  return ruleExecutionScopes.run({}, operation);
}

export function currentRuleExecutionScope(): object | undefined {
  return ruleExecutionScopes.getStore();
}
