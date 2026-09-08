#!/usr/bin/env node
// Checks one GitHub account against the rules and says what it found: every
// public repository of their own that is not a fork, how many commits it has,
// and how much code is in it.
//
//   node api/account.js jaywcjlove           what it found, in a paragraph
//   node api/account.js jaywcjlove --list    every repository, one to a line
//   node api/account.js jaywcjlove --json    the answer the API gives
//
// The rules are in README.md. A repository counts when it has ten commits or
// more and more than a hundred lines of code; a hundred that count makes a
// hero, ten puts a name on the list, and one of them must carry a thousand
// commits. Forks are not asked for at all, and a mirror of someone else's
// work is passed over the way a fork is.
//
// Lines are the one thing GitHub does not give. It gives the bytes of every
// language it recognises in a repository, so lines are those bytes over
// BYTES_PER_LINE, about thirty across this repository and others measured
// beside it. The bytes are answered next to the estimate, so anyone can do
// the sum again.
//
// api/handler.js serves this over HTTP, at /api. Needs a token, GITHUB_TOKEN or
// `gh auth token`, and no dependencies, like data/crawl.js.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The rules, as README.md says them.
const HUNDRED = 100; // repositories that count, to be a hero
const TEN = 10; // repositories that count, to be on the list
const MIN_COMMITS = 10; // commits a repository needs to count
const MIN_LINES = 100; // lines of code it needs, and more than
const THOUSAND = 1000; // commits one repository must carry

// A line of code, in bytes: 30.6 across this repository, 38 and 39 across two
// others, indentation and blank lines in. Thirty is the round number under
// all three, so a repository near the line is given the benefit of it.
const BYTES_PER_LINE = 30;

// GitHub counts the bytes of every language it recognises, prose and data
// among them: a repository of a hundred Markdown files answers a hundred
// kilobytes of Markdown. The rule asks for code, so these go and everything
// else stays — HTML, CSS and a shell script are somebody's work.
const NOT_CODE = new Set([
  "Markdown", "Text", "reStructuredText", "AsciiDoc", "Creole", "Textile", "Org", "Pod",
  "Rich Text Format", "JSON", "JSON with Comments", "JSON5", "JSONLD", "YAML", "TOML", "XML",
  "INI", "CSV", "TSV", "SVG", "GeoJSON", "Gettext Catalog", "Diff", "Ignore List",
  "Git Attributes", "Git Config", "EditorConfig",
]);

// A GitHub username, lowercase, as scripts/check.js reads it off a file name.
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

const API = "https://api.github.com/graphql";
// Repositories to a request. A hundred is more than GitHub counts the commits
// of in the ten seconds it gives a query, and it answers 502; fifty takes it
// about five, and a page that fails is asked for in smaller pieces.
const PAGE = 50;
// Languages read from each repository; past twenty is a rounding error in the
// bytes, and every one of them is asked for a whole page of repositories.
const LANGUAGES = 20;
const TIMEOUT_MS = 30000;
const RETRIES = 5;
// Between one request going out and the next: thirty a minute, the pace
// data/crawl.js keeps, since GitHub turns away queries this heavy past about
// forty. Requests here are five seconds apart on their own, so it only holds
// anything back when the server runs one check after another.
const PACE_MS = 2000;
const AGENT = "heroes-check (+https://github.com/lhypds/heroes)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let TOKEN = null;

// The token, once, from the environment or from a signed-in GitHub CLI.
export const token = () => {
  if (TOKEN) return TOKEN;
  if (process.env.GITHUB_TOKEN) return (TOKEN = process.env.GITHUB_TOKEN);
  try {
    TOKEN = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("needs a token: set GITHUB_TOKEN, or sign in with `gh auth login`");
  }
  return TOKEN;
};

// GitHub
// -----------------------------------------------------------------------------

// What is asked of every repository: whether it is a repository at all, the
// commits on its default branch, and the bytes of each language in it.
const REPOSITORY = `name url isArchived isMirror isEmpty
  languages(first: ${LANGUAGES}, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name } } }
  defaultBranchRef { target { ... on Commit { history { totalCount } } } }`;

// The person and a page of their repositories. Both counts come with every
// page, which costs nothing and says how far there is to go.
const OWN = "privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER";

const QUERY = (first) => `query($login: String!, $after: String) {
  rateLimit { remaining }
  user(login: $login) {
    login name url avatarUrl
    all: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    own: repositories(${OWN}) { totalCount }
    page: repositories(${OWN}, first: ${first}, after: $after, orderBy: {field: PUSHED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { ${REPOSITORY} }
    }
  }
}`;

// How many requests the token has left this hour, as of the last answer.
let remaining = null;
export const left = () => remaining;

// Lets requests out one every PACE_MS, in the order they were asked, however
// many checks are running. A rate limit pushes the next one out past the wait.
let nextStart = 0;

