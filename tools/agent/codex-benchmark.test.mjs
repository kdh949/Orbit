import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexJsonl } from "./codex-benchmark.mjs";

test("Codex JSONL에서 token과 첫 patch 이전 탐색 지표만 집계한다", () => {
  const output = [
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "rg -n retry apps/web/src/runtime/speech/stt/example.ts",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "apply_patch apps/web/src/runtime/speech/stt/example.ts",
      },
    },
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "pnpm turbo run test --filter=@orbit/web -- example.test.ts",
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 40,
        output_tokens: 30,
        reasoning_tokens: 20,
      },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");

  const result = parseCodexJsonl(output);

  assert.deepEqual(result.usage, {
    inputTokens: 120,
    cachedInputTokens: 40,
    outputTokens: 30,
    reasoningTokens: 20,
  });
  assert.equal(result.metrics.filesReadBeforeFirstPatch, 1);
  assert.equal(result.metrics.searchCallsBeforeFirstPatch, 1);
  assert.equal(result.metrics.toolCallsBeforeFirstTargetedTest, 3);
  assert.deepEqual(result.metrics.workspacesVerified, ["web"]);
});
