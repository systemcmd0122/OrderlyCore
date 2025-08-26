// systemcmd0122/overseer/overseer-73bfc1e5f235bcccdbf7f2400b84767315a3e964/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, Partials, PermissionsBitField, EmbedBuilder } = require('discord.js'); // EmbedBuilderを追加
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const chalk = require('chalk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeApp } = require('firebase/app');
// limit を getDocs の隣に追加
const { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, deleteDoc, Timestamp, orderBy, limit } = require('firebase/firestore');
const { getDatabase, ref, set, get, remove } = require('firebase/database');

// --- Express アプリケーション設定 ---
const app = express();
const PORT = process.env.PORT || 8000;

// CORS設定: Koyeb環境では、異なるサブドメイン間で通信することがあるため設定を推奨
app.use(cors({
    origin: process.env.APP_URL || `http://localhost:${PORT}`, // フロントエンドのURL
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// 'public'ディレクトリの前にセッションミドルウェアを配置
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_very_secret_key_that_is_long_and_random',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // 'production'モードではtrueに
        httpOnly: true, // セキュリティ向上のため
        maxAge: 24 * 60 * 60 * 1000 // 24時間
    }
}));
app.use(express.static(path.join(__dirname, 'public')));


app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// --- Firebase設定 ---
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const rtdb = getDatabase(firebaseApp);

// --- Google Gemini API設定 ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- Discordクライアント設定 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember]
});

client.db = db;
client.rtdb = rtdb;
client.commands = new Collection();
client.geminiModel = geminiModel;

// --- Webダッシュボード用ミドルウェアとAPI ---

// 認証チェックミドルウェア
const isAuthenticated = (req, res, next) => {
    if (req.session.userId && req.session.guildId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please login again.' });
};

// サーバー管理者チェックミドルウェア
const isGuildAdmin = async (req, res, next) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.session.userId);
        if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return next();
        }
        res.status(403).json({ error: 'Forbidden: You are not an administrator of this server.' });
    } catch (error) {
        console.error('Error checking guild admin status:', error);
        res.status(500).json({ error: 'Internal Server Error while verifying permissions.' });
    }
};

// --- ヘルスチェック用エンドポイント ---
app.get('/ping', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});
app.get('/health', (req, res) => {
    const health = {
        status: client.isReady() ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        bot_status_code: client.ws.status
    };
    res.status(client.isReady() ? 200 : 503).json(health);
});

// --- Keep-alive機能 ---
function keepAlive() {
    const PING_INTERVAL = 2 * 60 * 1000;
    const appUrl = process.env.APP_URL;

    if (!appUrl) {
        console.warn(chalk.yellow('⚠️ APP_URLが設定されていません。Keep-alive機能は無効になります。'));
        return;
    }

    setInterval(async () => {
        try {
            const url = appUrl.endsWith('/ping') ? appUrl : `${appUrl}/ping`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, { 
                signal: controller.signal,
                headers: { 'User-Agent': `Overseer-Bot/${require('./package.json').version}` }
            });
            
            clearTimeout(timeout);
            
            if (response.ok) {
                 console.log(chalk.blueBright(`[Keep-Alive] Ping successful to ${url}. Status: ${response.status}`));
            } else {
                 console.error(chalk.yellow(`[Keep-Alive] Ping failed to ${url}. Status: ${response.status}`));
            }
        } catch (error) {
            console.error(chalk.red(`[Keep-Alive] Error pinging ${appUrl}:`, error.message));
        }
    }, PING_INTERVAL);
}

// API: 認証トークンの検証
app.post('/api/verify', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const tokenRef = ref(rtdb, `authTokens/${token}`);
    try {
        const snapshot = await get(tokenRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (data.expiresAt > Date.now()) {
                req.session.userId = data.userId;
                req.session.guildId = data.guildId;
                await remove(tokenRef);
                return res.status(200).json({ message: 'Login successful!', guildId: data.guildId });
            } else {
                await remove(tokenRef);
                return res.status(401).json({ error: 'Token has expired.' });
            }
        } else {
            return res.status(401).json({ error: 'Invalid token.' });
        }
    } catch (error) {
        console.error("Token verification error:", error);
        return res.status(500).json({ error: 'Database error during token verification.' });
    }
});

// API: ログアウト
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully.' });
    });
});

