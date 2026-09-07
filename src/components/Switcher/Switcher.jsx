import styles from "./switcher.module.css";

// A row of words, one of them chosen: the language, the colors. The chosen
// one is set bold with a line under it, in the words' own color.
export default function Switcher({ label, options, value, onChange }) {
  return (
    <div className={styles.switcher} role="group" aria-label={label}>
      {options.map(({ code, label: text }) => (
        <button
          key={code}
          type="button"
          className={code === value ? styles.optionOn : styles.option}
          aria-pressed={code === value}
          onClick={() => onChange(code)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
