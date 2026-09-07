import styles from "./json.module.css";

// JSON, colored the way GitHub colors it: a key, a string, a constant (a
// number, true, false, null), and the punctuation between them. The text is
// split at every one of the first three, in order; what is left between them
// is punctuation and space. A key is a string with a colon after it, and the
// colon is punctuation.
const PART = /("(?:[^"\\]|\\.)*"(?:\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/;

export default function Json({ text }) {
  return text.split(PART).map((part, i) => {
    if (part === "") return null;
    if (i % 2 === 0) {
      return <span key={i} className={styles.punct}>{part}</span>;
    }
    if (part.endsWith(":")) {
      const at = part.lastIndexOf('"') + 1;
      return (
        <span key={i}>
          <span className={styles.key}>{part.slice(0, at)}</span>
          <span className={styles.punct}>{part.slice(at)}</span>
        </span>
      );
    }
    return (
      <span key={i} className={part.startsWith('"') ? styles.string : styles.constant}>
        {part}
      </span>
    );
  });
}
