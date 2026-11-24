import { RepairPlan } from './domain/repair-plan.mjs';

/**
 * エージェントを呼ぶ前に、同じ失敗をコマンドだけで直せる場合の手順。
 * 1 コマンドにつき 1 回だけ使う。
 * @param {string | string[]} command
 * @param {string} output
 * @returns {{ repair: string, retry: string | string[], reason: string } | null}
 */
export function planMechanicalRepair(command, output) {
  const plan = RepairPlan.fromFailure(command, output);
  if (!plan) return null;
  return { repair: plan.repair, retry: plan.retry, reason: plan.reason };
}
