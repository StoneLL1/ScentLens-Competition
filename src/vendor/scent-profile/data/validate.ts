/**
 * 严格输入验证（Tech_stack.md §3.2、Request.md §2.3）。
 *
 * TypeScript 类型不能替代对设备消息或 JSON 的运行时验证：
 * 入口接收 unknown，依次检查对象形状、八个键、值类型、有限性及数值范围。
 *
 * - 缺失键与 null 规范为“不完整”（返回 null），不补零；
 * - 字符串数字、NaN、无穷、负值、超过 100 一律返回错误，不静默截断；
 * - 未知气味键记录警告，不参与八维计算；
 * - 顶层不是普通对象（含数组、null）返回错误。
 */

import { SCENT_KEYS, type InputScores, type ValidationResult } from "../types";

const KEY_SET = new Set<string>(SCENT_KEYS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 验证八维分数对象。
 * ok=true 时 value 为 InputScores：已知项保留原始数值（含小数），缺失项为 null。
 * “输入可解析”不等于“八项全部有效”，完整性用 isCompleteInput 另行判断。
 */
export function validateScores(input: unknown): ValidationResult<InputScores> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Expected a plain object with eight scent keys"] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const value = {} as InputScores;

  for (const key of SCENT_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null) {
      // 缺失不是 0：标记不完整，保留其他已知项。
      value[key] = null;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push(
        `"${key}" must be a finite number in [0, 100], got ${describeValue(raw)}`,
      );
      continue;
    }
    if (raw < 0 || raw > 100) {
      errors.push(`"${key}" must be within [0, 100], got ${raw}`);
      continue;
    }
    value[key] = raw;
  }

  for (const key of Object.keys(input)) {
    if (!KEY_SET.has(key)) {
      warnings.push(`Unknown scent key "${key}" ignored`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value, warnings };
}

function describeValue(raw: unknown): string {
  if (typeof raw === "string") return `string "${raw}"`;
  if (typeof raw === "bigint") return `bigint ${raw}`;
  if (Number.isNaN(raw as number)) return "NaN";
  if ((raw as number) === Infinity) return "Infinity";
  if ((raw as number) === -Infinity) return "-Infinity";
  if (raw === undefined) return "undefined";
  if (typeof raw === "object" && raw !== null) return "an object";
  return String(raw);
}

/** 八项全部为有效数值才可进入完整云渲染。 */
export function isCompleteInput(scores: InputScores): boolean {
  return SCENT_KEYS.every((key) => typeof scores[key] === "number");
}

/**
 * 完整输入 → 固定顺序数组（供几何模块）。
 * 调用前先用 isCompleteInput 判断；不完整输入抛 TypeError，避免把 null 悄悄当 0。
 */
export function completeInputToArray(scores: InputScores): number[] {
  if (!isCompleteInput(scores)) {
    throw new TypeError("Incomplete input must not feed the full cloud renderer");
  }
  return SCENT_KEYS.map((key) => scores[key] as number);
}