// API: サーバーの基本情報を取得
app.get('/api/guild-info', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 2) // Text and Voice
            .map(c => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name));
            
        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
            .sort((a,b) => a.name.localeCompare(b.name));
        
        const members = await guild.members.fetch();
        const memberCount = members.filter(member => !member.user.bot).size;
        const botCount = members.size - memberCount;

        res.json({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL(),
            channels,
            roles,
            memberCount,
            botCount
        });
    } catch (e) {
        console.error('Error fetching guild info:', e);
        res.status(404).json({ error: 'Guild not found or failed to fetch details.' });
    }
});

// === ▼▼▼▼▼ ここからアナリティクスAPIを追加 ▼▼▼▼▼ ===
app.get('/api/analytics/activity', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guildId = req.session.guildId;
        const guild = await client.guilds.fetch(guildId);

        // Firestoreからレベル情報を取得
        const levelsRef = collection(db, 'levels');
        const q = query(levelsRef, where('guildId', '==', guildId));
        const snapshot = await getDocs(q);

        const allUsersData = [];
        snapshot.forEach(doc => {
            allUsersData.push(doc.data());
        });

        // 1. メッセージ数ランキング上位5名
        const topUsers = allUsersData
            .sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0))
            .slice(0, 5);
        
        // Discordから最新のユーザー情報を取得
        const topUsersWithDetails = await Promise.all(topUsers.map(async (user) => {
            try {
                const member = await guild.members.fetch(user.userId);
                return { ...user, displayName: member.displayName, username: member.user.username };
            } catch {
                return { ...user, displayName: '不明なユーザー', username: 'Unknown' };
            }
        }));

        // 2. 時間帯別アクティビティ
        const activityByHour = Array(24).fill(0);
        allUsersData.forEach(user => {
            if (user.lastMessageTimestamp) {
                // タイムゾーンをJST (+9)と仮定して計算
                const date = new Date(user.lastMessageTimestamp);
                const hour = date.getHours(); // UTCの時間を取得
                activityByHour[hour] = (activityByHour[hour] || 0) + 1; // ここではメッセージ数ではなくアクティブユーザー数
            }
        });

        const activityByHourFormatted = activityByHour.map((count, hour) => ({
            label: `${hour.toString().padStart(2, '0')}`,
            value: count
        }));

        res.json({
            topUsers: topUsersWithDetails,
            activityByHour: activityByHourFormatted
        });

    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data.' });
    }
});
// === ▲▲▲▲▲ ここまでアナリティクスAPIを追加 ▲▲▲▲▲ ===

// ★★★★★【ここから追加・変更】★★★★★
// API: ウェルカムメッセージ設定の取得
app.get('/api/settings/welcome-message', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const settingsRef = doc(db, 'guild_settings', req.session.guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists() && docSnap.data().welcomeMessage) {
            res.json(docSnap.data().welcomeMessage);
        } else {
            // デフォルト値を返す
            res.json({
                enabled: true,
                type: 'default',
                title: '🎉 {server.name} へようこそ！',
                description: '**{user.displayName}** さん、サーバーへのご参加ありがとうございます！\n\nまずはルールをご確認ください: {rulesChannel}',
                imageUrl: ''
            });
        }
    } catch (error) {
        console.error('Error fetching welcome message settings:', error);
        res.status(500).json({ error: 'Failed to fetch welcome message settings.' });
    }
});

// API: ウェルカムメッセージ設定の更新
app.post('/api/settings/welcome-message', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const settingsRef = doc(db, 'guild_settings', req.session.guildId);
        await setDoc(settingsRef, { welcomeMessage: req.body }, { merge: true });
        res.status(200).json({ message: 'Welcome message settings updated successfully.' });
    } catch (error) {
        console.error('Error updating welcome message settings:', error);
        res.status(500).json({ error: 'Failed to update welcome message settings.' });
    }
});
// ★★★★★【ここまで追加・変更】★★★★★

// API: サーバー設定の取得 (汎用)
app.get('/api/settings/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection } = req.params;
        if (!['guilds', 'guild_settings'].includes(collection)) {
            return res.status(400).json({ error: 'Invalid collection specified.' });
        }
        const settingsRef = doc(db, collection, req.session.guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            res.json(docSnap.data());
        } else {
            res.json({});
        }
    } catch (error) {
        console.error(`Error fetching settings from ${req.params.collection}:`, error);
        res.status(500).json({ error: `Failed to fetch settings from ${req.params.collection}.` });
    }
});

// API: サーバー設定の更新 (汎用)
app.post('/api/settings/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection } = req.params;
        if (!['guilds', 'guild_settings'].includes(collection)) {
            return res.status(400).json({ error: 'Invalid collection specified.' });
        }
        const settingsRef = doc(db, collection, req.session.guildId);
        await setDoc(settingsRef, req.body, { merge: true });
        res.status(200).json({ message: 'Settings updated successfully.' });
    } catch (error) {
        console.error(`Error updating settings for ${req.params.collection}:`, error);
        res.status(500).json({ error: `Failed to update settings for ${req.params.collection}.` });
    }
});

