
Contributing
============


Adding yourself
---------------

1. Fork the repository.  
2. Add one file, `data/heros/<handle>.json`, where `<handle>` is your GitHub
   username in lowercase.  
3. Run `npm run check`. It says what is missing, if anything.  
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
  "github": "https://github.com/you",
  "website": "https://example.com",
  "bio": "One line about what you build.",
  "apps": [
    {
      "name": "An app",
      "description": "What it does, in one line.",
      "repo": "https://github.com/you/an-app",
      "url": "https://an-app.example.com",
      "language": "TypeScript",
      "platform": "Web"
    }
  ]
}
```


Fields
------

The entry:  

`handle` — your GitHub username, lowercase, the same as the file name.  
`name` — how you want to be listed.  
`github` — the address of your GitHub profile.  
`website` — optional, an address of your own.  
`bio` — optional, one line, English or translated (see below).  
`apps` — at least ten, the most important first. There is no ceiling: the
count beside a name keeps climbing past a hundred, 124 of 100. The page unfolds
only the first hundred of the list, so the order is the ranking.  

Each application:  

`name` — what it is called.  
`description` — one line, English or translated.  
`repo` — the public repository, an `https://` address. One per application;
the same repository cannot be listed twice.  
`url` — optional, where the application is opened, installed or downloaded: a
site, a package page, a release page, a marketplace listing, a store listing.  
`language` — optional, the main programming language.  
`platform` — optional, where it runs: `Web`, `macOS, Linux`, `VS Code`, and so
on.  


What counts
-----------

Each application in an entry is one repository, and there are two rules.  

1. It is a public repository of your own: anyone can open it, read it and
   clone it, and you created it. A fork of someone else's repository is theirs
   and does not count, and neither does a mirror.  
2. It is real code: ten commits or more, and more than a hundred lines of code
   in a programming language. A repository that is only a README, or only
   prose, data or configuration, does not count. Stars are not asked for.  

It does not have to be an application. A web app, a command-line tool, an
extension, a bot, a library, a framework: all of them count the same, as long
as the repository passes both rules. A repository short of either is left out;
it does not count toward the ten to join or the hundred.  

Every application in an entry is the author's own. Someone else's application
belongs in that person's entry.  


The check
---------

`npm run check` reads every file under `data/heros/`:  

- the file name and `handle` agree  
- `name` and `github` are there  
- there are at least ten applications  
- every application has a `name`, a `description` and a `repo`  
- every `repo` is an `https://` address, listed once  
- translations use the six known codes, and always include `en`  

With `--online` it also asks each `repo` whether it answers, and mentions any
`url`, `github` or `website` that does not. The pull request check runs online.  

The rest — whether each repository is really code, with ten commits and more
than a hundred lines, and whether it is really yours and not a fork — is read
by a person.  


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

Anyone can correct an entry — a dead link, a repository gone private, an
application that turns out to be a fork. Open a pull request with the change
and say what you found.  
