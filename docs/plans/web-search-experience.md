# AI画像検索デモの検索体験を再構築する

このExecPlanは生きた文書である。進捗、発見事項、決定ログ、完了結果を作業中に更新し、`PLANS.md`と`C:\Users\AKIRA\.codex\skills\execplan\references\PLANS.md`の方法論に従う。

## 目的と利用者価値

認証済み利用者が、JPEGまたはPNGの商品画像をファイル選択、ドラッグ&ドロップ、端末カメラのいずれかで入力し、非同期検索の進行と結果を一つの明快な画面で確認できるようにする。画面はAppleのWeb体験を想起させる、明るい半透明マテリアル、精密な余白、システムタイポグラフィ、柔らかな奥行き、抑制された配色、即応するコントロールを一貫して使う。見た目だけをApple風にするのではなく、選択、アップロード、検索、結果到着までの状態変化も同じ物理感と連続性で伝える。画面は日本語と英語を即時に切り替えられ、選択言語はブラウザへ保存される。Cognitoマネージドログインからログアウトするときは、操作可能に見えるカードを挟まず、控えめな全画面のログアウト中・移動中フィードバックからCognitoへ直接遷移する。

## 対象範囲

`apps/web`の認証後検索画面、直接ログイン画面、マネージドログインのフォールバック画面、画像入力、結果表示、言語切替、文書タイトル、ログアウト遷移を対象とする。既存のS3署名付きPOST、Job作成、ポーリング、429/503表示、結果データ契約は維持する。要件、基本設計、テスト戦略も利用者に見える変更へ合わせる。

## 対象外

API契約、Cognito設定、Tier、DynamoDB、Step Functions、推論モデル、カタログ索引、CloudFront設定は変更しない。カメラ映像をアプリ内で常時プレビューする`getUserMedia`実装は行わず、モバイルブラウザの標準撮影UIを開ける`capture="environment"`付きファイル入力を使う。外部UIライブラリやアニメーションライブラリは追加しない。

## 現状調査

中心実装は`apps/web/src/App.tsx`で、画像選択、アップロード、Job作成、ポーリング、結果表示を一つのコンポーネントが担当している。`apps/web/src/styles.css`は単一列のパネルとドラッグ&ドロップ領域を提供するが、カメラ入力、言語切替、ドラッグ中の継続的フィードバック、結果がない時の案内はない。ページ内タイトルは「非同期商品画像検索デモ」、`apps/web/index.html`の文書タイトルは「非同期画像推論デモ」で一致していない。

`App.tsx`の`logout`はセッションストレージを消去した後に`setSession(undefined)`を呼び、続いてCognitoのログアウトURLへ遷移する。この順序により、ブラウザ遷移が完了するまで`ManagedLogin`が描画される。既存の未コミット変更は、セッションがないAWS環境でCognitoマネージドログインを自動開始する修正であり、本変更はその挙動を維持する。

初回修正後も、CognitoのログアウトendpointからCloudFrontへ戻った直後に`ManagedLogin`のカードが一瞬表示された。原因は、自動ログインの`window.location.assign`が返った直後に`finally`で初期化状態を解除し、Cognitoのauthorize画面へ移動するまでの短い間だけ未認証カードの描画条件が成立することにある。これはFlociの直接ログインカードではなく、AWS用の再試行カードである。

## アーキテクチャ上の制約

ブラウザは画像バイナリをAPI Gatewayへ送らず、既存の`uploadImage`でS3署名付きPOSTへ直接送る。許可形式はJPEGとPNG、上限はruntime configの`maxUploadBytes`とする。`POST /api/jobs`は202を返す非同期契約のままとし、画面は`GET /api/jobs/{jobId}`のポーリングを続ける。JWT、Tier判定、Job所有権、画像所有権は変更しない。

TypeScript strict modeを維持する。言語切替はUI表示だけを対象とし、APIのエラーメッセージや永続データ形式を変更しない。端末カメラは対応ブラウザで背面カメラを優先し、非対応環境では通常の画像選択へ安全にフォールバックする。

