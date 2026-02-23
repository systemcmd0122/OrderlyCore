const express = require('express');
const router = express.Router();
const { isAdminAuthenticated } = require('../middleware/auth');
const { client } = require('../config/discord');
const { db } = require('../config/firebase');
const { doc, getDoc, setDoc, collection, query, where, getDocs } = require('firebase/firestore');
const chalk = require('chalk');
const { createStandardEmbed, COLORS } = require('../utils/embedBuilder');

router.get('/stats', isAdminAuthenticated, async (_req, res) => {
    try {
        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);

        const guilds = Array.from(client.guilds.cache.values());
        const recentGuilds = [...guilds].sort((a, b) => b.joinedTimestamp - a.joinedTimestamp).slice(0, 5);
        const topGuilds = [...guilds].sort((a, b) => b.memberCount - a.memberCount).slice(0, 10);

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
            })),
            topGuilds: topGuilds.map(g => ({
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

router.post('/announce', isAdminAuthenticated, async (req, res) => {
    const { title, description, color, url, footer } = req.body;
    if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required.' });
    }

    try {
        const embed = createStandardEmbed({
            title: title,
            description: description,
            color: color ? parseInt(color.replace('#', ''), 16) : COLORS.PRIMARY,
        });
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
                            console.log(chalk.green(`[OK] Announcement sent to guild ${doc.id}`));
                        });
                    }
                })
                .catch(err => {
                    console.error(chalk.red(`[ERROR] Failed to send announcement to ${channelId}:`), err.message);
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

router.get('/statuses', isAdminAuthenticated, async (_req, res) => {
    try {
        const settingsRef = doc(db, 'bot_settings', 'statuses');
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            res.json(docSnap.data());
        } else {
            res.json({ list: [], mode: 'custom' });
        }
    } catch (error) {
        console.error("Error fetching statuses:", error);
        res.status(500).json({ error: 'Failed to fetch statuses.' });
    }
});

router.post('/statuses', isAdminAuthenticated, async (req, res) => {
    const { statuses, mode } = req.body;
    if (!['ai', 'custom'].includes(mode)) {
        return res.status(400).json({ error: 'Invalid mode specified.' });
    }
    try {
        const settingsRef = doc(db, 'bot_settings', 'statuses');
        const currentSettings = (await getDoc(settingsRef)).data() || {};
        const newSettings = {
            mode: mode,
            list: mode === 'custom' ? statuses : currentSettings.list || []
        };
        await setDoc(settingsRef, newSettings);
        res.status(200).json({ message: 'Statuses settings updated successfully.' });
    } catch (error) {
        console.error("Error updating statuses:", error);
        res.status(500).json({ error: 'Failed to update statuses.' });
    }
});

router.get('/maintenance', isAdminAuthenticated, async (req, res) => {
    try {
        const docRef = doc(db, 'bot_settings', 'maintenance');
        const snap = await getDoc(docRef);
        res.json(snap.exists() ? snap.data() : { enabled: false });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch maintenance status.' });
    }
});

router.post('/maintenance', isAdminAuthenticated, async (req, res) => {
    try {
        const { enabled, reason } = req.body;
        const docRef = doc(db, 'bot_settings', 'maintenance');
        await setDoc(docRef, { enabled, reason, updatedAt: new Date().toISOString() });
        res.status(200).json({ message: 'Maintenance status updated.' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update maintenance status.' });
    }
});

router.get('/blacklist', isAdminAuthenticated, async (req, res) => {
    try {
        const docRef = doc(db, 'bot_settings', 'blacklist');
        const snap = await getDoc(docRef);
        res.json(snap.exists() ? snap.data().users || [] : []);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch blacklist.' });
    }
});

router.post('/blacklist', isAdminAuthenticated, async (req, res) => {
    try {
        const { userId, action } = req.body; // action: 'add' or 'remove'
        const docRef = doc(db, 'bot_settings', 'blacklist');
        const snap = await getDoc(docRef);
        let users = snap.exists() ? snap.data().users || [] : [];

        if (action === 'add') {
            if (!users.includes(userId)) users.push(userId);
        } else {
            users = users.filter(id => id !== userId);
        }

        await setDoc(docRef, { users, updatedAt: new Date().toISOString() });
        res.status(200).json({ message: `User ${action === 'add' ? 'added to' : 'removed from'} blacklist.` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update blacklist.' });
    }
});

router.get('/health/history', isAdminAuthenticated, async (req, res) => {
    try {
        // Since we don't have a background task to record history,
        // we'll return current stats and let the frontend track it.
        // We could also try to find health logs if we had them.
        res.json({
            timestamp: new Date().toISOString(),
            memory: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
            ping: client.ws.ping
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch health data.' });
    }
});

router.get('/guilds', isAdminAuthenticated, async (req, res) => {
    try {
        const { search = '', page = 1, limit = 20 } = req.query;
        let guilds = Array.from(client.guilds.cache.values()).map(g => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            joinedTimestamp: g.joinedTimestamp
        }));

        if (search) {
            const lowerSearch = search.toLowerCase();
            guilds = guilds.filter(g => g.name.toLowerCase().includes(lowerSearch) || g.id.includes(lowerSearch));
        }

        guilds.sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);

        const total = guilds.length;
        const start = (page - 1) * limit;
        const paginated = guilds.slice(start, start + limit);

        res.json({
            guilds: paginated,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch guilds.' });
    }
});

router.get('/user-search', isAdminAuthenticated, async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'User ID is required.' });
    try {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) return res.status(404).json({ error: 'User not found in Discord.' });

        const guilds = [];
        for (const guild of client.guilds.cache.values()) {
            if (guild.members.cache.has(userId)) {
                guilds.push({ id: guild.id, name: guild.name });
            }
        }

        res.json({
            id: user.id,
            tag: user.tag,
            avatar: user.displayAvatarURL(),
            guilds: guilds
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to search user.' });
    }
});

module.exports = router;
