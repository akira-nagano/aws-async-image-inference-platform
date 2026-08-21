export type Locale = "ja" | "en";

export type JobStatusLabel =
  | "RESERVED"
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "SUBMIT_FAILED";

export interface Messages {
  pageTitle: string;
  language: {
    label: string;
    japanese: string;
    english: string;
  };
  auth: {
    localLabel: string;
    localDescription: string;
    managedDescription: string;
    username: string;
    password: string;
    login: string;
    loggingIn: string;
    redirecting: string;
    logout: string;
    loggingOut: string;
    loginError: string;
    loginStartError: string;
  };
  header: {
    productLabel: string;
    signedInAs: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    description: string;
  };
  image: {
    step: string;
    title: string;
    description: string;
    dropTitle: string;
    dropDescription: string;
    dropActive: string;
    choose: string;
    camera: string;
    cameraHint: string;
    remove: string;
    selectedAlt: string;
    selected: string;
    supportedTypes: string;
    search: string;
    submitting: string;
    uploading: string;
  };
  results: {
    step: string;
    title: string;
    description: string;
    emptyTitle: string;
    emptyDescription: string;
    jobLabel: string;
    jobId: string;
    concurrency: string;
    processingTime: string;
    model: string;
    rank: string;
    similarity: string;
    noMatches: string;
    seconds: string;
  };
  errors: {
    loadingConfig: string;
    configFailed: string;
    stateFailed: string;
    unsupportedType: string;
    fileTooLarge: string;
    startFailed: string;
    concurrencyLimit: string;
    systemBusy: string;
    localOnlyLogin: string;
  };
  status: Record<JobStatusLabel, string>;
  footer: string;
}

