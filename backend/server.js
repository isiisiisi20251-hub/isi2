require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS設定（フロントエンドからのアクセスを許可）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// PostgreSQL接続プールの設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// データベース接続テスト
pool.on('connect', () => {
  console.log('PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// データベーステーブルの初期化（初回起動時のみ）
async function initDatabase() {
  try {
    // 石テーブル
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stones (
        id VARCHAR(50) PRIMARY KEY,
        location_lat DECIMAL(10, 8),
        location_lng DECIMAL(11, 8),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // 投稿テーブル
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id BIGSERIAL PRIMARY KEY,
        stone_id VARCHAR(50) REFERENCES stones(id),
        nickname VARCHAR(100) NOT NULL,
        comment TEXT,
        post_location_lat DECIMAL(10, 8),
        post_location_lng DECIMAL(11, 8),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // インデックスの作成
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_stone_id ON posts(stone_id)
    `);
    
    console.log('Database tables initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// URLから石IDを取得する関数
function getStoneIdFromUrl(host) {
  // isi2.onrender.com → stone-002
  const match = host.match(/^isi(\d+)/);
  if (match) {
    const num = match[1].padStart(3, '0');
    return `stone-${num}`;
  }
  return null;
}

app.get('/', (req, res) => {
  res.json({ message: 'Backend API' });
});

// 投稿データを取得（石IDでフィルタリング）
app.get('/api/posts', async (req, res) => {
  try {
    const host = req.get('host') || req.headers.host;
    const stoneId = getStoneIdFromUrl(host) || req.query.stoneId;
    
    if (!stoneId) {
      return res.status(400).json({ error: '石IDが取得できませんでした' });
    }
    
    // 石が存在しない場合は作成
    await pool.query(
      'INSERT INTO stones (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [stoneId]
    );
    
    // 該当石の投稿を取得
    const result = await pool.query(
      `SELECT id, nickname, comment, post_location_lat as "postLocationLat", 
              post_location_lng as "postLocationLng", created_at as "createdAt"
       FROM posts 
       WHERE stone_id = $1 
       ORDER BY created_at DESC`,
      [stoneId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('投稿取得エラー:', error);
    res.status(500).json({ error: '投稿データの取得に失敗しました' });
  }
});

// 投稿データを保存
app.post('/api/posts', async (req, res) => {
  try {
    const host = req.get('host') || req.headers.host;
    const stoneId = getStoneIdFromUrl(host) || req.body.stoneId;
    
    if (!stoneId) {
      return res.status(400).json({ error: '石IDが取得できませんでした' });
    }
    
    const { nickname, comment, postLocation } = req.body;
    
    // バリデーション
    if (!nickname) {
      return res.status(400).json({ error: 'ニックネームは必須です' });
    }
    
    // 石が存在しない場合は作成
    await pool.query(
      'INSERT INTO stones (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [stoneId]
    );
    
    // 投稿を保存
    const result = await pool.query(
      `INSERT INTO posts (stone_id, nickname, comment, post_location_lat, post_location_lng)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nickname, comment, post_location_lat as "postLocationLat", 
                 post_location_lng as "postLocationLng", created_at as "createdAt"`,
      [
        stoneId,
        nickname,
        comment || '',
        postLocation?.lat || null,
        postLocation?.lng || null
      ]
    );
    
    res.json({ success: true, post: result.rows[0] });
  } catch (error) {
    console.error('投稿保存エラー:', error);
    res.status(500).json({ error: '投稿の保存に失敗しました' });
  }
});

// サーバー起動
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  });
});

