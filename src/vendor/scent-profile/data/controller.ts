/**
 * 数据状态机（Request.md §4.3、Tech_stack.md §3.3、§11.2）。
 *
 * 职责：接收已通过验证的输入（setData / setFrame 同一管线），
 * 维护三组数据状态中的前两组——
 *   latestRawScores  最新收到的可解析输入（读数与数值表使用，缺失为 null）
 *   lastComplete     最近一次完整有效结果（云的渲染目标与“Last reading”快照）
 * 第三组 displayedScores 由 motion/controller.ts 负责。
 *
 * 状态流转要点：
 * - 缺失不是零：不完整输入不生成新云；保留的旧云按 Last reading 标注；
 * - 全零是有效完整结果：状态 zero，动画结束后云完全清空；
 * - error 帧清空云并显示错误说明，不把错误换成零分或随机结果；
 * - analyzing 且无有效分数：清空云，不把旧样本云当作新样本预览；
 *   analyzing 带完整分数的活跃流读数照常更新云，状态仍标识别中；
 * - 同一 streamId 仅接受递增 sequence；新 streamId 重建序列上下文；
 * - 仅 setFrame + stream（活跃采样流）启用 staleAfterMs 超时；
 *   setData 的 stream（滑杆等 UI 连续输入）与离散最终结果不过期；
 * - 断连保留最近结果并停止装饰动效（由上层根据状态判定）。
 *
 * 本模块不接触 DOM 与像素：时钟与定时器注入，便于受控单元测试。
 */

import { SCENT_KEYS, type ConnectionEvent, type InputScores, type ProfileState, type ScentFrame, type UpdateMode } from "../types";
import { isCompleteInput } from "./validate";

export interface LastCompleteSnapshot {
  /** SCENT_KEYS 固定顺序的完整分数。 */
  scores: number[];
  sampleId: string;
  receivedAt: number;
}

export type ConnectionStatus = "unknown" | "connected" | "disconnected";

export interface ControllerContext {
  state: ProfileState;
  /** 最近收到的可解析输入（含缺失项）。 */
  latestScores: InputScores | null;
  /** 最近完整有效结果；云保留旧图时以此为身份标注。 */
  lastComplete: LastCompleteSnapshot | null;
  /** 最近一次收到输入的本地单调时间。 */
  receivedAt: number | null;
  /** error 状态的简短说明（纯文本）。 */
  errorMessage: string | null;
  connection: ConnectionStatus;
}

export interface DataControllerCallbacks {
  /** 渲染目标变化：scores 为 null 表示清空云（动画到零后清除）。 */
  onTarget(scores: number[] | null, mode: UpdateMode): void;
  /** 状态或读数上下文变化（含 latestScores 更新）。 */
  onState(context: ControllerContext): void;
}

