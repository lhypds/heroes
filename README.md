
Tech Leads
==========


A public list of programmers who have built a hundred applications, each one
released with its source open for anyone to read.  

The bar to join is ten. Ten public, open-source applications put a name on the
list; the count beside it runs to a hundred. Anyone can check an entry, and
anyone can add one with a pull request.  

A hundred makes a hero. Nobody has one yet, and the page says so in its
largest type until somebody does — then the same line names them.  

On the page each name is closed; press it and the applications unfold. A link
to one person, `#handle`, arrives with them open.  

The page reads in English, 中文, 日本語, Français, Español and Deutsch. The list
itself is written in English.  


Rules
-----

1. Ten applications to join. The hundred squares beside a name fill in one at
   a time.  
2. Public: every application can be opened, installed or run by anyone — a site
   at an address, a package on a registry, a release that downloads, an
   extension on a marketplace, an app in a store.  
3. Open source: every application's source is in a public repository that
   anyone can read, clone and build.  
4. An application, not a library: a thing a person uses — a web app, a desktop
   or mobile app, a command-line tool, an extension, a bot. Libraries, scripts,
   templates and forks of other people's work do not count.  
5. Checkable: an entry is one file, `data/leads/<handle>.json`. Anyone can
   check it against the repositories it points at, and anyone can correct it
   with a pull request.  


Add yourself
------------

Fork the repository, add `data/leads/<handle>.json`, open a pull request.
[CONTRIBUTING.md](CONTRIBUTING.md) has the file's fields and an example.  

`npm run check` reads every entry and says what is missing. The same check runs
on every pull request, and asks each repository whether it answers.  


Develop
-------

Node.js 22 or later.  

`npm install`  
`npm run dev` — the page, reloading as files change  
`npm run build` — a static site in `dist/`  
`npm run check` — every entry under `data/leads/`; add `--online` to ask each
link whether it answers  


Languages
---------

The page's own words are in `src/i18n/<lang>.json`, one file per language:
`en`, `zh`, `ja`, `fr`, `es`, `de`. The page opens in the language the reader
chose last, or the browser's; `?lang=ja` in the address opens it in one
language for that visit.  

An entry is written in English. A description or a bio may instead be an object
keyed by those same codes, and the page shows the reader's language when it is
there, English otherwise.  
