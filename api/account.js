#!/usr/bin/env node
// Checks a GitHub account against the rules and says what it found: every
// public repository of their own that is not a fork, how many commits it has,
// and how much code is in it.
//
//   node api/account.js jaywcjlove           what it found, in a paragraph
//   node api/account.js jaywcjlove --list    every repository, one to a line
//   node api/account.js jaywcjlove --json    the answer the API gives
//
// An account is a person or an organisation, and several of them can be read
// as one, since a person's work is often spread over more than one:
//
//   node api/account.js jaywcjlove,uiwjs     both accounts, counted together
//
// The rules are in README.md. A repository counts when it has ten commits or
// more and more than a hundred lines of code; a hundred that count makes a
// hero, ten puts a name on the list, and one of them must carry a thousand
// commits. Forks are not asked for at all, and a mirror of someone else's
// work is passed over the way a fork is.
//
// The commits are added up as they are read, so the answer also says how many
// there are in all — every repository read, and the ones that count.
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

// A GitHub account name, lowercase, as scripts/check.js reads it off a file
// name. A person and an organisation are named the same way and read the same
// way, so one pattern does for both.
const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
// Accounts one check may put together. Each is a few hundred repositories read
// fifty at a time, so this is already a minute or two of GitHub's patience.
export const MAX_ACCOUNTS = 5;

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

// The account and a page of its repositories. Both counts come with every
// page, which costs nothing and says how far there is to go.
//
// `repositoryOwner` is asked for rather than `user`, because an organisation
// owns repositories the same way a person does and the page takes either. The
// two are one type as far as this goes; only the display name has to be asked
// for of each in turn.
const OWN = "privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER";

const QUERY = (first) => `query($login: String!, $after: String) {
  rateLimit { remaining }
  owner: repositoryOwner(login: $login) {
    __typename login url avatarUrl
    ... on User { name }
    ... on Organization { name }
    all: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
    own: repositories(${OWN}) { totalCount }
    page: repositories(${OWN}, first: ${first}, after: $after, orderBy: {field: PUSHED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes { ${REPOSITORY} }
    }
  }
}`;

// Whether the accounts asked for are there at all, all in one request. A name
// typed wrong among several would otherwise be found only after the ones
// before it had been read for nothing — a minute of waiting for an answer that
// was known at the start.
const EXISTS = (n) => {
  const each = Array.from({ length: n }, (unused, i) => i);
  return `query(${each.map((i) => `$a${i}: String!`).join(", ")}) {
    rateLimit { remaining }
    ${each.map((i) => `a${i}: repositoryOwner(login: $a${i}) { login }`).join("\n    ")}
  }`;
};

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

// A handle nobody has. It stops the check the way any other failure does, but
// whoever asked should hear which of the names was wrong, so it carries it.
export class NoSuchAccount extends Error {
  constructor(handle) {
    super(`no such account on GitHub: ${handle}`);
    this.handle = handle;
  }
}