## 実装方針

`apps/web/src/i18n.ts`へ`ja`と`en`の型付き辞書、初期言語判定、保存、文書言語とタイトルの同期を集約する。`apps/web/src/LanguageSwitcher.tsx`は二つの押しボタンを持つセグメントコントロールとし、`aria-pressed`で選択状態を伝える。

`apps/web/src/ImagePicker.tsx`へファイル入力、カメラ入力、ドラッグ状態、プレビュー、ファイル情報、削除操作を分離する。ドロップ領域はドラッグ開始から離脱まで見た目を連続して変え、クリック時は通常のファイル選択を開く。カメラボタンは別の非表示入力を開き、`accept="image/jpeg,image/png"`と`capture="environment"`を指定する。ファイル検証は`apps/web/src/image-selection.ts`の純粋関数へ分け、形式と容量のテストを可能にする。

`App.tsx`は検索入力と結果をデスクトップでは二列、狭い画面では一列に配置する。視覚言語はApple風の意匠を明示的な品質目標とする。背景には白から淡い青灰へ移る空気感のあるグラデーションを使い、その上に光を通すフローティングナビゲーションと大きな角丸のマテリアル面を重ねる。見出しはsystem-uiの太いウェイトと負のトラッキングで簡潔に構成し、本文は十分な行間を取る。操作は青を主役にした塗りボタン、白い副操作、カプセル型の言語セグメント、細い境界線、拡散した影で階層を示す。画像ドロップ面は選択前、ドラッグ中、選択後で同じ面が連続的に変化し、結果面も空状態から処理中、完了へ位置関係を変えずに展開する。

押下時は約`0.98`へ即座に縮小し、ホバーとフォーカスは明るさ、影、境界で応答する。面の出現や状態切替は短く、過度に跳ねない臨界減衰に近い動きとし、`transform`と`opacity`を中心に実装する。半透明の上部ナビゲーションとカードは`backdrop-filter`を使い、`prefers-reduced-transparency`では不透明へ切り替える。`prefers-reduced-motion`では移動を止め、短いクロスフェードまたは静的切替に置き換える。`prefers-contrast`では境界と文字のコントラストを強める。

認証遷移は`initializing`、`redirecting-to-login`、`logging-out`、`ready`の明示的な状態として扱う。マネージドログアウトでは`logging-out`へ移してからCognitoへ遷移し、Cognitoから戻って自動ログインを開始するときは`redirecting-to-login`の全画面表示を維持する。`window.location.assign`がJavaScript上で返っても`ready`へ移さず、PKCE生成や遷移開始が例外になった場合だけ`ready`へ戻してエラー付きの`ManagedLogin`カードを表示する。直接認証では従来どおりローカルログインへ戻す。固定時間の派手なログオフアニメーションは追加せず、現在のブランドアイコン、3点の進行表示、短い文言を使う。

## マイルストーン

第一マイルストーンでは、型付き翻訳辞書、画像検証、画像入力、言語切替の小さな単位を実装する。`bun test apps/web/src`で言語の初期値・保存値と画像形式・容量の境界が通れば完了とする。

第二マイルストーンでは、`App.tsx`と認証画面を新しい単位へ接続し、ログアウト遷移を修正する。`mise run format-check`、`mise run lint`、`mise run typecheck`、`mise run test`が成功し、API契約が変わっていないことを確認する。

第三マイルストーンでは、ローカルWebを起動してデスクトップとモバイル幅を目視確認する。画像選択、ドロップ、カメラ入力の存在、日本語と英語、ログアウト中表示、キーボードフォーカス、縮小表示を確認し、必要ならCSSを調整する。その後`mise run build`と`mise run synth`を実行する。

## 具体的な変更ファイル

