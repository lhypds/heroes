#!/usr/bin/env node
// Crawls GitHub for people who might be heroes, and checks them against the
// two rules. What it finds goes into data/crawl.db, a SQLite file, so a crawl
// of a hundred thousand people can stop and start again where it left off.
//
//   node data/crawl.js               from everyone under data/heros/: who they
//                                    follow and who follows them, then checked
//   node data/crawl.js alice bob     from these handles instead
//   node data/crawl.js --search      everyone on GitHub with a hundred public
//                                    repositories, through the search API
//   node data/crawl.js --expand      also from everyone who passes, and so on
//   node data/crawl.js --find        find, do not check
//   node data/crawl.js --check       check, do not find
//   node data/crawl.js --check alice check these handles, on the list or not
//   node data/crawl.js --report      who passes, most repositories first
//   node data/crawl.js --fresh       forget everything and start over
//
// Finding is cheap: a page of a hundred people, with how many public
// repositories of their own each has, is one request, and anyone short of a
// hundred is passed over (rule 1). Checking costs one request per hundred
// repositories: each is asked its commits and how much code it holds, and is
// counted with ten commits and more than a hundred lines (rule 2). The lines
// are read off the bytes GitHub counts as code, about thirty to a line; prose,
// data and configuration are not in that count, so a repository that is only
// a README shows nothing. Nothing is decided here: an entry is still written
// by a person, or by an assistant with the prompt in src/prompt.js.
//
// Needs a token, GITHUB_TOKEN or `gh auth token`, and Node.js 22.13 or later
// for node:sqlite. No dependencies, like scripts/check.js.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// node:sqlite still announces itself as experimental; the announcement is
// queued for the next tick, so it can be taken off here.
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name !== "ExperimentalWarning") console.error(warning.stack);
});

const DB = fileURLToPath(new URL("./crawl.db", import.meta.url));
const HEROS = fileURLToPath(new URL("./heros/", import.meta.url));

// The rules. A hundred public repositories of their own, forks aside; each
// with ten commits and more than a hundred lines of code.
const HUNDRED = 100;
const MIN_COMMITS = 10;
// GitHub counts the bytes of code in a repository and leaves out prose, data,
// configuration and vendored files. A hundred lines is about three kilobytes.
const MIN_CODE = 3000;

const PAGE = 100;
// The search API answers at most a thousand people to a query, so a query
// that would find more is cut into slices, by repository count and then by
// the day the account was made.
const SEARCH_CAP = 1000;
const FIRST_ACCOUNT = "2007-01-01";
const TIMEOUT_MS = 30000;
const RETRIES = 5;
const API = "https://api.github.com/graphql";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const handles = args.filter((arg) => !arg.startsWith("--")).map((handle) => handle.toLowerCase());
const FRESH = flag("fresh");
const SEARCH = flag("search");
const EXPAND = flag("expand");
const REPORT = flag("report");
const FIND = flag("find") || (!flag("check") && !REPORT);
const CHECK = flag("check") || (!flag("find") && !REPORT);

const token = () => {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    console.error("needs a token: set GITHUB_TOKEN, or sign in with `gh auth login`");
    process.exit(1);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
};
const text = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "") || null;
const show = process.stdout.isTTY ? (line) => process.stdout.write(`\r\x1b[K${line}`) : () => {};
const done = process.stdout.isTTY ? () => process.stdout.write("\r\x1b[K") : () => {};

// The database
// -----------------------------------------------------------------------------

