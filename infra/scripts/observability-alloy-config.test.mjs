import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const alloyConfigUrl = new URL(
  "../observability/alloy/config.alloy",
  import.meta.url,
);

test("Alloy memory limiter keeps measured staging headroom", async () => {
  const alloy = await readFile(alloyConfigUrl, "utf8");

  assert.match(alloy, /limit\s+=\s+"256MiB"/);
  assert.match(alloy, /spike_limit\s+=\s+"64MiB"/);
  assert.doesNotMatch(alloy, /limit\s+=\s+"128MiB"/);
});
