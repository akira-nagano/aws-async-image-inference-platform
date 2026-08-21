import type { Locale, Messages } from "./i18n";

interface Props {
  locale: Locale;
  messages: Messages;
  onChange: (locale: Locale) => void;
}

export function LanguageSwitcher({ locale, messages, onChange }: Props) {
  return (
    <div
      className="language-switcher"
      data-locale={locale}
      role="group"
      aria-label={messages.language.label}
    >
      <span className="language-switcher-highlight" aria-hidden="true" />
      <button type="button" aria-pressed={locale === "ja"} onClick={() => onChange("ja")}>
        {messages.language.japanese}
      </button>
      <button type="button" aria-pressed={locale === "en"} onClick={() => onChange("en")}>
        {messages.language.english}
      </button>
    </div>
  );
}