// === ロールボード専用API ===
app.get('/api/roleboards', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const q = query(collection(db, 'roleboards'), where('guildId', '==', req.session.guildId));
        const snapshot = await getDocs(q);
        const boards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(boards);
    } catch (error) {
        console.error('Error fetching roleboards:', error);
        res.status(500).json({ error: 'Failed to fetch roleboards.' });
    }
});

app.post('/api/roleboards', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { title, description, color } = req.body;
        const guildId = req.session.guildId;
        const boardId = `rb_${guildId}_${Date.now()}`;
        
        const boardData = {
            guildId,
            title,
            description: description || 'ボタンをクリックしてロールを取得・削除できます。',
            color: parseInt(color.replace('#', ''), 16) || 0x5865F2,
            roles: {},
            genres: {},
            createdBy: req.session.userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        await setDoc(doc(db, 'roleboards', boardId), boardData);
        res.status(201).json({ message: 'Roleboard created successfully.', board: {id: boardId, ...boardData} });
    } catch (error) {
        console.error('Error creating roleboard:', error);
        res.status(500).json({ error: 'Failed to create roleboard.' });
    }
});

app.put('/api/roleboards/:id', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const boardRef = doc(db, 'roleboards', id);
        const boardDoc = await getDoc(boardRef);

        if (!boardDoc.exists() || boardDoc.data().guildId !== req.session.guildId) {
            return res.status(404).json({ error: 'Roleboard not found.' });
        }
        
        const updateData = { ...req.body, updatedAt: new Date().toISOString() };
        await updateDoc(boardRef, updateData);
        res.status(200).json({ message: 'Roleboard updated successfully.' });

    } catch (error) {
        console.error(`Error updating roleboard ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update roleboard.' });
    }
});

app.delete('/api/roleboards/:id', isAuthenticated, isGuildAdmin, async (req, res) => {
     try {
        const { id } = req.params;
        const boardRef = doc(db, 'roleboards', id);
        const boardDoc = await getDoc(boardRef);

        if (!boardDoc.exists() || boardDoc.data().guildId !== req.session.guildId) {
            return res.status(404).json({ error: 'Roleboard not found.' });
        }
        
        await deleteDoc(boardRef);
        res.status(200).json({ message: 'Roleboard deleted successfully.' });

    } catch (error) {
        console.error(`Error deleting roleboard ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete roleboard.' });
    }
});


// ページルーティング (SPAなので、/dashboardへのアクセスはdashboard.htmlを返す)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// その他のルートは、index.htmlにフォールバックさせる
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    const filePath = path.join(__dirname, 'public', req.path);
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
        return res.sendFile(filePath);
    }
    if (req.path === '/login') {
        return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// --- コマンド・イベントの読み込みとボット起動 ---
const BotStatus = {
    INITIALIZING: '🔄 初期化中...',
    LOADING_COMMANDS: '📂 コマンド読み込み中...',
    LOADING_EVENTS: '🎯 イベント読み込み中...',
    CONNECTING: '🌐 Discord に接続中...',
    REGISTERING_COMMANDS: '⚙️ コマンド登録中...',
    GENERATING_STATUS: '🤖 AIステータス生成中...',
    READY: '✅ 正常稼働中',
    ERROR: '❌ エラー発生'
};
let currentStatus = BotStatus.INITIALIZING;

function updateBotStatus(status, details = '') {
    currentStatus = status;
    console.log(`[${new Date().toLocaleString('ja-JP')}] ${status} ${details}`);
    if (client.user && !client.isReady()) {
         client.user.setPresence({
            activities: [{ name: 'status', type: ActivityType.Custom, state: status }],
            status: 'dnd'
        });
    }
}

updateBotStatus(BotStatus.LOADING_COMMANDS);
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const commands = [];
for (const file of commandFiles) {
    try {
        const filePath = path.join(commandsPath, file);
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
        } else {
             console.log(chalk.yellow(`⚠️ 警告: ${filePath} のコマンドに必要なプロパティがありません。`));
        }
    } catch (error) {
        console.error(chalk.red(`❌ コマンド読み込みエラー (${file}):`), error);
    }
}

