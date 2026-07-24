# ECS single-AZ cutover runbook

## Scope and safety boundary

- ALB requires public subnets in two AZs. Only the public ALB subnet is multi-AZ; NAT, ECS tasks, Redis nodes, and RDS compute stay in `ap-northeast-2a`.
- The existing EC2 path, local Redis volume, CloudFront distribution, and legacy target group stay intact for seven days after ECS reaches 100%.
- No runbook step prints a secret, cookie, Redis value, raw audio, or transcript. Confirm only secret existence and configuration references.
- `infra/aws/main-production-bootstrap.yaml` continues to own the existing EC2/RDS/CloudFront resources. Do not import, replace, or delete them in the new stacks.

## Pre-change readiness gate

- Do not create or execute a Change Set with an AWS account root session. Configure separate least-privilege GitHub OIDC roles in repository variables `AWS_INFRA_PLAN_ROLE_ARN` and `AWS_INFRA_APPLY_ROLE_ARN`; the apply job remains behind the `production` environment approval, and the Apply role trust must accept only the repository's `production` environment OIDC subject.
- Run `Plan AWS infrastructure` only from `refs/heads/main`. The Plan role trust must require `aud=sts.amazonaws.com` and exact subject `repo:na-man-mu-303-team2/Orbit:ref:refs/heads/main`; never allow `repo:na-man-mu-303-team2/Orbit:*`. Pull-request static validation has no `id-token: write` permission and cannot assume the Plan role.
- Configure repository variable `AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN` with a dedicated role trusted only by `cloudformation.amazonaws.com`. The Plan workflow must pass this role with `create-change-set --role-arn`. `DescribeChangeSet` does not return the role ARN, so the role boundary is enforced at Change Set creation through the Plan role's exact `iam:PassRole` scope, not by parsing the review artifact. Do not define an environment-level variable with the same name.
- Keep GitHub roles and the CloudFormation execution role separate. The Plan role receives only its required CloudFormation control-plane actions and `iam:PassRole` scoped to the exact execution role with `iam:PassedToService=cloudformation.amazonaws.com`. The Apply role receives only the actions needed to describe and execute the reviewed Change Set and observe completion; resource provisioning permissions belong only to the execution role.
- Configure repository variable `AWS_ECR_PUBLISH_ROLE_ARN` as a separate main-branch image publishing role. It must not reuse the Plan, Apply, or CloudFormation execution role.
- Confirm `origin.tryorbit.site` has an issued ACM certificate in `ap-northeast-2`. The existing CloudFront certificate in `us-east-1` cannot terminate the regional ALB listener.
- Confirm the Route 53 public hosted zone and the regional `com.amazonaws.global.cloudfront.origin-facing` managed prefix list exist. Pass the hosted zone ID and prefix-list ID as identifiers; never put DNS or verification secret values in workflow inputs.
- Before the shared-services Change Set, create the queue Redis and private-evidence Redis AUTH secrets. Before the compute Change Set, create the origin-verification secret and a customer-managed-KMS-encrypted application runtime secret. Check only resource existence and required JSON key names; never print values.
- Confirm the existing private-audio bucket ARN, runtime policy ARN, `raw/` 14-day lifecycle, `evidence/` 7-day lifecycle, and public-access block. ECR repositories and managed Redis are expected additions in the shared-services Change Set.
- Verify `PublicSubnetBCidr` and `PrivateAppSubnetACidr` do not overlap existing VPC subnets, then validate all three templates with CloudFormation before opening a Change Set.
- Record the retained bootstrap stack's `Ec2SecurityGroupId` and `RdsSecurityGroupId` outputs. Pass them to the compute stack as `LegacyEc2SecurityGroupId` and `RdsSecurityGroupId`; the compute stack owns only the additive ALB-to-EC2 port 80 and ECS-to-RDS port 5432 ingress rules.

## Required approval evidence

1. Record the current application SHA, RDS manual snapshot ID, CloudFront distribution configuration export, and current stack template in the production change record.
2. After the reviewed release commit is on `main`, run `Plan AWS infrastructure` from `refs/heads/main`; record the successful workflow run and use only the Change Set ARN produced by that run. Confirm the change set contains no replacement or deletion of `AWS::RDS::DBInstance`, `AWS::S3::Bucket`, `AWS::CloudFront::Distribution`, or `AWS::EC2::Instance`.
   A protected `Modify` is safe only when CloudFormation reports `Replacement: False`; `True`, `Conditional`, and missing replacement evidence are blocked.
