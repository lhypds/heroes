// The account check, mounted on the page's own server. Vite serves the page
// and this serves /api, on one port: `npm run dev` and `npm run preview` both
// answer the check, and there is nothing to proxy and no second process.
import api, { ready } from "./handler.js";

// GITHUB_TOKEN is read from the environment by api/account.js. Vite loads
// .env itself and does not put it there, so what it loaded is passed on;
// anything already in the environment wins, as PM2's does.
export default function apiPlugin(env = {}) {
  return {
    name: "heroes-api",
    configureServer: (server) => mount(server, env),
    configurePreviewServer: (server) => mount(server, env),
  };
}

const mount = (server, env) => {
  if (!process.env.GITHUB_TOKEN && env.GITHUB_TOKEN) process.env.GITHUB_TOKEN = env.GITHUB_TOKEN;
  const problem = ready();
  if (problem) console.error(`the check at /api is off: ${problem}`);
  server.middlewares.use(api);
};