const gate = async () => {
  const at = Math.max(nextStart, Date.now());
  nextStart = at + PACE_MS;
  const wait = at - Date.now();
  if (wait > 0) await sleep(wait);
};

// One query, with the waiting and the retrying data/crawl.js does: a rate
// limit is waited out, a failure on GitHub's side is asked again, and a
// handle nobody has comes back as no user rather than as an error.
const graphql = async (query, variables) => {
  const bearer = token();
  for (let attempt = 1; ; attempt++) {
    await gate();
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: { authorization: `bearer ${bearer}`, "content-type": "application/json", "user-agent": AGENT },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (attempt >= RETRIES) throw new Error(`GitHub could not be reached (${error.message})`);
      await sleep(attempt * 2000);
      continue;
    }
    if (response.status === 401) throw new Error("the token was refused");
    let json = null;
    if (response.ok) {
      try {
        json = await response.json();
      } catch (error) {
        // A body cut short is a network failure like any other.
        if (attempt >= RETRIES) throw new Error(`GitHub answered nothing (${error.message})`);
        await sleep(attempt * 2000);
        continue;
      }
    }
    const limited = response.status === 403 || response.status === 429 ||
      (json?.errors ?? []).some((error) => error.type === "RATE_LIMITED");
    if (limited) {
      // The hourly limit says when it resets; the secondary one says how long
      // to hold off, or nothing, in which case a minute.
      const retryAfter = Number(response.headers.get("retry-after")) * 1000;
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000 - Date.now();
      const wait = retryAfter > 0 ? retryAfter : reset > 0 && response.status !== 403 ? reset + 1000 : 60000;
      if (attempt >= RETRIES) throw new Error("GitHub is turning requests away; try again in a few minutes");
      // Every check in flight is turned away together, and the first to hear
      // it holds the gate for all of them.
      nextStart = Math.max(nextStart, Date.now() + wait);
      await sleep(wait);
      continue;
    }
    if (!response.ok) {
      // A 5xx is GitHub's side: a blip, or a page of repositories it could
      // not count in the ten seconds it gives a query. One more ask tells the
      // two apart, and whoever asked then decides whether to ask for fewer.
      if (attempt >= 2) throw new Error(`GitHub answered ${response.status}`);
      await sleep(2000);
      continue;
    }
    const unknown = (json.errors ?? []).every((error) => error.type === "NOT_FOUND");
    if (json.errors && !unknown) throw new Error(json.errors.map((error) => error.message).join("; "));
    remaining = json.data?.rateLimit?.remaining ?? remaining;
    return json.data ?? {};
  }
};

// The check
// -----------------------------------------------------------------------------

const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

// One repository, read against rule 2: ten commits or more, and more than a
// hundred lines of code. A repository that does not count says why.
const look = (repo) => {
  const commits = repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
  const languages = (repo.languages?.edges ?? []).filter((edge) => !NOT_CODE.has(edge.node.name));
  const bytes = languages.reduce((sum, edge) => sum + edge.size, 0);
  const lines = Math.round(bytes / BYTES_PER_LINE);
  const found = {
    name: repo.name,
    url: repo.url,
    commits,
    lines,
    bytes,
    languages: languages.slice(0, 3).map((edge) => edge.node.name),
  };
  if (repo.isArchived) found.archived = true;
  // What is short, in a word, and then in words. The word is for whoever
  // answers in another language — the page says it in six — and the sentence
  // is for whoever reads the answer as it is.
  const reason = repo.isMirror
    ? "mirror"
    : repo.isEmpty || commits === 0
      ? "empty"
      : commits < MIN_COMMITS
        ? "commits"
        : bytes === 0
          ? "prose"
          : lines <= MIN_LINES
            ? "lines"
            : null;
  const why = {
    mirror: "a mirror of someone else's work",
    empty: "empty",
    commits: plural(commits, "commit"),
    prose: "no code, only prose or data",
    lines: `about ${plural(lines, "line")} of code`,
  };
  return reason === null ? found : { ...found, reason, why: why[reason] };
};

