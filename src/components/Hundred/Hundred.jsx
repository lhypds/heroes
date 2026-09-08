import { HUNDRED } from "../../constants";
import styles from "./hundred.module.css";

// A hundred squares, ten by ten, one per application, so the whole of what
// the list asks for is one glance: how far along a name is, and how far there
// is to go.
//
// Past the hundred the count comes round again over the same squares, and
// each lap is drawn in a colour of its own — green, orange, gold, purple,
// red — so which lap a square is on is read at a glance: 182 is every square
// filled with the first 82 of them orange, 240 is every square orange with
// the first 40 gold. The sixth is ink, and holds every lap above it.
const CELLS = Array.from({ length: HUNDRED }, (_, i) => i);
const LAPS = 6;

export default function Hundred({ count, titles = [], label }) {
  const laps = Math.floor(count / HUNDRED);
  const rest = count % HUNDRED;

  return (
    <div className={styles.grid} role="img" aria-label={label}>
      {CELLS.map((i) => {
        // The lap this square is on: every square has been round `laps`
        // times, and the first `rest` of them once more.
        const filled = i < rest;
        const level = Math.min(LAPS, laps + (filled ? 1 : 0));
        // Which application it stands for is the last one to land on it.
        const app = ((filled ? laps : laps - 1) * HUNDRED) + i;
        return (
          <span
            key={i}
            className={level === 0 ? styles.off : styles[`on${level}`]}
            title={level === 0 ? undefined : titles[app]}
          />
        );
      })}
    </div>
  );
}
