import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  getJob,
  isTerminal,
  predictionMetadata,
  predictionTitle,
  submitJob,
  uploadImage,
  type JobResponse,
} from "./api";
import {
  clearSession,
  completeManagedLogin,
  createLogoutPlan,
  loadSession,
  saveSession,
  shouldAutoStartManagedLogin,
  signIn,
  startManagedLogin,
  startManagedLogout,
  type Session,
} from "./auth";
import { authTransitionMessage, type AuthTransition } from "./auth-transition";
import { loadConfig, type RuntimeConfig } from "./config";
import { ImagePicker } from "./ImagePicker";
import { ImageIcon, LogOutIcon, SearchIcon } from "./Icons";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Login } from "./Login";
import { ManagedLogin } from "./ManagedLogin";
import { validateImageFile } from "./image-selection";
import {
  loadLocale,
  saveLocale,
  translations,
  type JobStatusLabel,
  type Locale,
  type Messages,
} from "./i18n";

function statusLabel(status: string, messages: Messages): string {
  return status in messages.status
    ? messages.status[status as JobStatusLabel]
    : status.replaceAll("_", " ");
}

function statusClass(status: string): string {
  return status.toLowerCase().replaceAll("_", "-");
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="transition-screen" aria-live="polite">
      <span className="brand-symbol large">
        <ImageIcon />
      </span>
      <div className="activity-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{message}</p>
    </main>
  );
}