3. Apply a reviewed change set only through `Apply AWS infrastructure`, protected by GitHub environment `production` approval.
4. Deploy `edge-waf-count-mode.yaml` in `us-east-1`, retain Count mode for at least 24 hours, and verify that WAF logging redacts `cookie`, `authorization`, and the origin verification header before a separate Block-mode PR.

## Build and candidate verification

1. Let `Build and push images` copy the exact `main` SHA manifest to ECR and record immutable `@sha256` digests. Supply only those digests to the ECS compute change set.
2. Create the shared-services stack additively: private app subnet A, NAT, S3 gateway endpoint, two TLS Redis nodes, and ECR repositories. Pass the retained production storage stack's private-audio bucket ARN and runtime policy ARN; this stack must not create or replace that bucket.
3. Keep `S3_PRIVATE_AUDIO_BUCKET` empty on EC2 and set it only on ECS tasks after the existing policy is attached. New raw audio keys start with `raw/`, evidence derivatives start with `evidence/`, and prefixless legacy audio remains readable from the assets bucket. Verify the existing 14-day raw and 7-day evidence lifecycle rules before traffic shift.
4. Treat the existing bucket's SSE-S3 encryption as current state. SSE-KMS hardening requires a separate reviewed update to the storage-owning stack; do not silently replace or import the bucket during this cutover.
5. Deploy the ECS compute stack with ALB weights EC2 `100`, ECS `0`. Confirm the stack created the ECS-client-to-RDS and ALB-to-legacy-EC2 ingress rules, and that API runtime config reports slide practice and slide question guides enabled. Use a candidate CloudFront distribution for login, Deck save, OOXML sync, export, AI deck, rehearsal audio, legacy audio read, Socket.IO presence, and AI/STT/OCR job smoke tests.
6. In the retained bootstrap stack Change Set, set `ApplicationOriginDomainName` only after the ALB candidate is healthy. The API, auth, and Socket.IO behaviors then use CloudFront `AllViewerExceptHostHeader`, so the origin receives `origin.tryorbit.site` while existing direct-EC2 operation keeps `AllViewer`.
7. Run migrations as one one-off ECS API task from the immutable API digest. Never run migrations from API service startup. During the seven-day rollback window, permit expand-only schema changes; do not automate migration revert.

## Worker handoff and traffic ramp

1. Set `ASYNC_JOB_ADMISSION_MODE=drain` through the approved runtime secret update.
2. Confirm queue and database active counts are zero using read-only operational queries; do not dump values into logs.
3. Replace the ECS Worker task, then resume admission with `accept`. Keep the EC2 Worker in standby until the ECS worker completes smoke verification.
4. Update ALB weights in the reviewed change set: ECS `5%` for 15 minutes, `25%` for 30 minutes, `50%` for 60 minutes, then `100%` for 24 hours. Target-group and target stickiness remain enabled throughout Socket.IO polling.
5. At every stage inspect ALB 5xx, API p95, healthy target count, Job failure/delay, Redis eviction, RDS connections, Socket.IO presence, private audio reads, and legacy audio fallback.

## Abort and rollback

Immediately return ALB weight to EC2 `100` when any of these holds: ALB 5xx is at least 2% for five minutes, ECS healthy target count is zero, new Job failures materially spike, or Redis eviction is observed.

1. ALB rollback: update only target group weights to EC2 `100`, ECS `0`.
2. Worker rollback: drain admission, stop ECS Worker, re-enable EC2 Worker, then resume admission.
3. ALB outage: execute the pre-reviewed CloudFront origin rollback change set to point directly to EC2.
4. Managed Redis outage: only after stopping API writes, copy key/TTL state back to the retained local Redis. Do not delete managed Redis as a recovery action.
5. WAF false positive: detach the WebACL or move the affected rule back to Count mode.

Do not roll back application code before the PR #640 runtime fixes: the safe rollback floor is the fixed version that understands private-audio routing. After seven clean days, remove EC2, local Redis, candidate distribution, and legacy target resources only in a separately approved PR.
