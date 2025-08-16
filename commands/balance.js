// commands/balance.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getFirestore, doc, getDoc } = require('firebase/firestore');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('あなたの現在のコイン残高を確認します。')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('他のユーザーの残高を確認します')),

    async execute(interaction) {
        await interaction.deferReply();
        
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guild.id;

        const userRef = doc(interaction.client.db, 'levels', `${guildId}_${targetUser.id}`);
        const docSnap = await getDoc(userRef);

        const coins = docSnap.exists() ? (docSnap.data().coins || 0) : 0;

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setAuthor({ name: `${targetUser.username} の財産`, iconURL: targetUser.displayAvatarURL() })
            .addFields({ name: '🪙 所持コイン', value: `**${coins.toLocaleString()}** コイン` })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    },
};