const { ActivityType } = require('discord.js');

module.exports = {
    name: 'shardReconnecting',
    execute(shardId, client) {
        console.log('[INFO] Discordに再接続中...');
        
        if (client.user) {
            client.user.setActivity('再接続中...', { type: ActivityType.Custom });
        }
    }
};