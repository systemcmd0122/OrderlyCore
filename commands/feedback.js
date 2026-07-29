const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { collection, addDoc, Timestamp } = require('firebase/firestore');
const chalk = require('chalk');
const { createSuccessEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('OrderlyCoreに関するフィードバックや不具合報告を開発者に送信します。'),

    async execute(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('feedback_modal')
            .setTitle('FEEDBACK');

        const typeInput = new TextInputBuilder()
            .setCustomId('feedback_type')
            .setLabel('種類')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例: 要望、不具合報告')
            .setRequired(true);

        const contentInput = new TextInputBuilder()
            .setCustomId('feedback_content')
            .setLabel('内容')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('内容を入力してください')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(typeInput),
            new ActionRowBuilder().addComponents(contentInput)
        );

        await interaction.showModal(modal);

        try {
            const submitted = await interaction.awaitModalSubmit({
                time: 300000,
                filter: i => i.user.id === interaction.user.id,
            });

            const type = submitted.fields.getTextInputValue('feedback_type');
            const content = submitted.fields.getTextInputValue('feedback_content');
            
            await addDoc(collection(interaction.client.db, 'feedbacks'), {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                guildId: interaction.guild.id,
                type: type,
                content: content,
                timestamp: Timestamp.now()
            });

            const embed = createSuccessEmbed(
                '送信完了',
                '貴重なご意見ありがとうございます！今後の開発の参考にさせていただきます。'
            ).addFields([
                { name: '種類', value: type, inline: true },
                { name: '内容', value: content }
            ]);

            await submitted.reply({ embeds: [embed], ephemeral: true });
            console.log(chalk.green(`[Feedback] Received from ${interaction.user.tag}`));

        } catch (error) {
            if (error.code !== 'InteractionCollectorError') console.error('[ERROR] Feedback error:', error);
        }
    },
};
