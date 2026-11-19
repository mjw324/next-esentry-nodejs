import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "next-esentry-nodejs";
export default defineRailway(() => {
  const nextEsentryNodejs = service("next-esentry-nodejs", {
    source: github("mjw324/next-esentry-nodejs", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 300,
    // Restart policy type is Railway's default (ON_FAILURE); only the retry cap is set.
    deploy: { restartPolicyMaxRetries: 3 },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["api.esentry.dev"],
  });

  return project("vivacious-luck", {
    variables: { managed: false },
    resources: [nextEsentryNodejs],
  });
});
