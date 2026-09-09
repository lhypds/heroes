#!/usr/bin/env node
// Reads every entry under data/heroes/ and says what is missing. Run it with
// --online to also ask each link whether it answers; the pull request check
// does, so an entry that points at a private repository is caught before a
// person reads it.
//
// No dependencies: this is what a contributor runs before opening a pull
// request, and it should work the moment the repository is cloned.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../data/heroes/", import.meta.url));
// Ten to join; there is no ceiling. The count beside a name keeps climbing
// past a hundred, and the page unfolds the first hundred of the list.
const MIN_APPS = 10;
const LANGS = ["en", "zh", "ja", "fr", "es", "de"];
// A GitHub username, in lowercase because it is also the file name.
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const ONLINE = process.argv.includes("--online");
const TIMEOUT_MS = 15000;
const PARALLEL = 4;

const problems = [];
const warnings = [];
const problem = (file, text) => problems.push(`${file}: ${text}`);
const warn = (file, text) => warnings.push(`${file}: ${text}`);

const isText = (value) => typeof value === "string" && value.trim().length > 0;

const isHttps = (value) => {
  if (!isText(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

// A person may keep more than one account — a personal one, an organisation
// of their own — and the rules read them as one, so github is a list. A lone
// address is read as a list of one.
const accountsOf = (github) => {
  if (Array.isArray(github)) return github;
  return github === undefined ? [] : [github];
};

// Every account is a profile address, https://github.com/<handle>, and each
// one is listed once. The first is the account the entry is named for.
const checkAccounts = (file, github) => {
  const list = accountsOf(github);
  if (list.length === 0) {
    problem(file, `github must be a list of profile addresses, ["https://github.com/<handle>"]`);
    return;
  }
  const seen = new Set();
  list.forEach((url, i) => {
    const where = Array.isArray(github) ? `github[${i}]` : "github";
    if (!isHttps(url)) {
      problem(file, `${where} must be an https:// address`);
    } else if (!/^https:\/\/github\.com\/[^/]+\/?$/i.test(url)) {
      problem(file, `${where} must be a profile address, https://github.com/<handle>`);
    } else if (seen.has(url.toLowerCase())) {
      problem(file, `${where} is listed twice: ${url}`);
    } else {
      seen.add(url.toLowerCase());
    }
  });
};

// A description is English, or an object of translations that at least says
// it in English.
const checkLocalised = (file, where, value, required) => {
  if (value === undefined) {
    if (required) problem(file, `${where} is missing`);
    return;
  }
  if (isText(value)) return;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (!isText(value.en)) problem(file, `${where} needs an "en" text`);
    for (const code of Object.keys(value)) {
      if (!LANGS.includes(code)) {
        problem(file, `${where} has an unknown language "${code}" (one of ${LANGS.join(", ")})`);
      } else if (!isText(value[code])) {
        problem(file, `${where}.${code} is empty`);
      }
    }
    return;
  }
  problem(file, `${where} must be a text or an object of translations`);
};

const checkApp = (file, app, i, seen) => {
  const where = `apps[${i}]`;
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    problem(file, `${where} is not an object`);
    return;
  }
  const label = isText(app.name) ? `${where} (${app.name})` : where;
  if (!isText(app.name)) problem(file, `${where} needs a name`);
  checkLocalised(file, `${label}.description`, app.description, true);
  if (!isHttps(app.repo)) {
    problem(file, `${label}.repo must be an https:// address`);
  } else if (seen.has(app.repo)) {
    problem(file, `${label}.repo is listed twice: ${app.repo}`);
  } else {
    seen.add(app.repo);
  }
  if (app.url !== undefined && !isHttps(app.url)) problem(file, `${label}.url must be an https:// address`);
  if (app.language !== undefined && !isText(app.language)) problem(file, `${label}.language is empty`);
  if (app.platform !== undefined && !isText(app.platform)) problem(file, `${label}.platform is empty`);
};

const checkLead = (file, lead) => {
  const handle = basename(file, ".json");
  if (!HANDLE.test(handle)) problem(file, `the file name must be a lowercase GitHub username`);
  if (lead.handle !== handle) problem(file, `handle must be "${handle}", the same as the file name`);
  if (!isText(lead.name)) problem(file, `name is missing`);
  checkAccounts(file, lead.github);
  if (lead.website !== undefined && !isHttps(lead.website)) problem(file, `website must be an https:// address`);
  checkLocalised(file, "bio", lead.bio, false);
  // How many repositories of their own they hold and what those come to in
  // commits, the two figures the page shows beside the name. Whether either
  // is right is read by a person, the way the rules themselves are — or
  // written by `npx hero scan`, which reads the first off GitHub; this only
  // asks that they are whole numbers.
  if (lead.own_repos !== undefined && !(Number.isInteger(lead.own_repos) && lead.own_repos >= 0)) {
    problem(file, `own_repos must be a whole number of repositories`);
  }
  if (lead.commits !== undefined && !(Number.isInteger(lead.commits) && lead.commits >= 0)) {
    problem(file, `commits must be a whole number of commits`);
  }

  if (!Array.isArray(lead.apps)) {
    problem(file, `apps must be a list`);
    return;
  }
  if (lead.apps.length < MIN_APPS) problem(file, `${lead.apps.length} applications — the list starts at ${MIN_APPS}`);
  const seen = new Set();
  lead.apps.forEach((app, i) => checkApp(file, app, i, seen));
};

// Every link an entry makes, with whether a failure is a problem (the
// repository, which is the open-source claim itself) or a mention (everything
// else — a store page can turn a script away and still be there).
const linksOf = (file, lead) => {
  const links = [];
  for (const url of accountsOf(lead.github)) {
    if (isHttps(url)) links.push({ file, url, required: false });
  }
  if (isHttps(lead.website)) links.push({ file, url: lead.website, required: false });
  for (const app of Array.isArray(lead.apps) ? lead.apps : []) {
    if (!app || typeof app !== "object") continue;
    if (isHttps(app.repo)) links.push({ file, url: app.repo, required: true, name: app.name });
    if (isHttps(app.url)) links.push({ file, url: app.url, required: false, name: app.name });
  }
  return links;
};

const answers = async (url) => {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "tech-leads-check (+https://github.com/lhypds/heroes)" },
    });
    return response.ok ? null : `answered ${response.status}`;
  } catch (error) {
    return error.name === "TimeoutError" ? "did not answer in time" : `could not be reached (${error.message})`;
  }
};

