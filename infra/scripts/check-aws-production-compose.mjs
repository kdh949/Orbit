import { spawnSync } from "node:child_process";
import fs from "node:fs";

const composeFile = "docker-compose.aws.yml";
const envFile = "infra/aws/ec2-production.env.example";
const bootstrapFile = "infra/aws/main-production-bootstrap.yaml";
const productionEnvFile = ".env.production.example";
const deployScriptFile = "infra/scripts/deploy-aws-ec2.sh";
const deployWorkflowFile = ".github/workflows/deploy-aws-production.yml";
const privateRedisUrl = "redis://private-evidence-redis:6379";
const editorPracticeFlags = [
  "SLIDE_PRACTICE_ENABLED",
  "SLIDE_QUESTION_GUIDES_ENABLED",
];
const failures = [];

function assertContract(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function renderComposeConfig() {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "config",
      "--format",
      "json",
      "--no-env-resolution",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ORBIT_ENV_FILE: envFile,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (result.error || result.status !== 0) {
    failures.push("docker-compose.aws.yml could not be rendered");
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    failures.push("docker-compose.aws.yml did not render as valid JSON");
    return null;
  }
}

function hasCommandPair(command, option, value) {
  if (!Array.isArray(command)) {
    return false;
  }

  const optionIndex = command.indexOf(option);
  return optionIndex >= 0 && command[optionIndex + 1] === value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertTemplateValue(file, key, expectedValue, allowLeadingWhitespace) {
  const content = fs.readFileSync(file, "utf8");
  const prefix = allowLeadingWhitespace ? "\\s*" : "";
  const keyPattern = new RegExp(`^${prefix}${key}=`, "gm");
  const valuePattern = new RegExp(
    `^${prefix}${key}=${escapeRegex(expectedValue)}\\s*$`,
    "gm",
  );
  const keyCount = content.match(keyPattern)?.length ?? 0;
  const valueCount = content.match(valuePattern)?.length ?? 0;

  assertContract(keyCount === 1, `${file} must declare ${key} exactly once`);
  assertContract(valueCount === 1, `${file} must set ${key}=${expectedValue}`);
}

function assertRequiredKey(file, key) {
  const content = fs.readFileSync(file, "utf8");
  const requiredKeysBlock =
    content.match(/required_keys=\(\s*([\s\S]*?)\n\)/)?.[1] ?? "";
  const keyCount =
    requiredKeysBlock.match(new RegExp(`^\\s*${key}\\s*$`, "gm"))?.length ?? 0;

  assertContract(keyCount === 1, `${file} must require ${key} exactly once`);
}

function commandContains(command, value) {
  return Array.isArray(command) && command.join(" ").includes(value);
}

function assertFileContains(file, pattern, message) {
  const content = fs.readFileSync(file, "utf8");
  assertContract(pattern.test(content), message);
}

const config = renderComposeConfig();

if (config) {
  const services = config.services ?? {};
  const privateRedis = services["private-evidence-redis"];

  for (const serviceName of [
    "redis",
    "private-evidence-redis",
    "api",
    "worker",
    "python-worker",
    "nginx",
  ]) {
    assertContract(
      Boolean(services[serviceName]),
      `${serviceName} service is missing`,
    );
  }

  assertContract(
    Boolean(privateRedis),
    "private-evidence-redis service is missing",
  );

  if (privateRedis) {
    assertContract(
      privateRedis.image === "redis:7-alpine",
      "private-evidence-redis must use redis:7-alpine",
    );
    assertContract(
      hasCommandPair(privateRedis.command, "--save", ""),
      "private-evidence-redis must disable RDB persistence",
    );
    assertContract(
      hasCommandPair(privateRedis.command, "--appendonly", "no"),
      "private-evidence-redis must disable AOF persistence",
    );
    assertContract(
      !Array.isArray(privateRedis.volumes) || privateRedis.volumes.length === 0,
      "private-evidence-redis must not mount volumes",
    );
    assertContract(
      !Array.isArray(privateRedis.ports) || privateRedis.ports.length === 0,
      "private-evidence-redis must not publish host ports",
    );
    assertContract(
      Boolean(privateRedis.healthcheck),
      "private-evidence-redis healthcheck is missing",
    );
    assertContract(
      privateRedis.restart === "unless-stopped",
      "private-evidence-redis restart policy is incorrect",
    );
    assertContract(
      privateRedis.logging?.driver === "awslogs",
      "private-evidence-redis must use awslogs",
    );
    assertContract(
      privateRedis.logging?.options?.["awslogs-stream"] ===
        "private-evidence-redis",
      "private-evidence-redis CloudWatch stream is incorrect",
    );
  }

  for (const serviceName of ["api", "worker"]) {
    const service = services[serviceName];
    const environment = service?.environment ?? {};

    assertContract(Boolean(service), `${serviceName} service is missing`);
    assertContract(
      environment.PRIVATE_EVIDENCE_REDIS_URL === privateRedisUrl,
      `${serviceName} must inject PRIVATE_EVIDENCE_REDIS_URL directly`,
    );
    assertContract(
      environment.PRIVATE_EVIDENCE_REDIS_URL !== environment.REDIS_URL,
      `${serviceName} must keep private evidence Redis separate from REDIS_URL`,
    );
    assertContract(
      service?.depends_on?.["private-evidence-redis"]?.condition ===
        "service_healthy",
      `${serviceName} must wait for private-evidence-redis health`,
    );
  }

  assertContract(
    commandContains(services.api?.command, "migration:run"),
    "api must run TypeORM migrations before startup",
  );
  assertContract(
    commandContains(
      services.api?.healthcheck?.test,
      "http://127.0.0.1:3000/health",
    ),
    "api healthcheck must call the direct /health endpoint",
  );
  assertContract(
    commandContains(
      services["python-worker"]?.healthcheck?.test,
      "http://127.0.0.1:8000/health",
    ),
    "python-worker healthcheck must call its direct /health endpoint",
  );
  assertContract(
    commandContains(
      services.nginx?.healthcheck?.test,
      "http://127.0.0.1/api/health",
    ),
    "nginx healthcheck must call the proxied /api/health endpoint",
  );
}

assertTemplateValue(
  envFile,
  "PRIVATE_EVIDENCE_REDIS_URL",
  privateRedisUrl,
  false,
);
assertTemplateValue(
  bootstrapFile,
  "PRIVATE_EVIDENCE_REDIS_URL",
  privateRedisUrl,
  true,
);
assertTemplateValue(
  productionEnvFile,
  "DEMO_AI_DECK_CACHE_ENABLED",
  "false",
  false,
);
assertTemplateValue(
  productionEnvFile,
  "DEMO_AI_DECK_CACHE_ALLOW_PRODUCTION",
  "false",
  false,
);

for (const flag of editorPracticeFlags) {
  assertTemplateValue(productionEnvFile, flag, "true", false);
  assertTemplateValue(envFile, flag, "true", false);
  assertTemplateValue(bootstrapFile, flag, "true", true);
  assertRequiredKey(deployScriptFile, flag);
}

assertFileContains(
  deployScriptFile,
  /"\$\{COMPOSE\[@\]\}" config --quiet/,
  "EC2 deploy script must validate the rendered Compose configuration",
);
assertFileContains(
  deployScriptFile,
  /"\$\{COMPOSE\[@\]\}" run --rm --no-deps api corepack pnpm --filter @orbit\/api migration:run/,
  "EC2 deploy script must run API migrations before replacing application services",
);
assertFileContains(
  deployScriptFile,
  /curl -fsS http:\/\/127\.0\.0\.1:3000\/health/,
  "EC2 deploy script must verify the direct API health endpoint",
);
assertFileContains(
  deployScriptFile,
  /curl -fsS http:\/\/127\.0\.0\.1\/api\/health/,
  "EC2 deploy script must verify the nginx-proxied API health endpoint",
);

const deployWorkflow = fs.readFileSync(deployWorkflowFile, "utf8");
const triggerBlock =
  deployWorkflow.match(/^on:\s*\n([\s\S]*?)^permissions:/m)?.[1] ?? "";
assertContract(
  /^\s{2}workflow_dispatch:\s*$/m.test(triggerBlock),
  "AWS production deploy workflow must keep the manual workflow_dispatch trigger",
);
assertContract(
  /^\s{2}push:\s*\n\s{4}branches:\s*\[main\]\s*$/m.test(triggerBlock),
  "AWS production deploy workflow must deploy automatically from main pushes",
);
assertContract(
  !/^\s{2}(pull_request|schedule):/m.test(triggerBlock),
  "AWS production deploy workflow must not deploy from pull requests or schedules",
);
assertContract(
  deployWorkflow.includes("Ec2InstanceId"),
  "AWS production deploy workflow must resolve the existing EC2 instance",
);
assertContract(
  deployWorkflow.includes("/usr/local/sbin/orbit-deploy-aws-production"),
  "AWS production deploy workflow must invoke the EC2 deployment wrapper",
);
assertContract(
  deployWorkflow.includes("/api/health"),
  "AWS production deploy workflow must verify CloudFront API health",
);

if (failures.length > 0) {
  console.error("EC2 production release contract validation failed:");
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("EC2 production release contract validation passed.");
