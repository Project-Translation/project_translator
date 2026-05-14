import { expect } from "chai";
import { diagnoseOpenAIAbortError } from "../../services/openaiAbortDiagnosis";

describe("diagnoseOpenAIAbortError", () => {
  it("returns null for non-abort errors", () => {
    const result = diagnoseOpenAIAbortError(new Error("boom"), {
      elapsedMs: 1000,
      configuredTimeoutMs: 30000,
    });

    expect(result).to.eq(null);
  });

  it("classifies cancellation-triggered aborts", () => {
    const error = new Error("Request was aborted.");
    const result = diagnoseOpenAIAbortError(error, {
      cancellationRequested: true,
      vendorName: "cliproxyapi",
      model: "test-model",
      sourcePath: "/tmp/a.md",
    });

    expect(result).to.include("取消令牌已触发");
    expect(result).to.include("file=a.md");
  });

  it("classifies near-timeout aborts as timeout-driven", () => {
    const error = new Error("Request was aborted.");
    const result = diagnoseOpenAIAbortError(error, {
      elapsedMs: 30021,
      configuredTimeoutMs: 30000,
      vendorName: "cliproxyapi",
    });

    expect(result).to.not.eq(null);
    expect(result!).to.include("timeout=30000ms");
    expect(result!).to.include("超时触发");
  });

  it("classifies early aborts as likely upstream disconnects", () => {
    const error = new Error("Request was aborted.");
    const result = diagnoseOpenAIAbortError(error, {
      elapsedMs: 11234,
      configuredTimeoutMs: 30000,
      model: "openrouter/model",
    });

    expect(result).to.not.eq(null);
    expect(result!).to.include("提前中止");
    expect(result!).to.include("主动断开了连接");
  });
});
