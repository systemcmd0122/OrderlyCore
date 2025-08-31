// systemcmd0122/overseer/overseer-0bf111bc7d4cbe93c0063e5af9df0630e3d9374e/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, Partials, PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const chalk = require('chalk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, query, where, getDocs, updateDoc, deleteDoc, Timestamp, orderBy, limit, startAfter, endBefore, getCountFromServer } = require('firebase/firestore');
const { getDatabase, ref, set, get, remove } = require('firebase/database');
const os = require('os');

// --- Express アプリケーション設定 ---
const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors({
    origin: process.env.APP_URL || `http://localhost:${PORT}`,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your_very_secret_key_that_is_long_and_random',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
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

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

let dynamicStatuses = [];
let statusInterval = null;
let statusMode = 'ai';


const isAuthenticated = (req, res, next) => {
    if (req.session.userId && req.session.guildId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please login again.' });
};

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

const isAdminAuthenticated = (req, res, next) => {
    if (req.session.isAdmin) {
        return next();
    }
    res.status(401).json({ error: 'Administrator access required.' });
};

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

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully.' });
    });
});

app.get('/api/guild-info', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 2)
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

// ★★★★★【ここから変更】★★★★★
app.get('/api/members', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '', sortBy = 'displayName', sortOrder = 'asc', roleFilter = '' } = req.query;
        const guild = await client.guilds.fetch(req.session.guildId);
        await guild.members.fetch();
        const members = guild.members.cache;

        const levelsRef = collection(db, 'levels');
        const levelsQuery = query(levelsRef, where('guildId', '==', req.session.guildId));
        const levelsSnapshot = await getDocs(levelsQuery);
        const levelsData = new Map(levelsSnapshot.docs.map(doc => [doc.data().userId, doc.data()]));

        const warningsRef = collection(db, 'warnings');
        const warningsQuery = query(warningsRef, where('guildId', '==', req.session.guildId));
        const warningsSnapshot = await getDocs(warningsQuery);
        const warningsData = new Map();
        warningsSnapshot.forEach(doc => {
            const userId = doc.data().userId;
            warningsData.set(userId, (warningsData.get(userId) || 0) + 1);
        });

        let memberList = members.map(member => {
            const levelInfo = levelsData.get(member.id) || { messageCount: 0 };
            return {
                id: member.id,
                avatar: member.user.displayAvatarURL(),
                username: member.user.username,
                displayName: member.displayName,
                roles: member.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
                joinedAt: member.joinedTimestamp,
                messageCount: levelInfo.messageCount || 0,
                warnCount: warningsData.get(member.id) || 0
            };
        });

        // Filtering
        if (search) {
            const lowercasedSearch = search.toLowerCase();
            memberList = memberList.filter(m =>
                m.displayName.toLowerCase().includes(lowercasedSearch) ||
                m.username.toLowerCase().includes(lowercasedSearch)
            );
        }
        if (roleFilter) {
            memberList = memberList.filter(m => m.roles.some(r => r.id === roleFilter));
        }

        // Sorting
        memberList.sort((a, b) => {
            let valA = a[sortBy];
            let valB = b[sortBy];

            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();

            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        const totalMembers = memberList.length;
        const paginatedMembers = memberList.slice((page - 1) * limit, page * limit);

        res.json({
            members: paginatedMembers,
            totalMembers,
            totalPages: Math.ceil(totalMembers / limit),
            currentPage: parseInt(page)
        });

    } catch (error) {
        console.error('Error fetching member list:', error);
        res.status(500).json({ error: 'Failed to fetch member list.' });
    }
});
// ★★★★★【ここまで変更】★★★★★

app.post('/api/members/:memberId/kick', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.params.memberId);
        await member.kick(req.body.reason || '理由なし');
        res.status(200).json({ message: 'Member kicked.' });
    } catch (error) {
        console.error('Error kicking member:', error);
        res.status(500).json({ error: 'Failed to kick member.' });
    }
});

app.post('/api/members/:memberId/ban', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.params.memberId);
        await member.ban({ reason: req.body.reason || '理由なし' });
        res.status(200).json({ message: 'Member banned.' });
    } catch (error) {
        console.error('Error banning member:', error);
        res.status(500).json({ error: 'Failed to ban member.' });
    }
});

