# OrderlyCore - 高機能Discord管理ボット

OrderlyCoreは、Gemini AIを統合した洗練されたデザインと強力な機能を備えたDiscord管理ボットです。

## 主な機能

- **Gemini AI統合**: 歓迎メッセージの生成、ステータスの自動更新、メンションへのインテリジェントな応答。
- **包括的なダッシュボード**: サーバー設定、メンバー管理、アナリティクスを直感的なウェブUIから操作。
- **レベリングシステム**: メッセージ送信やVC参加によるXP獲得、ロール報酬の自動付与。
- **高度なログ機能**: メッセージの編集・削除ログ、VCの入退出ログを詳細に記録。
- **オートモッド**: NGワードフィルター、招待リンクのブロックなどによる自動管理。
- **チケットシステム**: ユーザーからの問い合わせをスレッド形式で効率的に処理。
- **ロールボード**: ユーザーが自分でロールを選択できるインタラクティブなパネル。

## 技術スタック

- **ボット**: Discord.js v14
- **AI**: Google Generative AI (Gemini 1.5 Flash)
- **バックエンド**: Node.js, Express
- **データベース**: Firebase Firestore, Realtime Database
- **フロントエンド**: HTML, CSS (Glassmorphism Design), JavaScript (Feather Icons, Chart.js, Tom Select)

## セットアップ

### 必要条件

- Node.js 18.x 以上
- Firebase プロジェクト
- Google AI (Gemini) APIキー
- Discord Bot トークン

### 環境変数

`.env` ファイルを作成し、以下の情報を設定してください：

```env
DISCORD_TOKEN=your_token
CLIENT_ID=your_client_id
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_DATABASE_URL=...
FIREBASE_PROJECT_ID=...
GOOGLE_API_KEY=your_gemini_key
SESSION_SECRET=your_secret
ADMIN_PASSWORD=your_admin_password
```

### インストール

```bash
npm install
node index.js
```

## ライセンス

MIT License