`apps/web/src/App.tsx`は画面構造、言語状態、ログアウト遷移を変更する。`apps/web/src/styles.css`はゼロベースで検索体験用のレイアウトと状態表現へ置き換える。`apps/web/src/i18n.ts`、`apps/web/src/LanguageSwitcher.tsx`、`apps/web/src/ImagePicker.tsx`、`apps/web/src/image-selection.ts`を追加する。`apps/web/src/Login.tsx`と`apps/web/src/ManagedLogin.tsx`は翻訳済み文言と共通の言語切替を受け取る。`apps/web/index.html`は初期タイトルを「AI画像検索デモ」へ変更する。

`apps/web/src/i18n.test.ts`と`apps/web/src/image-selection.test.ts`を追加し、`apps/web/src/auth.test.ts`へログアウト方式の回帰テストを加える。認証遷移の表示判断は`apps/web/src/auth-transition.ts`へ分離し、`apps/web/src/auth-transition.test.ts`で初期化、自動ログイン、ログアウト、待機終了の表示を検証する。`docs/01_requirements.md`、`docs/DESIGN.md`、`docs/10_test_strategy.md`は入力方式、二言語、ログアウト表示の契約を追記する。

## データ移行・互換性

サーバー側データ移行はない。言語設定は新しいlocalStorageキーへ`ja`または`en`だけを保存し、値が不正ならブラウザ言語へフォールバックする。既存セッションキー、OAuth state、APIリクエスト、Jobレスポンスは変更しない。

## テスト計画

単体テストではJPEG/PNGの受理、別形式、上限超過、保存済み言語、ブラウザ言語、マネージドログアウトがReact上のセッションを保持する方針、直接ログアウトがセッションを消す方針を確認する。加えて、自動ログイン開始後は全画面の「移動中」表示が継続し、`ready`だけがカード表示へ進めることを確認する。既存のAPIと認証テストを全件実行する。

静的検証ではformat、lint、TypeScript、全単体テスト、Web build、CDK synthを実行する。手動確認では通常のファイル選択、ドラッグ&ドロップ、カメラ選択ボタン、プレビュー削除、検索開始、処理中、成功、候補なし、エラー、日英切替、狭い画面、キーボード操作、reduced-motionを確認する。

## ローカル確認手順

作業ディレクトリをリポジトリルートとして、`mise run format-check`、`mise run lint`、`mise run typecheck`、`mise run test`、`mise run build`を順に実行する。視覚確認では既存のFloci開発環境が利用可能なら`mise run floci-up`と`mise run deploy-local`を実行し、Web URLを開く。Flociを使わず見た目だけを確認する場合は、runtime configと認証を満たせる既存環境を使い、Vite開発サーバーで確認する。

## AWS確認手順

本変更はインフラ契約を変えないため、実装中のAWS再デプロイは必須としない。WebをAWSへ配信する場合は既存の`mise run deploy-web`を使い、CloudFront上でCognitoログイン後の入力、言語切替、検索、ログアウトを確認する。Cognitoログアウト押下後にアプリ内ログイン画面が表示されず、ログアウト中表示からCognitoへ遷移することを確認する。

## リスクと緩和策

`capture`属性の挙動はブラウザと端末に依存するため、カメラ専用APIとは表現せず、非対応環境では画像選択として動作するよう同じ検証経路へ接続する。ドラッグイベントは子要素移動でleaveが発火しやすいため、入れ子カウンターで状態を管理する。Object URLはファイル変更時とアンマウント時に必ず破棄する。半透明と動きはOSのアクセシビリティ設定で弱める。

既存の未コミット認証変更と文書変更を上書きしない。編集前の差分を基準に保持し、対象ファイルだけを整形する。

## 進捗

