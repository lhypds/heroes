#!/usr/bin/env node
// The list's own command. One thing so far:
//
//   npx hero scan                  every entry, read off GitHub
//   npx hero scan dtolnay feross   only these
//   npx hero scan --missing        only the entries without the figure or the list
//   npx hero scan --dry            say what would change, write nothing
//
// scan writes own_repos into every entry under data/heroes/: the public
// repositories the entry's accounts hold of their own, forks out — the
// repositories rule 1 is read against — which the page shows beside the name
// as "x repositories".
//
// It writes repos beside it: a hundred of those repositories, the ones pushed
// to most recently, written the way the applications under them are written —
// a name, the repository, where it is opened when it says so, and what it is
// written in. A description is the one thing left out, since nobody but the
// person can write it.
//
// An entry may name more than one account, and the rules read them as one, so
// the figure is the accounts added up and the list is the accounts merged,
// newest push first.
//
// GitHub has counted the repositories already and answers the number without
// reading one, and it orders them by their last push itself, so the whole list
// is a handful of requests rather than the day and a half a full check of it
// takes. What counts as their own is asked for the way api/account.js asks it,
// and the token, the pacing and the retrying are that file's too, so there is
// one place where anything talks to GitHub.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { graphql } from "./api/account.js";

const DIR = fileURLToPath(new URL("./data/heroes/", import.meta.url));

// The token lives in .env, as it does for the other commands; those are run
// through package.json, which hands node the file, and npx hands this one
// nothing. A repository without the file has a signed-in GitHub CLI instead,
// and api/account.js asks it, so nothing is said here either way.
try {
  process.loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
} catch {
  // no .env; the environment or `gh auth token` has it, or nothing does
}

// Accounts to a request. Each answers a number GitHub keeps and hands back as
// it is, and a hundred repositories it has only to name; five of them is a
// query GitHub answers inside the ten seconds it gives one, and short enough
// to read in a failure. A page it cannot answer is asked for in halves.
const BATCH = 5;

// Repositories listed for each account, the most recently pushed first. A
// hundred is what the page unfolds and what rule 1 asks for, so it is as far
// as a list is worth carrying.
const LIST = 100;

// The order an entry is written back in. own_repos goes before commits, which
// is the order the page reads them in — so many repositories, so many commits
// — and the repositories themselves after the two figures and before the
// applications they are written like. Anything else an entry carries follows,
// as it was.
const ORDER = ["handle", "name", "github", "website", "bio", "own_repos", "commits", "repos", "apps"];

// Their own public repositories: not forks, and theirs rather than ones they
// are only a member of. The same repositories api/account.js counts, asked
// for in the same words.
const OWN = "privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER";

// What is asked of each repository listed: what it is called, where it is,
// where it is opened when it says so, what it is written in, and when it was
// last pushed to, which is the order they are read in. Nothing here is
// counted, so a hundred of them cost about what one costs.
const REPOSITORY = "name url homepageUrl pushedAt primaryLanguage { name }";

// A page of accounts, each asked how many repositories it holds and for the
// hundred it pushed to most recently. `repositoryOwner` takes a person or an
// organisation, and an entry may name either. An account nobody has answers as
// nothing rather than as an error, which is how a handle typed wrong — or
// since changed — is found.
const ACCOUNTS = (n) => {
  const each = Array.from({ length: n }, (unused, i) => i);
  const asked = `login
      own: repositories(${OWN}) { totalCount }
      active: repositories(${OWN}, first: ${LIST}, orderBy: {field: PUSHED_AT, direction: DESC}) {
        nodes { ${REPOSITORY} }
      }`;
  return `query(${each.map((i) => `$a${i}: String!`).join(", ")}) {
    rateLimit { remaining }
    ${each.map((i) => `a${i}: repositoryOwner(login: $a${i}) { ${asked} }`).join("\n    ")}
  }`;
};

