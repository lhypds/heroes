
Contributing
============


Adding yourself
---------------

1. Fork the repository.  
2. Add one file, `data/heroes/<handle>.json`, where `<handle>` is your GitHub
   username in lowercase.  
3. Run `pnpm run check`. It says what is missing, if anything.  
4. Open a pull request.  

Not every entry arrives this way. The people who keep the site also collect
entries themselves, for programmers whose work is public but who have not sent
one. Those entries are checked and corrected the same way as any other; if one
names you and you want it changed, open a pull request.  

The file looks like this:  

```json
{
  "handle": "you",
  "name": "Your Name",
  "github": ["https://github.com/you", "https://github.com/your-org"],
  "website": "https://example.com",
  "bio": "One line about what you build.",
  "commits": 12345,
  "repos": [
    {
      "name": "a-repository",
      "repo": "https://github.com/you/a-repository",
      "url": "https://a-repository.example.com",
      "language": "TypeScript"
    }
  ]
}
```


Fields
------

The entry:  

`handle` — your GitHub username, lowercase, the same as the file name.  
`name` — how you want to be listed.  
`github` — a list of your GitHub profiles, the account the file is named for
first. Several accounts count together — a personal account and an
organisation of yours, say — so list every one the repositories below come
from. One account on its own is a list of one.  
`website` — optional, an address of your own.  
`bio` — optional, one line, English or translated (see below).  
`own_repos` — optional, how many public repositories of your own you have,
forks out, over every account listed above. You need not write it: `npx hero
scan` reads it off the accounts and fills it in. The page shows it beside your
name, and counts the repositories below instead until it has been filled in.  
`commits` — optional, the commits your own public repositories come to in all,
the figure the second rule asks for. `pnpm run account -- <handle>` reads it off
the account; the page shows it beside your name, and leaves the line out when
the entry has no figure.  
`repos` — optional, and usually written by `npx hero scan` rather than by
hand: a hundred of your repositories, the ones pushed to most recently. The
most important first — the page unfolds only the first hundred of the list, so
the order is the ranking. There is no ceiling: the count beside a name keeps
climbing past a hundred, 124 of 100. An entry the scan has not reached yet
carries none, and the page shows it with nothing to unfold.  

Each repository:  

`name` — what it is called.  
`repo` — the public repository, an `https://` address. One per repository; the
same repository cannot be listed twice.  
`url` — optional, a home page of its own: a site, a package page, a release
page, a marketplace listing, a store listing.  
`language` — optional, the main programming language.  


The check
---------

`pnpm run check` reads every file under `data/heroes/`:  

- the file name and `handle` agree  
- `name` is there, and `github` has at least one profile address, each listed
  once  
- every repository has a `name` and a `repo`  
- every `repo` is an `https://` address, listed once  
- `own_repos` and `commits`, where there are any, are whole numbers  
- translations use the six known codes, and always include `en`  

With `--online` it also asks each `repo` whether it answers, and mentions any
`url`, `github` or `website` that does not. The pull request check runs online.  

The rest — whether each repository is really code, with ten commits and more
than a hundred lines, and whether it is really yours and not a fork — is read
by a person. `pnpm run account -- <handle>` reads a whole GitHub account the
same way first, repository by repository, and says which ones count and which
do not; [Check an account](docs/30_Check%20an%20account.md) says what it
counts, and how to ask it over HTTP.  


Translations
------------

The list is written in English. Where you want to, a `description` or `bio`
can be an object keyed by language instead of a string:  

```json
"description": {
  "en": "One AI chat, in the browser and in the terminal.",
  "zh": "一个 AI 聊天，在浏览器里，也在终端里。",
  "ja": "ブラウザでもターミナルでも使える、ひとつの AI チャット。"
}
```

The codes are `en`, `zh`, `ja`, `fr`, `es` and `de`. `en` is required; the
others are optional, and the page falls back to English for any that are
missing.  


Fixing an entry
---------------

Anyone can correct an entry — a dead link, a repository gone private, one that
turns out to be a fork. Open a pull request with the change and say what you
found.  