updateBotStatus(BotStatus.LOADING_EVENTS);
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        try {
            const filePath = path.join(eventsPath, file);
            delete require.cache[require.resolve(filePath)];
            const event = require(filePath);
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
        } catch (error) {
            console.error(chalk.red(`❌ イベント読み込みエラー (${file}):`), error);
        }
    }
}
require('./events/auditLog')(client);
require('./events/automodListener')(client);
require('./events/levelingSystem')(client);
// ★★★★★【ここから追加】★★★★★
require('./events/mentionReply')(client);
// ★★★★★【ここまで追加】★★★★★


const rest = new REST().setToken(process.env.DISCORD_TOKEN);
async function deployCommands() {
    try {
        updateBotStatus(BotStatus.REGISTERING_COMMANDS, `${commands.length} 個`);
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log(chalk.green(`✅ ${data.length} 個のコマンド登録完了。`));
    } catch (error) {
        console.error(chalk.red('❌ コマンド登録エラー:'), error);
    }
}

async function generateStatuses(client) {
    updateBotStatus(BotStatus.GENERATING_STATUS);
    try {
        const serverCount = client.guilds.cache.size;
        const userCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
        const prompt = `あなたは多機能Discordボットのための、ユニークでキャッチーな「カスタムステータス」を考えるプロです。
以下の情報を参考に、ボットの機能や規模をアピールするような、短くて魅力的なステータスを10個生成してください。
# ボットの情報
- サーバー参加数: ${serverCount}
- 合計ユーザー数: ${userCount}
- 主な機能: ウェルカムメッセージ, 高機能ロールボード, Firestoreデータベース連携, AI連携, 高度なモデレーション
# 出力形式のルール
- 必ずJSON形式の配列で出力してください。
- 各要素は、'emoji'(string)と'state'(string)のキーを持つオブジェクトとします。
- 'emoji'にはステータスに付ける絵文字を1つ記述します。
- 'state'にはステータスのテキストを記述します。
- サーバー数やユーザー数のような動的な情報は、必ず"\${serverCount}"や"\${userCount}"というプレースホルダーの形でテキストに含めてください。`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text();
        const cleanedJson = text.replace(/```json|```/g, '').trim();
        const generatedStatuses = JSON.parse(cleanedJson);
        return generatedStatuses.filter(s => s.emoji && s.state);
    } catch (error) {
        console.error(chalk.red('❌ Gemini APIでのステータス生成に失敗:'), error.message);
        console.log(chalk.yellow('⚠️ フォールバック用の静的ステータスを使用します。'));
        return [
            { emoji: '✅', state: '正常稼働中' },
            { emoji: '🛡️', state: `${client.guilds.cache.size} サーバーを保護中` },
            { emoji: '💡', state: '/help でコマンド一覧' },
            { emoji: '👥', state: `${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)} ユーザーをサポート` },
        ];
    }
}

// ▼▼▼ ランキングボード更新機能 ▼▼▼
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

