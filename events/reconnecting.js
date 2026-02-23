const { ActivityType } = require('discord.js');

module.exports = {
    name: 'reconnecting',
    execute(client) {
        console.log('[INFO] Discordに再接続中...');
        
        // 再接続中のステータス更新
        if (client.user) {
            client.user.setActivity('再接続中...', { type: ActivityType.Custom });
        }
    }
};