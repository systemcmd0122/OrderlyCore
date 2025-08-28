const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const { doc, setDoc, getDoc } = require('firebase/firestore');
const chalk = require('chalk');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('チケットサポートシステムを管理します。')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('チケット作成用のパネルをチャンネルに設置します。')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('パネルを設置するチャンネル')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('support-role')
                        .setDescription('チケット対応を行うサポートチームのロール')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('category')
                        .setDescription('作成されたチケットチャンネルが格納されるカテゴリ')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('パネルのタイトル（例：サポートへのお問い合わせ）'))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('パネルの説明文'))
                .addStringOption(option =>
                    option.setName('button-label')
                        .setDescription('作成ボタンのラベル（例：チケットを作成）'))
                .addStringOption(option =>
                    option.setName('button-emoji')
                        .setDescription('作成ボタンの絵文字'))
        ),

    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return;

        await interaction.deferReply({ ephemeral: true });
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            try {
                const channel = interaction.options.getChannel('channel');
                const supportRole = interaction.options.getRole('support-role');
                const category = interaction.options.getChannel('category');
                const title = interaction.options.getString('title') || 'サポートへのお問い合わせ';
                const description = interaction.options.getString('description') || '下のボタンをクリックすると、サポートチームとのプライベートなチャンネルが作成されます。';
                const buttonLabel = interaction.options.getString('button-label') || 'チケットを作成';
                const buttonEmoji = interaction.options.getString('button-emoji');

                // 設定をFirestoreに保存
                const settingsRef = doc(interaction.client.db, 'guild_settings', interaction.guild.id);
                await setDoc(settingsRef, {
                    ticketSystem: {
                        supportRoleId: supportRole.id,
                        categoryId: category.id
                    }
                }, { merge: true });

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle(title)
                    .setDescription(description)
                    .setFooter({ text: `${interaction.guild.name} サポート` });

                const row = new ActionRowBuilder();
                const createButton = new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel(buttonLabel)
                    .setStyle(ButtonStyle.Success);
                
                if (buttonEmoji) {
                    try {
                        createButton.setEmoji(buttonEmoji);
                    } catch (e) {
                        console.warn(chalk.yellow(`無効な絵文字が指定されました: ${buttonEmoji}`));
                    }
                }

                row.addComponents(createButton);

                await channel.send({ embeds: [embed], components: [row] });

                await interaction.editReply({ content: `✅ チケットパネルを ${channel} に設置しました。` });
                console.log(chalk.blue(`[Ticket System] Setup in guild ${interaction.guild.name} (#${channel.name})`));

            } catch (error) {
                console.error(chalk.red('❌ Ticket setup error:'), error);
                await interaction.editReply({ content: '❌ パネルの設置中にエラーが発生しました。権限などを確認してください。' });
            }
        }
    },
};