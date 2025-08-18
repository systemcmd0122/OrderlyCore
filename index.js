// systemcmd0122/overseer/overseer-56eb1777939dec018269fcbfbef7995841b85cf1/index.js
// 必要なモジュールのインポート
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, Partials } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const chalk = require('chalk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');
const { getDatabase } = require('firebase/database');

// --- Express アプリケーション設定 ---
const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    fs.access(indexPath, fs.constants.F_OK, (err) => {
        if (err) {
            console.error('index.html が見つかりません。');
            res.status(404).json({
                status: 'error',
                message: 'Website not found. Bot is running.',
                botStatus: client && client.isReady() ? 'ok' : 'initializing'
            });
        } else {
            res.sendFile(indexPath);
        }
    });
});

app.get('/ping', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/health', (req, res) => {
    const isReady = client && client.isReady();
    const status = isReady && client.ws.status === 0 ? 'ok' : 'degraded';
    const health = {
        status: status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        botStatus: isReady ? client.ws.status : 'initializing'
    };
    res.status(status === 'ok' ? 200 : 503).json(health);
});

function keepAlive() {
    const PING_INTERVAL = 2 * 60 * 1000;
    const selfUrl = process.env.APP_URL;
    if (!selfUrl) {
        console.warn(chalk.yellow('環境変数 APP_URL が設定されていません。Keep-Alive機能は無効になります。'));
        return;
    }
    setInterval(async () => {
        try {
            const url = selfUrl.endsWith('/ping') ? selfUrl : `${selfUrl}/ping`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': `Discord-Bot-KeepAlive/${require('./package.json').version || '1.0.0'}` } });
            clearTimeout(timeout);
            if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
            console.log(chalk.cyan(`Keep-Alive ping successful to ${url}. Status: ${response.status}`));
        } catch (error) {
            console.error(chalk.yellow(`Keep-Alive ping failed for ${selfUrl}:`, error.message));
        }
        const used = process.memoryUsage();
        console.log(chalk.cyan(`Memory: ${Math.round(used.heapUsed / 1024 / 1024)}MB / ${Math.round(used.heapTotal / 1024 / 1024)}MB`));
    }, PING_INTERVAL);
    app.listen(PORT, () => console.log(chalk.green(`✅ Webサーバーがポート ${PORT} で起動しました。`)));
}

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
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember] // GuildMember を追加
});

// グローバル変数
client.db = db;
client.rtdb = rtdb;
client.commands = new Collection();

// --- ボットステータス管理 ---
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

// --- コマンド・イベントの読み込み ---
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
            console.log(chalk.blue(`✅ コマンド読み込み完了: ${command.data.name}`));
        } else {
            console.log(chalk.yellow(`⚠️ 警告: ${filePath} のコマンドに必要なプロパティがありません。`));
        }
    } catch (error) {
        console.error(chalk.red(`❌ コマンド読み込みエラー (${file}):`), error);
    }
}
console.log(chalk.blueBright(`📦 ${commands.length} 個のコマンドが読み込まれました。`));

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
            console.log(chalk.magenta(`✅ イベント読み込み完了: ${event.name}`));
        } catch (error) {
            console.error(chalk.red(`❌ イベント読み込みエラー (${file}):`), error);
        }
    }
}

// ===== ▼▼▼▼▼ 変更箇所 ▼▼▼▼▼ =====
// 新しいカスタムイベントハンドラをここで読み込みます
require('./events/auditLog')(client);
console.log(chalk.magenta(`✅ イベント読み込み完了: auditLog (カスタム)`));
require('./events/automodListener')(client);
console.log(chalk.magenta(`✅ イベント読み込み完了: automodListener (カスタム)`));
// ===== ▲▲▲▲▲ 変更箇所 ▲▲▲▲▲ =====


// --- スラッシュコマンド登録 ---
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
async function deployCommands() {
    try {
        updateBotStatus(BotStatus.REGISTERING_COMMANDS, `${commands.length} 個のコマンド`);
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log(chalk.green(`✅ ${data.length} 個のアプリケーションコマンドの登録が完了しました。`));
        return true;
    } catch (error) {
        console.error(chalk.red('❌ コマンド登録エラー:'), error);
        updateBotStatus(BotStatus.ERROR, 'コマンド登録失敗');
        return false;
    }
}

// --- Gemini APIによるカスタムステータス生成 ---
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
- サーバー数やユーザー数のような動的な情報は、必ず"\${serverCount}"や"\${userCount}"というプレースホルダーの形でテキストに含めてください。
# 出力例
[
  { "emoji": "🚀", "state": "\${serverCount}個のサーバーをサポート中！" },
  { "emoji": "🎧", "state": "\${userCount}人の声に耳を傾けています" }
]`;

        const result = await geminiModel.generateContent(prompt);
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

// --- ボット準備完了イベント ---
client.once('ready', async () => {
    console.log(chalk.bold.greenBright('\n==========================================='));
    console.log(`🚀 ${client.user.tag} が正常に起動しました！`);
    console.log(`📊 サーバー数: ${client.guilds.cache.size}`);
    console.log(`👥 ユーザー数: ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`);
    console.log(chalk.bold.greenBright('===========================================\n'));

    const deploySuccess = await deployCommands();
    if (deploySuccess) {
        keepAlive();
        
        const statuses = await generateStatuses(client);
        console.log(`✅ ${statuses.length}個のカスタムステータスを準備しました。`);

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
        console.log(chalk.greenBright('🎉 ボットの初期化が完全に完了しました！'));
    }
});

// --- エラーハンドリング ---
client.on('error', error => console.error(chalk.red('❌ Discord.js クライアントエラー:'), error));
client.on('warn', warning => console.warn(chalk.yellow('⚠️ Discord.js 警告:'), warning));
process.on('unhandledRejection', error => console.error(chalk.red('❌ 未処理の Promise リジェクション:'), error));
process.on('uncaughtException', error => {
    console.error(chalk.red('❌ 未処理の例外:'), error);
    process.exit(1);
});
const shutdown = () => {
    console.log(chalk.yellow('\n🔄 ボットを安全にシャットダウンしています...'));
    client.destroy();
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- ボット起動 ---
updateBotStatus(BotStatus.CONNECTING);
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error(chalk.red('❌ ボットの起動に失敗しました:'), error);
    updateBotStatus(BotStatus.ERROR, 'ログイン失敗');
    if (error.message.includes('An invalid token')) {
        console.error(chalk.red('🔑 無効なトークンです。.envファイルの DISCORD_TOKEN を確認してください。'));
    } else if (error.message.includes('Privileged intent')) {
        console.error(chalk.red('🔒 必要な特権インテントが有効化されていません。Discord Developer Portalで設定を確認してください。'));
    }
    process.exit(1);
});