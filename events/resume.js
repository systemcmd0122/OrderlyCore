const { ActivityType } = require('discord.js');

module.exports = {
    name: 'shardResume',
    execute(replayed, shardId, client) {
        console.log('[OK] Discord接続が復旧しました。');
        console.log(`[INFO] ${replayed} 個のイベントが再生されました。`);
        
        if (client.user) {
            client.user.setActivity('Online', { type: ActivityType.Custom });
        }
    }
};