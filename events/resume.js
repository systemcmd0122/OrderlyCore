const { ActivityType } = require('discord.js');

module.exports = {
    name: 'resume',
    execute(replayed, client) {
        console.log('[OK] Discord接続が復旧しました。');
        console.log(`[INFO] ${replayed} 個のイベントが再生されました。`);
        
        // 復旧時のステータス更新
        if (client.user) {
            client.user.setActivity('Online', { type: ActivityType.Custom });
        }
    }
};