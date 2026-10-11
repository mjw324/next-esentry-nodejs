import { defineRailway, github, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "next-esentry-nodejs";
export default defineRailway(() => {
  const nextEsentryNodejs = service("next-esentry-nodejs", {
    source: github("mjw324/next-esentry-nodejs", { branch: "main" }),
    // Set explicitly: the dashboard setting is NIXPACKS, which railway.json used to override.
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 300,
    // Platform default is 10 retries; keep the 3 from railway.json.
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 3 },
    replicas: { "us-east4-eqdc4a": 1 },
    domains: ["api.esentry.dev"],
  });

  return project("vivacious-luck", {
    variables: { managed: false },
    resources: [nextEsentryNodejs],
  });
});
