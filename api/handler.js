// The account check over HTTP: give it a GitHub username and it reads that
// account and says whether it meets the rules.
//
//   GET /api/check/<handle>   the account, checked
//   GET /api/health           whether it is up, and what the token has left
//   GET /api                  what there is
//
// It answers on the page's own port, under /api, as a piece of middleware the
// Vite server and the preview server both mount (see plugin.js). One port,
// one process, one address from outside.
//
// Reading a couple of hundred repositories takes half a minute, longer than a
// browser or a proxy will hold a connection open, so the first ask starts the
// check and answers 202 with how far it has got. Ask again — every second or
// two — until it answers 200 with the result. Everyone asking about the same
// handle rides the same run, and the answer is kept for an hour.
//
// One check runs at a time. The requests behind it are heavy enough that
// GitHub turns them away past about forty a minute, and there is one token
// for everybody, so the checks stand in a queue and each one says where in it
// it is.
//
// Needs a token, GITHUB_TOKEN or `gh auth token`. No dependencies.
import { check, left, token } from "./account.js";

// How long an answer stands. An account moves slowly, and the same person
// asking twice in an afternoon costs nothing the second time.
const KEEP_MS = 60 * 60 * 1000;
// And a failure, which is usually GitHub having a moment: long enough not to
// hammer it, short enough that a person can try again.
const KEEP_ERROR_MS = 60 * 1000;
// Answers held in memory. Each is a few hundred repositories at most.
const ANSWERS = 500;
// Checks waiting to run. Past this the door is closed rather than promising
// an answer an hour from now.
const QUEUE = 20;
// New checks one address may start in an hour. Asking again about a check
// already running is free, so a page may poll as it likes.
const PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

// What has been asked, and what came back
// -----------------------------------------------------------------------------

// handle -> { at, report | error | unknown }
const answers = new Map();
// handle -> { started, read, of } for the checks running or waiting
const running = new Map();
// The handles waiting, in the order they were asked for; the first is the one
// running now.
const queue = [];
// address -> the times it started a check, this hour
const starts = new Map();

const fresh = (answer) => Date.now() - answer.at < (answer.error ? KEEP_ERROR_MS : KEEP_MS);

const remember = (handle, answer) => {
  answers.set(handle, { ...answer, at: Date.now() });
  // The oldest answers go first; Map keeps the order they were put in.
  while (answers.size > ANSWERS) answers.delete(answers.keys().next().value);
};

// One check after another. Each waits for the one before it, so the queue is
// the promise chain and the array beside it is what to tell whoever asks.
let chain = Promise.resolve();

const start = (handle) => {
  const state = { started: Date.now(), read: 0, of: null };
  running.set(handle, state);
  queue.push(handle);
  chain = chain.then(async () => {
    try {
      const report = await check(handle, {
        onProgress: ({ read, of }) => {
          state.read = read;
          state.of = of;
        },
      });
      remember(handle, report === null ? { unknown: true } : { report });
    } catch (error) {
      console.error(`${handle}: ${error.message}`);
      remember(handle, { error: error.message });
    } finally {
      running.delete(handle);
      queue.splice(queue.indexOf(handle), 1);
    }
  });
  return state;
};

const allowed = (address) => {
  const now = Date.now();
  const times = (starts.get(address) ?? []).filter((at) => now - at < HOUR_MS);
  if (times.length >= PER_HOUR) {
    starts.set(address, times);
    return false;
  }
  times.push(now);
  starts.set(address, times);
  // Addresses that have not asked for an hour are forgotten, so the map does
  // not grow with everyone who has ever asked.
  if (starts.size > 10000) {
    for (const [each, when] of starts) if (when.every((at) => now - at >= HOUR_MS)) starts.delete(each);
  }
  return true;
};

// A token that is not there is worth hearing about at the start and not on
// the first check; but the page it now shares a port with must still be
// served, so the check says it is unavailable rather than the process ending.
let tokenError = null;
export const ready = () => {
  try {
    token();
    tokenError = null;
  } catch (error) {
    tokenError = error.message;
  }
  return tokenError;
};

// Answering
// -----------------------------------------------------------------------------

const send = (request, response, status, body, headers = {}) => {
  const text = JSON.stringify(body, null, 2) + "\n";
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    // The list is public and so is the check; anyone's page may ask it.
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(request.method === "HEAD" ? undefined : text);
};

const checked = (request, response, handle) => {
  const answer = answers.get(handle);
  if (answer && fresh(answer)) {
    if (answer.unknown) return send(request, response, 404, { status: "unknown", handle, error: "no such user on GitHub" });
    if (answer.error) {
      // A token GitHub will not take is the check being off, the same as
      // having no token at all, and is answered the same way; anything else
      // is GitHub itself, which is worth asking again in a moment.
      const off = /token was refused|needs a token/i.test(answer.error);
      return send(request, response, off ? 503 : 502, { status: "error", handle, error: answer.error },
        off ? { "retry-after": "60" } : {});
    }
    // An answer that stands is worth keeping at the browser too, for as long
    // as it has left here.
    const age = Math.round((Date.now() - answer.at) / 1000);
    return send(request, response, 200, { status: "done", ...answer.report }, {
      "cache-control": `public, max-age=${Math.max(0, Math.round(KEEP_MS / 1000) - age)}`,
    });
  }
  if (answer) answers.delete(handle);

  let state = running.get(handle);
  if (!state) {
    if (queue.length >= QUEUE) {
      return send(request, response, 503, { status: "busy", handle, error: "too many checks waiting; try again in a minute" },
        { "retry-after": "60" });
    }
    const address = (request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() ||
      request.socket.remoteAddress || "unknown";
    if (!allowed(address)) {
      return send(request, response, 429, { status: "error", handle, error: `${PER_HOUR} checks an hour from one address` },
        { "retry-after": "600" });
    }
    state = start(handle);
  }
  const waiting = Math.max(0, queue.indexOf(handle));
  send(request, response, 202, {
    status: "running",
    handle,
    read: state.read,
    of: state.of,
    waiting,
    seconds: Math.round((Date.now() - state.started) / 1000),
  }, { "retry-after": "2" });
};

// Everything under /api; everything else is the page, and goes on past.
export default function api(request, response, next) {
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/api" && !path.startsWith("/api/")) return next();

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-max-age": "86400",
    });
    return response.end();
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return send(request, response, 405, { status: "error", error: "GET only" }, { allow: "GET, HEAD, OPTIONS" });
  }

  if (path === "/api") {
    return send(request, response, 200, {
      check: "/api/check/<handle>",
      health: "/api/health",
      about: "https://github.com/lhypds/heroes",
    });
  }
  if (path === "/api/health") {
    return send(request, response, 200, {
      status: tokenError ? "no token" : "ok",
      checking: queue.length,
      answers: answers.size,
      requestsLeftThisHour: left(),
    });
  }

  const asked = path.startsWith("/api/check/") ? decodeURIComponent(path.slice("/api/check/".length)) : null;
  if (asked === null) return send(request, response, 404, { status: "error", error: "no such address" });
  const handle = asked.trim().toLowerCase();
  if (!HANDLE.test(handle)) {
    return send(request, response, 400, { status: "error", handle: asked, error: "not a GitHub username" });
  }
  if (tokenError) {
    return send(request, response, 503, { status: "error", handle, error: tokenError }, { "retry-after": "60" });
  }
  checked(request, response, handle);
}