if (FRESH) for (const suffix of ["", "-wal", "-shm"]) rmSync(DB + suffix, { force: true });
const db = new DatabaseSync(DB);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS people (
    login TEXT PRIMARY KEY,
    name TEXT, bio TEXT, company TEXT, location TEXT, website TEXT,
    followers INTEGER NOT NULL DEFAULT 0,
    repos INTEGER NOT NULL,          -- public repositories of their own, forks aside
    counted INTEGER,                 -- of those, how many pass rule 2; empty until checked
    via TEXT NOT NULL,               -- how they were found
    found_at TEXT NOT NULL,
    checked_at TEXT,
    expanded INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS repos (
    login TEXT NOT NULL, name TEXT NOT NULL,
    commits INTEGER NOT NULL,
    code INTEGER NOT NULL,           -- bytes GitHub counts as code
    language TEXT,
    counted INTEGER NOT NULL,        -- 1 if it passes rule 2
    PRIMARY KEY (login, name)
  );
  CREATE TABLE IF NOT EXISTS crawls (
    login TEXT NOT NULL, field TEXT NOT NULL,
    cursor TEXT, done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (login, field)
  );
  CREATE TABLE IF NOT EXISTS searches (
    query TEXT PRIMARY KEY,
    count INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0
  );
`);

const sql = {
  person: db.prepare("SELECT via FROM people WHERE login = ?"),
  upsert: db.prepare(`
    INSERT INTO people (login, name, bio, company, location, website, followers, repos, via, found_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(login) DO UPDATE SET name = excluded.name, bio = excluded.bio, company = excluded.company,
      location = excluded.location, website = excluded.website, followers = excluded.followers,
      repos = excluded.repos, via = excluded.via`),
  unchecked: db.prepare("SELECT login FROM people WHERE checked_at IS NULL ORDER BY rowid"),
  clearRepos: db.prepare("DELETE FROM repos WHERE login = ?"),
  repo: db.prepare("INSERT OR REPLACE INTO repos (login, name, commits, code, language, counted) VALUES (?, ?, ?, ?, ?, ?)"),
  checked: db.prepare("UPDATE people SET counted = ?, repos = ?, checked_at = ? WHERE login = ?"),
  crawl: db.prepare("SELECT cursor, done FROM crawls WHERE login = ? AND field = ?"),
  crawlSave: db.prepare("INSERT OR REPLACE INTO crawls (login, field, cursor, done) VALUES (?, ?, ?, ?)"),
  expanded: db.prepare("UPDATE people SET expanded = 1 WHERE login = ?"),
  toExpand: db.prepare("SELECT login FROM people WHERE counted >= ? AND expanded = 0 ORDER BY rowid"),
  search: db.prepare("SELECT count, done FROM searches WHERE query = ?"),
  searchSave: db.prepare("INSERT OR REPLACE INTO searches (query, count, done) VALUES (?, ?, ?)"),
  passing: db.prepare("SELECT login, name, counted, repos FROM people WHERE counted >= ? ORDER BY counted DESC, login"),
  totals: db.prepare(`SELECT count(*) AS found, count(checked_at) AS checked,
    sum(counted >= ?) AS passing, sum(counted >= ? AND counted < ?) AS close FROM people`),
};

// Anyone with an entry already is not a candidate, and everyone with one is
// where a crawl starts by default.
const listed = readdirSync(HEROS)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -".json".length).toLowerCase());

// GitHub
// -----------------------------------------------------------------------------

const TOKEN = token();
let remaining = null;

// One page of a seed's followers or following, with what decides whether
// each person is worth a look.
const PERSON = `login name bio company location websiteUrl
  followers { totalCount }
  repositories(privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER) { totalCount }`;

const EDGES = (field) => `query($login: String!, $after: String) {
  rateLimit { remaining }
  user(login: $login) {
    ${field}(first: ${PAGE}, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ${PERSON} }
    }
  }
}`;

const USER = `query($login: String!) {
  rateLimit { remaining }
  user(login: $login) { ${PERSON} }
}`;

const SEARCH_QUERY = `query($q: String!, $after: String) {
  rateLimit { remaining }
  search(type: USER, query: $q, first: ${PAGE}, after: $after) {
    userCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on User { ${PERSON} } }
  }
}`;

// One page of a person's repositories, with what rule 2 asks of each.
const REPOS = `query($login: String!, $after: String) {
  rateLimit { remaining }
  user(login: $login) {
    repositories(first: ${PAGE}, after: $after, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER,
                 orderBy: { field: NAME, direction: ASC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name mirrorUrl
        primaryLanguage { name }
        languages(first: 1) { totalSize }
        defaultBranchRef { target { ... on Commit { history { totalCount } } } }
      }
    }
  }
}`;

const graphql = async (query, variables) => {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: {
          authorization: `bearer ${TOKEN}`,
          "content-type": "application/json",
          "user-agent": "heros-crawl (+https://github.com/lhypds/heros)",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt >= RETRIES) throw error;
      await sleep(attempt * 2000);
      continue;
    }
    if (response.status === 401) {
      console.error("the token was refused");
      process.exit(1);
    }
    const json = response.ok ? await response.json() : null;
    const limited = response.status === 403 || response.status === 429 ||
      (json?.errors ?? []).some((error) => error.type === "RATE_LIMITED");
    if (limited) {
      // The hourly limit says when it resets; the secondary one says how
      // long to hold off, or nothing, in which case a minute.
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
      const wait = retryAfter > 0 ? retryAfter : reset > 0 && response.status !== 403 ? reset + 1000 : 60000;
      done();
      console.log(`rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    if (!response.ok) {
      if (attempt >= RETRIES) throw new Error(`GitHub answered ${response.status}`);
      await sleep(attempt * 2000);
      continue;
    }
    // A handle nobody has comes back as an error, with the rest of the
    // answer intact; anything else is a real failure.
    const unknown = (json.errors ?? []).every((error) => error.type === "NOT_FOUND");
    if (json.errors && !unknown) throw new Error(json.errors.map((error) => error.message).join("; "));
    remaining = json.data?.rateLimit?.remaining ?? remaining;
    return json.data ?? {};
  }
};

