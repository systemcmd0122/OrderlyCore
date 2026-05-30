const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const { doc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } = require('firebase/firestore');
const chalk = require('chalk');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

function getTicketChannelName(user) {
    return `ticket-${user.username.substring(0, 10)}-${user.discriminator}`;
}

async function createTranscript(channel) {
    let content = `SERVER: ${channel.guild.name}\n`;
    content += `CHANNEL: ${channel.name}\n`;
    content += `DATE: ${new Date(channel.createdTimestamp).toLocaleString('ja-JP')}\n`;
    content += `CLOSE: ${new Date().toLocaleString('ja-JP')}\n\n`;
    content += '--- MESSAGE LOG ---\n\n';

    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
        const timestamp = new Date(msg.createdTimestamp).toLocaleString('ja-JP');
        content += `[${timestamp}] ${msg.author.tag}:\n`;
        if (msg.content) content += `${msg.content}\n`;
        if (msg.attachments.size > 0) {
            msg.attachments.forEach(att => {
                content += `[ATTACHMENT: ${att.name}] ${att.url}\n`;
            });
        }
        content += '\n';
    }
    
    return new AttachmentBuilder(Buffer.from(content, 'utf-8'), { name: `${channel.name}-transcript.txt` });
}

async function handleCreateTicket(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const { guild, member, user } = interaction;

    const q = query(collection(client.db, 'tickets'), where('guildId', '==', guild.id), where('userId', '==', user.id), where('status', '==', 'open'));
    const existingTickets = await getDocs(q);
    if (!existingTickets.empty) {
        const ticketChannelId = existingTickets.docs[0].data().channelId;
        return interaction.editReply({ content: `[WARN] チケットが既に存在します: <#${ticketChannelId}>` });
    }
    
    const settingsRef = doc(client.db, 'guild_settings', guild.id);
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists() || !settingsSnap.data().ticketSystem) {
        return interaction.editReply({ content: '[ERROR] チケットシステムの設定がありません。' });
    }
    const settings = settingsSnap.data().ticketSystem;
    
    const supportRole = guild.roles.cache.get(settings.supportRoleId);
    const category = guild.channels.cache.get(settings.categoryId);
    
    if (!supportRole || !category) {
        return interaction.editReply({ content: '[ERROR] 設定(ロール/カテゴリ)が見つかりません。' });
    }
    
    try {
        const channel = await guild.channels.create({
            name: getTicketChannelName(user),
            type: ChannelType.GuildText,
            parent: category,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
                { id: supportRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] },
            ],
            topic: `Ticket for ${user.tag} (ID: ${user.id}).`
        });

        const newTicketRef = await addDoc(collection(client.db, 'tickets'), {
            guildId: guild.id,
            userId: user.id,
            channelId: channel.id,
            status: 'open',
            createdAt: Timestamp.now()
        });

        const embed = createStandardEmbed({
            title: `[TICKET] ようこそ、${member.displayName}さん`,
            description: 'サポートチームがまもなく対応します。お問い合わせ内容を詳しく入力してください。',
            color: COLORS.PRIMARY,
            footer: { text: `Ticket ID: ${newTicketRef.id}` }
        });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`close_ticket_${newTicketRef.id}`)
                .setLabel('クローズ')
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `${member} ${supportRole}`, embeds: [embed], components: [row] });
        await interaction.editReply({ content: `[OK] チケットを作成しました: ${channel}` });
        console.log(chalk.green(`[Ticket] Created by ${user.tag} in ${guild.name}`));

    } catch (error) {
        console.error(chalk.red('[ERROR] Ticket creation error:'), error);
        await interaction.editReply({ content: '[ERROR] 作成に失敗しました。' });
    }
}

async function handleCloseTicket(interaction, client, ticketId) {
    await interaction.deferReply({ ephemeral: true });

    const ticketRef = doc(client.db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);
    if (!ticketSnap.exists()) return interaction.editReply({ content: '[ERROR] データベースに存在しません。' });
    
    const embed = createStandardEmbed({
        title: '[CONFIRM] チケットクローズ',
        description: 'このチケットをクローズしますか？',
        color: COLORS.WARNING
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_close_${ticketId}`).setLabel('クローズ').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_close').setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleConfirmClose(interaction, client, ticketId) {
    await interaction.deferUpdate();
    const { channel } = interaction;
    try {
        const transcript = await createTranscript(channel);
        const embed = createStandardEmbed({
            title: '[LOG] チケットクローズ',
            description: `実行者: ${interaction.user.tag}`,
            color: COLORS.ERROR,
            fields: [{ name: 'トランスクリプト', value: '添付ファイルを参照してください。' }]
        });
        
        const settingsRef = doc(client.db, 'guild_settings', interaction.guild.id);
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists() && settingsSnap.data().auditLogChannel) {
            const logChannelId = settingsSnap.data().auditLogChannel;
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) await logChannel.send({ embeds: [embed], files: [transcript] });
        }
        
        await channel.delete('Ticket closed.');
        await updateDoc(doc(client.db, 'tickets', ticketId), {
            status: 'closed',
            closedAt: Timestamp.now(),
            closedBy: interaction.user.id
        });
    } catch (error) {
        console.error(chalk.red('[ERROR] Ticket close error:'), error);
    }
}

async function handleCancelClose(interaction) {
    await interaction.message.delete();
    await interaction.followUp({ content: '[INFO] キャンセルしました。', ephemeral: true });
}

module.exports = (client) => {
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;
        const [action, ...args] = interaction.customId.split('_');
        try {
            switch (action) {
                case 'create': if (args[0] === 'ticket') await handleCreateTicket(interaction, client); break;
                case 'close': if (args[0] === 'ticket') await handleCloseTicket(interaction, client, args[1]); break;
                case 'confirm': if (args[0] === 'close') await handleConfirmClose(interaction, client, args[1]); break;
                case 'cancel': if (args[0] === 'close') await handleCancelClose(interaction); break;
            }
        } catch (error) {
             console.error(chalk.red(`[ERROR] Ticket action failure: ${interaction.customId}`), error);
        }
    });
};
