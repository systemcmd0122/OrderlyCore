const express = require('express');
const router = express.Router();
const { isAdminAuthenticated } = require('../middleware/auth');
const { client } = require('../config/discord');
const { db } = require('../config/firebase');
const { doc, getDoc, setDoc, collection, query, where, getDocs } = require('firebase/firestore');
const { EmbedBuilder } = require('discord.js');
const chalk = require('chalk');

router.get('/stats', isAdminAuthenticated, async (_req, res) => {
    try {
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

router.post('/announce', isAdminAuthenticated, async (req, res) => {
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

        // Note: Actual status update is handled by statusService, but we need to notify it or update global state.
        // For now, we'll assume the status rotation will pick up the changes from DB.

        res.status(200).json({ message: 'Statuses settings updated successfully.' });
    } catch (error) {
        console.error("Error updating statuses:", error);
        res.status(500).json({ error: 'Failed to update statuses.' });
    }
});

module.exports = router;
