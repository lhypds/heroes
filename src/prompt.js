import { REPO, GUIDE } from "./constants";

// The smallest entry that passes the check, shown on the page as it would
// be typed.
export const EXAMPLE = `{
  "handle": "you",
  "name": "Your Name",
  "github": ["https://github.com/you"],
  "repos": [
    {
      "name": "a-repository",
      "repo": "https://github.com/you/a-repository",
      "url": "https://a-repository.example.com"
    }
  ]
}`;

// The whole entry, every field, for the prompt.
const FULL = `{
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
}`;

// What the Copy prompt button copies: handed to an assistant along with a
// GitHub profile, it comes back with the file. The rules and the fields say
// the same as CONTRIBUTING.md, in the same order.
export const PROMPT = `Write an entry for Code Heroes, a public list of programmers who have a hundred public repositories of their own, every one of them real code: ${REPO}

The person: https://github.com/<handle>
Replace <handle> with their GitHub username. If it still says <handle>, ask for it before doing anything else. Where they keep more than one account — an organisation of their own, say — read them all: several accounts count together, as long as the repositories under them are their own work.

Read their profile and their public repositories, and pick the ones that count. A repository counts when two things are true. One: it is a public repository of their own, one they created, that anyone can open, read and clone. Forks and mirrors of other people's work do not count, and neither does anyone else's repository. Two: it is real code: ten commits or more, and more than a hundred lines of code in a programming language. A repository that is only a README, or only prose, data or configuration, does not count. Stars do not matter. A repository short of either rule is left out.

Answer with one JSON file, data/heroes/<handle>.json, and nothing else. It looks like this:

${FULL}

The entry:
- handle: their GitHub username, lowercase; it is also the file name.
- name: how they are named on their profile.
- github: a list of their profiles, the account the entry is named for first. Several accounts count together — a personal account and an organisation of theirs, say — so list every one whose repositories are in the entry, and only those.
- website: optional, an address of their own.
- bio: optional, one line about what they build.
- commits: optional, the commits their own public repositories come to in all, forks out — a whole number. Leave it out rather than guess at it.
- repos: the repositories that count, as many as there are; the count keeps climbing past a hundred. The most important first: the page unfolds only the first hundred of the list, so the order is the ranking.

Each repository:
- name: what it is called.
- repo: the public repository, an https:// address; each repository once.
- url: optional, a home page of its own: a site, a package page, a release page, a marketplace or store listing.
- language: optional, the main programming language.

Write in English. Use only what the repositories show: do not invent a repository or an address, and leave an optional field out rather than guess it.

The file is added with a pull request; the guide is at ${GUIDE}
`;
