import { Fragment, useLayoutEffect, useRef, useState, memo } from "react";
import { useTranslation } from "react-i18next";
import Hero from "../Hero";
import styles from "./wall.module.css";

// Everyone at once, as a wall of faces: one photograph each, side by side, as
// many to a row as the page is wide. Press one and their entry unfolds inside
// the wall itself, in a row of its own directly under the row the face is in,
// so the face and what it stands for are read in the one place and nothing
// above the entry moves. Thousands of names as a list is thousands of rows and
// read as none of them; the same thousands as a wall is one glance, and any
// face in it is one movement from being read.
//
// Pointing at a face does nothing but light it, which is the browser's own
// work and not the wall's. The wall is drawn again only when a face is pressed
// or arrived at — the pace of a hand — and never as the pointer travels across
// it, which was the one thing that would have put React through every face on
// the wall for every face passed.

// GitHub's picture for a profile, hero or not, asked for at twice the size it
// is drawn so it is sharp on a screen that draws two pixels for one.
//
// This is the picture's own address on GitHub's pictures host rather than the
// github.com/<handle>.png one, which is a page that redirects to it. Chrome
// blocks a good many of those on a wall this size — the redirect answers as
// a document and not as a picture, and the browser refuses documents asked
// for as pictures — and it is two requests each where this is one.
const FACE = 40;
const picture = (handle) => `https://avatars.githubusercontent.com/${handle}?size=${FACE * 2}`;

// A profile with no picture, or a picture that would not come: the square
// stays as it is, blank, rather than showing the browser's torn page. The
// handler is written once here so every face on the wall shares the one.
const missing = (event) => {
  event.currentTarget.hidden = true;
};

// How many faces a row holds, read off the grid's own columns rather than
// counted off the children: the open entry is a child of the wall too, and
// counting children would count it as a face.
const columnsOf = (el) => {
  const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean);
  return Math.max(1, tracks.length);
};

function Wall({ people }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const wall = useRef(null);

  // Whose entry is unfolded. The wall opens with none of them: an address is
  // put back to the page's own before anything is drawn — main.jsx — so there
  // is no anchor here to arrive on a person by.
  const [open, setOpen] = useState(null);

  // How wide a row is, kept as the page is resized: it is what says which face
  // ends the row the entry is unfolded under, and how far a row is by arrow.
  const [columns, setColumns] = useState(1);

  useLayoutEffect(() => {
    const el = wall.current;
    if (!el) return undefined;
    const measure = () => setColumns(columnsOf(el));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // Which face the tab key comes back to. The wall is one stop on the way down
  // the page rather than two thousand: the tab key reaches the face last read
  // and the arrows reach the rest, which is how a grid of one thing is walked.
  const [at, setAt] = useState(0);

  // The entry belongs after the last face of the row the open one is in.
  const after =
    open === null ? -1 : Math.min(people.length, (Math.floor(open / columns) + 1) * columns);

  const faces = () => wall.current?.querySelectorAll("button[data-at]");

  const indexOf = (event) => {
    const button = event.target.closest("button[data-at]");
    if (!button) return -1;
    const i = Number(button.dataset.at);
    return Number.isInteger(i) ? i : -1;
  };

  // Pressed: the entry unfolds under its row. The same face pressed again
  // folds it away.
  const press = (event) => {
    const i = indexOf(event);
    if (i !== -1) setOpen((was) => (was === i ? null : i));
  };

  // Arrived at, by the tab key or by the arrows: the tab key comes back here.
  const mark = (event) => {
    const i = indexOf(event);
    if (i !== -1) setAt(i);
  };

  // The arrows walk the wall a face or a row at a time, and Escape folds the
  // open entry away. Walking moves the focus and nothing else: an entry is
  // opened by pressing its face, so the wall does not fold and unfold under
  // the reader as they go along it.
  function byKey(event) {
    // Escape reaches from inside the open entry as well as from the faces, and
    // takes the reader back to the face it was unfolded from — the entry it
    // was pressed in is about to go.
    if (event.key === "Escape") {
      if (open === null) return;
      event.preventDefault();
      faces()?.[open]?.focus();
      setOpen(null);
      return;
    }
    // The arrows belong to the wall alone. Inside the open entry they are the
    // reader's own — a link walked to, a page moved — and are left there.
    if (!event.target.closest("button[data-at]")) return;
    const all = faces();
    if (!all || all.length === 0) return;
    const move = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
      Home: -all.length,
      End: all.length,
    }[event.key];
    if (!move) return;
    event.preventDefault();
    // Moving the focus is the whole of it: the face arrived at becomes the tab
    // stop of its own accord, because arriving is what sets it.
    all[Math.max(0, Math.min(all.length - 1, at + move))].focus();
  }

  return (
    <>
      <div className={styles.caption}>
        <span>{t("wall.count", { n: people.length.toLocaleString(language) })}</span>
      </div>

      <div
        className={styles.wall}
        ref={wall}
        role="group"
        aria-label={t("wall.label")}
        onClick={press}
        onFocus={mark}
        onKeyDown={byKey}
      >
        {people.map((person, i) => (
          <Fragment key={person.handle}>
            <button
              type="button"
              data-at={i}
              tabIndex={i === at ? 0 : -1}
              data-on={i === open ? "" : undefined}
              aria-expanded={i === open}
              aria-controls={i === open ? `${person.handle}-entry` : undefined}
              className={styles.face}
              title={person.name}
              aria-label={person.name}
            >
              <img
                className={styles.avatar}
                src={picture(person.handle)}
                alt=""
                width={FACE}
                height={FACE}
                loading="lazy"
                decoding="async"
                onError={missing}
              />
            </button>

            {/* The entry, drawn where the row it belongs to ends. Keyed by the
                person, so pressing another face in the same row unfolds them
                afresh rather than pouring them into the entry already open. */}
            {i + 1 === after && (
              <div className={styles.entry} id={`${people[open].handle}-entry`}>
                <Hero hero={people[open]} key={people[open].handle} />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </>
  );
}

// The list the wall is given is the same list every time, so the page around
// it — a language changed, a theme changed — does not draw the faces again.
export default memo(Wall);
