// The three ways the page is colored: GitHub's light, GitHub's dark, and
// black ink on white paper. The choice is the reader's, remembered the way
// the language is; until they choose, the page is light or dark as the
// system is, and follows it. The theme is a word on the <html> element,
// data-theme, and global.css fills in every color from it.
export const THEMES = ["light", "dark", "mono"];
export const STORAGE_KEY = "theme";

const DARK = "(prefers-color-scheme: dark)";

export const savedTheme = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved) ? saved : null;
  } catch {
    // storage can be unavailable; then nothing was chosen
    return null;
  }
};

export const systemTheme = () => (matchMedia(DARK).matches ? "dark" : "light");

export const initialTheme = () => savedTheme() ?? systemTheme();

// Called with a function of the system's theme whenever the system changes
// it; returns the way to stop listening.
export const onSystemTheme = (callback) => {
  const media = matchMedia(DARK);
  const changed = () => callback(media.matches ? "dark" : "light");
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};

// index.html sets the word before the first paint, so a reader who chose
// black and white never sees a flash of color; this keeps it in step with
// the choice from then on, and tells the browser's own chrome the paper's
// color as well.
export const applyTheme = (theme) => {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const paper = getComputedStyle(root).getPropertyValue("--paper").trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = paper;
  }
};

export const rememberTheme = (theme) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // not being able to remember it is not a reason to refuse the change
  }
};
