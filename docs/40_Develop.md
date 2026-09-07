
Develop
=======


Node.js 22.13 or later.  

`npm install`  
`npm run dev` — the page, reloading as files change  
`npm run build` — a static site in `dist/`  
`npm run check` — every entry under `data/heros/`; add `--online` to ask each
link whether it answers  
`./crawl.sh` — people who might be heroes, checked against the two rules,
into `data/crawl.db`. Needs `GITHUB_TOKEN`, in the environment or `.env`, or a
signed-in `gh`  


The crawl
---------

`./crawl.sh` finds people and checks them. Finding starts from everyone under
`data/heros/`, reading who they follow and who follows them; give it handles to
start from someone else, or `--search` to ask GitHub's search for everyone
with a hundred public repositories, which is the whole population, some
hundred thousand people. Anyone short of a hundred public repositories of
their own is passed over. Checking asks each of a person's repositories its
commits and its code, a hundred repositories to a request, and counts the ones
with ten commits and more than a hundred lines; the lines are read off the
bytes GitHub counts as code, about thirty to a line, and a README alone counts
for nothing.  

Everything goes into `data/crawl.db`, a SQLite file, with a row per person and
a row per repository, so the crawl can be stopped and started again where it
left off; GitHub allows five thousand requests an hour, and the whole
population is a day or two of them. `--find` only finds, `--check` only
checks, `--check alice` checks named people whether or not they are on the
list, `--expand` goes on from everyone who passes, `--report` prints who
passes, and `--fresh` starts over.  


Deploy
------

The built site is served by `vite preview` under PM2. `.env` holds the port,
the PM2 process name and the public hostname; `.env.example` has the keys.  

`./setup.sh` — copies `.env.example` to `.env` if there is none, asks for
`HOST`, installs and builds  
`./start.sh` — starts the site under PM2, or reloads it if it is running  
`./stop.sh` — stops it  
`./restart.sh` — pulls, installs, builds and restarts  
