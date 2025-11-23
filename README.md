# 石の掲示板プロジェクト

100個のユニークな石にQRコードを設置し、それぞれの石専用の掲示板を表示するプロジェクトです。

## 構成

```
ishi-ver3/
├── .env              # 環境変数（Gitに含まれません）
├── .gitignore        # Git除外設定
├── backend/          # バックエンドAPI（Node.js + Express + PostgreSQL）
│   ├── package.json
│   └── server.js
└── frontend/         # フロントエンド（HTML）
    └── index_isi2.html
```

## 機能

- 各石（stone-001 〜 stone-100）専用の投稿表示
- URL（例: `isi2.onrender.com`）から自動的に石IDを判定
- PostgreSQLで投稿データを管理

## セットアップ

### バックエンド

```bash
cd backend
npm install
```

`.env`ファイルをルートに作成：

```
DATABASE_URL=postgresql://...
PORT=3000
```

### フロントエンド

静的HTMLファイルです。バックエンドAPIのURLを設定してください。

## デプロイ

- バックエンド: Render Web Service
- フロントエンド: Render Static Site（各石ごとに個別のサービス）