app.put('/api/members/:memberId/roles', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.params.memberId);
        await member.roles.set(req.body.roles);
        res.status(200).json({ message: 'Roles updated.' });
    } catch (error) {
        console.error('Error updating roles:', error);
        res.status(500).json({ error: 'Failed to update roles.' });
    }
});

app.get('/api/audit-logs', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { eventType, user, page = 1, limit: pageLimit = 15 } = req.query;
        const logsRef = collection(db, 'audit_logs');
        let q = query(logsRef, where('guildId', '==', req.session.guildId));

        if (eventType) {
            q = query(q, where('eventType', '==', eventType));
        }
        
        const countQuery = query(q);
        const totalSnapshot = await getCountFromServer(countQuery);
        const totalLogs = totalSnapshot.data().count;

        q = query(q, orderBy('timestamp', 'desc'));

        if (page > 1) {
            const lastVisibleDocQuery = query(q, limit(pageLimit * (page - 1)));
            const lastVisibleSnapshot = await getDocs(lastVisibleDocQuery);
            const lastVisible = lastVisibleSnapshot.docs[lastVisibleSnapshot.docs.length - 1];
            if (lastVisible) {
                q = query(q, startAfter(lastVisible));
            }
        }
        
        q = query(q, limit(parseInt(pageLimit)));

        const snapshot = await getDocs(q);
        let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (user) {
            logs = logs.filter(log => log.executorTag?.includes(user) || log.targetTag?.includes(user));
        }

        res.json({
            logs,
            totalPages: Math.ceil(totalLogs / pageLimit),
            currentPage: parseInt(page),
            totalLogs
        });

    } catch (error) {
        console.error('Error fetching audit logs:', error);
        if (error.code === 'failed-precondition') {
            const firestoreUrl = `https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT_ID}/firestore/indexes`;
            return res.status(500).json({ 
                error: 'データベースインデックスが必要です。',
                errorCode: 'INDEX_REQUIRED',
                fixUrl: firestoreUrl, 
                message: '監査ログ機能を利用するには、Firestoreの複合インデックスが必要です。エラーログに記載されているURLにアクセスしてインデックスを作成してください。'
            });
        }
        res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
});

// ★★★★★【ここから変更】★★★★★
app.get('/api/analytics/activity', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guildId = req.session.guildId;
        const guild = await client.guilds.fetch(guildId);

        // --- 1. メッセージ数ランキングと時間帯別アクティビティ ---
        const levelsRef = collection(db, 'levels');
        const q = query(levelsRef, where('guildId', '==', guildId));
        const snapshot = await getDocs(q);

        const allUsersData = snapshot.docs.map(doc => doc.data());

        const topUsers = allUsersData
            .sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0))
            .slice(0, 10);

        const topUsersWithDetails = await Promise.all(topUsers.map(async (user) => {
            try {
                const member = await guild.members.fetch(user.userId);
                return { ...user, displayName: member.displayName, username: member.user.username };
            } catch {
                return { ...user, displayName: '不明なユーザー', username: 'Unknown' };
            }
        }));

        const activityByHour = Array(24).fill(0);
        // lastMessageTimestampではなく、messageCountをそのまま使う方がアクティビティの実態に近い
        allUsersData.forEach(user => {
            // ここは簡易的な実装。正確な時間帯別アクティビティは別途ログが必要
            if (user.lastMessageTimestamp) {
                const date = user.lastMessageTimestamp.toDate ? user.lastMessageTimestamp.toDate() : new Date(user.lastMessageTimestamp);
                const hour = date.getHours();
                activityByHour[hour] += user.messageCount || 0;
            }
        });
        
        // --- 2. ロール分布 ---
        await guild.members.fetch();
        const roleCounts = {};
        guild.members.cache.forEach(member => {
            member.roles.cache.forEach(role => {
                if (role.id === guild.id) return; // @everyoneは除外
                roleCounts[role.id] = (roleCounts[role.id] || 0) + 1;
            });
        });

        const roleDistribution = Object.entries(roleCounts)
            .map(([roleId, count]) => {
                const role = guild.roles.cache.get(roleId);
                return {
                    name: role ? role.name : '不明なロール',
                    count,
                    color: role ? role.hexColor : '#808080'
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 10); // 上位10ロールに絞る

        res.json({
            topUsers: topUsersWithDetails,
            activityByHour,
            roleDistribution
        });

    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data.' });
    }
});
// ★★★★★【ここまで変更】★★★★★