export const translations: Record<Locale, Messages> = {
  ja: {
    pageTitle: "AI画像検索デモ",
    language: {
      label: "表示言語",
      japanese: "日本語",
      english: "English",
    },
    auth: {
      localLabel: "ローカル開発環境",
      localDescription: "Flociのテストユーザーでログインします。",
      managedDescription: "Amazon Cognitoのログイン画面で安全に認証します。",
      username: "ユーザー名",
      password: "パスワード",
      login: "ログイン",
      loggingIn: "ログイン中…",
      redirecting: "移動中…",
      logout: "ログアウト",
      loggingOut: "ログアウト中…",
      loginError: "ログインに失敗しました。",
      loginStartError: "ログインを開始できませんでした。",
    },
    header: {
      productLabel: "AI画像検索",
      signedInAs: "ログイン中",
    },
    hero: {
      eyebrow: "ASYNCHRONOUS VISUAL SEARCH",
      title: "AI画像検索デモ",
      description:
        "商品画像をアップロードすると、AIが登録済みカタログから見た目の近い候補を非同期で検索します。",
    },
    image: {
      step: "01 · 画像を入力",
      title: "検索したい商品を見せてください",
      description: "ファイル選択、ドラッグ&ドロップ、または端末のカメラを利用できます。",
      dropTitle: "ここに画像をドロップ",
      dropDescription: "クリックしてファイルを選択することもできます",
      dropActive: "画像を離して選択",
      choose: "画像を選択",
      camera: "カメラで撮影",
      cameraHint: "対応端末では背面カメラを優先して開きます",
      remove: "選択を解除",
      selectedAlt: "選択した商品のプレビュー",
      selected: "選択済み",
      supportedTypes: "JPEG / PNG、最大",
      search: "AIで候補を検索",
      submitting: "検索を受け付けています…",
      uploading: "画像をアップロード中",
    },
    results: {
      step: "02 · 検索結果",
      title: "近い商品候補",
      description: "受付後も画面が自動で状態を確認します。",
      emptyTitle: "検索結果はここに表示されます",
      emptyDescription: "画像を選択して検索を始めると、上位候補と類似度を確認できます。",
      jobLabel: "検索ステータス",
      jobId: "Job ID",
      concurrency: "同時実行",
      processingTime: "処理時間",
      model: "モデル",
      rank: "位",
      similarity: "類似度",
      noMatches: "登録済みカタログに十分近い商品が見つかりませんでした。",
      seconds: "秒",
    },
    errors: {
      loadingConfig: "設定を読み込み中…",
      configFailed: "設定を読み込めませんでした。",
      stateFailed: "状態確認に失敗しました。",
      unsupportedType: "JPEGまたはPNGを選択してください。",
      fileTooLarge: "ファイルサイズが上限を超えています。",
      startFailed: "検索を開始できませんでした。",
      concurrencyLimit: "同時実行上限です",
      systemBusy: "システム混雑中です",
      localOnlyLogin: "直接ログインはローカル環境でのみ利用できます。",
    },
    status: {
      RESERVED: "受付済み",
      QUEUED: "待機中",
      RUNNING: "検索中",
      SUCCEEDED: "完了",
      FAILED: "失敗",
      TIMED_OUT: "タイムアウト",
      CANCELLED: "キャンセル",
      SUBMIT_FAILED: "受付失敗",
    },
    footer: "画像は署名付きURLを使ってS3へ直接送信され、検索は非同期で処理されます。",
  },
  en: {
    pageTitle: "AI Image Search Demo",
    language: {
      label: "Display language",
      japanese: "日本語",
      english: "English",
    },
    auth: {
      localLabel: "Local development",
      localDescription: "Sign in with a Floci test user.",
      managedDescription: "Continue to Amazon Cognito to sign in securely.",
      username: "Username",
      password: "Password",
      login: "Sign in",
      loggingIn: "Signing in…",
      redirecting: "Redirecting…",
      logout: "Sign out",
      loggingOut: "Signing out…",
      loginError: "Sign-in failed.",
      loginStartError: "Could not start sign-in.",
    },
    header: {
      productLabel: "AI Image Search",
      signedInAs: "Signed in",
    },
    hero: {
      eyebrow: "ASYNCHRONOUS VISUAL SEARCH",
      title: "AI Image Search Demo",
      description:
        "Upload a product image and AI will asynchronously search the registered catalog for visually similar items.",
    },
    image: {
      step: "01 · Add an image",
      title: "Show us the product to find",
      description: "Choose a file, drag and drop an image, or use your device camera.",
      dropTitle: "Drop your image here",
      dropDescription: "You can also click to browse your files",
      dropActive: "Release to select this image",
      choose: "Choose image",
      camera: "Take a photo",
      cameraHint: "On supported devices, the rear camera opens first",
      remove: "Remove selection",
      selectedAlt: "Preview of the selected product",
      selected: "Selected",
      supportedTypes: "JPEG / PNG, up to",
      search: "Search with AI",
      submitting: "Submitting search…",
      uploading: "Uploading image",
    },
    results: {
      step: "02 · Results",
      title: "Similar product candidates",
      description: "The page checks progress automatically after submission.",
      emptyTitle: "Your results will appear here",
      emptyDescription:
        "Choose an image and start a search to see top matches and similarity scores.",
      jobLabel: "Search status",
      jobId: "Job ID",
      concurrency: "Concurrent jobs",
      processingTime: "Processing time",
      model: "Model",
      rank: "#",
      similarity: "Similarity",
      noMatches: "No product in the registered catalog was similar enough.",
      seconds: "sec",
    },
    errors: {
      loadingConfig: "Loading configuration…",
      configFailed: "Could not load configuration.",
      stateFailed: "Could not refresh the search status.",
      unsupportedType: "Choose a JPEG or PNG image.",
      fileTooLarge: "The image exceeds the size limit.",
      startFailed: "Could not start the search.",
      concurrencyLimit: "Concurrency limit reached",
      systemBusy: "The system is busy",
      localOnlyLogin: "Direct sign-in is available only in the local environment.",
    },
    status: {
      RESERVED: "Accepted",
      QUEUED: "Queued",
      RUNNING: "Searching",
      SUCCEEDED: "Complete",
      FAILED: "Failed",
      TIMED_OUT: "Timed out",
      CANCELLED: "Cancelled",
      SUBMIT_FAILED: "Submission failed",
    },
    footer:
      "Images are uploaded directly to S3 with a signed URL, and searches run asynchronously.",
  },
};

export const LOCALE_STORAGE_KEY = "ai-image-search-locale";

export function resolveLocale(
  storedLocale: string | null,
  browserLanguages: readonly string[],
): Locale {
  if (storedLocale === "ja" || storedLocale === "en") return storedLocale;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("ja")) ? "ja" : "en";
}

export function loadLocale(): Locale {
  let storedLocale: string | null = null;
  try {
    storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // A privacy mode may deny storage access. Browser language remains a safe fallback.
  }
  return resolveLocale(storedLocale, navigator.languages);
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The UI can still switch languages for the current page when storage is unavailable.
  }
}