// A person may keep more than one account and the rules read them as one, so
// github is a list. A lone address is read as a list of one, the way
// scripts/check.js and the page read it.
const accountsOf = (github) => {
  if (Array.isArray(github)) return github;
  return github === undefined ? [] : [github];
};

// "lhypds" for https://github.com/lhypds, which is how an entry names an
// account. Anything else in the list is not an account to ask about; saying
// so is scripts/check.js's work, not this one's.
const handleOf = (url) => {
  try {
    const { host, pathname } = new URL(url);
    if (host.toLowerCase().replace(/^www\./, "") !== "github.com") return "";
    const path = pathname.replace(/^\/+|\/+$/g, "");
    return path.includes("/") ? "" : path.toLowerCase();
  } catch {
    return "";
  }
};

const number = (n) => n.toLocaleString("en-US");

// One repository as an entry lists one: the name GitHub knows it by, where it
// is, where it is opened when the repository says so, and what it is written
// in. A repository with no home page, or one given as plain http, is left with
// the source address alone, since an entry's addresses are https.
const listed = (repo) => {
  const entry = { name: repo.name, repo: repo.url };
  if (/^https:\/\//i.test(repo.homepageUrl ?? "")) entry.url = repo.homepageUrl;
  if (repo.primaryLanguage) entry.language = repo.primaryLanguage.name;
  return entry;
};

// The hundred an entry carries, out of everything its accounts hold: the most
// recently pushed to first, and where two were pushed to at the same moment,
// by address, so the same accounts always come back in the same order. A
// repository nobody has pushed to sorts last rather than first.
const active = (repos) =>
  repos
    .slice()
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "") || a.url.localeCompare(b.url))
    .slice(0, LIST)
    .map(listed);

// The entry as it is written: the keys the list knows first, in the order it
// knows them, and whatever else the file carried after them.
const ordered = (hero) => {
  const out = {};
  for (const key of ORDER) if (key in hero) out[key] = hero[key];
  for (const key of Object.keys(hero)) if (!(key in out)) out[key] = hero[key];
  return out;
};

// A key of an entry, as it is written: the whole line it is on, which is all
// of it for a figure and the first line of it for a list.
const line = (name) => new RegExp(`^ {2}"${name}":[^\\n]*$`, "m");

// The repositories as they are already in a file, from the line they open on,
// through the lines further in that are the repositories themselves, to the
// two spaces and a bracket that close them. An empty list, written on the one
// line, is the same list and is matched too. Nothing outside the list is
// indented as far as its contents, so a list cannot be read as running on
// into the applications under it.
const REPOS = /^ {2}"repos": \[(?:\n(?: {4}[^\n]*\n)* {2})?\](,?)$/m;

// A key the file has not got goes in above the first of the keys that follow
// it, so it lands where ORDER says it belongs.
const insert = (text, above, written) => {
  const next = above.map(line).find((key) => key.test(text));
  return next === undefined ? null : text.replace(next, (was) => `${written},\n${was}`);
};

// The figure and the list into the file as it stands: own_repos a line of its
// own before the commits — the two are read together — and the repositories
// after them, above the applications they are written like. An entry is
// written by people as well as by this, and a pull request is easier to read
// when nothing has moved but what changed, so the rest of the file is left
// exactly as it was typed.
//
// A file with nowhere to put either comes back as nothing, and is written out
// whole instead.
const place = (text, own, repos) => {
  const figure = line("own_repos");
  const withOwn = figure.test(text)
    ? text.replace(figure, (was) => `  "own_repos": ${own}${was.trimEnd().endsWith(",") ? "," : ""}`)
    : insert(text, ["commits", "repos", "apps"], `  "own_repos": ${own}`);
  if (withOwn === null) return null;
  // The list is written as the file writes anything nested: two spaces in,
  // and two more for every step inside it.
  const written = `  "repos": ${JSON.stringify(repos, null, 2).replaceAll("\n", "\n  ")}`;
  return REPOS.test(withOwn)
    ? withOwn.replace(REPOS, (was, comma) => `${written}${comma}`)
    : insert(withOwn, ["apps"], written);
};

