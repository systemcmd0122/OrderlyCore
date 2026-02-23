const { collection, query, where, getDocs, deleteDoc, doc } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    name: 'guildDelete',
    async execute(guild, client) {
        console.log(chalk.yellow(`[EXIT] サーバーから退出: ${guild.name} (ID: ${guild.id})`));
        console.log(chalk.cyan(`[INFO] 現在のサーバー数: ${client.guilds.cache.size}`));

        try {
            const guildId = guild.id;
            const db = client.db;
            let totalDeleted = 0;

            // 削除するコレクションのリスト
            const collectionsToClean = [
                { name: 'roleboards', field: 'guildId' },
                { name: 'levels', field: 'guildId' },
                { name: 'warnings', field: 'guildId' },
                { name: 'audit_logs', field: 'guildId' },
                { name: 'quotes', field: 'guildId' }
            ];

            // 各コレクションからギルドデータを削除
            for (const collectionInfo of collectionsToClean) {
                try {
                    const collectionRef = collection(db, collectionInfo.name);
                    const q = query(collectionRef, where(collectionInfo.field, '==', guildId));
                    const snapshot = await getDocs(q);
                    
                    if (!snapshot.empty) {
                        const deletePromises = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
                        await Promise.all(deletePromises);
                        totalDeleted += snapshot.size;
                        console.log(chalk.green(`[CLEAN] ${collectionInfo.name}: ${snapshot.size}件削除`));
                    }
                } catch (error) {
                    console.error(chalk.red(`[ERROR] ${collectionInfo.name}の削除エラー:`), error.message);
                }
            }

            // ギルド設定を削除
            try {
                const guildSettingsRef = doc(db, 'guild_settings', guildId);
                await deleteDoc(guildSettingsRef);
                totalDeleted++;
                console.log(chalk.green(`[CLEAN] guild_settings: 削除完了`));
            } catch (error) {
                console.error(chalk.red(`[ERROR] guild_settingsの削除エラー:`), error.message);
            }

            // guildsコレクションからも削除
            try {
                const guildsRef = doc(db, 'guilds', guildId);
                await deleteDoc(guildsRef);
                totalDeleted++;
                console.log(chalk.green(`[CLEAN] guilds: 削除完了`));
            } catch (error) {
                console.error(chalk.red(`[ERROR] guildsの削除エラー:`), error.message);
            }

            console.log(chalk.greenBright(`[OK] ${guild.name} の全データ削除完了 (合計: ${totalDeleted}件)`));

        } catch (error) {
            console.error(chalk.red(`[ERROR] ${guild.name} のデータ削除中にエラーが発生:`), error);
        }
    }
};