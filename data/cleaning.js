#!/usr/bin/env node
// Cleans data/crawl.db of people the crawl kept who are plainly not heroes,
// in steps. Whoever is removed is written to data/cleaning/step<n>.json, one
// file a step, with everything the crawl knew about them and the reason.
//
//   node data/cleaning.js            step 1, then step 2
//   node data/cleaning.js --step1    empty profiles: no name, no location, no
//                                    website and no followers
//   node data/cleaning.js --step2    too few commits: under ten a repository
//                                    on average, over the first hundred
//   node data/cleaning.js --repos 25 over the first twenty-five instead
//   node data/cleaning.js --dry      count, and say who would go; remove nobody
//   node data/cleaning.js alice bob  only these people, whatever their state
//   node data/cleaning.js --report   how many are left, how many went and why
//   node data/cleaning.js --export   write the JSON files again from the database
//
// Step 1 is a query on the database. Step 2 asks GitHub, one person to a
// request, for the commits on the default branch of their most recently
// pushed repositories of their own, a hundred unless --repos says otherwise;
// the count and how many repositories it covers are saved on the person, so
// a run cut short carries on where it left off, and under ten a repository
// they go.
//
// These are heavy requests. GitHub gives one ten seconds, and a hundred
// repositories take about nine, so a person GitHub cannot manage is asked
// for fifty at a time, then twenty-five, then ten. And GitHub allows only
// so much of its own time a minute before turning requests away for five,
// so the gate here keeps the time of the last minute's answers and holds
// until it is under a budget it finds by feel. Measured: ten people a
// minute with a hundred repositories each, three or four days for everyone
// the crawl found; --repos 25 is about twice as fast, --repos 10 five times.
//
// Needs a token, GITHUB_TOKEN in the environment or in .env, or `gh auth
// token`, and Node.js 22.13 or later for node:sqlite. No dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name !== "ExperimentalWarning") console.error(warning.stack);
});

const DB = fileURLToPath(new URL("./crawl.db", import.meta.url));
const OUT = fileURLToPath(new URL("./cleaning/", import.meta.url));
const ENV = fileURLToPath(new URL("../.env", import.meta.url));

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? Number(args[at + 1]) : fallback;
};
const handles = args
  .filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--repos")
  .map((handle) => handle.toLowerCase());
const DRY = flag("dry");
const REPORT = flag("report");
const EXPORT = flag("export");
const STEP1 = flag("step1") || (!flag("step2") && !REPORT && !EXPORT);
const STEP2 = flag("step2") || (!flag("step1") && !REPORT && !EXPORT);

// Step 2's bar: ten commits a repository on average, over the first SAMPLE.
const SAMPLE = option("repos", 100);
const PER_REPO = 10;
// Repositories to a request, and what to fall back to when GitHub times out.
const PAGES = [100, 50, 25, 10];

// The gate: GitHub's time answering, over the last minute, is kept under a
// budget; a few requests in flight at most, and a moment between them. How
// much of that time GitHub counts is not said, so the budget is found by
// feel: cut by a third whenever GitHub turns a request away, grown a tenth
// after ten clean minutes.
const BUDGET_MS = 120000;
const BUDGET_MIN_MS = 30000;
const BUDGET_MAX_MS = 240000;
const CLEAN_MS = 600000;
const WINDOW_MS = 60000;
const IN_FLIGHT = 3;
// And no more than thirty a minute whatever their weight, like the crawl.
const PACE_MS = 2000;
const WORKERS = 6;
const TIMEOUT_MS = 30000;
const RETRIES = 5;
const API = "https://api.github.com/graphql";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
};
const show = process.stdout.isTTY ? (line) => process.stdout.write(`\r\x1b[K${line}`) : () => {};
const done = process.stdout.isTTY ? () => process.stdout.write("\r\x1b[K") : () => {};

// The database
// -----------------------------------------------------------------------------