// The entry, with the figure and the list in it. Both are put where they
// belong and the file read back to see that it says what it should; anything
// else — a file written some other way, a line that landed somewhere it should
// not have — is written out from the entry itself, ordered as the list orders
// it.
const write = (file, hero, own, repos) => {
  const entry = ordered({ ...hero, own_repos: own, repos });
  const placed = place(readFileSync(file, "utf8"), own, repos);
  if (placed !== null) {
    try {
      if (JSON.stringify(ordered(JSON.parse(placed))) === JSON.stringify(entry)) {
        writeFileSync(file, placed);
        return;
      }
    } catch {
      // not JSON any more; the whole entry goes back instead
    }
  }
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
};

// scan
// -----------------------------------------------------------------------------

// Every entry asked for, read off the files: all of them, or the handles
// named, or only the ones the figure or the list is missing from. A handle
// nobody has a file for is worth saying, since it was asked for by name.
const read = (only, missing) => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".json")).sort();
  const heroes = [];
  const problems = [];
  let skipped = 0;

  for (const name of files) {
    const handle = basename(name, ".json");
    if (only.size > 0 && !only.has(handle)) continue;
    const file = join(DIR, name);
    let hero;
    try {
      hero = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${handle}: is not JSON (${error.message})`);
      continue;
    }
    if (missing && Number.isInteger(hero.own_repos) && Array.isArray(hero.repos)) {
      skipped++;
      continue;
    }
    const accounts = accountsOf(hero.github).map(handleOf).filter(Boolean);
    if (accounts.length === 0) {
      problems.push(`${handle}: names no GitHub account`);
      continue;
    }
    heroes.push({ handle, file, hero, accounts });
  }

  for (const handle of only) {
    if (!files.includes(`${handle}.json`)) problems.push(`${handle}: no such entry under data/heroes/`);
  }
  return { heroes, problems, skipped };
};

// One page of accounts, each answered with how many repositories it holds and
// which of them it pushed to last. An account nobody has is left out, and
// whoever asked hears about it against the entry that named it.
const ask = async (page) => {
  const found = new Map();
  let data;
  try {
    data = await graphql(ACCOUNTS(page.length), Object.fromEntries(page.map((login, j) => [`a${j}`, login])));
  } catch (error) {
    // GitHub gives a query ten seconds and answers 502 when a page takes
    // longer — an account holding thousands of repositories is slow to order
    // even where nothing in it is counted. The same accounts in two halves
    // get through, the way api/account.js asks for fewer at a time; one
    // account on its own that still cannot be answered is whoever asked for
    // it to hear about.
    if (page.length === 1 || !/answered 5\d\d|reached/i.test(error.message)) throw error;
    const half = Math.ceil(page.length / 2);
    for (const part of [page.slice(0, half), page.slice(half)]) {
      for (const [login, owner] of await ask(part)) found.set(login, owner);
    }
    return found;
  }
  page.forEach((login, j) => {
    const owner = data[`a${j}`];
    if (owner) found.set(login, { own: owner.own.totalCount, repos: owner.active.nodes });
  });
  return found;
};

// Every account asked for, a page at a time.
const counts = async (logins, onProgress) => {
  const found = new Map();
  for (let i = 0; i < logins.length; i += BATCH) {
    for (const [login, owner] of await ask(logins.slice(i, i + BATCH))) found.set(login, owner);
    onProgress({ read: Math.min(i + BATCH, logins.length), of: logins.length });
  }
  return found;
};

// What each entry came to: how many repositories its accounts hold of their
// own, and how many of them the list it carries names.
const HEADING = `  ${"entry".padEnd(28)} ${"own".padStart(6)} ${"listed".padStart(6)}`;

const scan = async (args) => {
  const dry = args.includes("--dry");
  const missing = args.includes("--missing");
  const only = new Set(
    args
      .filter((arg) => !arg.startsWith("--"))
      .map((arg) => basename(arg, ".json").toLowerCase()),
  );

  const { heroes, problems, skipped } = read(only, missing);
  if (heroes.length === 0) {
    for (const text of problems) console.log(`error ${text}`);
    console.log(
      skipped > 0
        ? `nothing to read: ${number(skipped)} already have the figure and the list`
        : "nothing to read",
    );
    process.exit(problems.length > 0 ? 1 : 0);
  }

  // The accounts of every entry asked for, each asked about once: two entries
  // sharing an account is not two questions.
  const logins = [...new Set(heroes.flatMap((hero) => hero.accounts))];
  const talking = process.stdout.isTTY;
  if (talking) process.stdout.write(`\r\x1b[Kasking GitHub about ${number(logins.length)} accounts…`);
  const found = await counts(logins, ({ read: done, of }) => {
    if (talking) process.stdout.write(`\r\x1b[Kasking GitHub about ${number(done)} of ${number(of)} accounts…`);
  });
  if (talking) process.stdout.write("\r\x1b[K");

  let written = 0;
  let unchanged = 0;
  let carried = 0;
  console.log(HEADING);
  for (const { handle, file, hero, accounts } of heroes) {
    const unknown = accounts.filter((login) => !found.has(login));
    if (unknown.length > 0) {
      problems.push(`${handle}: no such account on GitHub: ${unknown.join(", ")}`);
      continue;
    }
    const own = accounts.reduce((total, login) => total + found.get(login).own, 0);
    const repos = active(accounts.flatMap((login) => found.get(login).repos));
    carried += repos.length;
    // What the figure is made of, when it is made of more than one account,
    // and what it was, when it was something else: the two things a reader
    // would otherwise have to go and look up.
    const parts = accounts.length > 1
      ? `  ${accounts.map((login) => `${login} ${number(found.get(login).own)}`).join(" + ")}`
      : "";
    const was = Number.isInteger(hero.own_repos) && hero.own_repos !== own
      ? `  was ${number(hero.own_repos)}`
      : "";
    console.log(
      `  ${handle.padEnd(28)} ${number(own).padStart(6)} ${number(repos.length).padStart(6)}${was}${parts}`,
    );
    // The list moves whenever anything was pushed to, so an entry is left
    // alone only when both the figure and the list are what they were.
    if (hero.own_repos === own && JSON.stringify(hero.repos) === JSON.stringify(repos)) {
      unchanged++;
      continue;
    }
    if (!dry) write(file, hero, own, repos);
    written++;
  }

  for (const text of problems) console.log(`error ${text}`);
  const said = [
    `${number(heroes.length)} ${heroes.length === 1 ? "entry" : "entries"}`,
    `${number(logins.length)} ${logins.length === 1 ? "account" : "accounts"}`,
    `${number(carried)} ${carried === 1 ? "repository" : "repositories"} listed`,
    `${number(written)} ${dry ? "to write" : "written"}`,
    `${number(unchanged)} unchanged`,
  ];
  if (skipped > 0) said.push(`${number(skipped)} skipped`);
  console.log(`\n${said.join(", ")}`);
  if (problems.length > 0) process.exit(1);
};

// The command line
// -----------------------------------------------------------------------------

const USAGE = `usage: npx hero <command>

  scan [handle…] [--missing] [--dry]   own_repos and repos for every entry, from GitHub`;

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (command === "scan") {
    await scan(args);
    return;
  }
  // Asked for, it is the answer; arrived at by a command nobody has, it is
  // the complaint.
  const asked = command === undefined || command === "--help" || command === "-h";
  (asked ? console.log : console.error)(USAGE);
  process.exit(asked ? 0 : 1);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
