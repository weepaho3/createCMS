import type {
  CMSAfterHook,
  CMSAfterHookContext,
  CMSBeforeHook,
  CMSBeforeHookContext,
} from './types/plugin';

export type HookRunner = ReturnType<typeof createHookRunner>;

export function createHookRunner(
  beforeHooks: CMSBeforeHook[],
  afterHooks: CMSAfterHook[],
) {
  function matchesHook(
    hook: { action: string | '*'; collection?: string },
    action: string,
    collection: string,
  ): boolean {
    if (hook.action !== '*' && hook.action !== action) return false;
    if (hook.collection && hook.collection !== collection) return false;
    return true;
  }

  return {
    async runBefore(
      action: string,
      collection: string,
      ctx: CMSBeforeHookContext,
    ): Promise<Record<string, unknown>> {
      const matching = beforeHooks.filter((hook) =>
        matchesHook(hook, action, collection),
      );
      const overrides: Record<string, unknown> = {};

      for (const hook of matching) {
        const result = await hook.handler(ctx);
        if (result?.override) Object.assign(overrides, result.override);
      }

      return overrides;
    },

    async runAfter(
      action: string,
      collection: string,
      ctx: CMSAfterHookContext,
    ): Promise<{ response: unknown } | void> {
      const matching = afterHooks.filter((hook) =>
        matchesHook(hook, action, collection),
      );

      let currentResult = ctx.result;

      for (const hook of matching) {
        try {
          const hookResult = await hook.handler({
            ...ctx,
            result: currentResult,
          });
          if (hookResult?.response !== undefined) {
            currentResult = hookResult.response;
          }
        } catch (err) {
          console.error(
            `[cms] after-hook failed for ${action}/${collection}:`,
            err,
          );
        }
      }

      if (currentResult !== ctx.result) {
        return { response: currentResult };
      }
    },
  };
}
