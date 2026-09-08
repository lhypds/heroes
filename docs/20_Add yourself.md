
Add yourself
============


Fork the repository, add `data/heroes/<handle>.json`, open a pull request.
[CONTRIBUTING.md](../CONTRIBUTING.md) has the file's fields and an example.  

Not every entry is written by the person it names. The people who keep the
site also collect entries themselves, and those are checked and corrected the
same way as any other.  

Before writing anything, the box under the rules in "Be a hero" reads a GitHub
account against them and says where it stands: how many repositories count,
which ones do not and why. [Check an account](30_Check%20an%20account.md) says
what it counts, and how to ask it from the command line or over HTTP.  

`pnpm run check` reads every entry and says what is missing. The same check
runs on every pull request, and asks each repository whether it answers.  

The page has a Copy prompt button under the example file. Give the prompt to
an AI assistant along with a GitHub profile and it drafts the file; the prompt
is `src/prompt.js`, and says what CONTRIBUTING.md says.  
