import http from "k6/http";
import encoding from "k6/encoding";
import { check } from "k6";
import {
  handleLoadSummary,
  jsonHeaders,
  profile,
  scenarioOptions,
} from "./common.js";

if (!__ENV.PROJECT_ID) throw new Error("PROJECT_ID is required.");
const png = encoding.b64decode(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "std",
);
if (png.byteLength > 1024)
  throw new Error("The built-in load-test asset must remain <= 1KiB.");

export const options = {
  scenarios: { file_round_trip: scenarioOptions() },
  thresholds: {
    checks: ["rate>0.99"],
    dropped_iterations: ["count==0"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const root = `${profile.baseUrl}/api/v1/projects/${encodeURIComponent(__ENV.PROJECT_ID)}/assets`;
  const request = http.post(
    `${root}/upload-url`,
    JSON.stringify({
      originalName: "load-smoke.png",
      mimeType: "image/png",
      size: png.byteLength,
      purpose: "reference-material",
    }),
    { headers: jsonHeaders(), tags: { operation: "file-upload-url" } },
  );
  if (
    !check(request, {
      "upload URL was issued": (value) => value.status === 201,
    })
  )
    return;
  const fileId = request.json("fileId");
  const uploadUrl = request.json("uploadUrl");
  const uploadHeaders = request.json("headers") || {};
  const uploaded = http.put(uploadUrl, png, {
    headers: uploadHeaders,
    tags: { operation: "file-upload" },
  });
  if (
    !check(uploaded, {
      "file upload succeeded": (value) => [200, 204].includes(value.status),
    })
  )
    return;
  const completed = http.post(`${root}/complete`, JSON.stringify({ fileId }), {
    headers: jsonHeaders(),
    tags: { operation: "file-complete" },
  });
  if (
    !check(completed, {
      "file completion succeeded": (value) => value.status === 201,
    })
  )
    return;
  const downloaded = http.get(`${root}/${encodeURIComponent(fileId)}/content`, {
    headers: jsonHeaders(),
    responseType: "binary",
    tags: { operation: "file-download" },
  });
  check(downloaded, {
    "file download matched": (value) =>
      value.status === 200 && value.body.byteLength === png.byteLength,
  });
}

export const handleSummary = handleLoadSummary;
