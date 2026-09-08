const fs = require("fs");
const path = require("path");

const env = {};
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) env[match[1]] = (match[2] || "").trim();
  }
}

const PORT = env.PORT || "4173";
const PM2_NAME = env.PM2_NAME || "heroes";

// One process on one port. The page is served by `vite preview`, and the
// account check rides along on the same server under /api (api/plugin.js), so
// there is nothing else to start and nothing to proxy.
module.exports = {
  apps: [
    {
      name: PM2_NAME,
      script: "npm",
      args: `run preview -- --host --port ${PORT}`,
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        // What the check reads GitHub with. `gh auth token` is not there for
        // the process PM2 starts, so it comes from .env.
        GITHUB_TOKEN: env.GITHUB_TOKEN || "",
      },
    },
  ],
};
