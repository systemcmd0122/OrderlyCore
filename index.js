require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, Partials, PermissionsBitField } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const chalk = require('chalk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, deleteDoc, Timestamp, orderBy } = require('firebase/firestore');
const { getDatabase, ref, set, get, remove } = require('firebase/database');

// --- Express アプリケーション設定 ---
const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_very_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 86400000 } // 1 day
}));

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
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// サーバー管理者チェックミドルウェア
const isGuildAdmin = async (req, res, next) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.session.userId);
        if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            next();
        } else {
            res.status(403).json({ error: 'Forbidden: You are not an administrator of this server.' });
        }
    } catch (error) {
        console.error('Error checking guild admin status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

// API: 認証トークンの検証
app.post('/api/verify', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const tokenRef = ref(rtdb, `authTokens/${token}`);
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

// API: サーバーの基本情報を取得 (チャンネルリスト、ロールリストなど)
app.get('/api/guild-info', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 2) // Text and Voice channels
            .map(c => ({ id: c.id, name: c.name, type: c.type }));
        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id) // @everyoneを除外
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }));
        
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


// API: サーバー設定の取得 (汎用)
app.get('/api/settings/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection } = req.params;
        const settingsRef = doc(db, collection, req.session.guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            res.json(docSnap.data());
        } else {
            res.json({}); // 設定がない場合は空のオブジェクトを返す
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

// === 警告(Warn)専用API ===
app.get('/api/warnings/:userId', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const q = query(
            collection(db, 'warnings'),
            where('guildId', '==', req.session.guildId),
            where('userId', '==', userId),
            orderBy('timestamp', 'desc')
        );
        const snapshot = await getDocs(q);
        const warnings = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                timestamp: data.timestamp.toDate().toISOString()
            }
        });
        res.json(warnings);
    } catch (error) {
        console.error('Error fetching warnings:', error);
        res.status(500).json({ error: 'Failed to fetch warnings.' });
    }
});


// ページルーティング
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    // 認証はクライアントサイドJSで /api/guild-info を叩いて行う
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});


// --- コマンド・イベントの読み込みとボット起動 (既存のコード) ---

// ボットステータス管理
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

// コマンド読み込み
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

// イベント読み込み
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


// スラッシュコマンド登録
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

// ステータス生成
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

// ボット準備完了イベント
client.once('ready', async () => {
    console.log(chalk.bold.greenBright(`🚀 ${client.user.tag} が起動しました！`));
    await deployCommands();
    
    app.listen(PORT, () => console.log(chalk.green(`✅ Webサーバーがポート ${PORT} で起動しました。`)));

    const statuses = await generateStatuses(client);
    if (statuses.length > 0) {
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

// エラーハンドリング
client.on('error', console.error);
process.on('unhandledRejection', console.error);

// ボット起動
client.login(process.env.DISCORD_TOKEN);