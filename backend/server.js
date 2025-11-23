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
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
        user_id VARCHAR(64),
        pin_color VARCHAR(7),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // ユーザーIDカラムを追加（既存テーブルにカラムがない場合）
    await pool.query(`
      ALTER TABLE posts 
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(64)
    `);
    
    // ピンの色カラムを追加（既存テーブルにカラムがない場合）
    await pool.query(`
      ALTER TABLE posts 
      ADD COLUMN IF NOT EXISTS pin_color VARCHAR(7)
    `);
    
    // インデックスの作成
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_stone_id ON posts(stone_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_ip_address ON posts(ip_address)
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

// Google Maps APIキーとMap IDを取得
app.get('/api/google-maps-config', (req, res) => {
  res.json({
    apiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    mapId: process.env.GOOGLE_MAPS_MAP_ID || ''
  });
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
              post_location_lng as "postLocationLng", user_id as "userId",
              pin_color as "pinColor", created_at as "createdAt"
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
    
    // ピンの色の配列
    const pinColors = ['#F17900', '#6466FF', '#00C27E', '#F2DD4E'];
    
    // 最新の投稿を取得（時系列順）
    const latestPosts = await pool.query(
      `SELECT nickname, pin_color 
       FROM posts 
       WHERE stone_id = $1 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [stoneId]
    );
    
    let assignedColor;
    
    if (latestPosts.rows.length > 0) {
      const latestPost = latestPosts.rows[0];
      
      // 同じニックネームが連続している場合は同じ色を使用
      if (latestPost.nickname === nickname && latestPost.pin_color) {
        assignedColor = latestPost.pin_color;
      } else {
        // 連続していない場合は、最新の投稿の色の次の色を使用（ループ）
        const currentColorIndex = latestPost.pin_color 
          ? pinColors.indexOf(latestPost.pin_color)
          : -1;
        
        if (currentColorIndex >= 0) {
          // 次の色を取得（ループ）
          assignedColor = pinColors[(currentColorIndex + 1) % pinColors.length];
        } else {
          // 色が設定されていない場合は最初の色
          assignedColor = pinColors[0];
        }
      }
    } else {
      // 最初の投稿の場合は最初の色
      assignedColor = pinColors[0];
    }
    
    // 石が存在しない場合は作成
    await pool.query(
      'INSERT INTO stones (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [stoneId]
    );
    
    // 投稿を保存
    const result = await pool.query(
      `INSERT INTO posts (stone_id, nickname, comment, post_location_lat, post_location_lng, pin_color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nickname, comment, post_location_lat as "postLocationLat", 
                 post_location_lng as "postLocationLng", pin_color as "pinColor",
                 created_at as "createdAt"`,
      [
        stoneId,
        nickname,
        comment || '',
        postLocation?.lat || null,
        postLocation?.lng || null,
        assignedColor
      ]
    );
    
    res.json({ success: true, post: result.rows[0] });
  } catch (error) {
    console.error('投稿保存エラー:', error);
    res.status(500).json({ error: '投稿の保存に失敗しました' });
  }
});

// データベースの中身を確認（開発用）
app.get('/api/debug/posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id,
        p.stone_id as "stoneId",
        p.nickname,
        p.comment,
        p.post_location_lat as "postLocationLat",
        p.post_location_lng as "postLocationLng",
        p.created_at as "createdAt"
      FROM posts p
      ORDER BY p.created_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('投稿取得エラー:', error);
    res.status(500).json({ error: '投稿データの取得に失敗しました' });
  }
});

// 全データ削除（デバッグ用）
app.delete('/api/debug/clear-all', async (req, res) => {
  try {
    // まず投稿データを削除（外部キー制約があるため先に削除）
    const postsResult = await pool.query('DELETE FROM posts');
    
    // 次に石データを削除
    const stonesResult = await pool.query('DELETE FROM stones');
    
    res.json({ 
      success: true, 
      message: '全データを削除しました',
      deletedPosts: postsResult.rowCount,
      deletedStones: stonesResult.rowCount
    });
  } catch (error) {
    console.error('データ削除エラー:', error);
    res.status(500).json({ error: 'データの削除に失敗しました' });
  }
});

// サーバー起動
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
  });
});