if (!existsSync(DB)) {
  console.error("no data/crawl.db; run the crawl first");
  process.exit(1);
}
const db = new DatabaseSync(DB);
db.exec("PRAGMA journal_mode = WAL");
// The crawl's people table gains two columns: commits in the first
// repositories, and how many repositories that covers; empty until step 2.
const columns = db.prepare("PRAGMA table_info(people)").all().map((column) => column.name);
if (!columns.includes("commits")) db.exec("ALTER TABLE people ADD COLUMN commits INTEGER");
if (!columns.includes("checked")) db.exec("ALTER TABLE people ADD COLUMN checked INTEGER");
db.exec(`
  CREATE TABLE IF NOT EXISTS removed (
    login TEXT PRIMARY KEY,
    step INTEGER NOT NULL,
    reason TEXT NOT NULL,
    removed_at TEXT NOT NULL,
    person TEXT NOT NULL             -- the row as it was, as JSON, with the reason
  );
`);

const sql = {
  empty: db.prepare(`SELECT * FROM people
    WHERE name IS NULL AND location IS NULL AND website IS NULL AND followers = 0 ORDER BY rowid`),
  uncounted: db.prepare("SELECT login FROM people WHERE commits IS NULL OR checked < ? ORDER BY rowid"),
  short: db.prepare("SELECT * FROM people WHERE commits IS NOT NULL AND commits < checked * ? ORDER BY rowid"),
  person: db.prepare("SELECT * FROM people WHERE login = ?"),
  counted: db.prepare("UPDATE people SET commits = ?, checked = ? WHERE login = ?"),
  remove: db.prepare("DELETE FROM people WHERE login = ?"),
  removed: db.prepare("INSERT OR REPLACE INTO removed (login, step, reason, removed_at, person) VALUES (?, ?, ?, ?, ?)"),
  exported: db.prepare("SELECT person FROM removed WHERE step = ? ORDER BY rowid"),
  steps: db.prepare("SELECT step, count(*) AS n FROM removed GROUP BY step ORDER BY step"),
  totals: db.prepare(`SELECT count(*) AS people, count(commits) AS counted,
    sum(commits >= checked * ?) AS enough, sum(commits < checked * ?) AS short FROM people`),
};

// Takes a person out, and remembers them under the step and the reason.
const remove = (person, step, reason) => {
  const record = { ...person, step, reason, removed_at: today() };
  sql.removed.run(person.login, step, reason, record.removed_at, JSON.stringify(record));
  sql.remove.run(person.login);
};

