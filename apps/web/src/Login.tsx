import { useState, type FormEvent } from "react";
import { ImageIcon } from "./Icons";
import { LanguageSwitcher } from "./LanguageSwitcher";
import type { Locale, Messages } from "./i18n";

interface Props {
  onSubmit: (username: string, password: string) => Promise<void>;
  locale: Locale;
  messages: Messages;
  onLocaleChange: (locale: Locale) => void;
}

export function Login({ onSubmit, locale, messages, onLocaleChange }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : messages.auth.loginError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-toolbar">
        <div className="brand-lockup">
          <span className="brand-symbol">
            <ImageIcon />
          </span>
          <span>{messages.header.productLabel}</span>
        </div>
        <LanguageSwitcher locale={locale} messages={messages} onChange={onLocaleChange} />
      </div>
      <section className="auth-card">
        <p className="eyebrow">{messages.auth.localLabel}</p>
        <h1>{messages.pageTitle}</h1>
        <p className="auth-description">{messages.auth.localDescription}</p>
        <form onSubmit={submit}>
          <label>
            <span>{messages.auth.username}</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            <span>{messages.auth.password}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? messages.auth.loggingIn : messages.auth.login}
          </button>
        </form>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
