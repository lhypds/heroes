
Develop
=======


Node.js 22.13 or later.  

`npm install`  
`npm run dev` — the page, reloading as files change  
`npm run build` — a static site in `dist/`  
`npm run check` — every entry under `data/heros/`; add `--online` to ask each
link whether it answers  
`./crawl.sh` — people who might be heroes, into `data/crawl.db`. Needs
`GITHUB_TOKEN`, in the environment or `.env`, or a signed-in `gh`  


The crawl
---------

`./crawl.sh` finds people with a hundred public repositories of their own.
Two counts decide, and both come in the same request as the person: their
public repositories with forks in, and the same with forks out. A hundred of
each keeps them; anyone short of either is passed over and not written.
Whether the repositories are real code is not asked; that is read by whoever
writes the entry.  

Finding starts from everyone under `data/heros/`, reading who they follow and
who follows them, a hundred people to a request; give it handles to start
from someone else, and they are looked at too, or `--search` to ask GitHub's
search for everyone with a hundred public repositories, which is the whole
population, some quarter of a million people, a few thousand requests.  

Everything goes into `data/crawl.db`, a SQLite file, with a row per person,
so the crawl can be stopped and started again where it left off; GitHub
allows five thousand requests an hour. `--expand` goes on from everyone found,
`--report` prints who was found, most repositories first, and `--fresh` starts
over; a file from an earlier `crawl.js`, with other rules, asks for it.  


Deploy
------

The built site is served by `vite preview` under PM2. `.env` holds the port,
the PM2 process name and the public hostname; `.env.example` has the keys.  

`./setup.sh` — copies `.env.example` to `.env` if there is none, asks for
`HOST`, installs and builds  
`./start.sh` — starts the site under PM2, or reloads it if it is running  
`./stop.sh` — stops it  
`./restart.sh` — pulls, installs, builds and restarts  