// Reads a whole account and says whether it meets the rules. `onProgress` is
// called with how many repositories have been read of how many there are, so
// a caller can say so while it waits. A handle nobody has answers null.
export const check = async (handle, options = {}) => {
  const login = String(handle ?? "").trim().toLowerCase();
  if (!HANDLE.test(login)) throw new Error(`"${handle}" is not a GitHub username`);
  const onProgress = options.onProgress ?? (() => {});

  let first = options.page ?? PAGE;
  let after = null;
  let user = null;
  let read = 0;
  const counted = [];
  const passedOver = [];

  for (;;) {
    let data;
    try {
      data = await graphql(QUERY(first), { login, after });
    } catch (error) {
      // GitHub gives a query ten seconds and answers 502 when counting the
      // commits of a page of repositories takes longer. Fewer at a time from
      // the same place gets through; `after` is where this page began.
      const fewer = first > 25 ? 25 : first > 10 ? 10 : 0;
      if (fewer > 0 && /answered 5\d\d|reached/i.test(error.message)) {
        first = fewer;
        continue;
      }
      throw error;
    }
    if (!data.user) return null;
    user = data.user;
    for (const repo of user.page.nodes) {
      const found = look(repo);
      (found.why === undefined ? counted : passedOver).push(found);
    }
    read += user.page.nodes.length;
    onProgress({ read, of: user.own.totalCount });
    if (!user.page.pageInfo.hasNextPage) break;
    after = user.page.pageInfo.endCursor;
  }

  const byCommits = (a, b) => b.commits - a.commits || a.name.localeCompare(b.name);
  counted.sort(byCommits);
  passedOver.sort(byCommits);
  // Rule 3 asks for one repository with a thousand commits; it is read off
  // the ones that count, since a repository that is not code is not one of
  // yours to point at either.
  const busiest = counted[0] ?? null;

  return {
    handle: user.login,
    name: user.name,
    url: user.url,
    avatar: user.avatarUrl,
    checkedAt: new Date().toISOString(),
    repositories: { public: user.all.totalCount, own: user.own.totalCount, read },
    rules: {
      // 1. A hundred public repositories of your own that count.
      repositories: { need: HUNDRED, have: counted.length, ok: counted.length >= HUNDRED },
      // 2. What made them count, and how many did not.
      code: {
        commits: MIN_COMMITS,
        lines: MIN_LINES,
        bytesPerLine: BYTES_PER_LINE,
        counted: counted.length,
        passedOver: passedOver.length,
      },
      // 3. One of them with a thousand commits.
      commits: {
        need: THOUSAND,
        have: busiest?.commits ?? 0,
        repository: busiest?.name ?? null,
        ok: (busiest?.commits ?? 0) >= THOUSAND,
      },
    },
    hero: counted.length >= HUNDRED && (busiest?.commits ?? 0) >= THOUSAND,
    listed: counted.length >= TEN,
    counted,
    passedOver,
  };
};

// The command line
// -----------------------------------------------------------------------------

const HEADING = `  ${"repository".padEnd(32)} ${"commits".padStart(8)} ${"lines".padStart(9)}  languages`;

const line = (repo) =>
  `  ${repo.name.padEnd(32)} ${String(repo.commits).padStart(8)} ${String(repo.lines).padStart(9)}` +
  `  ${repo.languages.join(", ")}${repo.why ? `  — ${repo.why}` : ""}`;

const say = (report, list) => {
  const { rules } = report;
  const who = report.name ? `${report.handle} (${report.name})` : report.handle;
  console.log(`${who} — ${report.url}`);
  const own = report.repositories.own;
  console.log(
    `${own.toLocaleString("en-US")} public ${own === 1 ? "repository" : "repositories"} of their own, ` +
      `${report.repositories.public.toLocaleString("en-US")} counting forks`,
  );
  console.log(
    `${rules.code.counted.toLocaleString("en-US")} count: ${rules.code.commits} commits or more, ` +
      `more than ${rules.code.lines} lines of code. ${rules.code.passedOver.toLocaleString("en-US")} do not`,
  );
  console.log(
    rules.commits.repository === null
      ? "no repository with commits to speak of"
      : `the busiest is ${rules.commits.repository}, ${plural(rules.commits.have, "commit")}`,
  );
  if (list) {
    if (report.counted.length > 0) console.log(`\nthese count:\n${HEADING}`);
    for (const repo of report.counted) console.log(line(repo));
    if (report.passedOver.length > 0) console.log(`\nthese do not:\n${HEADING}`);
    for (const repo of report.passedOver) console.log(line(repo));
  }
  console.log("");
  console.log(
    report.hero
      ? `a hero: a hundred repositories that count, and one with ${THOUSAND.toLocaleString("en-US")} commits`
      : report.listed
        ? `on the list, ${rules.repositories.have} of ${HUNDRED}` +
          (rules.commits.ok ? "" : `, and no repository with ${THOUSAND.toLocaleString("en-US")} commits yet`)
        : `${rules.repositories.have} of the ${TEN} the list starts at`,
  );
};

const main = async () => {
  const args = process.argv.slice(2);
  const handle = args.find((arg) => !arg.startsWith("--"));
  if (!handle) {
    console.error("usage: node api/account.js <handle> [--list] [--json]");
    process.exit(1);
  }
  const json = args.includes("--json");
  const report = await check(handle, {
    onProgress: process.stdout.isTTY && !json
      ? ({ read, of }) => process.stdout.write(`\r\x1b[Kreading ${read} of ${of}…`)
      : () => {},
  });
  if (process.stdout.isTTY && !json) process.stdout.write("\r\x1b[K");
  if (!report) {
    console.error(`no such user: ${handle}`);
    process.exit(1);
  }
  if (json) console.log(JSON.stringify(report, null, 2));
  else say(report, args.includes("--list"));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
