import styles from "./hundred.module.css";

// A hundred squares, ten by ten, the first `count` of them filled in. One
// square per application, so the whole of what the list asks for is one
// glance: how far along a name is, and how far there is to go.
const CELLS = Array.from({ length: 100 }, (_, i) => i);

export default function Hundred({ count, titles = [], label, big = false }) {
  return (
    <div className={big ? styles.big : styles.grid} role="img" aria-label={label}>
      {CELLS.map((i) => (
        <span key={i} className={i < count ? styles.on : styles.off} title={titles[i]} />
      ))}
    </div>
  );
}
