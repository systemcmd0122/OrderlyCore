const voiceStateLog = require('./voiceStateLog'); // 正しいパスを指定

module.exports = {
    name: 'shardDisconnect',
    execute(event, shardId, client) {
        console.log('[WARN] Discordから切断されました。');
        console.log('[INFO] 切断理由:', event);
        console.log('[INFO] 自動再接続を試行中...');
        
        voiceStateLog.shutdown();
    }
};