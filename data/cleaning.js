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
//   node data/cleaning.js --step3    the heroes: over ten thousand commits in
//                                    the hundred repositories they last pushed
//   node data/cleaning.js --step4    the hundred cut them short: count every
//                                    repository of whoever could still pass
//   node data/cleaning.js --dry      count, and say who would go; remove nobody
//   node data/cleaning.js alice bob  only these people, whatever their state
//   node data/cleaning.js --report   how many are left, how many went and why
//   node data/cleaning.js --export   write the JSON files again from the database
//
// Step 1 is a query on the database. Step 2 asks GitHub, one person to a
// request, for the commits on the default branch of their most recently
// pushed repositories of their own, a hundred unless --repos says otherwise:
// the commits by anyone, which is what decides, since a commit made with an
// assistant or a bot is still their work, and the commits they wrote under
// their own name, kept beside it. Both counts and how many repositories
// they cover are saved on the person, so a run cut short carries on where
// it left off; under ten a repository, they go. Telling their own commits
// apart needs their GitHub id, looked up a hundred people to a request.
//
// Step 3 asks the same of everyone left, one request each, of the hundred
// repositories they pushed to most recently and of nothing else: more
// than ten thousand commits they wrote themselves, and they are heroes.
// What decides is their own commits and not the commits in their
// repositories, because a repository of their own is not always their own
// work — a copy of a kernel, a mirror, a book a thousand people edit —
// and its ten thousand commits are somebody else's. Every hero gets the
// entry the site reads, data/heroes/<handle>.json, with what the crawl
// knows of them — their name, their profile, their site, their line about
// themselves, and the commits they wrote — and an empty list of
// applications for a person to fill in later. An entry already written is
// left alone, whatever it says. Whoever falls short is left where they
// are, counted, neither removed nor a hero.
//
// Step 4 is for whom the hundred was not enough. Someone with a thousand
// repositories was read to the hundredth and no further, and the nine
// hundred left unread might hold what the bar asks for; someone with a
// hundred and two was read almost to the end, and nothing is waiting
// there. So step 4 asks who could still pass if everything they have were
// counted — their hundred busiest, taken as the pace of all of them,
// reaching the bar — and counts everything they have. It is a thousand
// people of thirty-three thousand, and two hours: the rest cannot pass
// however long they are read for, and are not asked.
//
// These are heavy requests. GitHub gives one ten seconds, and a hundred
// repositories take about nine, so a person GitHub cannot manage is asked
// for fifty at a time, then twenty-five, then ten. And GitHub allows only
// so much of its own time a minute before turning requests away for five,
// so the gate here keeps the time of the last minute's answers and holds
// until it is under a budget it finds by feel; and no more than thirty a
// minute whatever their weight, like the crawl. Measured: ten people a
// minute with a hundred repositories each, three or four days for everyone
// the crawl found; --repos 25 or 10 run at the thirty a minute, some
// thirty hours. Step 3 asks the same question of the same hundred, so it
// runs at the same ten a minute: two or three days for the thirty-three
// thousand the first two steps left.
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
const HEROES = fileURLToPath(new URL("./heroes/", import.meta.url));
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
const STEP3 = flag("step3");
const STEP4 = flag("step4");
const STEP1 = flag("step1") || (!flag("step2") && !STEP3 && !STEP4 && !REPORT && !EXPORT);
const STEP2 = flag("step2") || (!flag("step1") && !STEP3 && !STEP4 && !REPORT && !EXPORT);

// Step 2's bar: ten commits a repository on average, over the first SAMPLE.
const SAMPLE = option("repos", 100);
const PER_REPO = 10;
// Step 3's bar: ten thousand commits of their own writing, in the hundred
// repositories they pushed to most recently.
const HERO = 10000;
const HERO_REPOS = 100;
// Repositories to a request, and what to fall back to when GitHub times
// out, down to one at a time; an account GitHub cannot count even so is
// kept, and marked. Fifty to start with, and smaller for the person
// GitHub gives out on.
// Both ends were measured over two hundred people each. A hundred is more
// than GitHub will count for a third of them: it spends its ten seconds,
// gives out, and the person is asked again in halves, three and a third
// requests each and twenty-seven seconds of waiting. Twenty-five it counts
// every time, but a hundred repositories are then four requests, and what
// is allowed a minute is requests as much as time: ten of them a minute,
// nine hundred and eighty requests for two hundred people. Fifty is two
// requests and, so far, an answer to both.
const PAGES = [50, 25, 10, 5, 2, 1];

