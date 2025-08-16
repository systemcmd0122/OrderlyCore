module.exports = {
    name: 'error',
    execute(error, client) {
        console.error('❌ Discord クライアントエラー:', error);
        
        // エラーの種類に応じて処理を分岐
        if (error.code === 'TOKEN_INVALID') {
            console.error('🔑 無効なトークンです。環境変数を確認してください。');
            process.exit(1);
        } else if (error.code === 'DISALLOWED_INTENTS') {
            console.error('🚫 許可されていないIntentが指定されています。');
            process.exit(1);
        } else if (error.code === 'RATE_LIMITED') {
            console.warn('⏰ レート制限に達しました。しばらく待機します。');
        } else {
            console.error('❌ 予期しないエラーが発生しました:', error.message);
        }
        
        // エラー時のボットステータス更新
        if (client.user) {
            client.user.setActivity('❌ エラー発生', { type: 4 }); // Custom status
        }
    }
};