app.get('/api/settings/welcome-message', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const settingsRef = doc(db, 'guild_settings', req.session.guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists() && docSnap.data().welcomeMessage) {
            res.json(docSnap.data().welcomeMessage);
        } else {
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


app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password && password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.status(200).json({ message: 'Admin login successful.' });
    } else {
        res.status(401).json({ error: 'Invalid password.' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully.' });
    });
});

app.get('/api/admin/stats', isAdminAuthenticated, async (req, res) => {
    try {
        const guilds = await client.guilds.fetch();
        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);

        const recentGuilds = client.guilds.cache.sort((a, b) => b.joinedTimestamp - a.joinedTimestamp).first(5);

        res.json({
            guildCount: client.guilds.cache.size,
            userCount: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0),
            uptime: `${days}d ${hours}h ${minutes}m`,
            memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
            bot: {
                username: client.user.username,
                avatar: client.user.displayAvatarURL(),
            },
            recentGuilds: recentGuilds.map(g => ({
                id: g.id,
                name: g.name,
                memberCount: g.memberCount,
                joinedTimestamp: g.joinedTimestamp
            }))
        });
    } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({ error: 'Failed to fetch bot statistics.' });
    }
});

app.post('/api/admin/announce', isAdminAuthenticated, async (req, res) => {
    const { title, description, color, url, footer } = req.body;
    if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required.' });
    }

    try {
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color || '#3498db')
            .setTimestamp();
        if (url) embed.setURL(url);
        if (footer) embed.setFooter({ text: footer });

        const settingsRef = collection(db, 'guild_settings');
        const q = query(settingsRef, where('announcementChannelId', '!=', null));
        const snapshot = await getDocs(q);

        let sentCount = 0;
        const sendPromises = [];

        snapshot.forEach(doc => {
            const settings = doc.data();
            const channelId = settings.announcementChannelId;

            const promise = client.channels.fetch(channelId)
                .then(channel => {
                    if (channel && channel.isTextBased()) {
                        return channel.send({ embeds: [embed] }).then(() => {
                            sentCount++;
                            console.log(chalk.green(`📢 Announcement sent to guild ${doc.id}`));
                        });
                    }
                })
                .catch(err => {
                    console.error(chalk.red(`Failed to send announcement to channel ${channelId} in guild ${doc.id}:`), err.message);
                });
            sendPromises.push(promise);
        });

        await Promise.all(sendPromises);

        res.status(200).json({ message: 'Announcements sent.', sentCount });

    } catch (error) {
        console.error("Error sending announcement:", error);
        res.status(500).json({ error: 'Failed to send announcements.' });
    }
});

app.get('/api/admin/statuses', isAdminAuthenticated, async (req, res) => {
    const settingsRef = doc(db, 'bot_settings', 'statuses');
    const docSnap = await getDoc(settingsRef);
    if (docSnap.exists()) {
        res.json(docSnap.data());
    } else {
        res.json({ list: [], mode: 'custom' });
    }
});