// The gate: GitHub's time answering, over the last minute, is kept under a
// budget; a few requests in flight at most, and a moment between them. How
// much of that time GitHub counts is not said, so the budget is found by
// feel: cut by a third whenever GitHub turns a request away, grown a tenth
// after ten clean minutes. What is kept here is the time from asking to
// being answered, which is not what GitHub counts — it counts the time it
// spends running the query, and it gives that up at ten seconds, while an
// answer takes half as long again to arrive. So the ceiling is set well
// above the ninety seconds a minute the documents describe: two hours of
// step 3 at a hundred and fifty were not turned away once, and what is
// too much is what GitHub says is too much.
const BUDGET_MS = 150000;
const BUDGET_MIN_MS = 30000;
const BUDGET_MAX_MS = 300000;
const CLEAN_MS = 600000;
const WINDOW_MS = 60000;
const IN_FLIGHT = 5;
// And no more than so many a minute whatever their weight: thirty to
// start, a quarter slower at every turning away, a tenth faster after ten
// clean minutes. Thirty of the heaviest requests, a hundred repositories
// at a time, were turned away every time; half that weight is not, and a
// page of fifty that has to be asked for twice is no more of GitHub's time
// than a page of a hundred that it gives up on.
const PACE_MS = 2000;
const PACE_MIN_MS = 2000;
const PACE_MAX_MS = 8000;
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
// The crawl's people table gains columns for step 2: their GitHub id, empty
// until looked up and "" when GitHub has no such user any more; commits by
// anyone and by themselves in the first repositories; and how many
// repositories that covers.
const columns = db.prepare("PRAGMA table_info(people)").all().map((column) => column.name);
for (const [name, type] of [["id", "TEXT"], ["commits", "INTEGER"], ["authored", "INTEGER"], ["checked", "INTEGER"],
  ["full", "INTEGER"]]) {
  if (!columns.includes(name)) db.exec(`ALTER TABLE people ADD COLUMN ${name} ${type}`);
}
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
  // checked is -1 for someone GitHub could not count at all; they are kept.
  uncounted: db.prepare("SELECT login FROM people WHERE checked IS NULL OR (checked >= 0 AND checked < ?) ORDER BY rowid"),
  short: db.prepare("SELECT * FROM people WHERE commits IS NOT NULL AND commits < checked * ? ORDER BY rowid"),
  person: db.prepare("SELECT * FROM people WHERE login = ?"),
  identified: db.prepare("UPDATE people SET id = ? WHERE login = ?"),
  counted: db.prepare("UPDATE people SET commits = ?, authored = ?, checked = ?, full = ? WHERE login = ?"),
  // Anyone step 3 has not settled: counted over fewer than a hundred
  // repositories, counted without their own commits told apart, or not
  // counted at all. Someone step 2 already put over the bar is asked again
  // all the same, so that every hero's commits are the same hundred
  // repositories; checked is -1 for someone GitHub could not count at all,
  // and full is 1 for someone who has no hundred repositories to count —
  // ninety-nine of them counted is all of them — and neither is asked again.
  undecided: db.prepare(`SELECT login FROM people
    WHERE full IS NOT 1 AND (checked IS NULL OR (checked >= 0 AND (checked < ? OR authored IS NULL)))
    ORDER BY rowid`),
  // Step 4's: whoever the hundred cut short and could still reach the bar
  // if the rest of their repositories were counted. The test is generous
  // on purpose — it supposes every repository they have is as busy as the
  // hundred busiest, which measurement says is three times the truth — so
  // that nobody who could pass is left unasked.
  truncated: db.prepare(`SELECT login FROM people
    WHERE full IS NOT 1 AND checked = ? AND own > ? AND authored <= ? AND authored * own / 100.0 > ?
    ORDER BY authored DESC`),
  truncatedRepos: db.prepare(`SELECT sum(own - ?) AS n FROM people
    WHERE full IS NOT 1 AND checked = ? AND own > ? AND authored <= ? AND authored * own / 100.0 > ?`),
  heroes: db.prepare("SELECT * FROM people WHERE authored > ? ORDER BY authored DESC, login"),
  heroCount: db.prepare("SELECT count(*) AS n FROM people WHERE authored > ?"),
  remove: db.prepare("DELETE FROM people WHERE login = ?"),
  removed: db.prepare("INSERT OR REPLACE INTO removed (login, step, reason, removed_at, person) VALUES (?, ?, ?, ?, ?)"),
  exported: db.prepare("SELECT person FROM removed WHERE step = ? ORDER BY rowid"),
  steps: db.prepare("SELECT step, count(*) AS n FROM removed GROUP BY step ORDER BY step"),
  totals: db.prepare(`SELECT count(*) AS people, count(commits) AS counted, sum(checked = -1) AS uncountable,
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
// most recently pushed first: by anyone, and by the person.
const REPOS = (first) => `query($login: String!, $id: ID!, $after: String) {
  rateLimit { remaining }
  user(login: $login) {
    repositories(first: ${first}, after: $after, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER,
                 orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { defaultBranchRef { target { ... on Commit {
        all: history { totalCount }
        own: history(author: { id: $id }) { totalCount }
      } } } }
    }
  }
}`;

// The GitHub ids of up to a hundred people at once; one GitHub no longer
// has comes back empty.
const IDS = (logins) => `query {
  rateLimit { remaining }
  ${logins.map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { id }`).join("\n  ")}
}`;

const ID = `query($login: String!) {
  rateLimit { remaining }
  user(login: $login) { id }
}`;

let nextStart = 0;
let inFlight = 0;
let budget = BUDGET_MS;
let pace = PACE_MS;
let lastLimited = 0;
let lastGrown = Date.now();
const answered = []; // [when, how long] of the last minute's requests
// What has been spent on the way: the pages GitHub answered, the pages it
// gave out on, and the time both took.
const spent = { pages: 0, timeouts: 0, ms: 0 };

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
  if ((budget < BUDGET_MAX_MS || pace > PACE_MIN_MS) && Date.now() - Math.max(lastLimited, lastGrown) > CLEAN_MS) {
    budget = Math.min(BUDGET_MAX_MS, Math.round(budget * 1.1));
    pace = Math.max(PACE_MIN_MS, Math.round(pace / 1.1));
    lastGrown = Date.now();
  }
  nextStart = Date.now() + pace;
  inFlight++;
};

const release = (started) => {
  inFlight--;
  answered.push([Date.now(), Date.now() - started]);
  spent.pages++;
  spent.ms += Date.now() - started;
};

// One request, retried on failures of GitHub's or the network's. A 5xx is
// not retried unless `patient`: for these queries it is GitHub's ten seconds
// running out, which happens again, costs GitHub the whole ten seconds each
// time, and is what it turns requests away for; a smaller page is the answer.
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
        pace = Math.min(PACE_MAX_MS, Math.round(pace * 1.25));
        lastLimited = Date.now();
        done();
        console.log(`rate limited, waiting ${Math.round(wait / 1000)}s; now ${Math.round(60000 / pace)} a minute, ` +
          `${Math.round(budget / 1000)}s of GitHub's time a minute`);
      }
      await sleep(wait);
      continue;
    }
    if (!response.ok) {
      if (attempt >= (patient ? RETRIES : 1)) throw new Error(`GitHub answered ${response.status}`);
      await sleep(attempt * 10000);
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
const UNCOUNTABLE = "GitHub cannot count their commits in time, even one repository at a time; kept";
const reasonShort = (person) =>
  `${person.commits} commits in the first ${person.checked} repositories, ${person.authored} of them their own`;
const isShort = (person) => person.commits !== null && person.commits < person.checked * PER_REPO;

let countedNow = 0;
let removedNow = 0;
let left = 0;

const gone = (login, step = 2) => {
  const person = sql.person.get(login);
  if (person && !DRY) remove(person, step, REASON_GONE);
  done();
  console.log(`${login}: ${REASON_GONE}${DRY ? " (would go)" : ""}`);
  removedNow++;
};

// The ids of a hundred people at a time, remembered; "" for anyone gone.
const identify = async (logins) => {
  const data = await graphql(IDS(logins), {});
  db.exec("BEGIN");
  logins.forEach((login, i) => sql.identified.run(data[`u${i}`]?.id ?? "", login));
  db.exec("COMMIT");
};

// Adds up the commits on the default branches of one person's own
// repositories, the most recently pushed first, a page at a time and
// smaller pages when GitHub times out, and the commits they wrote
// themselves beside them. It stops at `sample` repositories, or when the
// person runs out. Null for someone GitHub no longer has, and `gaveUp` for
// one it could not count even a repository at a time.
const tally = async (login, { sample, id }) => {
  let page = 0;
  let after = null;
  let checked = 0;
  let commits = 0;
  let authored = 0;
  while (checked < sample) {
    const first = Math.min(PAGES[page], sample - checked);
    let user;
    try {
      ({ user } = await graphql(REPOS(first), { login, id, after }));
    } catch (error) {
      // The next page size that is actually smaller than the one that
      // failed; with --repos 10 the first few are all ten. Past one at a
      // time there is nothing smaller: an account whose every repository
      // is a Linux kernel gives up here. GitHub says its ten seconds ran
      // out in three ways: a 502, a 504, and an answer that something went
      // wrong, with an id to quote.
      if (/answered 5\d\d|timeout|something went wrong/i.test(error.message)) {
        spent.timeouts++;
        const smaller = PAGES.findIndex((size, i) => i > page && Math.min(size, sample - checked) < first);
        if (smaller !== -1) {
          page = smaller;
          continue;
        }
        return { commits, authored, checked, gaveUp: true, exhausted: false };
      }
      throw error;
    }
    if (!user) return null;
    const repos = user.repositories;
    for (const repo of repos.nodes) {
      commits += repo.defaultBranchRef?.target?.all?.totalCount ?? 0;
      authored += repo.defaultBranchRef?.target?.own?.totalCount ?? 0;
    }
    checked += repos.nodes.length;
    if (!repos.pageInfo.hasNextPage) return { commits, authored, checked, gaveUp: false, exhausted: true };
    after = repos.pageInfo.endCursor;
  }
  return { commits, authored, checked, gaveUp: false, exhausted: false };
};

// Counts one person's commits and their own; then keeps or removes them.
const count = async (login) => {
  let id = sql.person.get(login)?.id ?? null;
  let counts;
  try {
    if (id === null) {
      // Missed by the lookup by the hundred; asked for alone.
      const { user } = await graphql(ID, { login });
      id = user?.id ?? "";
      sql.identified.run(id, login);
    }
    if (id === "") return gone(login);
    counts = await tally(login, { sample: SAMPLE, id });
  } catch (error) {
    done();
    console.log(`${login}: ${error.message}; left for next time`);
    left++;
    return;
  }
  if (counts === null) return gone(login);
  // What was counted before GitHub gave out may already be over the bar,
  // and then it decides on its own; only when it is not is there nothing
  // to say.
  if (counts.gaveUp && counts.commits < SAMPLE * PER_REPO) {
    sql.counted.run(null, null, -1, 0, login);
    done();
    console.log(`${login}: ${UNCOUNTABLE}`);
    return;
  }
  sql.counted.run(counts.commits, counts.authored, counts.checked, counts.exhausted ? 1 : 0, login);
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
  // A hundred people at a time: their ids in one request, then each of
  // them, a few at once, so the cleaning shows from the first minute.
  let logged = 0;
  while (queue.length > 0) {
    const chunk = queue.splice(0, 100);
    const unknown = chunk.filter((login) => sql.person.get(login)?.id === null);
    if (unknown.length > 0) {
      try {
        await identify(unknown);
      } catch (error) {
        done();
        console.log(`ids: ${error.message}; ${unknown.length} asked for one by one instead`);
      }
    }
    const pending = [...chunk];
    const worker = async () => {
      while (pending.length > 0) {
        await count(pending.shift());
        show(progress());
        if (!process.stdout.isTTY && countedNow - logged >= 200) {
          logged = countedNow;
          console.log(`${new Date().toLocaleString("sv-SE").slice(0, 16)} ${progress()}`);
        }
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
  }
  done();
  console.log(`step 2: ${countedNow} counted, ${removedNow} ${DRY ? "would go" : "removed"}` +
    (left > 0 ? `, ${left} left for next time` : ""));
  if (!DRY) exportStep(2);
};

// Step 3
// -----------------------------------------------------------------------------

let heroesNow = 0;
let wroteNow = 0;

// An address of their own as https:// or not at all: profiles hold every
// shape of one, and the entry takes only the shape the site reads.
const address = (website) => {
  const text = website?.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

// The entry the site reads, from what the crawl knows of them and what
// step 3 counted: the repositories are their own, forks out, as the crawl
// counted them, and the commits are the ones they wrote themselves, the
// figure the bar is set on. The applications are what a person adds
// later, and an empty list is how a hero waiting for them is told apart.
//
// The repositories are a figure of the day they were crawled; `npx hero scan`
// reads them off the account again, for every entry, however it was written.
const entry = (person) => ({
  handle: person.login.toLowerCase(),
  name: person.name?.trim() || person.login,
  github: [`https://github.com/${person.login}`],
  ...(address(person.website) ? { website: address(person.website) } : {}),
  ...(person.bio?.trim() ? { bio: person.bio.trim() } : {}),
  own_repos: person.own,
  commits: person.authored,
  apps: [],
});

// One entry, unless there is already a file for them: what a person has
// written of someone is not for this to overwrite.
const write = (person) => {
  const file = `${HEROES}${person.login.toLowerCase()}.json`;
  if (existsSync(file)) return false;
  writeFileSync(file, JSON.stringify(entry(person), null, 2) + "\n");
  return true;
};

// Every hero the database knows, written out again; entries already there
// are left as they are.
const exportHeroes = () => {
  mkdirSync(HEROES, { recursive: true });
  let written = 0;
  let already = 0;
  for (const person of sql.heroes.all(HERO)) {
    if (write(person)) written++;
    else already++;
  }
  console.log(`data/heroes/: ${written} entries written, ${already} already there`);
};

// Counts one person over the hundred repositories they pushed to most
// recently, and writes their entry if what they wrote themselves comes to
// more than the bar.
const hero = async (login, sample = HERO_REPOS) => {
  let id = sql.person.get(login)?.id ?? null;
  let counts;
  try {
    if (id === null) {
      const { user } = await graphql(ID, { login });
      id = user?.id ?? "";
      sql.identified.run(id, login);
    }
    if (id === "") return gone(login, 3);
    counts = await tally(login, { sample, id });
  } catch (error) {
    done();
    console.log(`${login}: ${error.message}; left for next time`);
    left++;
    return;
  }
  if (counts === null) return gone(login, 3);
  // What was counted before GitHub gave out may already be over the bar,
  // and then it decides on its own.
  if (counts.gaveUp && counts.authored <= HERO) {
    sql.counted.run(null, null, -1, 0, login);
    done();
    console.log(`${login}: ${UNCOUNTABLE}`);
    return;
  }
  sql.counted.run(counts.commits, counts.authored, counts.checked, counts.exhausted ? 1 : 0, login);
  countedNow++;
  const person = sql.person.get(login);
  if (!person || person.authored <= HERO) return;
  heroesNow++;
  if (!DRY && write(person)) wroteNow++;
  done();
  console.log(`${login}: ${person.authored} of ${person.commits} commits their own, ` +
    `in ${person.checked} repositories${DRY ? " (would be a hero)" : ""}`);
};

// Works through a queue of people, a few at once, counting each of them
// to the given depth and saying how it goes.
const drive = async (step, queue, sample) => {
  const total = queue.length;
  const progress = () =>
    `step ${step}: ${countedNow} of ${total} counted, ${heroesNow} heroes` +
    (left > 0 ? `, ${left} left for next time` : "") +
    `, ${(spent.ms / 1000 / Math.max(countedNow, 1)).toFixed(1)}s of GitHub's time each` +
    `, ${spent.timeouts} of ${spent.pages} pages gave out` +
    (remaining === null ? "" : `, ${remaining} requests left this hour`);
  const pending = [...queue];
  let logged = 0;
  const worker = async () => {
    while (pending.length > 0) {
      await hero(pending.shift(), sample);
      show(progress());
      if (!process.stdout.isTTY && countedNow - logged >= 200) {
        logged = countedNow;
        console.log(`${new Date().toLocaleString("sv-SE").slice(0, 16)} ${progress()}`);
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  done();
  console.log(`step ${step}: ${countedNow} counted, ${heroesNow} heroes` +
    (DRY ? " would be written" : `, ${wroteNow} entries written`) +
    (left > 0 ? `, ${left} left for next time` : ""));
  // Everyone the earlier steps already put over the bar gets their entry
  // too, at the end of a full run; asked about a few people by name, it
  // writes those few and nobody else.
  if (!DRY && handles.length === 0) exportHeroes();
};

const step3 = async () => {
  TOKEN = token();
  mkdirSync(HEROES, { recursive: true });
  const queue = handles.length > 0
    ? handles.filter((login) => sql.person.get(login))
    : sql.undecided.all(HERO_REPOS).map((row) => row.login);
  await drive(3, queue, HERO_REPOS);
};

// Step 4
// -----------------------------------------------------------------------------

const step4 = async () => {
  TOKEN = token();
  mkdirSync(HEROES, { recursive: true });
  const queue = handles.length > 0
    ? handles.filter((login) => sql.person.get(login))
    : sql.truncated.all(HERO_REPOS, HERO_REPOS, HERO, HERO).map((row) => row.login);
  if (handles.length === 0) {
    const repos = sql.truncatedRepos.get(HERO_REPOS, HERO_REPOS, HERO_REPOS, HERO, HERO);
    console.log(`step 4: ${queue.length} people the hundred cut short and who could still pass, ` +
      `${(repos.n ?? 0).toLocaleString("en")} repositories left to count`);
  }
  // Whoever came closest in the hundred goes first. They need least of
  // what is unread, so they are likeliest to pass and cheapest to settle,
  // and the run can be stopped at any hour with the heroes it would have
  // found already found. The repository farms — forty thousand
  // repositories and four hundred commits — sort to the very end.
  await drive(4, queue, Infinity);
};

// Report
// -----------------------------------------------------------------------------

const report = () => {
  const totals = sql.totals.get(PER_REPO, PER_REPO);
  const uncountable = totals.uncountable ?? 0;
  console.log(`${totals.people} people in data/crawl.db; ${totals.counted} counted for commits, ` +
    `${totals.enough ?? 0} with ten a repository, ${totals.short ?? 0} short, ` +
    `${totals.people - totals.counted - uncountable} not yet` +
    (uncountable > 0 ? `, ${uncountable} GitHub cannot count and kept` : ""));
  for (const row of sql.steps.all()) console.log(`step ${row.step}: ${row.n} removed`);
  console.log(`heroes: ${sql.heroCount.get(HERO).n} over ${HERO.toLocaleString("en")} commits`);
};

// -----------------------------------------------------------------------------

process.on("SIGINT", () => {
  done();
  console.log("stopped; the next run carries on from here");
  if (STEP2 && !DRY) exportStep(2);
  if ((STEP3 || STEP4) && !DRY && handles.length === 0) exportHeroes();
  process.exit(130);
});

const main = async () => {
  if (REPORT) {
    report();
    return;
  }
  if (EXPORT) {
    for (const row of sql.steps.all()) exportStep(row.step);
    exportHeroes();
    return;
  }
  if (STEP1) step1();
  if (STEP2) await step2();
  if (STEP3) await step3();
  if (STEP4) await step4();
  report();
};

main().catch((error) => {
  done();
  console.error(error.message);
  process.exit(1);
});
