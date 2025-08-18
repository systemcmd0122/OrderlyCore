const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { doc, getDoc } = require('firebase/firestore');
const { getDatabase, ref, get } = require('firebase/database');

// レベルアップに必要なXPを計算する関数
const calculateRequiredXp = (level) => 5 * (level ** 2) + 50 * level + 100;

// 時間を分かりやすい形式に変換するヘルパー関数
function formatDuration(milliseconds) {
    if (milliseconds < 1000) return "1秒未満";
    const totalSeconds = Math.floor(milliseconds / 1000);
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    let result = '';
    if (d > 0) result += `${d}日 `;
    if (h > 0) result += `${h}時間 `;
    if (m > 0) result += `${m}分`;
    return result.trim() || '0分';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('ユーザーの詳細なプロフィールを表示します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーのプロフィールを表示します（省略時は自分）')),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const { guild, client } = interaction;
        const db = client.db;
        const rtdb = client.rtdb;

        try {
            // Firestoreからレベリング情報とVC統計情報を並行取得
            const levelRef = doc(db, 'levels', `${guild.id}_${targetUser.id}`);
            const vcStatsRef = doc(db, 'voice_stats', `${guild.id}_${targetUser.id}`);
            const sessionRef = ref(rtdb, `voiceSessions/${guild.id}/${targetUser.id}`);
            
            const [levelSnap, vcStatsSnap, sessionSnapshot] = await Promise.all([
                getDoc(levelRef),
                getDoc(vcStatsRef),
                get(sessionRef)
            ]);

            const member = await guild.members.fetch(targetUser.id).catch(() => null);
            const embed = new EmbedBuilder()
                .setColor(member ? member.displayHexColor : '#FFFFFF')
                .setTitle(`👤 ${member ? member.displayName : targetUser.username} のプロフィール`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .addFields({
                    name: '基本情報',
                    value: `**ユーザー名:** ${targetUser.tag}\n**ID:** ${targetUser.id}\n**アカウント作成日:** <t:${Math.floor(targetUser.createdAt.getTime() / 1000)}:D>`,
                    inline: false
                });

            // レベリング情報を追加
            if (levelSnap.exists()) {
                const levelData = levelSnap.data();
                const requiredXp = calculateRequiredXp(levelData.level);
                embed.addFields({
                    name: '📈 アクティビティレベル',
                    value: `**レベル:** ${levelData.level}\n**XP:** ${levelData.xp.toLocaleString()} / ${requiredXp.toLocaleString()}\n**メッセージ数:** ${levelData.messageCount.toLocaleString()}回`,
                    inline: true
                });
            } else {
                embed.addFields({ name: '📈 アクティビティレベル', value: 'データがありません。', inline: true });
            }

            // VC滞在情報を追加
            let totalStayTime = vcStatsSnap.exists() ? vcStatsSnap.data().totalStayTime : 0;
            let currentSessionDuration = 0;
            if (sessionSnapshot.exists()) {
                currentSessionDuration = Date.now() - sessionSnapshot.val().joinedAt;
            }
            const finalTotalTime = totalStayTime + currentSessionDuration;
            
            embed.addFields({
                name: '🔊 ボイスチャンネル統計',
                value: `**累計滞在時間:** ${formatDuration(finalTotalTime)}\n**現在のセッション:** ${formatDuration(currentSessionDuration)}`,
                inline: true
            });

            embed.setTimestamp();
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('プロフィールコマンドの実行エラー:', error);
            await interaction.editReply({ content: '❌ プロフィール情報の取得中にエラーが発生しました。' });
        }
    }
};