const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const { doc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } = require('firebase/firestore');
const chalk = require('chalk');

// チケットチャンネル名を作成
function getTicketChannelName(user) {
    return `ticket-${user.username.substring(0, 10)}-${user.discriminator}`;
}

// チャンネル内のメッセージからトランスクリプトを生成
async function createTranscript(channel) {
    let content = `サーバー: ${channel.guild.name}\n`;
    content += `チャンネル: ${channel.name}\n`;
    content += `作成日時: ${new Date(channel.createdTimestamp).toLocaleString('ja-JP')}\n`;
    content += `クローズ日時: ${new Date().toLocaleString('ja-JP')}\n\n`;
    content += '--- メッセージログ ---\n\n';

    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    for (const msg of sortedMessages) {
        const timestamp = new Date(msg.createdTimestamp).toLocaleString('ja-JP');
        content += `[${timestamp}] ${msg.author.tag}:\n`;
        if (msg.content) content += `${msg.content}\n`;
        if (msg.attachments.size > 0) {
            msg.attachments.forEach(att => {
                content += `[添付ファイル: ${att.name}] ${att.url}\n`;
            });
        }
        if (msg.embeds.length > 0) {
            content += `[埋め込みコンテンツ]\n`;
        }
        content += '\n';
    }
    
    return new AttachmentBuilder(Buffer.from(content, 'utf-8'), { name: `${channel.name}-transcript.txt` });
}


// --- ボタン処理 ---
async function handleCreateTicket(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    
    const { guild, member, user } = interaction;

    // 既存のチケットをチェック
    const q = query(collection(client.db, 'tickets'), where('guildId', '==', guild.id), where('userId', '==', user.id), where('status', '==', 'open'));
    const existingTickets = await getDocs(q);
    if (!existingTickets.empty) {
        const ticketChannelId = existingTickets.docs[0].data().channelId;
        return interaction.editReply({ content: `⚠️ あなたは既にオープン中のチケットがあります: <#${ticketChannelId}>` });
    }
    
    const settingsRef = doc(client.db, 'guild_settings', guild.id);
    const settingsSnap = await getDoc(settingsRef);
    if (!settingsSnap.exists() || !settingsSnap.data().ticketSystem) {
        return interaction.editReply({ content: '❌ このサーバーではチケットシステムが正しく設定されていません。' });
    }
    const settings = settingsSnap.data().ticketSystem;
    
    const supportRole = guild.roles.cache.get(settings.supportRoleId);
    const category = guild.channels.cache.get(settings.categoryId);
    
    if (!supportRole || !category) {
        return interaction.editReply({ content: '❌ サポートロールまたはカテゴリが見つかりません。設定を確認してください。' });
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
            topic: `Ticket for ${user.tag} (ID: ${user.id}). Created at ${new Date().toISOString()}`
        });

        const newTicketRef = await addDoc(collection(client.db, 'tickets'), {
            guildId: guild.id,
            userId: user.id,
            channelId: channel.id,
            status: 'open',
            createdAt: Timestamp.now()
        });

        const embed = new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle(`ようこそ、${member.displayName}さん`)
            .setDescription(`サポートチームがまもなく対応しますので、お問い合わせ内容を詳しくお書きください。\n\nチケットを閉じるには、下のボタンを押してください。`)
            .setFooter({ text: `Ticket ID: ${newTicketRef.id}` });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`close_ticket_${newTicketRef.id}`)
                .setLabel('チケットを閉じる')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🔒')
        );

        await channel.send({ content: `${member} ${supportRole}`, embeds: [embed], components: [row] });
        await interaction.editReply({ content: `✅ チケットを作成しました: ${channel}` });
        console.log(chalk.green(`[Ticket] Created by ${user.tag} in ${guild.name}`));

    } catch (error) {
        console.error(chalk.red('❌ Ticket creation error:'), error);
        await interaction.editReply({ content: '❌ チケットの作成に失敗しました。' });
    }
}

async function handleCloseTicket(interaction, client, ticketId) {
    await interaction.deferReply({ ephemeral: true });

    const { guild, member } = interaction;
    const ticketRef = doc(client.db, 'tickets', ticketId);
    const ticketSnap = await getDoc(ticketRef);
    
    if (!ticketSnap.exists()) {
        return interaction.editReply({ content: '❌ このチケットはデータベースに存在しません。' });
    }
    
    const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🔒 チケットクローズ確認')
        .setDescription('本当にこのチケットを閉じますか？この操作は取り消せません。');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_close_${ticketId}`)
            .setLabel('閉じる')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('cancel_close')
            .setLabel('キャンセル')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleConfirmClose(interaction, client, ticketId) {
    await interaction.deferUpdate();
    
    const { channel } = interaction;
    
    try {
        const transcript = await createTranscript(channel);
        
        const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('チケットがクローズされました')
            .setDescription(`実行者: ${interaction.user.tag}`)
            .addFields({ name: 'トランスクリプト', value: '添付ファイルをご確認ください。' })
            .setTimestamp();
        
        // ログチャンネルにトランスクリプトを送信
        const settingsRef = doc(client.db, 'guild_settings', interaction.guild.id);
        const settingsSnap = await getDoc(settingsRef);
        if (settingsSnap.exists() && settingsSnap.data().auditLogChannel) {
            const logChannelId = settingsSnap.data().auditLogChannel;
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                await logChannel.send({ embeds: [embed], files: [transcript] });
            }
        }
        
        // チャンネルを削除
        await channel.delete('Ticket closed.');
        
        // Firestoreのステータスを更新
        await updateDoc(doc(client.db, 'tickets', ticketId), {
            status: 'closed',
            closedAt: Timestamp.now(),
            closedBy: interaction.user.id
        });
        console.log(chalk.yellow(`[Ticket] Closed ticket ${ticketId} by ${interaction.user.tag}`));

    } catch (error) {
        console.error(chalk.red('❌ Ticket close confirmation error:'), error);
        await interaction.followUp({ content: '❌ チケットのクローズ中にエラーが発生しました。', ephemeral: true });
    }
}

async function handleCancelClose(interaction) {
    await interaction.message.delete();
    await interaction.followUp({ content: 'チケットのクローズをキャンセルしました。', ephemeral: true });
}

module.exports = (client) => {
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isButton()) return;

        const [action, ...args] = interaction.customId.split('_');

        try {
            switch (action) {
                case 'create':
                    if (args[0] === 'ticket') await handleCreateTicket(interaction, client);
                    break;
                case 'close':
                    if (args[0] === 'ticket') await handleCloseTicket(interaction, client, args[1]);
                    break;
                case 'confirm':
                    if (args[0] === 'close') await handleConfirmClose(interaction, client, args[1]);
                    break;
                case 'cancel':
                    if (args[0] === 'close') await handleCancelClose(interaction);
                    break;
            }
        } catch (error) {
             console.error(chalk.red(`❌ Unhandled error in ticketSystem event handler for customId "${interaction.customId}":`), error);
        }
    });
};