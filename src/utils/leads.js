// Every entry under data/heros/, one file per person. A pull request adds a
// file; nothing here has to be told about it.
const files = import.meta.glob("../../data/heros/*.json", { eager: true, import: "default" });

// The fullest list first; the same count, alphabetically.
const LEADS = Object.values(files).sort(
  (a, b) => b.apps.length - a.apps.length || a.name.localeCompare(b.name),
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

export { LEADS, pick, host };
