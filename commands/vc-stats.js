const { SlashCommandBuilder } = require('discord.js');
const { collection, query, where, orderBy, limit, getDocs, doc, getDoc } = require('firebase/firestore');
const { ref, get } = require('firebase/database');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

function formatDuration(ms) {
    if (!ms || ms < 1000) return "1秒未満";
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const p = [];
    if (d > 0) p.push(`${d}d`);
    if (h > 0) p.push(`${h}h`);
    if (m > 0) p.push(`${m}m`);
    if (s > 0 && d === 0) p.push(`${s}s`);
    return p.join(' ') || '0s';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vc-stats')
        .setDescription('ボイスチャンネルの滞在時間統計を表示します。')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('特定のユーザーの統計を表示します')),
    
    async execute(interaction) {
        await interaction.deferReply();
        try {
            const targetUser = interaction.options.getUser('user');
            if (targetUser) await this.displayUserStats(interaction, targetUser);
            else await this.displayServerRanking(interaction);
        } catch (error) {
            console.error('[ERROR] vc-stats failure:', error);
            await interaction.editReply({ content: '[ERROR] 統計の取得に失敗しました。' });
        }
    },

    async displayUserStats(interaction, user) {
        const { guild, client } = interaction;
        const statsRef = doc(client.db, 'voice_stats', `${guild.id}_${user.id}`);
        const docSnap = await getDoc(statsRef);
        const totalTime = docSnap.exists() ? (docSnap.data()?.totalStayTime || 0) : 0;

        const sessionRef = ref(client.rtdb, `voiceSessions/${guild.id}/${user.id}`);
        const sessionSnap = await get(sessionRef);
        let currentDur = 0;
        let channelName = null;

        if (sessionSnap.exists()) {
            const data = sessionSnap.val();
            if (data?.joinedAt) {
                currentDur = Date.now() - data.joinedAt;
                channelName = data.channelName || 'Unknown';
            }
        }

        const finalTime = totalTime + currentDur;
        const member = await guild.members.fetch(user.id).catch(() => null);
        const color = member?.displayHexColor || COLORS.PRIMARY;

        const embed = createStandardEmbed({
            title: `[VOICE] ${member?.displayName || user.username} 統計`,
            color: color,
            thumbnail: user.displayAvatarURL(),
            fields: [
                { name: '累計滞在時間', value: `**${formatDuration(finalTime)}**`, inline: false },
                { name: '状態', value: channelName ? `[ON] ${channelName}` : '[OFF] Offline', inline: true },
                { name: '現在のセッション', value: currentDur > 0 ? formatDuration(currentDur) : '-', inline: true }
            ]
        });
        await interaction.editReply({ embeds: [embed] });
    },

    async displayServerRanking(interaction) {
        const { guild, client } = interaction;
        const statsCol = collection(client.db, 'voice_stats');
        const q = query(statsCol, where('guildId', '==', guild.id), orderBy('totalStayTime', 'desc'), limit(10));
        const snap = await getDocs(q);

        if (snap.empty) {
            return await interaction.editReply({ embeds: [createStandardEmbed({ title: '[VOICE] ランキング', description: 'データがありません。', color: COLORS.INFO })] });
        }

        const onlineSnap = await get(ref(client.rtdb, `voiceSessions/${guild.id}`));
        const onlineUsers = onlineSnap.exists() ? (onlineSnap.val() || {}) : {};

        const finalStats = snap.docs.map(d => {
            const data = d.data();
            const session = onlineUsers[data.userId];
            const dur = session?.joinedAt ? (Date.now() - session.joinedAt) : 0;
            return { userId: data.userId, time: data.totalStayTime + dur, isOnline: !!session };
        }).sort((a, b) => b.time - a.time);

        const rankingDesc = await Promise.all(finalStats.map(async (s, i) => {
            const member = await guild.members.fetch(s.userId).catch(() => null);
            const medal = ['1st', '2nd', '3rd'][i] || `#${i + 1}`;
            return `**${medal}** ${s.isOnline ? '[ON]' : '[OFF]'} ${member?.displayName || 'Unknown'}\n> ${formatDuration(s.time)}`;
        }));

        const embed = createStandardEmbed({
            title: `[VOICE RANKING] ${guild.name}`,
            description: rankingDesc.join('\n\n'),
            color: COLORS.PRIMARY,
            footer: { text: '[ON] 在席中 | [OFF] 離席中' }
        });
        await interaction.editReply({ embeds: [embed] });
    }
};
