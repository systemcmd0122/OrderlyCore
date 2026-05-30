const { PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    name: 'guildMemberRemove',
    async execute(member, client) {
        try {
            const guildId = member.guild.id;
            const user = member.user;
            if (user.bot) return;
            console.log(`[EXIT] ${user.tag} left ${member.guild.name}`);
            const guildConfigRef = doc(client.db, 'guilds', guildId);
            const guildConfigSnap = await getDoc(guildConfigRef);
            let guildConfig = guildConfigSnap.exists() ? guildConfigSnap.data() : {};
            const promises = [];
            if (guildConfig.goodbyeChannelId) promises.push(sendGoodbyeMessage(member, client, guildConfig));
            if (guildConfig.sendGoodbyeDM !== false) promises.push(sendGoodbyeDM(member, client, guildConfig));
            promises.push(updateLeaveStatistics(guildConfigRef, guildConfig, user, member));
            const results = await Promise.allSettled(promises);
            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    const ops = ['ChannelMsg', 'DM', 'Stats'];
                    console.error(`❌ ${ops[index]}:`, result.reason);
                }
            });
        } catch (error) {
            console.error('❌ guildMemberRemove error:', error);
        }
    },
};

async function sendGoodbyeMessage(member, client, guildConfig) {
    try {
        const goodbyeChannel = member.guild.channels.cache.get(guildConfig.goodbyeChannelId);
        if (!goodbyeChannel) return;
        if (!goodbyeChannel.permissionsFor(client.user).has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])) return;
        
        const user = member.user;
        const joinedDate = member.joinedAt;
        const stayDuration = joinedDate ? Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        
        const goodbyeEmbed = createStandardEmbed({
            title: '[LOG] メンバー退出',
            description: `**${user.displayName}** さんがサーバーを退出しました。`,
            color: COLORS.ERROR,
            thumbnail: user.displayAvatarURL({ dynamic: true, size: 256 }),
            fields: [
                {
                    name: 'ユーザー情報',
                    value: `Tag: ${user.tag}\n滞在: ${stayDuration.toLocaleString()}日間`,
                    inline: true
                },
                {
                    name: 'サーバー統計',
                    value: `現在: ${member.guild.memberCount.toLocaleString()}人`,
                    inline: true
                }
            ],
            footer: { text: `ID: ${user.id}`, iconURL: member.guild.iconURL() }
        });
        
        await goodbyeChannel.send({ embeds: [goodbyeEmbed] });
    } catch (error) {
        console.error(`❌ sendGoodbyeMessage error:`, error.message);
    }
}

async function sendGoodbyeDM(member, client, guildConfig) {
    try {
        const user = member.user;
        const guild = member.guild;
        const dmEmbed = createStandardEmbed({
            title: `[THANKS] ${guild.name} からの感謝メッセージ`,
            description: `${user.displayName}さん、サーバーにご参加いただきありがとうございました。またのお越しをお待ちしております！`,
            color: COLORS.PRIMARY,
            thumbnail: guild.iconURL({ dynamic: true, size: 256 }),
            footer: { text: `${guild.name} スタッフ一同`, iconURL: guild.iconURL() }
        });
        
        try {
            await user.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            console.log(`⚠️ ${user.tag} DM failure (blocked)`);
        }
    } catch (error) {
        console.error(`❌ sendGoodbyeDM error:`, error.message);
    }
}

async function updateLeaveStatistics(guildConfigRef, guildConfig, user, member) {
    try {
        const currentStats = guildConfig.statistics || {};
        const currentDate = new Date();
        const currentMonth = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
        const stayDuration = member.joinedAt ? Math.floor((Date.now() - member.joinedAt.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const lastUpdateMonth = currentStats.lastUpdateMonth || currentMonth;
        const monthlyLeaves = lastUpdateMonth === currentMonth ? (currentStats.monthlyLeaves || 0) : 0;
        
        await setDoc(guildConfigRef, {
            statistics: {
                ...currentStats,
                totalLeaves: (currentStats.totalLeaves || 0) + 1,
                monthlyLeaves: monthlyLeaves + 1,
                lastUpdateMonth: currentMonth,
                lastLeave: {
                    userId: user.id,
                    username: user.tag,
                    displayName: user.displayName,
                    stayDuration: stayDuration,
                    timestamp: Date.now()
                },
                updatedAt: Date.now()
            }
        }, { merge: true });
    } catch (error) {
        console.error(`❌ updateLeaveStatistics error:`, error.message);
    }
}
