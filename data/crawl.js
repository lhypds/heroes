#!/usr/bin/env node
// Crawls GitHub for people who might be heroes: anyone with a hundred public
// repositories, a hundred of them their own and not forks. Who it finds goes
// into data/crawl.db, a SQLite file, so a crawl of a hundred thousand people
// can stop and start again where it left off.
//
//   node data/crawl.js               around everyone under data/heros/: who
//                                    they follow and who follows them
//   node data/crawl.js alice bob     around these handles instead; each of
//                                    them is looked at too
//   node data/crawl.js --search      everyone on GitHub with a hundred public
//                                    repositories, through the search API
//   node data/crawl.js --expand      also around everyone found, and so on
//   node data/crawl.js --report      who was found, most repositories first
//   node data/crawl.js --fresh       forget everything and start over
//
// Two counts decide, and both come in the same request as the person: the
// public repositories they own, forks in, and the same with forks out. A
// hundred of each keeps them; anyone short of either is passed over and not
// written. A page of a hundred people is one request, whether from a search
// or from a seed's followers. Whether the repositories are real code is not
// asked here: an entry is still written by a person, or by an assistant with
// the prompt in src/prompt.js.
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

// The two counts a person needs: a hundred public repositories, and a
// hundred with the forks taken out.
const HUNDRED = 100;

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

// The shape of the file. A file from an earlier crawl.js, with other rules
// and other columns, is not carried over; it asks for --fresh.
const SCHEMA = 2;