export default function App() {
  const [config, setConfig] = useState<RuntimeConfig>();
  const [session, setSession] = useState<Session | undefined>(() => loadSession());
  const [locale, setLocale] = useState<Locale>(() => loadLocale());
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [job, setJob] = useState<JobResponse>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [authTransition, setAuthTransition] = useState<AuthTransition>("initializing");
  const logoutStarted = useRef(false);
  const activeMessages = useRef(translations[locale]);
  const messages = translations[locale];

  useEffect(() => {
    activeMessages.current = messages;
    saveLocale(locale);
    document.documentElement.lang = locale;
    document.title = messages.pageTitle;
  }, [locale, messages]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextConfig = await loadConfig();
        if (!active) return;
        setConfig(nextConfig);
        const nextSession = await completeManagedLogin(nextConfig);
        if (!active) return;
        if (nextSession) {
          saveSession(nextSession);
          setSession(nextSession);
          setAuthTransition("ready");
          return;
        }
        if (shouldAutoStartManagedLogin(nextConfig, loadSession(), new URL(window.location.href))) {
          setAuthTransition("redirecting-to-login");
          await startManagedLogin(nextConfig, loadLocale());
          return;
        }
        setAuthTransition("ready");
      } catch (error) {
        if (!active) return;
        setAuthTransition("ready");
        setMessage(
          error instanceof Error ? error.message : activeMessages.current.errors.configFailed,
        );
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      authTransition !== "logging-out" ||
      !config ||
      config.authMode !== "managed-login" ||
      logoutStarted.current
    ) {
      return;
    }
    logoutStarted.current = true;
    startManagedLogout(config);
  }, [authTransition, config]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!config || !session || !job || isTerminal(job.status)) return;
    const timer = window.setInterval(() => {
      void getJob(config, session, job.jobId)
        .then(setJob)
        .catch((error: unknown) => {
          setMessage(
            error instanceof Error ? error.message : activeMessages.current.errors.stateFailed,
          );
        });
    }, config.pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [config, session, job]);

  const tier = useMemo(() => {
    const group = session?.groups.find((candidate) => candidate.startsWith("tier-"));
    if (!group) return "—";
    const name = group.slice("tier-".length);
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }, [session]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
  }

  async function login(username: string, password: string) {
    if (!config) throw new Error(messages.errors.loadingConfig);
    if (config.authMode !== "direct") {
      throw new Error(messages.errors.localOnlyLogin);
    }
    const next = await signIn(config, username, password);
    saveSession(next);
    setSession(next);
  }

  async function managedLogin() {
    if (!config) throw new Error(messages.errors.loadingConfig);
    await startManagedLogin(config, locale);
  }

  function logout() {
    if (!config) return;
    const plan = createLogoutPlan(config);
    clearSession();
    setJob(undefined);
    if (plan.redirectToManagedLogout) {
      setAuthTransition("logging-out");
    }
    if (plan.clearRenderedSession) {
      setSession(undefined);
    }
  }

  function selectFile(next?: File) {
    setMessage(undefined);
    setUploadProgress(0);
    if (!next) {
      setFile(undefined);
      setJob(undefined);
      return;
    }
    if (!config) return;
    const validationError = validateImageFile(next, config.maxUploadBytes);
    if (validationError) {
      setMessage(messages.errors[validationError]);
      return;
    }
    setFile(next);
    setJob(undefined);
  }

  async function runInference() {
    if (!config || !session || !file) return;
    setBusy(true);
    setMessage(undefined);
    setUploadProgress(0);
    try {
      const objectKey = await uploadImage(config, session, file, setUploadProgress);
      const created = await submitJob(config, session, objectKey, crypto.randomUUID());
      setJob(created);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setMessage(`${messages.errors.concurrencyLimit}: ${error.message}`);
      } else if (error instanceof ApiError && error.status === 503) {
        setMessage(`${messages.errors.systemBusy}: ${error.message}`);
      } else {
        setMessage(error instanceof Error ? error.message : messages.errors.startFailed);
      }
    } finally {
      setBusy(false);
    }
  }

  const transitionMessage = authTransitionMessage(authTransition, messages);
  if (!config || transitionMessage) {
    return (
      <LoadingScreen message={transitionMessage ?? message ?? messages.errors.loadingConfig} />
    );
  }
  if (!session) {
    return config.authMode === "managed-login" ? (
      <ManagedLogin
        onLogin={managedLogin}
        error={message}
        locale={locale}
        messages={messages}
        onLocaleChange={changeLocale}
      />
    ) : (
      <Login onSubmit={login} locale={locale} messages={messages} onLocaleChange={changeLocale} />
    );
  }

  const working = job ? !isTerminal(job.status) : false;

  return (
    <div className="page-frame">
      <div className="ambient-light ambient-light-one" aria-hidden="true" />
      <div className="ambient-light ambient-light-two" aria-hidden="true" />

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <span className="brand-symbol">
              <ImageIcon />
            </span>
            <span>{messages.header.productLabel}</span>
          </div>
          <div className="topbar-actions">
            <div className="user-chip" title={`${messages.header.signedInAs}: ${session.username}`}>
              <span className="user-avatar" aria-hidden="true">
                {session.username.slice(0, 1).toUpperCase()}
              </span>
              <span className="user-copy">
                <strong>{session.username}</strong>
                <small>{tier}</small>
              </span>
            </div>
            <LanguageSwitcher locale={locale} messages={messages} onChange={changeLocale} />
            <button
              className="logout-button"
              type="button"
              onClick={logout}
              aria-label={messages.auth.logout}
            >
              <LogOutIcon />
              <span>{messages.auth.logout}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="app-shell">
        <section className="hero">
          <p className="eyebrow">{messages.hero.eyebrow}</p>
          <h1>{messages.hero.title}</h1>
          <p>{messages.hero.description}</p>
        </section>

        {message && (
          <div className="error-banner floating-message" role="alert">
            {message}
          </div>
        )}

        <div className="workspace-grid">
          <section className="glass-panel input-panel" aria-labelledby="image-input-title">
            <div className="section-heading">
              <p className="step-label">{messages.image.step}</p>
              <h2 id="image-input-title">{messages.image.title}</h2>
              <p>{messages.image.description}</p>
            </div>

            <ImagePicker
              file={file}
              previewUrl={previewUrl}
              maxUploadBytes={config.maxUploadBytes}
              locale={locale}
              messages={messages}
              disabled={busy}
              onSelect={selectFile}
            />

            {uploadProgress > 0 && uploadProgress < 100 && (
              <div className="upload-progress" aria-live="polite">
                <div>
                  <span>{messages.image.uploading}</span>
                  <strong>{uploadProgress}%</strong>
                </div>
                <progress max={100} value={uploadProgress}>
                  {uploadProgress}%
                </progress>
              </div>
            )}

            <button
              className="primary-button search-button"
              type="button"
              onClick={() => void runInference()}
              disabled={!file || busy}
            >
              <SearchIcon />
              {busy ? messages.image.submitting : messages.image.search}
            </button>
          </section>

          <section
            className="glass-panel results-panel"
            aria-labelledby="results-title"
            aria-live="polite"
            aria-busy={working}
          >
            <div className="section-heading">
              <p className="step-label">{messages.results.step}</p>
              <h2 id="results-title">{messages.results.title}</h2>
              <p>{messages.results.description}</p>
            </div>

            {!job ? (
              <div className="empty-results">
                <span className="result-orbit" aria-hidden="true">
                  <SearchIcon />
                </span>
                <strong>{messages.results.emptyTitle}</strong>
                <p>{messages.results.emptyDescription}</p>
              </div>
            ) : (
              <div className="job-results">
                <div className="job-status-row">
                  <div>
                    <span>{messages.results.jobLabel}</span>
                    <strong>{statusLabel(job.status, messages)}</strong>
                  </div>
                  <span className={`status-pill status-${statusClass(job.status)}`}>
                    {working && <span className="status-pulse" aria-hidden="true" />}
                    {statusLabel(job.status, messages)}
                  </span>
                </div>

                <dl className="job-metadata">
                  <div>
                    <dt>{messages.results.jobId}</dt>
                    <dd>{job.jobId}</dd>
                  </div>
                  {job.concurrency && (
                    <div>
                      <dt>{messages.results.concurrency}</dt>
                      <dd>
                        {job.concurrency.active} / {job.concurrency.limit}
                      </dd>
                    </div>
                  )}
                  {job.processingTimeMs !== undefined && (
                    <div>
                      <dt>{messages.results.processingTime}</dt>
                      <dd>
                        {(job.processingTimeMs / 1000).toLocaleString(
                          locale === "ja" ? "ja-JP" : "en-US",
                          { maximumFractionDigits: 2 },
                        )}{" "}
                        {messages.results.seconds}
                      </dd>
                    </div>
                  )}
                  {job.modelVersion && (
                    <div>
                      <dt>{messages.results.model}</dt>
                      <dd>{job.modelVersion}</dd>
                    </div>
                  )}
                </dl>

                {working && (
                  <div className="searching-state">
                    <div className="activity-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <p>{statusLabel(job.status, messages)}</p>
                  </div>
                )}

                {job.predictions && job.predictions.length > 0 && (
                  <ol className="predictions">
                    {job.predictions.map((prediction) => (
                      <li key={`${prediction.rank}-${prediction.productCode}`}>
                        <span className="rank-number" aria-hidden="true">
                          {prediction.rank.toString().padStart(2, "0")}
                        </span>
                        <div className="prediction-copy">
                          <strong>{predictionTitle(prediction)}</strong>
                          {predictionMetadata(prediction) && (
                            <small>{predictionMetadata(prediction)}</small>
                          )}
                        </div>
                        <div className="similarity">
                          <strong>{(prediction.confidence * 100).toFixed(1)}%</strong>
                          <span>{messages.results.similarity}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                {job.status === "SUCCEEDED" && job.predictions?.length === 0 && (
                  <p className="no-predictions">{messages.results.noMatches}</p>
                )}
                {job.error && (
                  <div className="error-banner" role="alert">
                    {job.error.message}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        <footer>{messages.footer}</footer>
      </main>
    </div>
  );
}