export interface DataControllerOptions {
  staleAfterMs: number;
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** 帧不带 confidence 时的规范输入：八项全部缺失（不冒充任何读数）。 */
function emptyInputScores(): InputScores {
  const out = {} as InputScores;
  for (const key of SCENT_KEYS) out[key] = null;
  return out;
}

export function createDataController(
  callbacks: DataControllerCallbacks,
  options: DataControllerOptions,
): {
  /** 返回 false 表示帧序重复/过旧被忽略，画面不回退。 */
  accept(mode: UpdateMode, scores: InputScores | null, frame?: ScentFrame): boolean;
  setConnection(event: ConnectionEvent): void;
  getContext(): ControllerContext;
  /** 仅供测试：直接触发活跃流超时。 */
  fireStale(): void;
  /** 清理超时计时器（组件销毁时调用）。 */
  dispose(): void;
} {
  const context: ControllerContext = {
    state: "idle",
    latestScores: null,
    lastComplete: null,
    receivedAt: null,
    errorMessage: null,
    connection: "unknown",
  };

  // ── 帧序上下文：同一 streamId 内 sequence 单调递增 ──
  let lastStreamId: string | null = null;
  let lastSequence = -1;

  // ── 活跃流超时：仅 setFrame + stream 启用 ──
  let staleHandle: unknown = null;

  function emitState(): void {
    callbacks.onState({
      ...context,
      lastComplete: context.lastComplete ? { ...context.lastComplete } : null,
    });
  }

  function disarmStale(): void {
    if (staleHandle !== null) {
      options.clearTimer(staleHandle);
      staleHandle = null;
    }
  }

  function armStale(): void {
    disarmStale();
    staleHandle = options.setTimer(() => fireStale(), options.staleAfterMs);
  }

  function fireStale(): void {
    staleHandle = null;
    // 仅活跃采样流超时；已断连（计时本应清除）或无数据不进入该状态。
    if (
      context.connection !== "disconnected" &&
      (context.state === "ready" ||
        context.state === "zero" ||
        context.state === "incomplete" ||
        context.state === "analyzing")
    ) {
      context.state = "stale";
      emitState();
    }
  }

  /** 由最近完整结果推导的基础数据状态。 */
  function baseDataState(): ProfileState {
    if (context.lastComplete === null) return "idle";
    return context.lastComplete.scores.every((v) => v === 0) ? "zero" : "ready";
  }

  function accept(
    mode: UpdateMode,
    scores: InputScores | null,
    frame?: ScentFrame,
  ): boolean {
    const now = options.now();

    // 帧序：同一 streamId 只接受递增 sequence（验证层已保证类型合法）。
    if (frame) {
      if (frame.streamId === lastStreamId) {
        if (frame.sequence <= lastSequence) return false; // 重复或乱序：忽略，不回退
        lastSequence = frame.sequence;
      } else {
        // 新 streamId 重建序列上下文。
        lastStreamId = frame.streamId;
        lastSequence = frame.sequence;
      }
    }

    const input = scores ?? emptyInputScores();
    const complete = isCompleteInput(input);
    context.latestScores = input;
    context.receivedAt = now;

    // 错误帧：清空云、显示错误说明，不把错误换成零分或随机结果。
    if (frame && frame.status === "error") {
      context.errorMessage = frame.message ?? "Device error";
      context.state = "error";
      context.lastComplete = null;
      disarmStale();
      callbacks.onTarget(null, mode);
      emitState();
      return true;
    }

    if (frame && frame.status === "analyzing" && scores === null) {
      // 识别中且无任何有效分数：清空云与旧样本身份，
      // 不把旧样本云当作新样本预览。
      context.errorMessage = null;
      context.state = "analyzing";
      context.lastComplete = null;
      disarmStale();
      callbacks.onTarget(null, mode);
      emitState();
      return true;
    }

    if (!complete) {
      // 缺失不是零：不完整结果不生成新云；保留旧目标，由上层标注身份。
      // analyzing 帧即使带部分分数也没有完整结果：保持识别中提示。
      context.errorMessage = null;
      context.state = frame?.status === "analyzing" ? "analyzing" : "incomplete";
      emitState();
      // 活跃流识别中仍需超时保护；离散不完整输入不启用。
      if (frame && mode === "stream") armStale();
      else disarmStale();
      return true;
    }

    // 完整分数：更新最近完整快照与渲染目标。setData 的样本身份固定为 local。
    const ordered = SCENT_KEYS.map((key) => input[key] as number);
    context.lastComplete = {
      scores: ordered,
      sampleId: frame?.sampleId ?? "local",
      receivedAt: now,
    };
    context.errorMessage = null;
    // analyzing 流的实时读数照常显示，但状态保持识别中。
    if (frame && frame.status === "analyzing") {
      context.state = "analyzing";
    } else {
      context.state = ordered.every((v) => v === 0) ? "zero" : "ready";
    }
    callbacks.onTarget(ordered, mode);
    emitState();

    // 超时策略：活跃采样流（setFrame + stream）续期；其余路径解除。
    if (frame && mode === "stream") armStale();
    else disarmStale();
    return true;
  }

  function setConnection(event: ConnectionEvent): void {
    if (event === "disconnected") {
      // 断连不是全零：保留最近结果，停止装饰动效与超时计时。
      context.connection = "disconnected";
      disarmStale();
      context.state = "disconnected";
      emitState();
      return;
    }
    if (event === "connected") {
      context.connection = "connected";
      // 恢复连接：按最新有效帧继续显示，等待下一帧重启超时。
      context.state = baseDataState();
      emitState();
      return;
    }
    // ended：一次测量结束，最终结果不因等待而过期。
    context.connection = "unknown";
    disarmStale();
    context.state = baseDataState();
    emitState();
  }

  return { accept, setConnection, getContext: () => ({ ...context }), fireStale, dispose: disarmStale };
}
