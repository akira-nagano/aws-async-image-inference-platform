# Local / Floci

## 日常開発

```bash
mise run dev-local
```

Floci本体とFloci UIを起動し、初回はCDK bootstrap/deploy、Cognitoユーザー作成まで行い、その後Viteを起動する。2回目以降は`local/data/`へ永続化されたStackを再利用する。

システム識別子変更前の`local/data/`は自動移行しない。古いリソースを残さず再構築する場合は、停止後に`local/data/`をリポジトリ外へ退避してから起動する。

```text
アプリケーションWeb UI: http://localhost:5173
Floci管理UI:          http://localhost:4500
```

Floci管理UIは日常開発では常に起動する。S3 bucketやLambda functionなど、Floci UIが対応するローカルAWSリソースを確認できる。

API Lambda、CDK、推論コンテナを変更した場合:

```bash
mise run dev-local-refresh
```

停止:

```bash
mise run dev-local-down
```

Ctrl+CではViteだけが停止する。`dev-local-down`はFloci UI、Floci本体、Lambdaコンテナ、ローカルECRレジストリを停止するが、`local/data/`は削除しない。

ログ:

```bash
mise run floci-logs
```

## 起動からE2Eまで

```bash
mise run e2e-local
```

Floci UIを起動せず、開発用の`local/data/`とは分離した一時データ領域へ現在のソースを新規deployし、Cognito seed、smoke、Tier結合試験を実行する。完了時はFlociを停止して一時データを削除し、失敗時は停止前にComposeログを出力する。開発用データは再利用も削除もしない。

アプリケーションWeb UIだけを起動する場合:

```bash
mise run dev-web
```

ローカルWeb UIのCognito通信は、FlociのCORS制約を避けるためViteの`/_local/cognito` proxyを経由する。ログイン時に`Failed to fetch`となる場合は、`apps/web/public/config.json`の`cognitoEndpoint`が`/_local/cognito`であることを確認し、必要なら`mise exec -- bash ./local/export-stack-outputs.sh`で再生成してViteを再起動する。

既定ユーザー:

```text
basic@example.test
LocalPassw0rd!
tier-basic
```

追加ユーザー例:

```bash
./local/seed-cognito-user.sh standard@example.test 'LocalPassw0rd!' tier-standard
./local/seed-cognito-user.sh premium@example.test 'LocalPassw0rd!' tier-premium
```

`local/data/` はFlociの永続データでありGit管理外です。

Floci 1.5.33のHTTP API v2は、CDKが定義したJWT AuthorizerのclaimsをLambdaイベントへ渡さない。
そのためローカル向けCDK deployだけは明示的なローカル認証ヘッダーを有効にする。
AWS向けテンプレートでは、この経路を有効化できない。
