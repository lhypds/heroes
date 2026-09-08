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
      },
    },
  ],
};
