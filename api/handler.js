// The account check over HTTP: give it a GitHub username and it reads that
// account and says whether it meets the rules. An account is a person or an
// organisation, and several separated by commas are read as one.
//
//   GET /api/check/<handle>            the account, checked
//   GET /api/check/<handle,handle…>    several accounts, counted together
//   GET /api/health                    whether it is up, and what the token has left
//   GET /api                           what there is
//
// It answers on the page's own port, under /api, as a piece of middleware the
// Vite server and the preview server both mount (see plugin.js). One port,
// one process, one address from outside.
//
// Reading a couple of hundred repositories takes half a minute, longer than a
// browser or a proxy will hold a connection open, so the first ask starts the
// check and answers 202 with how far it has got. Ask again — every second or
// two — until it answers 200 with the result. Everyone asking about the same
// accounts rides the same run, and the answer is kept for an hour.
//
// One check runs at a time. The requests behind it are heavy enough that
// GitHub turns them away past about forty a minute, and there is one token
// for everybody, so the checks stand in a queue and each one says where in it
// it is.
//
// Needs a token, GITHUB_TOKEN or `gh auth token`. No dependencies.
import { check, handles, left, NoSuchAccount, token } from "./account.js";

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
// New accounts one address may start reading in an hour. A check of three
// accounts is three of them, since it is three accounts' worth of work.
// Asking again about a check already running is free, so a page may poll as it
// likes.
const PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

// What has been asked, and what came back
// -----------------------------------------------------------------------------

// A check is named by the accounts it reads, in one string. Sorted, so the
// same accounts asked for in another order ride the same run and the same
// answer; what is read is the same either way.
const naming = (logins) => [...logins].sort().join(",");

// key -> { at, report | error | unknown }
const answers = new Map();
// key -> { started, read, of, account, index, accounts } for the checks
// running or waiting
const running = new Map();
// The keys waiting, in the order they were asked for; the first is the one
// running now.
const queue = [];
// address -> the times it started a check, this hour
const starts = new Map();

const fresh = (answer) => Date.now() - answer.at < (answer.error ? KEEP_ERROR_MS : KEEP_MS);

const remember = (key, answer) => {
  answers.set(key, { ...answer, at: Date.now() });
  // The oldest answers go first; Map keeps the order they were put in.
  while (answers.size > ANSWERS) answers.delete(answers.keys().next().value);
};

// One check after another. Each waits for the one before it, so the queue is
// the promise chain and the array beside it is what to tell whoever asks.
let chain = Promise.resolve();

const start = (key, logins) => {
  const state = { started: Date.now(), read: 0, of: null, account: logins[0], index: 1, accounts: logins.length };
  running.set(key, state);
  queue.push(key);
  chain = chain.then(async () => {
    try {
      const report = await check(logins, {
        onProgress: ({ read, of, account, index }) => {
          state.read = read;
          state.of = of;
          state.account = account;
          state.index = index;
        },
      });
      remember(key, { report });
    } catch (error) {
      // A handle nobody has is not a failure of the check; it is an answer,
      // and it names which of the accounts asked for was not there.
      if (error instanceof NoSuchAccount) remember(key, { unknown: error.handle });
      else {
        console.error(`${key}: ${error.message}`);
        remember(key, { error: error.message });
      }
    } finally {
      running.delete(key);
      queue.splice(queue.indexOf(key), 1);
    }
  });
  return state;
};

// Whether this address may start reading `cost` more accounts this hour.
const allowed = (address, cost) => {
  const now = Date.now();
  const times = (starts.get(address) ?? []).filter((at) => now - at < HOUR_MS);
  if (times.length + cost > PER_HOUR) {
    starts.set(address, times);
    return false;
  }
  for (let i = 0; i < cost; i++) times.push(now);
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

const checked = (request, response, key, logins) => {
  const answer = answers.get(key);
  if (answer && fresh(answer)) {
    if (answer.unknown) {
      return send(request, response, 404, {
        status: "unknown",
        handle: answer.unknown,
        error: `no such account on GitHub: ${answer.unknown}`,
      });
    }
    if (answer.error) {
      // A token GitHub will not take is the check being off, the same as
      // having no token at all, and is answered the same way; anything else
      // is GitHub itself, which is worth asking again in a moment.
      const off = /token was refused|needs a token/i.test(answer.error);
      return send(request, response, off ? 503 : 502, { status: "error", handles: logins, error: answer.error },
        off ? { "retry-after": "60" } : {});
    }
    // The answer stands for an hour, but here and not in the browser. What it
    // holds is shaped by the code that answered, and a deployment changes that
    // shape while a browser would go on handing the old one to the new page —
    // which is a field the page reads and does not find. It is already in
    // memory, so asking again costs a round trip and nothing else.
    return send(request, response, 200, { status: "done", ...answer.report });
  }
  if (answer) answers.delete(key);

  let state = running.get(key);
  if (!state) {
    if (queue.length >= QUEUE) {
      return send(request, response, 503, { status: "busy", handles: logins, error: "too many checks waiting; try again in a minute" },
        { "retry-after": "60" });
    }
    const address = (request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() ||
      request.socket.remoteAddress || "unknown";
    if (!allowed(address, logins.length)) {
      return send(request, response, 429, { status: "error", handles: logins, error: `${PER_HOUR} accounts an hour from one address` },
        { "retry-after": "600" });
    }
    state = start(key, logins);
  }
  const waiting = Math.max(0, queue.indexOf(key));
  send(request, response, 202, {
    status: "running",
    handles: logins,
    read: state.read,
    of: state.of,
    // Which account is being read, and which of how many it is; one account
    // says the same thing and the page says nothing about it.
    account: state.account,
    index: state.index,
    accounts: state.accounts,
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
      several: "/api/check/<handle,handle…>",
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
  let logins;
  try {
    logins = handles(asked);
  } catch (error) {
    // Either the name is not a name or there are too many of them; `reason`
    // says which in a word, for whoever answers in another language.
    return send(request, response, 400, { status: "error", asked, reason: error.reason, error: error.message });
  }
  if (tokenError) {
    return send(request, response, 503, { status: "error", handles: logins, error: tokenError }, { "retry-after": "60" });
  }
  checked(request, response, naming(logins), logins);
}
