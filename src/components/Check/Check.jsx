import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Hundred from "../Hundred";
import { HUNDRED } from "../../constants";
import styles from "./check.module.css";

// A GitHub username, read against the three rules: how many of that account's
// public repositories of their own are real code, and whether one of them
// carries a thousand commits. The reading is api/handler.js's, at /api; this
// is the box it is asked from and the answer set out.
//
// Reading a couple of hundred repositories takes half a minute, so the API
// answers 202 with how far it has got and is asked again until it answers.

// How often to ask again while a check runs, and how long to keep asking.
const POLL_MS = 1500;
const GIVE_UP_MS = 5 * 60 * 1000;

// What was typed, as a handle: a name, an @name, or a profile address.
const handleOf = (typed) =>
  typed
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A number as the reader's language writes it.
const count = (n, language) => Number(n).toLocaleString(language);

export default function Check() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rules = t("rules.items", { returnObjects: true });

  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  // The check in flight, so a second press stops the first, and leaving the
  // page stops it too.
  const asking = useRef(null);

  useEffect(() => () => asking.current?.abort(), []);

  // Which of the answers the API can give this is, in the reader's language.
  // The three that are somebody's fault are named: no such person, too many
  // asks, a queue that is full. The rest part into GitHub not answering,
  // which passes, and the check itself not being there, which does not — a
  // 503 with no token, or anything that comes back and is not JSON at all,
  // which is what a page served without the check under it answers.
  const failure = (status, body) => {
    // Whatever the server said for itself, for whoever opens the console.
    if (body?.error) console.error(`the check answered ${status}: ${body.error}`);
    if (status === 404 && body) return t("check.unknown");
    if (status === 400) return t("check.notAName");
    if (status === 429) return t("check.limit");
    if (status === 503 && body?.status === "busy") return t("check.busy");
    if (status === 502) return t("check.github");
    return t("check.off");
  };

  async function run(event) {
    event.preventDefault();
    const handle = handleOf(typed);
    if (!handle || running) return;

    asking.current?.abort();
    const stop = new AbortController();
    asking.current = stop;
    setRunning(true);
    setProgress(null);
    setReport(null);
    setError(null);
    setOpen(false);

    const until = Date.now() + GIVE_UP_MS;
    // Asks that did not arrive at all, one after another. A check takes half
    // a minute of asking, and a single one going astray on the way should not
    // end it; three in a row is the check not being there.
    let missed = 0;
    try {
      for (;;) {
        let answer;
        let body = null;
        try {
          answer = await fetch(`/api/check/${encodeURIComponent(handle)}`, {
            headers: { accept: "application/json" },
            signal: stop.signal,
          });
          body = await answer.json().catch(() => null);
        } catch (failed) {
          if (failed.name === "AbortError") return;
          if (++missed >= 3) {
            console.error(`the check could not be reached: ${failed.message}`);
            setError(t("check.off"));
            return;
          }
          await sleep(POLL_MS);
          if (stop.signal.aborted) return;
          continue;
        }
        missed = 0;
        if (answer.status === 202 && body) {
          setProgress(body);
          if (Date.now() > until) throw new Error("gave up waiting");
          await sleep(POLL_MS);
          if (stop.signal.aborted) return;
          continue;
        }
        if (answer.ok && body?.status === "done") {
          setReport(body);
          return;
        }
        setError(failure(answer.status, body));
        return;
      }
    } catch (failed) {
      // A check the reader has replaced or walked away from says nothing.
      if (failed.name !== "AbortError") {
        console.error(`the check did not finish: ${failed.message}`);
        setError(t("check.failed"));
      }
    } finally {
      if (!stop.signal.aborted) {
        setRunning(false);
        setProgress(null);
      }
    }
  }

  // The three rules, each with what this account has against it. The second
  // is the sieve the first counts through, so it is answered with what it
  // sifted rather than with a yes or a no.
  const marks = report && [
    {
      ok: report.rules.repositories.ok,
      value: t("check.one", {
        n: count(report.rules.repositories.have, language),
        need: count(report.rules.repositories.need, language),
      }),
    },
    {
      ok: null,
      value: t("check.two", {
        counted: count(report.rules.code.counted, language),
        over: count(report.rules.code.passedOver, language),
      }),
    },
    {
      ok: report.rules.commits.ok,
      value: report.rules.commits.repository === null
        ? t("check.none")
        : t("check.three", {
          repo: report.rules.commits.repository,
          n: count(report.rules.commits.have, language),
        }),
    },
  ];

  // A repository to a row: what it is called, the two figures the rules read,
  // and either what it is written in or what it is short of.
  const table = (repos, title, last) => (
    <div className={styles.wide}>
      <h5 className={styles.listLabel}>{title}</h5>
      <table className={styles.repos}>
        <thead>
          <tr>
            <th scope="col">{t("check.columns.repository")}</th>
            <th scope="col" className={styles.figure}>{t("check.columns.commits")}</th>
            <th scope="col" className={styles.figure}>{t("check.columns.lines")}</th>
            <th scope="col">{last}</th>
          </tr>
        </thead>
        <tbody>
          {repos.map((repo) => (
            <tr key={repo.name}>
              <td>
                <a className={styles.repoName} href={repo.url} target="_blank" rel="noopener">{repo.name}</a>
              </td>
              <td className={styles.figure}>{count(repo.commits, language)}</td>
              <td className={styles.figure}>{count(repo.lines, language)}</td>
              <td className={styles.why}>
                {repo.reason ? t(`check.why.${repo.reason}`) : repo.languages.join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className={styles.check}>
      <h3 className={styles.subLabel}>{t("check.title")}</h3>
      <p className={styles.lede}>{t("check.lede")}</p>

      <form className={styles.form} onSubmit={run}>
        <div className={styles.field}>
          <span className={styles.at} aria-hidden="true">@</span>
          <input
            className={styles.input}
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={t("check.placeholder")}
            aria-label={t("check.placeholder")}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck="false"
            enterKeyHint="go"
          />
        </div>
        <button className={styles.primary} type="submit" disabled={running || handleOf(typed) === ""}>
          {t("check.submit")}
        </button>
      </form>

      <p className={error && !running ? styles.problem : styles.status} aria-live="polite">
        {running
          ? progress?.waiting > 0
            ? t("check.waiting", { n: count(progress.waiting, language) })
            : progress?.of
              ? t("check.reading", { read: count(progress.read, language), of: count(progress.of, language) })
              : t("check.starting")
          : error}
      </p>

      {report && (
        <div className={styles.result}>
          <header className={styles.head}>
            <div className={styles.who}>
              <h4 className={styles.name}>{report.name || report.handle}</h4>
              <div className={styles.links}>
                <a href={report.url} target="_blank" rel="noopener">@{report.handle}</a>
              </div>
              <p className={styles.own}>
                {t("check.own", {
                  own: count(report.repositories.own, language),
                  all: count(report.repositories.public, language),
                })}
              </p>
            </div>
            <div className={styles.score}>
              <div className={styles.number} aria-hidden="true">
                <span className={styles.n}>{count(report.rules.repositories.have, language)}</span>
                <span className={styles.of}>/ {HUNDRED}</span>
              </div>
              <Hundred
                count={report.rules.repositories.have}
                titles={report.counted.map((repo) => repo.name)}
                label={t("check.grid", { n: count(report.rules.repositories.have, language) })}
              />
            </div>
          </header>

          <ol className={styles.marks}>
            {marks.map((mark, i) => (
              <li className={styles.mark} key={rules[i].name}>
                <span className={styles.index}>{String(i + 1).padStart(2, "0")}</span>
                <span
                  className={mark.ok === null ? styles.signSieve : mark.ok ? styles.signOk : styles.signShort}
                  aria-hidden="true"
                >
                  {mark.ok === null ? "·" : mark.ok ? "✓" : "✗"}
                </span>
                <span className={styles.markName}>{rules[i].name}</span>
                <span className={styles.markValue}>{mark.value}</span>
              </li>
            ))}
          </ol>

          <p className={styles.verdict}>
            {report.hero
              ? t("check.hero")
              : report.listed
                ? t("check.listed", { n: count(report.rules.repositories.have, language) })
                : t("check.under", { n: count(report.rules.repositories.have, language) })}
          </p>
          <p className={styles.note}>{t("check.sieve")}</p>

          <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {open ? t("check.hide") : t("check.show")}
            <span className={styles.plus} aria-hidden="true">{open ? "−" : "+"}</span>
          </button>

          {open && (
            <div className={styles.lists}>
              {report.counted.length > 0 &&
                table(report.counted, t("check.counts"), t("check.columns.languages"))}
              {report.passedOver.length > 0 &&
                table(report.passedOver, t("check.passedOver"), t("check.columns.short"))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
