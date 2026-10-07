/**
 * ScentFrame 运行时验证（Tech_stack.md §3.1、§3.2）。
 *
 * TypeScript 类型不能替代设备消息的运行时验证：setFrame 接收 unknown，
 * 依次检查对象形状、schemaVersion、各字段类型与嵌套 confidence。
 *
 * - schemaVersion 不支持：拒绝该消息（返回错误）；
 * - sequence 必须是非负安全整数（帧序去重由 controller 处理）；
 * - confidence 为 null（识别中/错误）或走 validateScores 的同一套规则；
 * - message 为纯文本，仅经 textContent 显示，不作为 HTML 执行。
 */

import type { ScentFrame } from "../types";
import type { ValidationResult } from "../types";
import { validateScores } from "./validate";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return `string "${value.slice(0, 40)}"`;
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return String(value);
}

/**
 * 验证一帧设备 / 适配器消息。ok=true 仅表示帧可解析；
 * 序号新旧、状态流转与过期判断由 data/controller.ts 负责。
 */
export function validateFrame(input: unknown): ValidationResult<ScentFrame> {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Expected a plain object frame"] };
  }

  const errors: string[] = [];
  const push = (message: string): void => {
    errors.push(message);
  };

  if (input.schemaVersion !== 1) {
    push(`schemaVersion must be 1, got ${describe(input.schemaVersion)}`);
  }
  if (input.source !== "mock" && input.source !== "device") {
    push(`source must be "mock" or "device", got ${describe(input.source)}`);
  }
  if (typeof input.streamId !== "string" || input.streamId.length === 0) {
    push(`streamId must be a non-empty string, got ${describe(input.streamId)}`);
  }
  if (typeof input.sampleId !== "string" || input.sampleId.length === 0) {
    push(`sampleId must be a non-empty string, got ${describe(input.sampleId)}`);
  }
  if (
    typeof input.sequence !== "number" ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0
  ) {
    push(
      `sequence must be a non-negative safe integer, got ${describe(input.sequence)}`,
    );
  }
  if (input.status !== "analyzing" && input.status !== "ready" && input.status !== "error") {
    push(`status must be "analyzing", "ready" or "error", got ${describe(input.status)}`);
  }
  if (
    input.sampledAt !== undefined &&
    (typeof input.sampledAt !== "string" || input.sampledAt.length === 0)
  ) {
    push(`sampledAt must be a non-empty string when present, got ${describe(input.sampledAt)}`);
  }
  if (
    input.message !== undefined &&
    typeof input.message !== "string"
  ) {
    push(`message must be a string when present, got ${describe(input.message)}`);
  }

  // confidence：null 合法（识别中 / 错误），对象则进入同一套分数验证。
  let confidence: ScentFrame["confidence"] = null;
  let confidenceResult: ReturnType<typeof validateScores> | null = null;
  if (input.confidence !== null && input.confidence !== undefined) {
    confidenceResult = validateScores(input.confidence);
    if (!confidenceResult.ok) {
      for (const error of confidenceResult.errors) {
        push(`confidence.${error}`);
      }
    } else {
      confidence = confidenceResult.value;
    }
  } else if (input.confidence === undefined) {
    // 缺键视同 null：帧契约允许省略（等价 null），不是八项全缺失。
    confidence = null;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const frame: ScentFrame = {
    schemaVersion: 1,
    source: input.source as ScentFrame["source"],
    streamId: input.streamId as string,
    sampleId: input.sampleId as string,
    sequence: input.sequence as number,
    status: input.status as ScentFrame["status"],
    confidence,
  };
  if (typeof input.sampledAt === "string") frame.sampledAt = input.sampledAt;
  if (typeof input.message === "string") frame.message = input.message;

  const warnings =
    confidenceResult !== null && confidenceResult.ok
      ? confidenceResult.warnings
      : ([] as string[]);
  return { ok: true, value: frame, warnings };
}
