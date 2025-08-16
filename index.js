// 必要なモジュールのインポート
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, Partials } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const chalk = require('chalk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, deleteDoc, doc } = require('firebase/firestore');
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

// --- ウェブサイトホスティング機能 ---
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    // fs.access は非推奨のため、fs.promises.stat を使用
    fs.promises.stat(indexPath)
        .then(() => res.sendFile(indexPath))
        .catch(() => {
            res.status(404).json({ 
                status: 'error', 
                message: 'Website not found. Bot is running.',
                botStatus: client && client.isReady() ? 'ok' : 'initializing' 
            });
        });
});

// --- ヘルスチェック用エンドポイント ---
app.get('/ping', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    const isReady = client && client.isReady();
    const status = isReady && client.ws.status === 0 ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503).json({ 
        status, 
        timestamp: new Date().toISOString(), 
        uptime: process.uptime(), 
        memory: process.memoryUsage(), 
        botStatus: isReady ? client.ws.status : 'initializing' 
    });
});

// --- Keep-Alive (常時起動) 機能 ---
function keepAlive() {
    const PING_INTERVAL = 2 * 60 * 1000; // 2分
    const selfUrl = process.env.APP_URL;
    if (!selfUrl) {
        console.warn(chalk.yellow('環境変数 APP_URL が設定されていません。Keep-Alive機能は無効になります。'));
        return;
    }
    setInterval(async () => {
        try {
            const url = new URL('/ping', selfUrl).href;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10秒タイムアウト
            
            const response = await fetch(url, { 
                signal: controller.signal, 
                headers: { 'User-Agent': `Discord-Bot-KeepAlive/${require('./package.json').version || '1.0.0'}` } 
            });
            clearTimeout(timeout);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            console.log(chalk.cyan(`Keep-Alive ping successful. Status: ${response.status}`));
        } catch (error) {
            console.error(chalk.yellow(`Keep-Alive ping failed:`, error.message));
        }
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
const geminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// --- グローバル変数 (他ファイルから参照できるようにclientオブジェクトに格納) ---
client.db = db;
client.rtdb = rtdb;
client.geminiModel = geminiModel; // ★ AIモデルを格納
client.commands = new Collection();

// --- コマンド・イベントの動的読み込み ---
// commandsフォルダ
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
const commands = [];
for (const file of commandFiles) {
    try {
        const command = require(path.join(commandsPath, file));
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            commands.push(command.data.toJSON());
        }
    } catch (error) {
        console.error(chalk.red(`❌ コマンド読み込みエラー (${file}):`), error);
    }
}
console.log(chalk.blueBright(`📦 ${commands.length} 個のコマンドを読み込みました。`));

// eventsフォルダ
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    try {
        const event = require(path.join(eventsPath, file));
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    } catch (error) {
        console.error(chalk.red(`❌ イベント読み込みエラー (${file}):`), error);
    }
}
console.log(chalk.magenta(`✨ ${eventFiles.length} 個のイベントを読み込みました。`));


// --- スラッシュコマンドの登録 ---
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
async function deployCommands() {
    try {
        console.log(chalk.yellow(`⚙️ ${commands.length} 個のアプリケーションコマンドの登録を開始...`));
        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log(chalk.green(`✅ ${data.length} 個のアプリケーションコマンドの登録が完了しました。`));
        return true;
    } catch (error) {
        console.error(chalk.red('❌ コマンド登録エラー:'), error);
        return false;
    }
}

// --- 予約投稿スケジューラ ---
function startScheduler(client) {
    console.log(chalk.blue('⏰ 予約投稿スケジューラを起動しました。'));
    setInterval(async () => {
        const now = Date.now();
        const firestore = client.db;
        try {
            // Firestoreから期限切れの予約タスクを取得
            const schedulesRef = collection(firestore, 'schedules');
            const q = query(schedulesRef, where('postAt', '<=', now));
            const snapshot = await getDocs(q);

            if (snapshot.empty) return;

            // 各タスクを実行
            for (const document of snapshot.docs) {
                const schedule = document.data();
                try {
                    const channel = await client.channels.fetch(schedule.channelId).catch(() => null);
                    if (channel) {
                        await channel.send(schedule.message);
                        console.log(chalk.green(`✅ 予約投稿を実行しました (ID: ${schedule.id})`));
                    } else {
                        console.warn(chalk.yellow(`⚠️ 予約投稿のチャンネルが見つかりません (ID: ${schedule.id})`));
                    }
                } catch (sendError) {
                    console.error(chalk.red(`❌ 予約投稿の送信に失敗 (ID: ${schedule.id}):`), sendError);
                } finally {
                    // 成功・失敗に関わらずDBから削除
                    await deleteDoc(doc(firestore, 'schedules', document.id));
                }
            }
        } catch (error) {
            console.error(chalk.red('❌ スケジューラの実行中にエラーが発生:'), error);
        }
    }, 60 * 1000); // 1分ごとにチェック
}


// --- ボット準備完了イベント (起動シーケンス) ---
client.once('ready', async () => {
    console.log(chalk.bold.greenBright('\n==========================================='));
    console.log(`🚀 ${client.user.tag} が正常に起動しました！`);
    console.log(`📊 サーバー数: ${client.guilds.cache.size}`);
    console.log(`👥 ユーザー数: ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`);
    console.log(chalk.bold.greenBright('===========================================\n'));

    // スラッシュコマンドをDiscordに登録
    const deploySuccess = await deployCommands();
    if (deploySuccess) {
        // 全ての準備が整ったらWebサーバーとスケジューラを起動
        keepAlive();
        startScheduler(client);
        console.log(chalk.greenBright('🎉 ボットの初期化が完全に完了し、全ての機能がオンラインです！'));
    } else {
        console.error(chalk.red('❌ 起動シーケンスに失敗しました。コマンド登録ができなかったため、一部機能が利用できません。'));
    }
});

// --- プロセス全体のエラーハンドリング ---
process.on('unhandledRejection', error => console.error(chalk.red('❌ 未処理の Promise リジェクション:'), error));
process.on('uncaughtException', error => {
    console.error(chalk.red('❌ 未処理の例外:'), error);
    process.exit(1);
});

// --- ボットのログイン ---
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error(chalk.red('❌ ボットの起動に致命的なエラーが発生しました:'), error);
    if (error.message.includes('An invalid token')) {
        console.error(chalk.red('🔑 無効なトークンです。.envファイルの DISCORD_TOKEN を確認してください。'));
    } else if (error.message.includes('Privileged intent')) {
        console.error(chalk.red('🔒 必要な特権インテントが有効化されていません。Discord Developer Portalで設定を確認してください。'));
    }
    process.exit(1);
});