// One repository, read against rule 1: ten commits or more, and more than a
// hundred lines of code. A repository that does not count says why. It is
// answered with the account that owns it, since several can be read as one and
// two accounts may both have a repository called dotfiles.
const look = (repo, owner) => {
  const commits = repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
  const languages = (repo.languages?.edges ?? []).filter((edge) => !NOT_CODE.has(edge.node.name));
  const bytes = languages.reduce((sum, edge) => sum + edge.size, 0);
  const lines = Math.round(bytes / BYTES_PER_LINE);
  const found = {
    owner,
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

// Something wrong with what was asked for rather than with the answer. The
// reason is a word, so whoever answers in another language has something to
// answer with; the message is the same thing in a sentence.
const badly = (reason, message) => Object.assign(new Error(message), { reason });

// What was asked for, as a list of handles: one name, or several separated by
// commas. The same account named twice is the same account.
export const handles = (asked) => {
  const named = (Array.isArray(asked) ? asked : String(asked ?? "").split(","))
    .map((each) => String(each).trim().toLowerCase())
    .filter((each) => each !== "");
  const logins = [...new Set(named)];
  if (logins.length === 0) throw badly("notAName", "no account named");
  for (const login of logins) {
    if (!HANDLE.test(login)) throw badly("notAName", `"${login}" is not a GitHub username`);
  }
  if (logins.length > MAX_ACCOUNTS) {
    throw badly("tooMany", `at most ${MAX_ACCOUNTS} accounts at a time`);
  }
  return logins;
};

// Reads one account, page by page, and answers who it is and what is in it.
// A handle nobody has throws NoSuchAccount.
const one = async (login, options) => {
  const onProgress = options.onProgress ?? (() => {});
  let first = options.page ?? PAGE;
  let after = null;
  let owner = null;
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
    if (!data.owner) throw new NoSuchAccount(login);
    owner = data.owner;
    for (const repo of owner.page.nodes) {
      const found = look(repo, owner.login);
      (found.why === undefined ? counted : passedOver).push(found);
    }
    read += owner.page.nodes.length;
    onProgress({ read, of: owner.own.totalCount });
    if (!owner.page.pageInfo.hasNextPage) break;
    after = owner.page.pageInfo.endCursor;
  }

  return {
    account: {
      handle: owner.login,
      name: owner.name,
      url: owner.url,
      avatar: owner.avatarUrl,
      // "user" or "organization", so a reader can tell which kind it was.
      type: owner.__typename.toLowerCase(),
      public: owner.all.totalCount,
      own: owner.own.totalCount,
      read,
    },
    counted,
    passedOver,
  };
};

// Reads one or more accounts and says whether what they hold between them
// meets the rules. Several are read one after another and counted as one, so
// work spread over a personal account and an organisation is read as the one
// body of work it is.
//
// `onProgress` is called with how many repositories have been read of how many
// there are in the account being read, and which account that is of how many,
// so a caller can say so while it waits.
export const check = async (asked, options = {}) => {
  const logins = handles(asked);
  const onProgress = options.onProgress ?? (() => {});

  // One account says whether it is there on its own first page, and needs no
  // asking twice; several are worth asking about first.
  if (logins.length > 1) {
    const found = await graphql(
      EXISTS(logins.length),
      Object.fromEntries(logins.map((login, i) => [`a${i}`, login])),
    );
    const missing = logins.find((login, i) => !found[`a${i}`]);
    if (missing) throw new NoSuchAccount(missing);
  }

  const accounts = [];
  const counted = [];
  const passedOver = [];
  for (const [index, login] of logins.entries()) {
    const found = await one(login, {
      page: options.page,
      onProgress: ({ read, of }) =>
        onProgress({ read, of, account: login, index: index + 1, accounts: logins.length }),
    });
    accounts.push(found.account);
    counted.push(...found.counted);
    passedOver.push(...found.passedOver);
  }

  const full = (repo) => `${repo.owner}/${repo.name}`;
  const byCommits = (a, b) => b.commits - a.commits || full(a).localeCompare(full(b));
  counted.sort(byCommits);
  passedOver.sort(byCommits);
  // Rule 2 asks for one repository with a thousand commits; it is read off
  // the ones that count, since a repository that is not code is not one of
  // yours to point at either.
  const busiest = counted[0] ?? null;
  const sum = (what) => accounts.reduce((total, account) => total + account[what], 0);
  const commitsIn = (repos) => repos.reduce((total, repo) => total + repo.commits, 0);

  return {
    handles: accounts.map((account) => account.handle),
    accounts,
    checkedAt: new Date().toISOString(),
    repositories: { public: sum("public"), own: sum("own"), read: sum("read") },
    // Commits in all: over every repository read, and over the ones that
    // count. Neither is a rule; they are what the reading adds up to.
    commits: { total: commitsIn(counted) + commitsIn(passedOver), counted: commitsIn(counted) },
    rules: {
      // 1. A hundred public repositories of your own that are real code: what
      // counted, and what was sifted out to get there.
      repositories: {
        need: HUNDRED,
        have: counted.length,
        ok: counted.length >= HUNDRED,
        passedOver: passedOver.length,
      },
      // What made a repository count, for anyone doing the sum again.
      code: {
        commits: MIN_COMMITS,
        lines: MIN_LINES,
        bytesPerLine: BYTES_PER_LINE,
        counted: counted.length,
        passedOver: passedOver.length,
      },
      // 2. One of them with a thousand commits.
      commits: {
        need: THOUSAND,
        have: busiest?.commits ?? 0,
        owner: busiest?.owner ?? null,
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

// A repository, named as it has to be: on its own when one account was read,
// and owner and all when several were, since the names may collide.
const named = (repo, several) => (several ? `${repo.owner}/${repo.name}` : repo.name);

const line = (repo, several) =>
  `  ${named(repo, several).padEnd(32)} ${String(repo.commits).padStart(8)} ${String(repo.lines).padStart(9)}` +
  `  ${repo.languages.join(", ")}${repo.why ? `  — ${repo.why}` : ""}`;

const say = (report, list) => {
  const { rules } = report;
  const several = report.accounts.length > 1;
  for (const account of report.accounts) {
    const who = account.name ? `${account.handle} (${account.name})` : account.handle;
    console.log(`${who} — ${account.url}`);
  }
  const own = report.repositories.own;
  console.log(
    `${own.toLocaleString("en-US")} public ${own === 1 ? "repository" : "repositories"} of their own, ` +
      `${report.repositories.public.toLocaleString("en-US")} counting forks` +
      (several ? `, across ${report.accounts.length} accounts` : ""),
  );
  console.log(
    `${rules.code.counted.toLocaleString("en-US")} count: ${rules.code.commits} commits or more, ` +
      `more than ${rules.code.lines} lines of code. ${rules.code.passedOver.toLocaleString("en-US")} do not`,
  );
  console.log(
    `${plural(report.commits.total, "commit")} in all, ` +
      `${report.commits.counted.toLocaleString("en-US")} of them in the ones that count`,
  );
  console.log(
    rules.commits.repository === null
      ? "no repository with commits to speak of"
      : `the busiest is ${named({ owner: rules.commits.owner, name: rules.commits.repository }, several)}, ` +
        plural(rules.commits.have, "commit"),
  );
  if (list) {
    if (report.counted.length > 0) console.log(`\nthese count:\n${HEADING}`);
    for (const repo of report.counted) console.log(line(repo, several));
    if (report.passedOver.length > 0) console.log(`\nthese do not:\n${HEADING}`);
    for (const repo of report.passedOver) console.log(line(repo, several));
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
  // Several accounts can be given with commas, or as separate words, since a
  // shell makes that easy and the meaning is the same.
  const asked = args.filter((arg) => !arg.startsWith("--")).join(",");
  if (!asked) {
    console.error("usage: node api/account.js <handle[,handle…]> [--list] [--json]");
    process.exit(1);
  }
  const json = args.includes("--json");
  const many = handles(asked).length > 1;
  const report = await check(asked, {
    onProgress: process.stdout.isTTY && !json
      ? ({ read, of, account, index, accounts }) =>
        process.stdout.write(
          `\r\x1b[Kreading ${read} of ${of}…${many ? ` (${account}, ${index} of ${accounts})` : ""}`,
        )
      : () => {},
  });
  if (process.stdout.isTTY && !json) process.stdout.write("\r\x1b[K");
  if (json) console.log(JSON.stringify(report, null, 2));
  else say(report, args.includes("--list"));
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
