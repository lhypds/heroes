
Develop
=======


Node.js 22.13 or later.  

`pnpm install`  
`pnpm run dev` — the page, reloading as files change, on `PORT` from `.env`  
`pnpm run build` — a static site in `dist/`  
`pnpm run check` — every entry under `data/heroes/`; add `--online` to ask
each link whether it answers  
`pnpm run account -- <handle>` — one GitHub account read against the rules,
or several with commas between, counted together; `--list` says it repository
by repository, `--json` as the API answers it  
`npx hero scan` — `own_repos` and `repos` for every entry under
`data/heroes/`, read off GitHub; handles restrict it to those entries,
`--missing` to the ones without either, and `--dry` says what would change
without writing  
`./crawl.sh` — people who might be heroes, into `data/crawl.db`  

The same check answers over HTTP under `/api`, on the page's own port:
`pnpm run dev` and `pnpm run preview` both serve it, and there is no second
process and nothing proxied. [Check an account](30_Check%20an%20account.md)
has the addresses and what the numbers mean.  

The account check, the scan and the crawl all need a GitHub token:
`GITHUB_TOKEN`, in the environment or `.env`, or a signed-in `gh`.  


The scan
--------

`npx hero scan` writes `own_repos` into every entry: how many public
repositories of their own the entry's accounts hold, forks out, which is the
figure the page shows beside the name. An entry naming more than one account
is the accounts added up, since the rules read them as one.  

It writes `repos` beside it: a hundred of those repositories, the ones pushed
to most recently — a `name`, the `repo`, the `url` where the repository names
a home page of its own, and the `language` it is mostly written in. An entry
naming more than one account is the accounts merged, newest push first.  

GitHub keeps the count itself and hands it back without reading a single
repository, and it orders repositories by their last push itself, so the whole
list is a handful of requests — ten accounts to one — rather than the days a
full check of it takes. The token, the pace and the retrying are
`api/account.js`'s, and so is what counts as their own, asked for in the same
words. The figure goes into the file on a line of its own and the list between
the commits and the applications, and nothing else moves, so a scan of an
entry someone typed by hand reads as the lines it changed. The list moves
whenever anything was pushed to, so an entry is left alone only when both the
figure and the list are what they were.  

`PORT` in `.env` is the port, and the only one: development, preview and the
PM2 process all listen on it, so what is developed on is what is deployed on.
A port already taken fails loudly rather than quietly moving to the next one,
which means development and preview cannot both be up at once.  


The crawl
---------

`./crawl.sh` finds people with a hundred public repositories of their own.
Two counts decide, and both come in the same request as the person: their
public repositories with forks in, and the same with forks out. A hundred of
each keeps them; anyone short of either is passed over and not written.
Whether the repositories are real code is not asked; that is read by whoever
writes the entry.  

Finding starts from everyone under `data/heroes/`, reading who they follow and
who follows them, a hundred people to a request; give it handles to start
from someone else, and they are looked at too, or `--search` to ask GitHub's
search for everyone with a hundred public repositories, which is the whole
population, some quarter of a million people, a few thousand requests.
GitHub allows five thousand requests an hour but turns away queries this
heavy past about forty a minute, so they go out thirty a minute, slices and
seeds side by side: ten thousand people in three or four minutes, the whole
population in an hour and a half.  

Everything goes into `data/crawl.db`, a SQLite file, with a row per person,
so the crawl can be stopped and started again where it left off. `--expand`
goes on from everyone found,
`--report` prints who was found, most repositories first, and `--fresh` starts
over; a file from an earlier `crawl.js`, with other rules, asks for it.  


The cleaning
------------

`pnpm run cleaning` takes out of `data/crawl.db` the people the crawl kept
who are plainly not heroes, in steps, and writes whoever goes to
`data/cleaning/step<n>.json`, one file a step, with everything the crawl
knew about them and the reason.  

Step 1 is a query: anyone with no name, no location, no website and no
followers goes. Step 2 asks GitHub about everyone left, one person to a
request: the commits on the default branch of their hundred most recently
pushed repositories of their own, and under ten a repository on average, they
go. The commits are counted whoever made them, since one made with an
assistant or a bot is still the person's work; how many they made under
their own name is counted beside it and kept, which needs their GitHub id,
looked up a hundred people to a request. A hundred repositories take GitHub about nine
of the ten seconds it gives a request, so a person it cannot manage is asked
for fifty at a time, then twenty-five, then ten. Both counts are saved on
the person, so a run cut short carries on where it left off.  

These requests are heavy, and GitHub allows only so much of its own time a
minute before turning them away for five; the gate keeps the last minute's
answer time under a budget it adjusts as it goes, and never lets out more
than thirty a minute, like the crawl. With a hundred repositories that is
about ten people a minute, three or four days for everyone the crawl found.
`--repos 25` or `--repos 10` counts the first twenty-five or ten instead,
against the same ten a repository, at the full thirty a minute: some thirty
hours.  

`--step1` or `--step2` runs one step, `--dry` counts and says who would go
without removing anyone, handles on the command line restrict a step to those
people, `--report` says how many are left and how many went and why, and
`--export` writes the JSON files again from the database.  


Deploy
------

The built site is served by `vite preview` under PM2, with the account check
mounted on the same server at `/api`: one process, one port, nothing proxied.
`.env` holds the port, the PM2 process name, the public hostname and the
GitHub token; `.env.example` has the keys. There is no `gh` for the process
PM2 starts, so `GITHUB_TOKEN` has to be in `.env` or the check is off — the
page says so, and `/api/health` answers `no token`.  

`./setup.sh` — copies `.env.example` to `.env` if there is none, asks for
`HOST`, installs and builds  
`./start.sh` — starts the site under PM2, or reloads it if it is running  
`./stop.sh` — stops it  
`./restart.sh` — pulls, installs, builds and restarts  