const checkOnline = async (links) => {
  const queue = [...links];
  const worker = async () => {
    for (let link = queue.shift(); link; link = queue.shift()) {
      const failure = await answers(link.url);
      if (!failure) continue;
      const text = `${link.name ? `${link.name}: ` : ""}${link.url} ${failure}`;
      if (link.required) problem(link.file, text);
      else warn(link.file, text);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
};

const main = async () => {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    console.error("no entries under data/heroes/");
    process.exit(1);
  }

  let apps = 0;
  const links = [];
  for (const name of files) {
    const file = `data/heroes/${name}`;
    let lead;
    try {
      lead = JSON.parse(readFileSync(join(DIR, name), "utf8"));
    } catch (error) {
      problem(file, `is not JSON (${error.message})`);
      continue;
    }
    if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
      problem(file, `must be an object`);
      continue;
    }
    checkLead(file, lead);
    if (Array.isArray(lead.apps)) apps += lead.apps.length;
    links.push(...linksOf(file, lead));
  }

  if (ONLINE && problems.length === 0) {
    console.log(`asking ${links.length} links…`);
    await checkOnline(links);
  }

  for (const text of warnings) console.log(`note  ${text}`);
  for (const text of problems) console.log(`error ${text}`);
  if (problems.length > 0) {
    console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log(`${files.length} lead${files.length === 1 ? "" : "s"}, ${apps} applications, ok`);
};

main();