- [x] (2026-07-24 23:19 +09:00) 必須設計書、現行UI、既存差分、Apple Design Skill、ExecPlan規約を確認した。
- [x] (2026-07-24 23:19 +09:00) ログアウト時のログイン画面表示原因とカメラ入力の実装境界を決定した。
- [x] (2026-07-24 23:31 +09:00) 翻訳、画像検証、ファイル選択、ドラッグ&ドロップ、カメラ入力、言語切替と単体テストを実装した。
- [x] (2026-07-24 23:31 +09:00) Apple風の検索画面、認証画面、ログアウト遷移、アクセシビリティ用CSSを再構築した。
- [x] (2026-07-24 23:32 +09:00) 要件、基本設計、テスト戦略を更新した。
- [x] (2026-07-24 23:36 +09:00) Chromeでデスクトップと幅390px相当のモバイル表示、日英切替、文書タイトル、`lang`、横方向のはみ出し、カメラ入力属性を確認した。
- [x] (2026-07-24 23:44 +09:00) 最終コードに対して`mise run check`と`mise exec -- bun run cdk:synth`を実行し、追加した画像入力マークアップテストを含むWebテスト20件も確認した。
- [x] (2026-07-24 23:58 +09:00) CodexプロファイルのChromeを再起動後、ローカルサンプル画像をfile chooserで選択し、プレビュー、ファイル名、検索ボタンの有効化、コンソールエラーなしを確認した。
- [x] (2026-07-25 00:07 +09:00) `poruru`プロファイルで`mise run deploy-web`を実行し、AWS devのS3へWebを同期してCloudFront invalidationの完了、新しいHTML・CSS・JS・AWS用runtime configの配信を確認した。
- [x] (2026-07-25 00:39 +09:00) Cognitoログアウト後の自動ログイン再遷移でカードを表示せず、全画面の移動中表示を維持するよう認証状態を修正し、回帰テストを追加した。
- [x] (2026-07-25 00:50 +09:00) Web UIの保存言語をCognito authorize URLの`lang=ja` / `lang=en`へ引き継ぎ、テスト後にAWS devへWebを再配信した。
- [x] (2026-07-25 JST) CloudFrontを実ブラウザで開き、Cognitoマネージドログインへの遷移と、認証済み状態からのログアウト遷移を確認した。

## 決定ログ

- 決定: 当初の「Apple風の意匠そのものではなく原則を優先する」という方針を撤回し、Apple風の意匠と操作原則を同格の必須品質として扱う。
  理由: 利用者から、Apple風の視覚的な完成度自体が重要であり、副次的な扱いでは要件を満たさないとの指摘を受けたため。半透明マテリアル、精密な余白、システムタイポグラフィ、大きな角丸、柔らかな奥行き、抑制された青系配色、連続した状態遷移を画面全体で一貫させる。
  日付/担当: 2026-07-24 / User, Codex

- 決定: カメラ入力は`capture="environment"`付きファイル入力で実装する。
  理由: 追加権限、映像ストリーム管理、ブラウザ差を増やさず、モバイル標準撮影UIからJPEG/PNGの既存アップロード契約へ接続できるため。
  日付/担当: 2026-07-24 / Codex

- 決定: マネージドログアウトではReact上のセッションを先に消さず、ログアウト中状態を表示する。
  理由: 現在のちらつきは未認証分岐の再描画がCognito遷移より先に起きることが原因であり、この順序を変えるとログイン画面を挟まずに済むため。
  日付/担当: 2026-07-24 / Codex

- 決定: AWS反映では既存Stackを変更せず、`mise run deploy-web`だけを実行する。
  理由: このExecPlanの実装対象はWeb UIとブラウザ側認証遷移であり、API、Cognito、CloudFrontなどのインフラ契約は変更していない。作業ツリーには別作業のCDK差分が残っているため、`deploy-dev`を避けることで無関係なインフラ変更をAWSへ持ち込まない。
  日付/担当: 2026-07-25 / Codex

- 決定: 正常なログアウト・自動ログイン遷移では認証カードを非表示にし、控えめな全画面の状態表示だけを維持する。
  理由: 空白画面は操作への反応を失わせる一方、すぐ外部ページへ移動する正常経路で再試行カードを見せると、操作可能な別画面が出現したように見えて空間的一貫性を壊す。固定時間のログオフ演出を追加せず、実際の遷移時間だけ状態を表示するのがApple Design Skillの応答性、単純さ、抑制に最も合う。カードは遷移開始失敗時だけ意味を持つ。
  日付/担当: 2026-07-25 / User, Codex

