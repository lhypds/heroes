Check an account
================


Give it a GitHub username and it reads that account against the rules: every
public repository of their own that is not a fork, how many commits it has,
and how much code is in it.  

`pnpm run account -- <handle>` — on the command line  
`pnpm run account -- <handle> --list` — and every repository, one to a line  
`pnpm run account -- <handle> --json` — the answer as the API gives it  

The same check answers over HTTP under `/api`, on the page's own port. It is
a piece of middleware the page's server mounts (`api/plugin.js`), so
`pnpm run dev` and `pnpm run preview` both answer it: one port, one process,
one address from outside.  

The page asks it too. Under the rules in "Be a hero" there is a box that takes
a username and sets the answer out: the score out of a hundred, the three
rules with what the account has against each, and, unfolded, every repository
that counts and every one that does not.  


The API
-------

```
GET /api/check/<handle>
```

Reading a couple of hundred repositories takes half a minute, longer than a
browser or a proxy will hold a connection open. So the first ask starts the
check and answers `202` with how far it has got:  

```json
{ "status": "running", "handle": "jaywcjlove", "read": 100, "of": 222, "waiting": 0, "seconds": 12 }
```

Ask again, every second or two, until it answers `200`:  

```json
{
  "status": "done",
  "handle": "jaywcjlove",
  "name": "小弟调调",
  "url": "https://github.com/jaywcjlove",
  "checkedAt": "2026-09-08T20:16:23.170Z",
  "repositories": { "public": 223, "own": 222, "read": 222 },
  "rules": {
    "repositories": { "need": 100, "have": 144, "ok": true },
    "code": { "commits": 10, "lines": 100, "bytesPerLine": 30, "counted": 144, "passedOver": 78 },
    "commits": { "need": 1000, "have": 2983, "repository": "awesome-mac", "ok": true }
  },
  "hero": true,
  "listed": true,
  "counted": [
    { "name": "awesome-mac", "url": "https://github.com/jaywcjlove/awesome-mac",
      "commits": 2983, "lines": 872, "bytes": 26157, "languages": ["Swift", "Dockerfile"] }
  ],
  "passedOver": [
    { "name": "reference", "url": "https://github.com/jaywcjlove/reference",
      "commits": 2273, "lines": 9, "bytes": 271, "languages": ["Dockerfile"],
      "reason": "lines", "why": "about 9 lines of code" }
  ]
}
```

`counted` are the repositories that meet rule 2, busiest first; `passedOver`
are the rest, each saying what is short: `reason` in a word — `mirror`,
`empty`, `commits`, `prose` or `lines` — for whoever answers in another
language, and `why` in a sentence for whoever reads it as it is. `waiting` is
how many checks are ahead of this one in the queue.  

The other answers: `400` the name is not a GitHub username, `404` nobody has
it, `429` too many checks from one address this hour, `503` too many waiting,
`502` GitHub would not answer, with `error` saying what happened.  

`GET /api/health` says whether it is up and what the token has left this hour.  

An answer stands for an hour, and everyone asking about the same handle rides
the same run. Asking again about a check already running costs nothing, so a
page may poll as it likes; only starting a new check is counted, twenty an
hour from one address.  


What it counts
--------------

The three rules are in [README.md](../README.md). This is how each is read.  

A repository counts when it is public, yours, not a fork and not a mirror,
has **10 commits or more** on its default branch, and holds **more than 100
lines of code**. Commits are counted whoever made them, since one made with
an assistant is still your work. Archived repositories count; they were real
when they were written.  

A hundred that count makes a hero — `hero` — and one of them must carry a
thousand commits. Ten puts a name on the list — `listed`.  


Lines
-----

Lines are the one thing GitHub does not give. What it gives is the bytes of
every language it recognises in a repository, so lines are those bytes over
thirty, which is about what a line of code weighs: 30.6 bytes across this
repository, 38 and 39 across two others measured beside it. Thirty is the
round number under all three, so a repository near the line is given the
benefit of it. The bytes are answered next to the estimate, and the languages
beside them, so the sum can be done again by hand.  

GitHub counts prose and data among its languages — a repository of a hundred
Markdown files answers a hundred kilobytes of Markdown — and the rule asks
for code, so Markdown, JSON, YAML, XML and the like are taken out first.
Everything else stays: HTML, CSS and a shell script are somebody's work.
`NOT_CODE` in [api/account.js](../api/account.js) is the whole list.  

The estimate is what makes this a check and not a verdict. A repository with
a few thousand bytes of code either way of the line is worth a person's eye,
and an entry is still read by a person before it is merged.  


The token, and the pace
-----------------------

The check needs a GitHub token, `GITHUB_TOKEN` in the environment or in
`.env`, or a signed-in `gh`. The requests behind it are heavy — a page of
fifty repositories takes GitHub about five seconds to count the commits of —
and GitHub turns queries this heavy away past about forty a minute. So they
go out thirty a minute, one check at a time, and the checks behind stand in a
queue.  

That is one token for everybody the API answers. A public deployment of it is
as fast as a hundred repositories a minute, and no faster.  
