// events/messageCreate.js
const { Events } = require('discord.js');
const { getFirestore, doc, setDoc, increment } = require('firebase/firestore');
const chalk = require('chalk');

const xpCooldowns = new Map();
const COOLDOWN_SECONDS = 60; // 60秒に1回

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (message.author.bot || !message.guild) return;

        const userId = message.author.id;
        const guildId = message.guild.id;
        const currentTime = Date.now();

        if (xpCooldowns.has(userId)) {
            const lastTime = xpCooldowns.get(userId);
            if (currentTime - lastTime < COOLDOWN_SECONDS * 1000) {
                return;
            }
        }

        // XPとコインをランダムに付与
        const xpGained = Math.floor(Math.random() * 11) + 15; // 15〜25 XP
        const coinsGained = Math.floor(Math.random() * 6) + 5;   // ★ 5〜10 コインを追加

        try {
            const userRef = doc(client.db, 'levels', `${guildId}_${userId}`);
            
            // データベースを更新 (xp, messageCount, coinsを同時に加算)
            await setDoc(userRef, {
                xp: increment(xpGained),
                messageCount: increment(1),
                coins: increment(coinsGained), // ★ コインを加算
                userId: userId,
                guildId: guildId,
                username: message.author.username
            }, { merge: true });

            xpCooldowns.set(userId, currentTime);

        } catch (error) {
            console.error(chalk.red('❌ XP/Coin付与エラー:'), error);
        }
    },
};