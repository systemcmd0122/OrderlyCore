const voiceStateLog = require('./voiceStateLog'); // 正しいパスを指定

module.exports = {
    name: 'disconnect',
    execute(event, client) {
        console.log('[WARN] Discordから切断されました。');
        console.log('[INFO] 切断理由:', event);
        
        // 切断時のステータス更新
        console.log('[INFO] 自動再接続を試行中...');
        
        // voiceStateLogのシャットダウン処理を呼び出す
        voiceStateLog.shutdown();
    }
};