// Writes data/cleaning/step<n>.json from the database.
const exportStep = (step) => {
  const people = sql.exported.all(step).map((row) => JSON.parse(row.person));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}step${step}.json`, JSON.stringify(people, null, 2) + "\n");
  console.log(`data/cleaning/step${step}.json: ${people.length} people`);
};

// GitHub
// -----------------------------------------------------------------------------

const token = () => {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (existsSync(ENV)) {
    const line = readFileSync(ENV, "utf8").split("\n").find((line) => /^GITHUB_TOKEN=.+/.test(line));
    if (line) return line.slice("GITHUB_TOKEN=".length).trim();
  }
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    console.error("needs a token: set GITHUB_TOKEN, put it in .env, or sign in with `gh auth login`");
    process.exit(1);
  }
};

let TOKEN = null;
let remaining = null;

// Commits on the default branch of a page of a person's own repositories,
// most recently pushed first.
const REPOS = (first) => `query($login: String!, $after: String) {
  rateLimit { remaining }
  user(login: $login) {
    repositories(first: ${first}, after: $after, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER,
                 orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { defaultBranchRef { target { ... on Commit { history { totalCount } } } } }
    }
  }
}`;

let nextStart = 0;
let inFlight = 0;
let budget = BUDGET_MS;
let lastLimited = 0;
let lastGrown = Date.now();
const answered = []; // [when, how long] of the last minute's requests

const spentLately = () => {
  const since = Date.now() - WINDOW_MS;
  while (answered.length > 0 && answered[0][0] < since) answered.shift();
  return answered.reduce((sum, [, ms]) => sum + ms, 0);
};

const gate = async () => {
  for (;;) {
    const wait = Math.max(
      nextStart - Date.now(),
      inFlight >= IN_FLIGHT ? 500 : 0,
      spentLately() > budget ? 1000 : 0,
    );
    if (wait <= 0) break;
    await sleep(wait);
  }
  if (budget < BUDGET_MAX_MS && Date.now() - Math.max(lastLimited, lastGrown) > CLEAN_MS) {
    budget = Math.min(BUDGET_MAX_MS, Math.round(budget * 1.1));
    lastGrown = Date.now();
  }
  nextStart = Date.now() + PACE_MS;
  inFlight++;
};

const release = (started) => {
  inFlight--;
  answered.push([Date.now(), Date.now() - started]);
};

// One request, retried on failures of GitHub's or the network's. A 5xx is
// given up on after one more try unless `patient`: for these queries it is
// GitHub's ten seconds running out, and a smaller page is the answer.
const graphql = async (query, variables, { patient = false } = {}) => {
  for (let attempt = 1; ; attempt++) {
    await gate();
    const started = Date.now();
    let response = null;
    let json = null;
    let failed = null;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: {
          authorization: `bearer ${TOKEN}`,
          "content-type": "application/json",
          "user-agent": "heros-cleaning (+https://github.com/lhypds/heros)",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) json = await response.json();
    } catch (error) {
      failed = error;
    } finally {
      release(started);
    }
    if (failed) {
      // No answer, or one cut short.
      if (attempt >= RETRIES) throw failed;
      await sleep(attempt * 2000);
      continue;
    }
    if (response.status === 401) {
      console.error("the token was refused");
      process.exit(1);
    }
    const limited = response.status === 403 || response.status === 429 ||
      (json?.errors ?? []).some((error) => error.type === "RATE_LIMITED");
    if (limited) {
      // The hourly limit says when it resets; the secondary one says how
      // long to hold off, or nothing, in which case five minutes. The first
      // to hear it holds the gate and says so.
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
      const wait = retryAfter > 0 ? retryAfter : reset > 0 && response.status !== 403 ? reset + 1000 : 300000;
      if (Date.now() + wait > nextStart) {
        nextStart = Date.now() + wait;
        budget = Math.max(BUDGET_MIN_MS, Math.round(budget * 0.7));
        lastLimited = Date.now();
        done();
        console.log(`rate limited, waiting ${Math.round(wait / 1000)}s; budget now ${Math.round(budget / 1000)}s a minute`);
      }
      await sleep(wait);
      continue;
    }
    if (!response.ok) {
      if (attempt >= (patient ? RETRIES : 2)) throw new Error(`GitHub answered ${response.status}`);
      await sleep(attempt * (patient ? 10000 : 5000));
      continue;
    }
    const unknown = (json.errors ?? []).every((error) => error.type === "NOT_FOUND");
    if (json.errors && !unknown) throw new Error(json.errors.map((error) => error.message).join("; "));
    remaining = json.data?.rateLimit?.remaining ?? remaining;
    return json.data ?? {};
  }
};

// Step 1
// -----------------------------------------------------------------------------

const REASON_EMPTY = "no name, no location, no website, no followers";
const isEmpty = (person) =>
  person.name === null && person.location === null && person.website === null && person.followers === 0;

const step1 = () => {
  const people = handles.length > 0
    ? handles.map((login) => sql.person.get(login)).filter((person) => person && isEmpty(person))
    : sql.empty.all();
  if (DRY) {
    for (const person of people) console.log(`${person.login}: ${person.own} repositories, ${REASON_EMPTY}`);
    console.log(`step 1: ${people.length} would go, ${REASON_EMPTY}`);
    return;
  }
  db.exec("BEGIN");
  for (const person of people) remove(person, 1, REASON_EMPTY);
  db.exec("COMMIT");
  console.log(`step 1: ${people.length} removed, ${REASON_EMPTY}`);
  exportStep(1);
};

// Step 2
// -----------------------------------------------------------------------------

const REASON_GONE = "no longer on GitHub";
const reasonShort = (person) => `${person.commits} commits in the first ${person.checked} repositories`;
const isShort = (person) => person.commits !== null && person.commits < person.checked * PER_REPO;

let countedNow = 0;
let removedNow = 0;
let left = 0;

// Counts one person's commits, a page at a time, smaller pages when GitHub
// times out; then keeps or removes them.
const count = async (login) => {
  let page = 0;
  let after = null;
  let checked = 0;
  let commits = 0;
  while (checked < SAMPLE) {
    const first = Math.min(PAGES[page], SAMPLE - checked);
    let user;
    try {
      ({ user } = await graphql(REPOS(first), { login, after }, { patient: page === PAGES.length - 1 }));
    } catch (error) {
      if (page < PAGES.length - 1 && /answered 5\d\d|timeout/i.test(error.message)) {
        page++;
        continue;
      }
      done();
      console.log(`${login}: ${error.message}; left for next time`);
      left++;
      return;
    }
    if (!user) {
      const person = sql.person.get(login);
      if (person && !DRY) remove(person, 2, REASON_GONE);
      done();
      console.log(`${login}: ${REASON_GONE}${DRY ? " (would go)" : ""}`);
      removedNow++;
      return;
    }
    const repos = user.repositories;
    for (const repo of repos.nodes) commits += repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
    checked += repos.nodes.length;
    if (!repos.pageInfo.hasNextPage) break;
    after = repos.pageInfo.endCursor;
  }
  sql.counted.run(commits, checked, login);
  const person = sql.person.get(login);
  if (!person) return;
  countedNow++;
  if (isShort(person)) {
    if (!DRY) remove(person, 2, reasonShort(person));
    removedNow++;
    done();
    console.log(`${login}: ${reasonShort(person)}${DRY ? " (would go)" : ""}`);
  } else if (handles.length > 0) {
    done();
    console.log(`${login}: ${reasonShort(person)}, stays`);
  }
};

const step2 = async () => {
  TOKEN = token();
  // Anyone counted on an earlier run, dry or cut short, and found short.
  if (!DRY) {
    const short = handles.length > 0
      ? handles.map((login) => sql.person.get(login)).filter((person) => person && isShort(person))
      : sql.short.all(PER_REPO);
    db.exec("BEGIN");
    for (const person of short) remove(person, 2, reasonShort(person));
    db.exec("COMMIT");
    if (short.length > 0) console.log(`step 2: ${short.length} counted earlier removed`);
  }

  const queue = handles.length > 0
    ? handles.filter((login) => sql.person.get(login))
    : sql.uncounted.all(SAMPLE).map((row) => row.login);
  const total = queue.length;
  const progress = () =>
    `step 2: ${countedNow} of ${total} counted, ${removedNow} ${DRY ? "would go" : "removed"}` +
    (left > 0 ? `, ${left} left for next time` : "") +
    (remaining === null ? "" : `, ${remaining} requests left this hour`);
  const worker = async () => {
    while (queue.length > 0) {
      await count(queue.shift());
      show(progress());
      if (!process.stdout.isTTY && countedNow > 0 && countedNow % 200 === 0) console.log(progress());
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  done();
  console.log(`step 2: ${countedNow} counted, ${removedNow} ${DRY ? "would go" : "removed"}` +
    (left > 0 ? `, ${left} left for next time` : ""));
  if (!DRY) exportStep(2);
};

// Report
// -----------------------------------------------------------------------------

const report = () => {
  const totals = sql.totals.get(PER_REPO, PER_REPO);
  console.log(`${totals.people} people in data/crawl.db; ${totals.counted} counted for commits, ` +
    `${totals.enough ?? 0} with ten a repository, ${totals.short ?? 0} short, ${totals.people - totals.counted} not yet`);
  for (const row of sql.steps.all()) console.log(`step ${row.step}: ${row.n} removed`);
};

// -----------------------------------------------------------------------------

process.on("SIGINT", () => {
  done();
  console.log("stopped; the next run carries on from here");
  if (STEP2 && !DRY) exportStep(2);
  process.exit(130);
});

const main = async () => {
  if (REPORT) {
    report();
    return;
  }
  if (EXPORT) {
    for (const row of sql.steps.all()) exportStep(row.step);
    return;
  }
  if (STEP1) step1();
  if (STEP2) await step2();
  report();
};

main().catch((error) => {
  done();
  console.error(error.message);
  process.exit(1);
});