// Finding
// -----------------------------------------------------------------------------

let found = 0;
let passedOver = 0;

// Keeps a person if they clear rule 1, and says whether they are new.
const note = (person, via, { always = false } = {}) => {
  if (!person?.login) return false;
  const login = person.login.toLowerCase();
  const repos = person.repositories.totalCount;
  if (!always && (listed.includes(login) || repos < HUNDRED)) {
    passedOver++;
    return false;
  }
  const was = sql.person.get(login);
  const vias = new Set(was ? was.via.split(", ") : []);
  vias.add(via);
  sql.upsert.run(
    login, text(person.name), text(person.bio), text(person.company), text(person.location),
    text(person.websiteUrl), person.followers.totalCount, repos, [...vias].sort().join(", "), today(),
  );
  if (!was) found++;
  return !was;
};

// Everyone a seed follows, or everyone who follows them. A seed read to the
// end is not read again; a seed read halfway carries on from there.
const crawl = async (seed, field) => {
  const via = field === "followers" ? `follows ${seed}` : `followed by ${seed}`;
  const progress = sql.crawl.get(seed, field);
  if (progress?.done) return null;
  let after = progress?.cursor ?? null;
  let seen = 0;
  let total = 0;
  let kept = 0;
  do {
    const { user } = await graphql(EDGES(field), { login: seed, after });
    if (!user) {
      console.log(`${seed}: no such user`);
      sql.crawlSave.run(seed, field, null, 1);
      return null;
    }
    const page = user[field];
    total = page.totalCount;
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    db.exec("BEGIN");
    for (const person of page.nodes) if (note(person, via)) kept++;
    sql.crawlSave.run(seed, field, after, after ? 0 : 1);
    db.exec("COMMIT");
    seen += page.nodes.length;
    show(`${seed}: ${field} ${seen} of ${total}, ${kept} kept`);
  } while (after);
  done();
  return { total, kept };
};

const crawlAround = async (seeds) => {
  for (const seed of seeds) {
    const followers = await crawl(seed, "followers");
    const following = followers === null ? null : await crawl(seed, "following");
    sql.expanded.run(seed);
    if (followers === null && following === null) continue;
    const parts = [];
    if (followers) parts.push(`${followers.total} followers`);
    if (following) parts.push(`${following.total} following`);
    const kept = (followers?.kept ?? 0) + (following?.kept ?? 0);
    console.log(`${seed}: ${parts.join(", ")}, ${kept} kept`);
  }
};

// Search. A slice is a range of repository counts and, when that is not
// narrow enough, a range of days the account was made. The search counts
// public repositories with forks in, so it finds a superset, and rule 1 is
// applied to each person it answers with.
let slices = 0;
let searched = 0;

const queryOf = (slice) => {
  const repos = slice.hi === null ? `>=${slice.lo}` : `${slice.lo}..${slice.hi}`;
  const created = slice.from === null ? "" : ` created:${slice.from}..${slice.to}`;
  return `type:user repos:${repos}${created}`;
};

const DAY = 86400000;
const dayOf = (date) => Math.floor(Date.parse(date) / DAY);
const dateOf = (day) => new Date(day * DAY).toISOString().slice(0, 10);

// Cuts a slice that answered `count` into enough pieces to get under the cap,
// as a guess; a piece that is still over is cut again when it is asked.
const split = (slice, count) => {
  const pieces = Math.ceil(count / (SEARCH_CAP * 0.8));
  if (slice.hi === null) {
    const hi = slice.lo * 2 - 1;
    return [{ ...slice, hi }, { ...slice, lo: hi + 1 }];
  }
  if (slice.hi > slice.lo) {
    const width = slice.hi - slice.lo + 1;
    const n = Math.min(pieces, width);
    return Array.from({ length: n }, (_, i) => ({
      ...slice,
      lo: slice.lo + Math.floor((width * i) / n),
      hi: slice.lo + Math.floor((width * (i + 1)) / n) - 1,
    }));
  }
  const from = dayOf(slice.from ?? FIRST_ACCOUNT);
  const to = dayOf(slice.to ?? today());
  const days = to - from + 1;
  if (days < 2) return [];
  const n = Math.min(pieces, days);
  return Array.from({ length: n }, (_, i) => ({
    ...slice,
    from: dateOf(from + Math.floor((days * i) / n)),
    to: dateOf(from + Math.floor((days * (i + 1)) / n) - 1),
  }));
};

