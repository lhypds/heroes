import { HUNDRED } from "../../constants";
import styles from "./hundred.module.css";

// A hundred squares, ten by ten, the first `count` of them filled in. One
// square per application, so the whole of what the list asks for is one
// glance: how far along a name is, and how far there is to go.
//
// Past the hundred the squares carry on underneath, half the size and in a
// colour of their own: the ten by ten stays the measure, and what is over it
// reads as over it rather than crowding it.
const CELLS = Array.from({ length: HUNDRED }, (_, i) => i);

export default function Hundred({ count, titles = [], label }) {
  const over = Math.max(0, count - HUNDRED);
  return (
    <div className={styles.hundred} role="img" aria-label={label}>
      <div className={styles.grid}>
        {CELLS.map((i) => (
          <span key={i} className={i < count ? styles.on : styles.off} title={titles[i]} />
        ))}
      </div>
      {over > 0 && (
        <div className={styles.rest}>
          {Array.from({ length: over }, (_, i) => (
            <span key={i} className={styles.extra} title={titles[HUNDRED + i]} />
          ))}
        </div>
      )}
    </div>
  );
}
