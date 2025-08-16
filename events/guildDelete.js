const { collection, query, where, getDocs, deleteDoc, doc } = require('firebase/firestore');

module.exports = {
    name: 'guildDelete',
    async execute(guild, client) {
        console.log(`👋 サーバーから退出: ${guild.name} (ID: ${guild.id})`);
        console.log(`📊 現在のサーバー数: ${client.guilds.cache.size}`);

        try {
            const guildId = guild.id;
            let deletedCount = 0;

            // 1. このサーバーのロールボードデータを削除
            const boardsRef = collection(client.db, 'roleboards');
            const boardQuery = query(boardsRef, where('guildId', '==', guildId));
            const boardSnapshot = await getDocs(boardQuery);
            
            const boardDeletePromises = [];
            boardSnapshot.forEach(doc => {
                boardDeletePromises.push(deleteDoc(doc.ref));
                deletedCount++;
            });
            await Promise.all(boardDeletePromises);
            
            if (deletedCount > 0) {
                console.log(`🗑️ ${guild.name} の ${deletedCount} 個のロールボードデータを削除しました`);
            }

            // 2. このサーバーの設定データ（ウェルカム、ボイスログ等）を削除
            const guildConfigRef = doc(client.db, 'guilds', guildId);
            await deleteDoc(guildConfigRef);
            console.log(`🗑️ ${guild.name} のサーバー設定データを削除しました`);

        } catch (error) {
            console.error(`❌ ${guild.name} のデータ削除中にエラーが発生:`, error);
        }
    }
};