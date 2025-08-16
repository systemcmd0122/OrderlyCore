const { ActivityType } = require('discord.js');

module.exports = {
    name: 'ready',
    once: true,
    execute(client) {
        console.log(`✅ ${client.user.tag} がオンラインになりました！`);
        
        // 初期アクティビティ設定
        client.user.setActivity('🚀 起動中...', { type: ActivityType.Custom });
        client.user.setStatus('online');
    }
};