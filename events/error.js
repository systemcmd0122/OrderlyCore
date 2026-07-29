const { ActivityType } = require('discord.js');

module.exports = {
    name: 'error',
    execute(error, client) {
        console.error('[ERROR] Discord クライアントエラー:', error);
        
        if (error.code === 'TOKEN_INVALID') {
            console.error('[AUTH] 無効なトークンです。環境変数を確認してください。');
            process.exit(1);
        } else if (error.code === 'DISALLOWED_INTENTS') {
            console.error('[ERROR] 許可されていないIntentが指定されています。');
            process.exit(1);
        } else if (error.code === 'RATE_LIMITED') {
            console.warn('[WARN] レート制限に達しました。しばらく待機します。');
        } else {
            console.error('[ERROR] 予期しないエラーが発生しました:', error.message);
        }
        
        if (client.user) {
            client.user.setActivity('System Error', { type: ActivityType.Custom });
        }
    }
};