- 決定: Cognitoの言語Cookieだけに依存せず、Web UIで保存した言語をすべてのauthorize URLへ明示する。
  理由: Web UIの言語を表示上の基準とし、利用者が日英を変更した直後のログイン、自己登録、パスワード再設定にも確実に反映するため。Cognito画面内の言語切替は追加しない。
  日付/担当: 2026-07-25 / User, Codex

## 発見事項

- 観察: Semble MCPは`Transport closed`で利用できなかったため、AGENTS.md指定の`mise exec -- uvx --from "semble[mcp]==0.4.1" semble`へ切り替えた。
  証拠: CLI検索は`apps/web/src/App.tsx:61`と`apps/web/src/auth.ts:99`を返した。

- 観察: 既存作業ツリーには、未認証時にマネージドログインを自動開始する`shouldAutoStartManagedLogin`の未コミット実装とテストがある。
  証拠: `git diff -- apps/web/src/App.tsx apps/web/src/auth.ts apps/web/src/auth.test.ts`で追加差分を確認した。

- 観察: 初版ExecPlanはApple Design Skillの動作原則を重視する一方、Apple風の視覚意匠を副次扱いにしており、利用者の品質目標と一致していなかった。
  証拠: 利用者から意匠も重要であり、その扱いでは不十分との明示的な修正指示を受けた。実装前に計画を改訂し、意匠を必須品質へ格上げした。

- 観察: `AGENTS.md`に列挙された`mise run format-check`、`mise run lint`、`mise run typecheck`、`mise run test`、`mise run build`、`mise run synth`は、整理後の`mise.toml`には個別タスクとして存在しない。
  証拠: `mise run format-check`と`mise run lint`は`no task found`を返し、`mise.toml`の`check`がformat、lint、型検査、全テスト、build、cdk-nagをまとめて実行する現行ゲートだった。このため検証は`mise run check`を基準にした。

- 観察: Chrome拡張のファイルURL権限は、Chromeプロセスを再起動した後にfile chooserへ反映された。
  証拠: 再起動前の`fileChooser.setFiles`は`Not allowed`を返したが、CodexプロファイルのChromeを起動し直した後は`examples/sample-image.png`の選択に成功した。画面上でプレビュー画像、`sample-image.png`、`PNG · 1.9 MB`、有効な「AIで候補を検索」ボタンを確認し、コンソールのerrorログは0件だった。

- 観察: `bun run cdk:synth`をmise外から直接実行すると、CDKの子PowerShellが`bun.cmd`を解決できなかった。
  証拠: 最初の単独synthは`The term 'bun.cmd' is not recognized`で失敗した。同じコマンドを`mise exec -- bun run cdk:synth`として実行すると、全Lambdaバンドルとsynthがexit code 0で完了した。

- 観察: AWS配信後の実ブラウザ確認時には、Codexから利用可能なブラウザ接続がなかった。
  証拠: CloudFront URLに対するブラウザ選択は`No browser is available`となり、利用可能ブラウザ一覧も空だった。代わりにCloudFrontへのHTTP取得、S3オブジェクト一覧、runtime configを照合し、配信反映そのものを確認した。

- 観察: ログアウト前のログイン画面ちらつきを抑えても、Cognitoログアウト後にCloudFrontへ戻った後の自動ログイン開始で別のカードちらつきが発生した。
  証拠: `App.tsx`の初期化effectは`startManagedLogin`を`await`した後、`window.location.assign`によるページ移動の完了を待てないまま`finally`で`initializingAuth=false`にする。この短い間に`config`あり、`session`なし、初期化済みとなり、AWS用`ManagedLogin`カードが描画される。

## 完了結果

Apple風の半透明マテリアル、システムタイポグラフィ、大きな角丸、柔らかな奥行き、青を主役にした操作階層を持つ検索画面へ再構築した。利用者はファイル選択、ドラッグ&ドロップ、対応端末の背面カメラからJPEGまたはPNGを入力できる。日本語と英語は即時に切り替わり、`html`の`lang`、文書タイトル、保存済み言語も同期する。