const search = async (slice) => {
  const query = queryOf(slice);
  const known = sql.search.get(query);
  if (known?.done) return;
  let count = known?.count ?? null;
  if (count === null || count <= SEARCH_CAP) {
    let after = null;
    let seen = 0;
    do {
      const page = (await graphql(SEARCH_QUERY, { q: query, after })).search;
      count = page.userCount;
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      db.exec("BEGIN");
      for (const person of page.nodes) note(person, "search");
      if (count > SEARCH_CAP) sql.searchSave.run(query, count, 0);
      db.exec("COMMIT");
      seen += page.nodes.length;
      searched += page.nodes.length;
      show(`search: ${slices} slices, ${searched} people, ${found} kept — ${query}`);
    } while (after && count <= SEARCH_CAP && seen < SEARCH_CAP);
  }
  if (count > SEARCH_CAP) {
    const pieces = split(slice, count);
    if (pieces.length === 0) {
      done();
      console.log(`search: ${query} has ${count} people and cannot be cut finer; the first ${SEARCH_CAP} were read`);
    }
    for (const piece of pieces) await search(piece);
  }
  slices++;
  sql.searchSave.run(query, count, 1);
};

// Checking
// -----------------------------------------------------------------------------

let checkedNow = 0;
let passingNow = 0;

// Every repository of one person against rule 2. The repositories are
// written as they come, the verdict only at the end, so a run cut short
// checks the person again from the start.
const check = async (login) => {
  let after = null;
  let seen = 0;
  let total = 0;
  let counted = 0;
  sql.clearRepos.run(login);
  do {
    const { user } = await graphql(REPOS, { login, after });
    if (!user) {
      sql.checked.run(0, 0, today(), login);
      console.log(`${login}: gone`);
      return;
    }
    const page = user.repositories;
    total = page.totalCount;
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    db.exec("BEGIN");
    for (const repo of page.nodes) {
      const commits = repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
      const code = repo.languages?.totalSize ?? 0;
      const language = repo.primaryLanguage?.name ?? null;
      const counts = !repo.mirrorUrl && commits >= MIN_COMMITS && code >= MIN_CODE && language !== null;
      sql.repo.run(login, repo.name, commits, code, language, counts ? 1 : 0);
      if (counts) counted++;
    }
    db.exec("COMMIT");
    seen += page.nodes.length;
    show(`${login}: ${seen} of ${total} repositories, ${counted} count`);
  } while (after);
  sql.checked.run(counted, total, today(), login);
  done();
  checkedNow++;
  if (counted >= HUNDRED) passingNow++;
  console.log(`${login}: ${counted} of ${total} count${counted >= HUNDRED ? " — a hundred" : ""}`);
};

const checkAll = async () => {
  for (const { login } of sql.unchecked.all()) await check(login);
};

// Asks GitHub about handles named on the command line, whatever their
// count and whether or not they are listed.
const ask = async (logins) => {
  for (const login of logins) {
    const { user } = await graphql(USER, { login });
    if (!user) console.log(`${login}: no such user`);
    else note(user, "asked", { always: true });
  }
};

// Report
// -----------------------------------------------------------------------------

const report = () => {
  const rows = sql.passing.all(HUNDRED);
  for (const row of rows) {
    console.log(`${row.login.padEnd(24)} ${String(row.counted).padStart(5)} of ${String(row.repos).padEnd(5)} ${row.name ?? ""}`);
  }
  if (rows.length > 0) console.log("");
  const totals = sql.totals.get(HUNDRED, HUNDRED / 2, HUNDRED);
  console.log(
    `${totals.found} people found, ${totals.checked} checked, ` +
      `${totals.passing ?? 0} at a hundred, ${totals.close ?? 0} at fifty or more`,
  );
};

// -----------------------------------------------------------------------------

process.on("SIGINT", () => {
  done();
  console.log("stopped; the next run carries on from here");
  process.exit(130);
});

const main = async () => {
  if (REPORT) {
    report();
    return;
  }

  if (CHECK && !FIND && handles.length > 0) await ask(handles);

  if (FIND) {
    const seeds = handles.length > 0 ? handles : listed;
    if (SEARCH) await search({ lo: HUNDRED, hi: null, from: null, to: null });
    await crawlAround(seeds);
  }
  if (CHECK) await checkAll();

  // Everyone who passes is a seed in turn, until nobody new passes.
  if (EXPAND) {
    for (;;) {
      const more = sql.toExpand.all(HUNDRED).map((row) => row.login);
      if (more.length === 0) break;
      await crawlAround(more);
      if (CHECK) await checkAll();
    }
  }

  const totals = sql.totals.get(HUNDRED, HUNDRED / 2, HUNDRED);
  console.log(
    `${found} people found` + (passedOver > 0 ? `, ${passedOver} passed over short of a hundred` : "") +
      (checkedNow > 0 ? `; ${checkedNow} checked, ${passingNow} at a hundred` : "") +
      `; ${totals.found} people and ${totals.passing ?? 0} at a hundred in data/crawl.db` +
      (remaining === null ? "" : `; ${remaining} requests left this hour`),
  );
};

main().catch((error) => {
  done();
  console.error(error.message);
  process.exit(1);
});
