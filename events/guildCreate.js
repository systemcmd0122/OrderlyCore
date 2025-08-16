module.exports = {
    name: 'guildCreate',
    execute(guild, client) {
        console.log(`🆕 新しいサーバーに参加: ${guild.name} (ID: ${guild.id})`);
        console.log(`👥 メンバー数: ${guild.memberCount}`);
        console.log(`📊 現在のサーバー数: ${client.guilds.cache.size}`);

        // サーバー参加時の処理があればここに追加
        // 例: ログチャンネルへの通知、データベースへの記録など
    }
};