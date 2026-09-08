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
export const PROMPT = `Write an entry for Code Heroes, a public list of programmers who have a hundred public repositories of their own, every one of them real code: ${REPO}

The person: https://github.com/<handle>
Replace <handle> with their GitHub username. If it still says <handle>, ask for it before doing anything else.

Read their profile and their public repositories, and pick the ones that count. There are two rules. One: it is a public repository of their own, one they created, that anyone can open, read and clone. Forks and mirrors of other people's work do not count, and neither does anyone else's repository. Two: it is real code: ten commits or more, and more than a hundred lines of code in a programming language. A repository that is only a README, or only prose, data or configuration, does not count. Stars do not matter. A repository short of either rule is left out.

Answer with one JSON file, data/heroes/<handle>.json, and nothing else. It looks like this:

${FULL}

The entry:
- handle: their GitHub username, lowercase; it is also the file name.
- name: how they are named on their profile.
- github: their profile, https://github.com/<handle>.
- website: optional, an address of their own.
- bio: optional, one line about what they build.
- apps: at least ten, and as many as count; the count keeps climbing past a hundred. The most important first: the page unfolds only the first hundred of the list, so the order is the ranking.

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