if (FRESH) for (const suffix of ["", "-wal", "-shm"]) rmSync(DB + suffix, { force: true });
const db = new DatabaseSync(DB);
const made = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n > 0;
const version = db.prepare("PRAGMA user_version").get().user_version;
if (made && version !== SCHEMA) {
  console.error("data/crawl.db is from an earlier crawl.js, with other rules; run with --fresh to start over");
  process.exit(1);
}
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA user_version = ${SCHEMA};
  CREATE TABLE IF NOT EXISTS people (
    login TEXT PRIMARY KEY,
    name TEXT, bio TEXT, company TEXT, location TEXT, website TEXT,
    followers INTEGER NOT NULL DEFAULT 0,
    repos INTEGER NOT NULL,          -- public repositories of their own, forks in
    own INTEGER NOT NULL,            -- the same, forks out
    via TEXT NOT NULL,               -- how they were found
    found_at TEXT NOT NULL,
    expanded INTEGER NOT NULL DEFAULT 0
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
    INSERT INTO people (login, name, bio, company, location, website, followers, repos, own, via, found_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(login) DO UPDATE SET name = excluded.name, bio = excluded.bio, company = excluded.company,
      location = excluded.location, website = excluded.website, followers = excluded.followers,
      repos = excluded.repos, own = excluded.own, via = excluded.via`),
  crawl: db.prepare("SELECT cursor, done FROM crawls WHERE login = ? AND field = ?"),
  crawlSave: db.prepare("INSERT OR REPLACE INTO crawls (login, field, cursor, done) VALUES (?, ?, ?, ?)"),
  expanded: db.prepare("UPDATE people SET expanded = 1 WHERE login = ?"),
  toExpand: db.prepare("SELECT login FROM people WHERE expanded = 0 ORDER BY rowid"),
  search: db.prepare("SELECT count, done FROM searches WHERE query = ?"),
  searchSave: db.prepare("INSERT OR REPLACE INTO searches (query, count, done) VALUES (?, ?, ?)"),
  people: db.prepare("SELECT login, name, repos, own FROM people ORDER BY own DESC, login"),
  count: db.prepare("SELECT count(*) AS n FROM people"),
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

// One person: the two counts that decide, and what an entry would want to
// know about them.
const PERSON = `login name bio company location websiteUrl
  followers { totalCount }
  all: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
  own: repositories(privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER) { totalCount }`;

// One page of a seed's followers or following, and the seed themselves,
// who might be one too.
const EDGES = (field) => `query($login: String!, $after: String) {
  rateLimit { remaining }
  user(login: $login) {
    ${PERSON}
    page: ${field}(first: ${PAGE}, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { ${PERSON} }
    }
  }
}`;

const SEARCH_QUERY = `query($q: String!, $after: String) {
  rateLimit { remaining }
  search(type: USER, query: $q, first: ${PAGE}, after: $after) {
    userCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on User { ${PERSON} } }
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

// Keeps a person if both counts reach a hundred, and says whether they are
// new. Anyone listed already is not kept either way.
const note = (person, via) => {
  if (!person?.login) return false;
  const login = person.login.toLowerCase();
  const repos = person.all.totalCount;
  const own = person.own.totalCount;
  if (listed.includes(login) || repos < HUNDRED || own < HUNDRED) {
    passedOver++;
    return false;
  }
  const was = sql.person.get(login);
  const vias = new Set(was ? was.via.split(", ") : []);
  vias.add(via);
  sql.upsert.run(
    login, text(person.name), text(person.bio), text(person.company), text(person.location),
    text(person.websiteUrl), person.followers.totalCount, repos, own, [...vias].sort().join(", "), today(),
  );
  if (!was) found++;
  return !was;
};

// Everyone a seed follows, or everyone who follows them. A seed read to the
// end is not read again; a seed read halfway carries on from there. The seed
// is looked at too, on the way past, once.
const looked = new Set();

const crawl = async (seed, field) => {
  const via = field === "followers" ? `follows ${seed}` : `followed by ${seed}`;
  const progress = sql.crawl.get(seed, field);
  if (progress?.done) return null;
  let after = progress?.cursor ?? null;
  let seen = 0;
  let total = 0;
  let kept = 0;
  let person = null;
  do {
    const { user } = await graphql(EDGES(field), { login: seed, after });
    if (!user) {
      console.log(`${seed}: no such user`);
      for (const each of ["followers", "following"]) sql.crawlSave.run(seed, each, null, 1);
      return null;
    }
    const page = user.page;
    total = page.totalCount;
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    db.exec("BEGIN");
    if (!looked.has(seed)) note(user, "seed");
    looked.add(seed);
    for (const each of page.nodes) if (note(each, via)) kept++;
    sql.crawlSave.run(seed, field, after, after ? 0 : 1);
    db.exec("COMMIT");
    person = user;
    seen += page.nodes.length;
    show(`${seed}: ${field} ${seen} of ${total}, ${kept} kept`);
  } while (after);
  done();
  return { total, kept, person };
};

const crawlAround = async (seeds) => {
  for (const seed of seeds) {
    const followers = await crawl(seed, "followers");
    const following = await crawl(seed, "following");
    sql.expanded.run(seed);
    if (followers === null && following === null) continue;
    const person = followers?.person ?? following?.person;
    const parts = [`${person.all.totalCount} repositories, ${person.own.totalCount} their own`];
    if (followers) parts.push(`${followers.total} followers`);
    if (following) parts.push(`${following.total} following`);
    const kept = (followers?.kept ?? 0) + (following?.kept ?? 0);
    console.log(`${seed}: ${parts.join(", ")}, ${kept} kept`);
  }
};

// Search. A slice is a range of repository counts and, when that is not
// narrow enough, a range of days the account was made. The search counts
// public repositories with forks in, which is the first count exactly; the
// second is read off each person it answers with.
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

// Report
// -----------------------------------------------------------------------------

const report = () => {
  const rows = sql.people.all();
  for (const row of rows) {
    console.log(`${row.login.padEnd(24)} ${String(row.own).padStart(5)} of ${String(row.repos).padEnd(5)} ${row.name ?? ""}`);
  }
  if (rows.length > 0) console.log("");
  console.log(`${rows.length} people in data/crawl.db, each with a hundred public repositories of their own`);
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

  const seeds = handles.length > 0 ? handles : listed;
  if (SEARCH) await search({ lo: HUNDRED, hi: null, from: null, to: null });
  await crawlAround(seeds);

  // Everyone found is a seed in turn, until nobody new is found.
  if (EXPAND) {
    for (;;) {
      const more = sql.toExpand.all().map((row) => row.login);
      if (more.length === 0) break;
      await crawlAround(more);
    }
  }

  console.log(
    `${found} people found` + (passedOver > 0 ? `, ${passedOver} passed over` : "") +
      `; ${sql.count.get().n} in data/crawl.db` +
      (remaining === null ? "" : `; ${remaining} requests left this hour`),
  );
};

main().catch((error) => {
  done();
  console.error(error.message);
  process.exit(1);
});