async function updateRankboards(client) {
    console.log(chalk.cyan('[Rankboard] Starting periodic update...'));
    const db = client.db;
    const rtdb = client.rtdb;
    const settingsCol = collection(db, 'guild_settings');
    const q = query(settingsCol, where('rankBoard', '!=', null));

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.log(chalk.cyan('[Rankboard] No active rankboards found.'));
            return;
        }

        for (const guildSettingsDoc of snapshot.docs) {
            const settings = guildSettingsDoc.data();
            const guildId = guildSettingsDoc.id;
            const rankBoardConfig = settings.rankBoard;

            if (!rankBoardConfig || !rankBoardConfig.channelId || !rankBoardConfig.messageId) {
                continue;
            }

            const guild = await client.guilds.fetch(guildId).catch(err => {
                console.error(chalk.red(`[Rankboard] Failed to fetch guild ${guildId}`), err);
                return null;
            });
            if (!guild) continue;

            try {
                // 1. Firestoreから上位10ユーザーの累計レベル情報を取得
                const levelsRef = collection(db, 'levels');
                const levelQuery = query(
                    levelsRef,
                    where('guildId', '==', guildId),
                    orderBy('level', 'desc'),
                    orderBy('xp', 'desc'),
                    limit(10)
                );
                const levelSnapshot = await getDocs(levelQuery);
                const userStats = [];
                levelSnapshot.forEach(doc => {
                    const data = doc.data();
                    userStats.push({
                        userId: data.userId,
                        level: data.level || 0,
                        xp: data.xp || 0,
                    });
                });

                // 2. Realtime DBから現在オンラインのユーザー全員のセッション情報を取得
                const allSessionsRef = ref(rtdb, `voiceSessions/${guild.id}`);
                const allSessionsSnapshot = await get(allSessionsRef);
                const onlineUsers = allSessionsSnapshot.exists() ? allSessionsSnapshot.val() : {};

                // 3. 累計XPと現在のVCセッションXPを合算して最終的なXPを計算
                const finalStats = userStats.map(stat => {
                    let currentXp = stat.xp;
                    if (onlineUsers[stat.userId]) {
                        const sessionDurationMs = Date.now() - onlineUsers[stat.userId].joinedAt;
                        const minutesStayed = Math.floor(sessionDurationMs / 60000);
                        const vcXpGained = minutesStayed * 5; // vcStateLog.jsと同じレート
                        currentXp += vcXpGained;
                    }
                    return { ...stat, finalXp: currentXp };
                });

                // 4. 再度ソートして最終ランキングを作成
                finalStats.sort((a, b) => {
                    if (b.level !== a.level) {
                        return b.level - a.level;
                    }
                    return b.finalXp - a.finalXp;
                });
                
                // 5. Embedを作成
                const rankEmbed = new EmbedBuilder()
                    .setColor(0x00FFFF)
                    .setTitle(`🏆 ${guild.name} リアルタイムランキング`)
                    .setThumbnail(guild.iconURL({ dynamic: true }))
                    .setTimestamp()
                    .setFooter({ text: '🟢: VC参加中 | 5分ごとに更新' });
                
                if (finalStats.length === 0) {
                    rankEmbed.setDescription('まだデータがありません。\nメンバーがチャットやVCで活動を始めると、ここにランキングが表示されます。');
                } else {
                    const rankPromises = finalStats.map(async (stat, index) => {
                        const member = await guild.members.fetch(stat.userId).catch(() => null);
                        const medal = ['🥇', '🥈', '🥉'][index] || `**#${index + 1}**`;
                        const requiredXp = calculateRequiredXp(stat.level);
                        const isOnline = onlineUsers[stat.userId] ? '🟢' : '';

                        return `${medal} ${isOnline} **${member ? member.displayName : '不明なユーザー'}**\n> LV: \`${stat.level}\` | XP: \`${stat.finalXp.toLocaleString()} / ${requiredXp.toLocaleString()}\``;
                    });
                    const rankStrings = await Promise.all(rankPromises);
                    rankEmbed.setDescription(rankStrings.join('\n\n'));
                }

                // 6. メッセージを更新
                const channel = await client.channels.fetch(rankBoardConfig.channelId).catch(() => null);
                if (channel) {
                    const message = await channel.messages.fetch(rankBoardConfig.messageId).catch(() => null);
                    if (message) {
                        await message.edit({ embeds: [rankEmbed] });
                        console.log(chalk.green(`[Rankboard] Updated for guild: ${guild.name}`));
                    }
                }
            } catch (error) {
                console.error(chalk.red(`[Rankboard] Error updating board for guild ${guildId}:`), error);
            }
        }
    } catch (error) {
        console.error(chalk.red('[Rankboard] Failed to query for guild settings:'), error);
    }
}
// ▲▲▲ ランキングボード更新機能 ▲▲▲

client.once('ready', async () => {
    console.log(chalk.bold.greenBright(`🚀 ${client.user.tag} が起動しました！`));
    await deployCommands();
    
    app.listen(PORT, () => console.log(chalk.green(`✅ Webサーバーがポート ${PORT} で起動しました。`)));
    
    keepAlive();

    // ▼▼▼ ランキングボードの定期更新を開始 ▼▼▼
    // 起動10秒後に初回更新、その後5分ごとに更新
    setTimeout(() => updateRankboards(client), 10000);
    setInterval(() => updateRankboards(client), 5 * 60 * 1000);
    // ▲▲▲ ここまで追加 ▲▲▲

    const statuses = await generateStatuses(client);
    if (statuses && statuses.length > 0) {
        let i = 0;
        const updateStatus = () => {
                const statusTemplate = statuses[i];
                const statusState = statusTemplate.state
                    .replace(/\$\{serverCount\}/g, client.guilds.cache.size)
                    .replace(/\$\{userCount\}/g, client.guilds.cache.reduce((a, g) => a + g.memberCount, 0));
                
                client.user.setPresence({
                    activities: [{
                        name: 'customstatus',
                        type: ActivityType.Custom,
                        state: statusState,
                        emoji: statusTemplate.emoji
                    }],
                    status: 'online'
                });
                console.log(chalk.cyan(`🎯 ステータス更新: ${statusTemplate.emoji} ${statusState}`));
                i = (i + 1) % statuses.length;
            };
        updateStatus();
        setInterval(updateStatus, 60000);
    }
});

client.on('error', console.error);
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(process.env.DISCORD_TOKEN);