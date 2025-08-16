const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getFirestore, collection, query, where, orderBy, limit, getDocs } = require('firebase/firestore');
const { getDatabase, ref, get } = require('firebase/database');

// 時間を分かりやすい形式に変換するヘルパー関数
function formatDuration(milliseconds) {
    if (milliseconds < 1000) {
        return "1秒未満";
    }
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let result = '';
    if (days > 0) result += `${days}日 `;
    if (hours > 0) result += `${hours}時間 `;
    if (minutes > 0) result += `${minutes}分 `;
    if (seconds > 0 && days === 0) result += `${seconds}秒`; // 日単位の表示では秒を省略

    return result.trim() || '0秒';
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

        const targetUser = interaction.options.getUser('user');
        
        if (targetUser) {
            // 特定ユーザーの統計を表示
            await this.displayUserStats(interaction, targetUser);
        } else {
            // サーバー全体のランキングを表示
            await this.displayServerRanking(interaction);
        }
    },

    async displayUserStats(interaction, user) {
        const { guild, client } = interaction;
        const db = client.db;
        const rtdb = client.rtdb;

        // 1. Firestoreから累計滞在時間を取得
        const statsRef = doc(db, 'voice_stats', `${guild.id}_${user.id}`);
        const docSnap = await getDoc(statsRef);
        let totalStayTime = docSnap.exists() ? docSnap.data().totalStayTime : 0;
        
        // 2. Realtime DBから現在のセッション情報を取得
        const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${user.id}`);
        const sessionSnapshot = await get(sessionRef);
        let currentSessionDuration = 0;
        let currentChannelName = 'なし';

        if (sessionSnapshot.exists()) {
            const sessionData = sessionSnapshot.val();
            currentSessionDuration = Date.now() - sessionData.joinedAt;
            currentChannelName = sessionData.channelName;
        }

        const finalTotalTime = totalStayTime + currentSessionDuration;

        const member = await guild.members.fetch(user.id).catch(() => null);

        const embed = new EmbedBuilder()
            .setColor(member ? member.displayHexColor : '#FFFFFF')
            .setTitle(`🔊 ${member ? member.displayName : user.username} のVC統計`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: '累計滞在時間', value: `**${formatDuration(finalTotalTime)}**`, inline: false },
                { name: '現在の状態', value: `**${currentChannelName}** に滞在中`, inline: true },
                { name: '現在のセッション', value: formatDuration(currentSessionDuration), inline: true }
            )
            .setFooter({ text: `データ集計日時` })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
    },

    async displayServerRanking(interaction) {
        const { guild, client } = interaction;
        const db = client.db;
        const rtdb = client.rtdb;
        
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
        querySnapshot.forEach(doc => {
            userStats.push({
                userId: doc.data().userId,
                totalStayTime: doc.data().totalStayTime
            });
        });

        if (userStats.length === 0) {
            return interaction.editReply({ content: 'まだ誰もボイスチャンネルに参加したことがありません。' });
        }

        // 2. Realtime DBから現在オンラインのユーザー全員のセッション情報を取得
        const allSessionsRef = ref(rtdb, `voiceSessions/${guild.id}`);
        const allSessionsSnapshot = await get(allSessionsRef);
        const onlineUsers = allSessionsSnapshot.exists() ? allSessionsSnapshot.val() : {};

        // 3. 累計時間と現在のセッション時間を合算
        const finalStats = userStats.map(stat => {
            let currentSessionDuration = 0;
            if (onlineUsers[stat.userId]) {
                currentSessionDuration = Date.now() - onlineUsers[stat.userId].joinedAt;
            }
            return {
                userId: stat.userId,
                finalTime: stat.totalStayTime + currentSessionDuration
            };
        });

        // 4. 再度ソートして最終ランキングを作成
        finalStats.sort((a, b) => b.finalTime - a.finalTime);

        // 5. ランキング表示用の文字列を作成
        const rankingDescription = await Promise.all(
            finalStats.map(async (stat, index) => {
                const member = await guild.members.fetch(stat.userId).catch(() => null);
                const medal = ['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`;
                const isOnline = onlineUsers[stat.userId] ? '🟢' : '';

                return `${medal} ${isOnline} ${member ? member.displayName : '不明なユーザー'}\n> **${formatDuration(stat.finalTime)}**`;
            })
        );

        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle(`🔊 ${guild.name} VC滞在時間ランキング`)
            .setDescription(rankingDescription.join('\n\n'))
            .setFooter({ text: '🟢 は現在オンライン中のユーザーを示します' })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    }
};