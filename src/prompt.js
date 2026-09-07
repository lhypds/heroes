import { REPO, GUIDE } from "./constants";

// The smallest entry that passes the check, shown on the page as it would
// be typed.
export const EXAMPLE = `{
  "handle": "you",
  "name": "Your Name",
  "github": "https://github.com/you",
  "apps": [
    {
      "name": "An app",
      "description": "What it does, in one line.",
      "repo": "https://github.com/you/an-app",
      "url": "https://an-app.example.com"
    }
  ]
}`;

// The whole entry, every field, for the prompt.
const FULL = `{
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
}`;

// What the Copy prompt button copies: handed to an assistant along with a
// GitHub profile, it comes back with the file. The rules and the fields say
// the same as CONTRIBUTING.md, in the same order.
export const PROMPT = `Write an entry for Tech Lead Heros, a public list of programmers who have built a hundred applications, every one of them open source: ${REPO}

The person: https://github.com/<handle>
Replace <handle> with their GitHub username. If it still says <handle>, ask for it before doing anything else.

Read their profile and their public repositories, and pick the ones that count. Something counts on three conditions: it is code, not prose, data or configuration; there is enough of it to be a real piece of work, not a snippet, a single script or a template; and anyone can check that it works, by opening it at its address, installing it from a registry or a store, or cloning the repository, building it and running it. It has to be public, and its source has to be in a public repository that anyone can read. Forks and mirrors of other people's work do not count, and neither does anyone else's application.

Answer with one JSON file, data/leads/<handle>.json, and nothing else. It looks like this:

${FULL}

The entry:
- handle: their GitHub username, lowercase; it is also the file name.
- name: how they are named on their profile.
- github: their profile, https://github.com/<handle>.
- website: optional, an address of their own.
- bio: optional, one line about what they build.
- apps: at least ten, at most a hundred, the best first.

Each application:
- name: what it is called.
- description: one line on what it does.
- repo: the public repository, an https:// address; each repository once.
- url: optional, where it is opened, installed or downloaded: a site, a package page, a release page, a marketplace or store listing.
- language: optional, the main programming language.
- platform: optional, where it runs: Web, macOS, Linux, iOS, Android, CLI, VS Code, and so on.

Write in English. Use only what the repositories show: do not invent an application, an address or a description, and leave an optional field out rather than guess it. If fewer than ten count, say so instead of filling the list.

The file is added with a pull request; the guide is at ${GUIDE}
`;