app.post('/api/admin/statuses', isAdminAuthenticated, async (req, res) => {
    const { statuses, mode } = req.body;
    if (!['ai', 'custom'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode specified.' });
    }
    if (mode === 'custom' && !Array.isArray(statuses)) {
        return res.status(400).json({ error: 'Statuses must be an array for custom mode.' });
    }

    try {
        const settingsRef = doc(db, 'bot_settings', 'statuses');
        const currentSettings = (await getDoc(settingsRef)).data() || {};
        const newSettings = {
            mode: mode,
            list: mode === 'custom' ? statuses : currentSettings.list || []
        };
        await setDoc(settingsRef, newSettings);

        statusMode = mode;
        if (mode === 'custom') {
            dynamicStatuses = statuses;
        }
        startStatusRotation();
        res.status(200).json({ message: 'Statuses settings updated successfully.' });
    } catch (error) {
        console.error("Error updating statuses:", error);
        res.status(500).json({ error: 'Failed to update statuses.' });
    }
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    const filePath = path.join(__dirname, 'public', req.path);
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
        return res.sendFile(filePath);
    }
    if (req.path === '/login') {
        return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
    if (req.path === '/admin-login.html' || req.path === '/admin.html') {
        const adminPage = req.path.substring(1);
        return res.sendFile(path.join(__dirname, 'public', adminPage));
    }
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

const BotStatus = {
    INITIALIZING: '🔄 初期化中...',
    LOADING_COMMANDS: '📂 コマンド読み込み中...',
    LOADING_EVENTS: '🎯 イベント読み込み中...',
    CONNECTING: '🌐 Discord に接続中...',
    REGISTERING_COMMANDS: '⚙️ コマンド登録中...',
    LOADING_STATUS_SETTINGS: '📝 ステータス設定読み込み中...',
    READY: '✅ 正常稼働中',
    ERROR: '❌ エラー発生'
};
let currentStatus = BotStatus.INITIALIZING;

function updateBotStatus(status, details = '') {
    currentStatus = status;
    console.log(`[${new Date().toLocaleString('ja-JP')}] ${status} ${details}`);
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

// ★★★★★【ここから変更】★★★★★
updateBotStatus(BotStatus.LOADING_EVENTS);
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        try {
            const filePath = path.join(eventsPath, file);
            delete require.cache[require.resolve(filePath)];
            const eventHandler = require(filePath);

            // パターン1: { name, execute } オブジェクトをエクスポートするイベント
            if (eventHandler.name && typeof eventHandler.execute === 'function') {
                if (eventHandler.once) {
                    client.once(eventHandler.name, (...args) => eventHandler.execute(...args, client));
                } else {
                    client.on(eventHandler.name, (...args) => eventHandler.execute(...args, client));
                }
                console.log(chalk.blueBright(`[Event] Loaded: ${eventHandler.name} (${file})`));
            } 
            // パターン2: (client) => { ... } 関数をエクスポートするイベント
            else if (typeof eventHandler === 'function') {
                eventHandler(client);
                console.log(chalk.blueBright(`[Event] Loaded modular handler: ${file}`));
            }
        } catch (error) {
            console.error(chalk.red(`❌ イベント読み込みエラー (${file}):`), error);
        }
    }
}
// ★★★★★【ここまで変更】★★★★★


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

async function generateAIStatus() {
    try {
        const userCount = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        const prompt = `あなたは「Overseer」という名前のDiscordボットです。あなたの現在のユニークで面白いステータスを生成してください。

# 指示
- サーバー数 (${client.guilds.cache.size}個) や、総ユーザー数 (${userCount}人) などの動的な情報を含めることができます。
- 短く、キャッチーで、少しユーモラスなものが望ましいです。
- 必ずJSON形式で {"emoji": "絵文字", "state": "ステータスメッセージ"} の形式で出力してください。
- ステータスメッセージは30文字以内にしてください。

# 生成例
{ "emoji": "☕", "state": "コードをコンパイル中..." }
{ "emoji": "🧠", "state": "${client.guilds.cache.size}個のサーバーを思考中。" }
{ "emoji": "🤖", "state": "AIの夢を見ています。" }
{ "emoji": "📈", "state": "${userCount}人のユーザーを監視中。" }`;

        const result = await client.geminiModel.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error(chalk.red('❌ Geminiによるステータス生成に失敗:'), error);
        return { emoji: '⚠️', state: 'AI思考エラー' };
    }
}

async function loadStatusSettings() {
    updateBotStatus(BotStatus.LOADING_STATUS_SETTINGS);
    try {
        const settingsRef = doc(db, 'bot_settings', 'statuses');
        const docSnap = await getDoc(settingsRef);

        if (docSnap.exists() && docSnap.data().list) {
            const settings = docSnap.data();
            statusMode = settings.mode || 'custom';
            console.log(chalk.green(`✅ Firestoreからステータス設定を読み込みました。モード: ${statusMode}`));
            return settings.list;
        } else {
            console.log(chalk.yellow('⚠️ Firestoreにステータス設定が見つかりません。デフォルトを作成します。'));
            const defaultStatuses = [
                { emoji: '✅', state: '正常稼働中' },
                { emoji: '💡', state: '/help でコマンド一覧' },
                { emoji: '🛡️', state: '${serverCount} サーバーを保護中' },
            ];
            await setDoc(settingsRef, { list: defaultStatuses, mode: 'custom' });
            statusMode = 'custom';
            return defaultStatuses;
        }
    } catch (error) {
        console.error(chalk.red('❌ Firestoreからのステータス読み込みに失敗:'), error.message);
        return [{ emoji: '❌', state: 'ステータス読込エラー' }];
    }
}

function startStatusRotation() {
    if (statusInterval) {
        clearInterval(statusInterval);
    }

    let i = 0;
    const updateStatus = async () => {
        if (!client.isReady()) return;

        let statusToShow;
        console.log(chalk.gray(`[Status Rotator] Running update cycle. Mode: ${statusMode}`));

        if (statusMode === 'ai') {
            console.log(chalk.gray(`[Status Rotator] Generating AI status...`));
            statusToShow = await generateAIStatus();
        } else {
            if (dynamicStatuses && dynamicStatuses.length > 0) {
                const statusTemplate = dynamicStatuses[i];
                const statusState = statusTemplate.state
                    .replace(/\$\{serverCount\}/g, client.guilds.cache.size)
                    .replace(/\$\{userCount\}/g, client.guilds.cache.reduce((a, g) => a + g.memberCount, 0));
                statusToShow = { emoji: statusTemplate.emoji, state: statusState };
                i = (i + 1) % dynamicStatuses.length;
            } else {
                console.log(chalk.yellow(`[Status Rotator] Custom mode is active but no statuses are configured.`));
                statusToShow = { emoji: '🔧', state: 'ステータス設定待ち' };
            }
        }

        if (statusToShow) {
            try {
                await client.user.setPresence({
                    activities: [{
                        name: 'customstatus',
                        type: ActivityType.Custom,
                        state: statusToShow.state,
                        emoji: statusToShow.emoji
                    }],
                    status: 'online'
                });
                console.log(chalk.cyan(`🎯 ステータス更新 (${statusMode}): ${statusToShow.emoji} ${statusToShow.state}`));
            } catch (error) {
                console.error(chalk.red('[Status Rotator] Failed to set presence:'), error);
            }
        } else {
             console.log(chalk.yellow('[Status Rotator] No status to show in this cycle.'));
        }
    };

    updateStatus();
    statusInterval = setInterval(updateStatus, 60000);
}

const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

async function updateRankboards(client) {
    if (!client.isReady()) return;
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

                const allSessionsRef = ref(rtdb, `voiceSessions/${guild.id}`);
                const allSessionsSnapshot = await get(allSessionsRef);
                const onlineUsers = allSessionsSnapshot.exists() ? allSessionsSnapshot.val() : {};

                const finalStats = userStats.map(stat => {
                    let currentXp = stat.xp;
                    if (onlineUsers[stat.userId]) {
                        const sessionDurationMs = Date.now() - onlineUsers[stat.userId].joinedAt;
                        const minutesStayed = Math.floor(sessionDurationMs / 60000);
                        const vcXpGained = minutesStayed * 5;
                        currentXp += vcXpGained;
                    }
                    return { ...stat, finalXp: currentXp };
                });

                finalStats.sort((a, b) => {
                    if (b.level !== a.level) {
                        return b.level - a.level;
                    }
                    return b.finalXp - a.finalXp;
                });

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

client.once('ready', async () => {
    console.log(chalk.bold.greenBright(`🚀 ${client.user.tag} が起動しました！`));
    await deployCommands();

    app.listen(PORT, () => console.log(chalk.green(`✅ Webサーバーがポート ${PORT} で起動しました。`)));

    keepAlive();

    setTimeout(() => updateRankboards(client), 10000);
    setInterval(() => updateRankboards(client), 5 * 60 * 1000);

    dynamicStatuses = await loadStatusSettings();
    startStatusRotation();

    updateBotStatus(BotStatus.READY);
});

client.on('error', console.error);
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

updateBotStatus(BotStatus.CONNECTING);
client.login(process.env.DISCORD_TOKEN);