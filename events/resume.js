const { ActivityType } = require('discord.js');

module.exports = {
    name: 'resume',
    execute(replayed, client) {
        console.log('✅ Discord接続が復旧しました。');
        console.log(`🔄 ${replayed} 個のイベントが再生されました。`);
        
        // 復旧時のステータス更新
        if (client.user) {
            client.user.setActivity('✅ 正常稼働中', { type: ActivityType.Custom });
        }
    }
};