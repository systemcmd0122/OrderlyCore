const { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { collection, addDoc, Timestamp } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('OrderlyCoreに関するフィードバックや不具合報告を開発者に送信します。'),

    async execute(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('feedback_modal')
            .setTitle('フィードバックの送信');

        const typeInput = new TextInputBuilder()
            .setCustomId('feedback_type')
            .setLabel('種類を選択してください')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('例: 感想、機能要望、不具合報告')
            .setRequired(true);

        const contentInput = new TextInputBuilder()
            .setCustomId('feedback_content')
            .setLabel('内容を詳しくお聞かせください')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('どのような機能が欲しいですか？\n不具合の場合は、どのコマンドでどのような問題が発生したか教えてください。')
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(typeInput);
        const secondActionRow = new ActionRowBuilder().addComponents(contentInput);

        modal.addComponents(firstActionRow, secondActionRow);

        await interaction.showModal(modal);

        try {
            const submitted = await interaction.awaitModalSubmit({
                time: 60000 * 5, // 5分
                filter: i => i.user.id === interaction.user.id,
            });

            const type = submitted.fields.getTextInputValue('feedback_type');
            const content = submitted.fields.getTextInputValue('feedback_content');
            const user = interaction.user;
            const guild = interaction.guild;

            // Firestoreにフィードバックを保存
            await addDoc(collection(interaction.client.db, 'feedbacks'), {
                userId: user.id,
                userTag: user.tag,
                guildId: guild.id,
                guildName: guild.name,
                type: type,
                content: content,
                timestamp: Timestamp.now()
            });

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ 送信完了')
                .setDescription('貴重なご意見ありがとうございます！\nいただいたフィードバックは、今後の開発の参考にさせていただきます。')
                .addFields(
                    { name: '種類', value: type },
                    { name: '内容', value: `\`\`\`${content}\`\`\`` }
                );

            await submitted.reply({ embeds: [embed], ephemeral: true });
            console.log(chalk.green(`[Feedback] Received from ${user.tag} in ${guild.name}`));

        } catch (error) {
            // モーダルがタイムアウトした場合など
            if (error.code !== 'InteractionCollectorError') {
                 console.error(chalk.red('❌ Feedback modal error:'), error);
            }
        }
    },
};