const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getFirestore, collection, query, where, orderBy, limit, getDocs, doc, getDoc } = require('firebase/firestore');

// レベルアップに必要なXPを計算する関数
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('レベルやXP、ランキングを表示します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーのランクを表示します（省略時は自分）')),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const db = interaction.client.db;
        const guildId = interaction.guild.id;

        try {
            // ユーザーデータの取得
            const userRef = doc(db, 'levels', `${guildId}_${targetUser.id}`);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                return interaction.editReply({ 
                    content: `📊 ${targetUser.username} さんにはまだランクデータがありません。\nメッセージを送信するとランクが記録されます。` 
                });
            }

            const rawData = userSnap.data();
            const userData = {
                level: rawData.level || 0,
                xp: rawData.xp || 0,
                messageCount: rawData.messageCount || 0,
                userId: rawData.userId,
                guildId: rawData.guildId
            };

            const requiredXp = calculateRequiredXp(userData.level);

            // ランキングの取得
            const usersRef = collection(db, 'levels');
            const q = query(
                usersRef, 
                where('guildId', '==', guildId), 
                orderBy('level', 'desc'), 
                orderBy('xp', 'desc')
            );
            const snapshot = await getDocs(q);
            
            let rank = -1;
            snapshot.docs.forEach((doc, index) => {
                if (doc.data().userId === targetUser.id) {
                    rank = index + 1;
                }
            });

            // 進捗バーの計算（修正版）
            let progress = 0;
            let progressPercentage = 0;
            
            if (requiredXp > 0) {
                // XPが必要値を超える場合も100%として扱う
                progressPercentage = Math.min((userData.xp / requiredXp) * 100, 100);
                // 進捗バーは0〜10の範囲で表示
                progress = Math.min(Math.floor((userData.xp / requiredXp) * 10), 10);
            }
            
            const progressBar = '🟩'.repeat(progress) + '⬛'.repeat(10 - progress);

            // メンバー情報の取得
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const displayName = member ? member.displayName : targetUser.username;
            const avatarColor = member ? member.displayHexColor : '#5865F2';

            // Embedの作成
            const embed = new EmbedBuilder()
                .setColor(avatarColor)
                .setTitle(`🏆 ${displayName} のランク`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields(
                    { 
                        name: '📊 レベル', 
                        value: `**Lv.${userData.level}**`, 
                        inline: true 
                    },
                    { 
                        name: '🎖️ 順位', 
                        value: rank !== -1 ? `**#${rank}**` : '計測中...', 
                        inline: true 
                    },
                    { 
                        name: '💬 総メッセージ数', 
                        value: `**${userData.messageCount.toLocaleString()}** 回`, 
                        inline: true 
                    },
                    { 
                        name: '✨ 経験値 (XP)', 
                        value: `**${userData.xp.toLocaleString()}** / ${requiredXp.toLocaleString()} XP`,
                        inline: false 
                    },
                    {
                        name: '📈 次のレベルへの進捗',
                        value: `${progressBar} **${progressPercentage.toFixed(1)}%**`,
                        inline: false
                    }
                )
                .setFooter({ 
                    text: `${interaction.guild.name} のランキング`, 
                    iconURL: interaction.guild.iconURL() 
                })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ ランクコマンドの実行エラー:', error);
            console.error('エラー詳細:', error.message);
            console.error('エラーコード:', error.code);
            
            // エラーコード別の詳細な対応
            if (error.code === 'failed-precondition') {
                await interaction.editReply({ 
                    content: '❌ **データベースインデックスエラー**\n\n' +
                             '⚠️ ランキング機能に必要なFirestoreインデックスが作成されていません。\n\n' +
                             '**管理者向け手順:**\n' +
                             '1. コンソールログに表示されているURLにアクセス\n' +
                             '2. Firebaseコンソールでインデックスを作成\n' +
                             '3. インデックス作成完了まで数分お待ちください\n\n' +
                             '詳細: https://firebase.google.com/docs/firestore/query-data/indexing'
                });
            } else if (error.code === 'permission-denied') {
                await interaction.editReply({ 
                    content: '❌ **権限エラー**\n\n' +
                             'データベースへのアクセス権限がありません。\n' +
                             'Firestoreのセキュリティルールを確認してください。'
                });
            } else if (error.code === 'unavailable') {
                await interaction.editReply({ 
                    content: '❌ **接続エラー**\n\n' +
                             'データベースに接続できませんでした。\n' +
                             'しばらく時間をおいてから再度お試しください。'
                });
            } else if (error.code === 'not-found') {
                await interaction.editReply({ 
                    content: '❌ **データ取得エラー**\n\n' +
                             '指定されたデータが見つかりませんでした。'
                });
            } else {
                await interaction.editReply({ 
                    content: '❌ **予期しないエラーが発生しました**\n\n' +
                             'ランク情報の取得中に問題が発生しました。\n' +
                             'Bot管理者に連絡してください。\n\n' +
                             `エラーコード: \`${error.code || 'UNKNOWN'}\``
                });
            }
        }
    }
};