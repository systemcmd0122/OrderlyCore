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
            // ユーザーのランクデータを取得
            const userRef = doc(db, 'levels', `${guildId}_${targetUser.id}`);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                return interaction.editReply({ content: `${targetUser.displayName} にはまだランクデータがありません。` });
            }

            const userData = userSnap.data();
            const requiredXp = calculateRequiredXp(userData.level);

            // サーバー内での順位を取得
            const usersRef = collection(db, 'levels');
            const q = query(usersRef, where('guildId', '==', guildId), orderBy('level', 'desc'), orderBy('xp', 'desc'));
            const snapshot = await getDocs(q);
            
            let rank = -1;
            snapshot.docs.forEach((doc, index) => {
                if (doc.data().userId === targetUser.id) {
                    rank = index + 1;
                }
            });

            // プログレスバーを作成
            const progress = Math.floor((userData.xp / requiredXp) * 10);
            const progressBar = '🟩'.repeat(progress) + '⬛'.repeat(10 - progress);

            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            const embed = new EmbedBuilder()
                .setColor(member ? member.displayHexColor : '#FFFFFF')
                .setTitle(`🏆 ${member ? member.displayName : targetUser.username} のランク`)
                .setThumbnail(targetUser.displayAvatarURL())
                .addFields(
                    { name: 'レベル', value: `**${userData.level}**`, inline: true },
                    { name: '順位', value: rank !== -1 ? `**#${rank}**` : '計測中', inline: true },
                    { name: '総メッセージ数', value: `${userData.messageCount.toLocaleString()}回`, inline: true },
                    { 
                        name: 'XP', 
                        value: `**${userData.xp.toLocaleString()}** / ${requiredXp.toLocaleString()} XP`,
                        inline: false 
                    },
                    {
                        name: '次のレベルへの進捗',
                        value: `${progressBar} **${((userData.xp / requiredXp) * 100).toFixed(1)}%**`,
                        inline: false
                    }
                )
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('ランクコマンドの実行エラー:', error);
            await interaction.editReply({ content: '❌ ランク情報の取得中にエラーが発生しました。' });
        }
    }
};