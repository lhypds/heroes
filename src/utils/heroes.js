// Every entry under data/heroes/, one file per person. A pull request adds a
// file; nothing here has to be told about it.
const files = import.meta.glob("../../data/heroes/*.json", { eager: true, import: "default" });

// The most repositories first; the same count, alphabetically. It is
// own_repos that says how many, which is what the scan counted rather than
// what it listed: repos holds a hundred at most — hero.js lists no more than
// that — so nearly every entry carries exactly a hundred of them, and reading
// the order off the list put all but one of them level and left the wall in
// alphabetical order alone. An entry the scan has not reached carries no
// count yet, and sorts as none.
const carried = (lead) => (typeof lead.own_repos === "number" ? lead.own_repos : 0);
const LEADS = Object.values(files).sort(
  (a, b) => carried(b) - carried(a) || a.name.localeCompare(b.name),
);

// A description is English, or an object of translations. The reader's
// language when it is there, English otherwise.
const pick = (value, language) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[language] || value.en || "";
};

// "gcc3.com" for https://gcc3.com/ — a link's own name, for a label.
const host = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// A person may keep more than one account — a personal one, an organisation
// of their own — and the rules read them as one, so github is a list. A lone
// address is read as a list of one.
const accounts = (github) => {
  if (Array.isArray(github)) return github.filter(Boolean);
  return github ? [github] : [];
};

// "lhypds" for https://github.com/lhypds — the account's own name, for a
// label, kept as the profile spells it.
const account = (url) => {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "") || host(url);
  } catch {
    return url;
  }
};

export { LEADS, pick, host, accounts, account };
