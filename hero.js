#!/usr/bin/env node
// The list's own command. One thing so far:
//
//   npx hero scan                  every entry, read off GitHub
//   npx hero scan dtolnay feross   only these
//   npx hero scan --missing        only the entries without the figure
//   npx hero scan --dry            say what would change, write nothing
//
// scan writes own_repos into every entry under data/heroes/: the public
// repositories the entry's accounts hold of their own, forks out — the
// repositories rule 1 is read against — which the page shows beside the name
// as "x repositories".
//
// An entry may name more than one account, and the rules read them as one, so
// the figure is the accounts added up.
//
// GitHub has counted these already and answers the number without reading a
// repository, so the whole list is a handful of requests rather than the day
// and a half a full check of it takes. What counts as their own is asked for
// the way api/account.js asks it, and the token, the pacing and the retrying
// are that file's too, so there is one place where anything talks to GitHub.
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

// Accounts to a request. Each is a number GitHub keeps and hands back as it
// is, so a page of them is one light query; twenty of them is short enough to
// read in a failure.
const BATCH = 20;

// The order an entry is written back in. own_repos goes before commits, which
// is the order the page reads them in — so many repositories, so many commits
// — and anything else an entry carries follows, as it was.
const ORDER = ["handle", "name", "github", "website", "bio", "own_repos", "commits", "apps"];

// Their own public repositories: not forks, and theirs rather than ones they
// are only a member of. The same repositories api/account.js counts, asked
// for in the same words.
const OWN = "privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER";

// A page of accounts, each asked nothing but how many it holds.
// `repositoryOwner` takes a person or an organisation, and an entry may name
// either. An account nobody has answers as nothing rather than as an error,
// which is how a handle typed wrong — or since changed — is found.
const COUNTS = (n) => {
  const each = Array.from({ length: n }, (unused, i) => i);
  return `query(${each.map((i) => `$a${i}: String!`).join(", ")}) {
    rateLimit { remaining }
    ${each
      .map((i) => `a${i}: repositoryOwner(login: $a${i}) { login own: repositories(${OWN}) { totalCount } }`)
      .join("\n    ")}
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

// The entry as it is written: the keys the list knows first, in the order it
// knows them, and whatever else the file carried after them.
const ordered = (hero) => {
  const out = {};
  for (const key of ORDER) if (key in hero) out[key] = hero[key];
  for (const key of Object.keys(hero)) if (!(key in out)) out[key] = hero[key];
  return out;
};

// The figure into the file as it stands, a line of its own before the
// commits — the two are read together — or before the applications when an
// entry has no commits. An entry is written by people as well as by this, and
// a pull request is easier to read when nothing has moved but the one line
// that changed, so the rest of the file is left exactly as it was typed.
//
// A file with nowhere to put the line comes back as nothing, and is written
// out whole instead.
const place = (text, own) => {
  if (/^ {2}"own_repos":/m.test(text)) {
    return text.replace(/^ {2}"own_repos":[^\n]*$/m, (was) =>
      `  "own_repos": ${own}${was.trimEnd().endsWith(",") ? "," : ""}`);
  }
  const before = [/^ {2}"commits":/m, /^ {2}"apps":/m].find((key) => key.test(text));
  return before === undefined ? null : text.replace(before, `  "own_repos": ${own},\n$&`);
};

// The entry, with the figure in it. The line is put where it belongs and the
// file read back to see that it says what it should; anything else — a file
// written some other way, a line that landed somewhere it should not have —
// is written out from the entry itself, ordered as the list orders it.
const write = (file, hero, own) => {
  const entry = ordered({ ...hero, own_repos: own });
  const placed = place(readFileSync(file, "utf8"), own);
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
// named, or only the ones the figure is missing from. A handle nobody has a
// file for is worth saying, since it was asked for by name.
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
    if (missing && Number.isInteger(hero.own_repos)) {
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

// How many repositories of their own each account holds, a page of accounts
// at a time. An account nobody has is left out, and whoever asked hears about
// it against the entry that named it.
const counts = async (logins, onProgress) => {
  const found = new Map();
  for (let i = 0; i < logins.length; i += BATCH) {
    const page = logins.slice(i, i + BATCH);
    const data = await graphql(
      COUNTS(page.length),
      Object.fromEntries(page.map((login, j) => [`a${j}`, login])),
    );
    page.forEach((login, j) => {
      const owner = data[`a${j}`];
      if (owner) found.set(login, owner.own.totalCount);
    });
    onProgress({ read: Math.min(i + BATCH, logins.length), of: logins.length });
  }
  return found;
};

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
    console.log(skipped > 0 ? `nothing to read: ${number(skipped)} already have the figure` : "nothing to read");
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
  for (const { handle, file, hero, accounts } of heroes) {
    const unknown = accounts.filter((login) => !found.has(login));
    if (unknown.length > 0) {
      problems.push(`${handle}: no such account on GitHub: ${unknown.join(", ")}`);
      continue;
    }
    const own = accounts.reduce((total, login) => total + found.get(login), 0);
    // What the figure is made of, when it is made of more than one account,
    // and what it was, when it was something else: the two things a reader
    // would otherwise have to go and look up.
    const parts = accounts.length > 1
      ? `  ${accounts.map((login) => `${login} ${number(found.get(login))}`).join(" + ")}`
      : "";
    const was = Number.isInteger(hero.own_repos) && hero.own_repos !== own
      ? `  was ${number(hero.own_repos)}`
      : "";
    console.log(`  ${handle.padEnd(28)} ${number(own).padStart(6)}${was}${parts}`);
    if (hero.own_repos === own) {
      unchanged++;
      continue;
    }
    if (!dry) write(file, hero, own);
    written++;
  }

  for (const text of problems) console.log(`error ${text}`);
  const said = [
    `${number(heroes.length)} ${heroes.length === 1 ? "entry" : "entries"}`,
    `${number(logins.length)} ${logins.length === 1 ? "account" : "accounts"}`,
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

  scan [handle…] [--missing] [--dry]   own_repos for every entry, from GitHub`;

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  if (command === "scan") {
    await scan(args);
    return;
  }
  console.error(USAGE);
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 1);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
