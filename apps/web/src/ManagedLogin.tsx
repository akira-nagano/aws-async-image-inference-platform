import { useState } from "react";
import { ImageIcon } from "./Icons";
import { LanguageSwitcher } from "./LanguageSwitcher";
import type { Locale, Messages } from "./i18n";

interface Props {
  onLogin: () => Promise<void>;
  error?: string;
  locale: Locale;
  messages: Messages;
  onLocaleChange: (locale: Locale) => void;
}

export function ManagedLogin({ onLogin, error, locale, messages, onLocaleChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string>();

  async function login() {
    setBusy(true);
    setLocalError(undefined);
    try {
      await onLogin();
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : messages.auth.loginStartError);
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
        <p className="eyebrow">AMAZON COGNITO</p>
        <h1>{messages.pageTitle}</h1>
        <p className="auth-description">{messages.auth.managedDescription}</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => void login()}
          disabled={busy}
        >
          {busy ? messages.auth.redirecting : messages.auth.login}
        </button>
        {(localError || error) && (
          <div className="error-banner" role="alert">
            {localError || error}
          </div>
        )}
      </section>
    </main>
  );
}
