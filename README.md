
Code Heros
==========


A public list of programmers who have built a hundred applications, each one
released with its source open for anyone to read.  

The bar to join is ten. Ten public, open-source applications put a name on the
list; the count beside it runs to a hundred. Anyone can check an entry, and
anyone can add one with a pull request.  

A hundred makes a hero. The page keeps two lists: the heroes, and everyone
still on the way. Nobody is a hero yet, and the first list says so in the
page's largest type until somebody is — then they are listed there, with
their GitHub picture beside the name.  

On the page each name is closed; press it and the applications unfold. A link
to one person, `#handle`, arrives with them open.  

The page reads in English, 中文, 日本語, Français, Español and Deutsch. The list
itself is written in English.  

It is drawn in GitHub's light, GitHub's dark, or black and white; the switch
is at the top of the page. Until a reader chooses, it is light or dark as
their system is.  


Rules
-----

1. Ten applications to join. The hundred squares beside a name fill in one at
   a time.  
2. Public: every application can be opened, installed or run by anyone — a site
   at an address, a package on a registry, a release that downloads, an
   extension on a marketplace, an app in a store.  
3. Open source: every application's source is in a public repository that
   anyone can read, clone and build.  
4. Code, and enough of it: it does not have to be an application. A library, a
   framework, a tool, a bot all count, on three conditions — it is code, there
   is enough of it to be a real piece of work, and anyone can check that it
   works by opening it, installing it, or building and running it. A snippet,
   a template, a page of configuration or a fork of someone else's work does
   not count.  
5. Checkable: an entry is one file, `data/leads/<handle>.json`. Anyone can
   check it against the repositories it points at, and anyone can correct it
   with a pull request.  


Add yourself
------------

Fork the repository, add `data/leads/<handle>.json`, open a pull request.
[CONTRIBUTING.md](CONTRIBUTING.md) has the file's fields and an example.  

Not every entry is written by the person it names. The people who keep the
site also collect entries themselves, and those are checked and corrected the
same way as any other.  

`npm run check` reads every entry and says what is missing. The same check runs
on every pull request, and asks each repository whether it answers.  

The page has a Copy prompt button under the example file. Give the prompt to
an AI assistant along with a GitHub profile and it drafts the file; the prompt
is `src/prompt.js`, and says what CONTRIBUTING.md says.  


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


Themes
------

Every color is a name in `src/global.css`, filled in three ways: GitHub's
light, GitHub's dark, and black-and-white. GitHub's values are read off
github.com's own stylesheets, token for token. The theme is the reader's
choice, remembered like the language; until they choose, the page is light
or dark as their system is, and follows it.  
