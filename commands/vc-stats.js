const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getFirestore, collection, query, where, orderBy, limit, getDocs, doc, getDoc } = require('firebase/firestore');
const { getDatabase, ref, get } = require('firebase/database');

// 時間を分かりやすい形式に変換するヘルパー関数
function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds < 1000) {
        return "1秒未満";
    }
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}日`);
    if (hours > 0) parts.push(`${hours}時間`);
    if (minutes > 0) parts.push(`${minutes}分`);
    if (seconds > 0 && days === 0) parts.push(`${seconds}秒`);

    return parts.join(' ') || '0秒';
}

// データベース接続チェック
function validateDatabaseConnection(client) {
    if (!client?.db) {
        throw new Error('Firestore接続が初期化されていません');
    }
    if (!client?.rtdb) {
        throw new Error('Realtime Database接続が初期化されていません');
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vc-stats')
        .setDescription('ボイスチャンネルの滞在時間統計を表示します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーの統計を表示します（省略時はサーバーランキング）')),
    
    async execute(interaction) {
        await interaction.deferReply();

        try {
            // データベース接続確認
            validateDatabaseConnection(interaction.client);

            const targetUser = interaction.options.getUser('user');
            
            if (targetUser) {
                await this.displayUserStats(interaction, targetUser);
            } else {
                await this.displayServerRanking(interaction);
            }
        } catch (error) {
            console.error('vc-stats コマンドエラー:', {
                error: error.message,
                stack: error.stack,
                guildId: interaction.guild?.id,
                userId: interaction.user?.id
            });

            // エラーの種類に応じたメッセージ
            let errorMessage = '❌ 統計情報の取得中にエラーが発生しました。';
            
            if (error.message.includes('接続が初期化されていません')) {
                errorMessage = '❌ データベース接続エラー: Botの再起動が必要な可能性があります。';
            } else if (error.code === 'permission-denied') {
                errorMessage = '❌ データベースの権限エラー: 管理者にFirebaseの権限設定を確認してもらってください。';
            } else if (error.code === 'unavailable') {
                errorMessage = '❌ データベースに一時的に接続できません。しばらく待ってから再試行してください。';
            }

            await interaction.editReply({ content: errorMessage }).catch(console.error);
        }
    },

    async displayUserStats(interaction, user) {
        const { guild, client } = interaction;
        const db = client.db;
        const rtdb = client.rtdb;

        if (!user || !user.id) {
            throw new Error('無効なユーザーオブジェクトです');
        }

        try {
            // 1. Firestoreから累計滞在時間を取得
            const statsRef = doc(db, 'voice_stats', `${guild.id}_${user.id}`);
            const docSnap = await getDoc(statsRef);
            const totalStayTime = docSnap.exists() ? (docSnap.data()?.totalStayTime || 0) : 0;
            
            // 2. Realtime DBから現在のセッション情報を取得
            const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${user.id}`);
            const sessionSnapshot = await get(sessionRef);
            let currentSessionDuration = 0;
            let currentChannelName = null;

            if (sessionSnapshot.exists()) {
                const sessionData = sessionSnapshot.val();
                if (sessionData?.joinedAt) {
                    currentSessionDuration = Date.now() - sessionData.joinedAt;
                    currentChannelName = sessionData.channelName || '不明なチャンネル';
                }
            }

            const finalTotalTime = totalStayTime + currentSessionDuration;

            // メンバー情報を安全に取得
            const member = await guild.members.fetch(user.id).catch(() => null);
            const displayName = member?.displayName || user.username || '不明なユーザー';
            const avatarURL = user.displayAvatarURL({ size: 256, dynamic: true });
            const color = member?.displayHexColor || '#5865F2';

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`🔊 ${displayName} のVC統計`)
                .setThumbnail(avatarURL)
                .addFields(
                    { 
                        name: '📊 累計滞在時間', 
                        value: finalTotalTime > 0 ? `**${formatDuration(finalTotalTime)}**` : '記録なし', 
                        inline: false 
                    },
                    { 
                        name: '🎙️ 現在の状態', 
                        value: currentChannelName ? `**${currentChannelName}** に接続中` : 'オフライン', 
                        inline: true 
                    },
                    { 
                        name: '⏱️ 現在のセッション', 
                        value: currentSessionDuration > 0 ? formatDuration(currentSessionDuration) : '-', 
                        inline: true 
                    }
                )
                .setFooter({ text: `${guild.name} | データ集計日時` })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('ユーザー統計表示エラー:', error);
            throw new Error('ユーザー統計の取得に失敗しました');
        }
    },

    async displayServerRanking(interaction) {
        const { guild, client } = interaction;
        const db = client.db;
        const rtdb = client.rtdb;
        
        try {
            // 1. Firestoreから上位10ユーザーの累計滞在時間を取得
            const statsCollectionRef = collection(db, 'voice_stats');
            const q = query(
                statsCollectionRef, 
                where('guildId', '==', guild.id), 
                orderBy('totalStayTime', 'desc'), 
                limit(10)
            );
            const querySnapshot = await getDocs(q);

            const userStats = [];
            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (data?.userId && data?.totalStayTime != null) {
                    userStats.push({
                        userId: data.userId,
                        totalStayTime: data.totalStayTime
                    });
                }
            });

            if (userStats.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor('#95a5a6')
                    .setTitle(`🔊 ${guild.name} VC滞在時間ランキング`)
                    .setDescription('まだ誰もボイスチャンネルに参加したことがありません。\n最初に参加してランキングに載りましょう！')
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // 2. Realtime DBから現在オンラインのユーザー全員のセッション情報を取得
            const allSessionsRef = ref(rtdb, `voiceSessions/${guild.id}`);
            const allSessionsSnapshot = await get(allSessionsRef);
            const onlineUsers = allSessionsSnapshot.exists() ? (allSessionsSnapshot.val() || {}) : {};

            // 3. 累計時間と現在のセッション時間を合算
            const finalStats = userStats.map(stat => {
                let currentSessionDuration = 0;
                const session = onlineUsers[stat.userId];
                
                if (session?.joinedAt) {
                    currentSessionDuration = Date.now() - session.joinedAt;
                }
                
                return {
                    userId: stat.userId,
                    finalTime: stat.totalStayTime + currentSessionDuration,
                    isOnline: !!session
                };
            });

            // 4. 再度ソートして最終ランキングを作成
            finalStats.sort((a, b) => b.finalTime - a.finalTime);

            // 5. ランキング表示用の文字列を作成
            const rankingDescription = await Promise.all(
                finalStats.map(async (stat, index) => {
                    const member = await guild.members.fetch(stat.userId).catch(() => null);
                    const displayName = member?.displayName || 'Unknown User';
                    
                    const medals = ['🥇', '🥈', '🥉'];
                    const medal = medals[index] || `**${index + 1}位**`;
                    const statusIcon = stat.isOnline ? '🟢' : '⚪';

                    return `${medal} ${statusIcon} ${displayName}\n> ${formatDuration(stat.finalTime)}`;
                })
            );

            const embed = new EmbedBuilder()
                .setColor('#9b59b6')
                .setTitle(`🏆 ${guild.name} VC滞在時間ランキング`)
                .setDescription(rankingDescription.join('\n\n'))
                .setFooter({ text: '🟢 オンライン中 | ⚪ オフライン' })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('サーバーランキング表示エラー:', error);
            throw new Error('ランキング情報の取得に失敗しました');
        }
    }
};