マネージドログアウトはReact上のセッションを先に消さず、ログアウト中画面を描画した後にCognitoへ遷移する。直接認証だけは従来どおりローカルログイン画面へ戻る。これにより、報告されていたCognito遷移前のログイン画面のちらつきをコード上と回帰テストで除去した。

`mise run check`はformat、lint、TypeScript、ruff、ty、Web/API/CDK/Pythonテスト、全build、cdk-nagを含めてexit code 0で完了した。最終的に追加した画像入力マークアップテストを含め、Webテスト20件、format、lint、Web typecheckも再実行して成功した。`mise exec -- bun run cdk:synth`も成功した。

Chromeでデスクトップと幅390px相当のモバイル表示を確認した。モバイルの実測は`clientWidth=375`、`scrollWidth=375`で横方向のはみ出しがなく、日英切替後のタイトルと`lang=en`も確認した。Chrome再起動後はローカルサンプル画像の選択にも成功し、画像プレビュー、ファイル情報、検索ボタンの有効化を確認した。選択後のコンソールerrorログは0件だった。

AWS devでは`mise run check`を再実行し、Web/APIテスト44件、CDK・Pythonテスト、build、cdk-nagを含む全ゲートの成功後に`mise run deploy-web`を実行した。CloudFront invalidation `I3M0QHGFQ131TQLUWEBLQATSUG`は`Completed`となり、`https://d1w6cg1fs33jit.cloudfront.net/`はタイトル「AI画像検索デモ」と新しいハッシュ付きCSS・JSをHTTP 200で返した。`config.json`は`managed-login`、`localAuthBypass=false`、CloudFront callback URLを持つAWS用設定である。

CognitoからCloudFrontへ戻った後の二段目のちらつきは、認証遷移を`initializing`、`redirecting-to-login`、`logging-out`、`ready`へ明示化して解消した。正常な自動ログインでは`window.location.assign`が返っても`redirecting-to-login`を維持し、例外時だけ再試行カードへ進む。修正後の`mise run check`はWeb/APIテスト46件を含む全ゲートで成功した。Webを再配信し、CloudFront invalidation `IC7EI2370R00HLD3H8X1TBTEAR`の`Completed`と、新しい`index-CcEyqJQv.js`に認証遷移状態が含まれることを確認した。

Web UIで保存した`ja`または`en`をCognito authorize URLの`lang`へ毎回渡すようにし、マネージドログイン、自己登録、パスワード再設定の言語をアプリと一致させた。修正後の`mise run check`は46テストを含む全ゲートで成功した。CloudFront invalidation `I2OF1LFPOIF9YO7QWBGH9LR8O8`は`Completed`となり、配信中の`index-Cu-kMzd-.js`で`code_challenge_method:"S256",lang:`が含まれることを確認した。

残る確認は、実端末のカメラ起動と、実ブラウザでのCognitoログイン・ログアウト遷移である。APIとインフラ契約は変更していないため、CDK StackとFloci環境は再デプロイしていない。

2026-07-25更新: 利用者のAWS反映指示を受け、既存Stackを維持したWeb単独デプロイとCloudFront上の実環境確認を進捗、決定ログ、AWS確認手順へ反映した。
2026-07-25 00:07更新: AWS devへのWeb配信、invalidation、HTTP/S3検証結果と、ブラウザ接続不在により残ったCognito実画面確認を記録した。
2026-07-25更新: AWSで確認されたCognito再遷移中のカードちらつきについて、Apple Design Skillに基づく表示方針、原因、実装とテストの変更点を追記した。
2026-07-25 00:39更新: 認証状態遷移の修正、46テストを含む全体チェック、AWSへのWeb再配信、CloudFront invalidation完了の証跡を記録した。
2026-07-25 00:50更新: Web UIの保存言語をCognitoへ引き継ぐ実装、テスト、AWS配信確認を記録した。
