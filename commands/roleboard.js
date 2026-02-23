const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } = require('firebase/firestore');
const { createStandardEmbed, createSuccessEmbed, createErrorEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roleboard')
        .setDescription('ロールボードの管理を行います')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('新しいロールボードを作成します')
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('ロールボードのタイトル')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('ロールボードの説明')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('color')
                        .setDescription('埋め込みの色 (16進数、例: #FF0000)')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('パスワード保護を有効にする（パスワードを指定、最大128文字）')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('ロールボードにロールを追加します')
                .addStringOption(option =>
                    option.setName('board_id')
                        .setDescription('ロールボードのID')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('追加するロール')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('genre')
                        .setDescription('ロールのジャンル')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('ボタンに表示する絵文字（省略可能）')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('ロールボードからロールを削除します')
                .addStringOption(option =>
                    option.setName('board_id')
                        .setDescription('ロールボードのID')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('削除するロール')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('send')
                .setDescription('ロールボードを指定チャンネルに送信します')
                .addStringOption(option =>
                    option.setName('board_id')
                        .setDescription('送信するロールボードのID')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('送信先チャンネル（デフォルト: 現在のチャンネル）')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('password')
                        .setDescription('パスワード保護を有効にする（パスワードを指定、最大128文字）')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('このサーバーのロールボード一覧を表示します'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('ロールボードを削除します')
                .addStringOption(option =>
                    option.setName('board_id')
                        .setDescription('削除するロールボードのID')
                        .setRequired(true)
                        .setAutocomplete(true))),

    async autocomplete(interaction) {
        try {
            if (!interaction.isAutocomplete()) return;
            if (interaction.responded) return;

            const focusedOption = interaction.options.getFocused(true);
            
            if (focusedOption.name === 'board_id') {
                try {
                    const guildId = interaction.guild.id;
                    const boardsRef = collection(interaction.client.db, 'roleboards');
                    const q = query(boardsRef, where('guildId', '==', guildId));
                    const snapshot = await getDocs(q);
                    
                    const choices = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        choices.push({
                            name: `${data.title} (${doc.id})`,
                            value: doc.id
                        });
                    });

                    const filtered = choices.filter(choice => 
                        choice.name.toLowerCase().includes(focusedOption.value.toLowerCase())
                    ).slice(0, 25);

                    if (!interaction.responded) {
                        await interaction.respond(filtered);
                    }
                } catch (dbError) {
                    if (!interaction.responded) await interaction.respond([]);
                }
            }
        } catch (error) {
            if (!interaction.responded) try { await interaction.respond([]); } catch (e) {}
        }
    },

    async execute(interaction) {
        try {
            if (!interaction.isChatInputCommand()) return;
            if (interaction.replied || interaction.deferred) return;

            const subcommand = interaction.options.getSubcommand();
            const guildId = interaction.guild.id;

            await interaction.deferReply({ ephemeral: true });

            switch (subcommand) {
                case 'create':
                    await this.handleCreate(interaction, guildId);
                    break;
                case 'add':
                    await this.handleAdd(interaction, guildId);
                    break;
                case 'remove':
                    await this.handleRemove(interaction, guildId);
                    break;
                case 'send':
                    await this.handleSend(interaction, guildId);
                    break;
                case 'list':
                    await this.handleList(interaction, guildId);
                    break;
                case 'delete':
                    await this.handleDelete(interaction, guildId);
                    break;
                default:
                    await interaction.editReply({ content: '[ERROR] 無効なサブコマンドです。' });
            }
        } catch (error) {
            console.error('[ERROR] ロールボードコマンドエラー:', error);
            await interaction.editReply({ content: '[ERROR] コマンドの実行中にエラーが発生しました。' });
        }
    },

    async handleCreate(interaction, guildId) {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') || 'ボタンをクリックしてロールを取得・削除できます。';
        const color = interaction.options.getString('color');
        const password = interaction.options.getString('password');

        let embedColor = COLORS.PRIMARY;
        if (color) {
            const colorMatch = color.match(/^#?([A-Fa-f0-9]{6})$/);
            if (colorMatch) {
                embedColor = parseInt(colorMatch[1], 16);
            } else {
                return await interaction.editReply({ content: '[ERROR] 無効な色の形式です。' });
            }
        }

        if (password && password.length > 128) {
            return await interaction.editReply({ content: '[ERROR] パスワードは128文字以内で指定してください。' });
        }

        const boardId = `rb_${guildId}_${Date.now()}`;

        try {
            const boardData = {
                guildId,
                title,
                description,
                color: embedColor,
                roles: {},
                genres: {},
                password: password || null,
                createdBy: interaction.user.id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await setDoc(doc(interaction.client.db, 'roleboards', boardId), boardData);

            const embed = createSuccessEmbed('作成完了', `**${title}** のロールボードが作成されました。`)
                .addFields([
                    { name: 'ボードID', value: `\`${boardId}\``, inline: true },
                    { name: 'パスワード保護', value: password ? '[ON] 有効' : '[OFF] 無効', inline: true }
                ])
                .setFooter({ text: '次に /roleboard add でロールを追加してください' });

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: '[ERROR] ロールボードの作成に失敗しました。' });
        }
    },

    async handleAdd(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        const role = interaction.options.getRole('role');
        const genre = interaction.options.getString('genre');
        const emoji = interaction.options.getString('emoji');

        try {
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                return await interaction.editReply({ content: '[ERROR] ロールボードが見つかりません。' });
            }

            const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
            if (role.position >= botMember.roles.highest.position) {
                return await interaction.editReply({ content: '[ERROR] ボットの権限不足です。' });
            }

            const boardData = boardDoc.data();
            boardData.roles[role.id] = {
                name: role.name,
                emoji: emoji || null,
                genre: genre,
                addedAt: new Date().toISOString()
            };

            if (!boardData.genres) boardData.genres = {};
            if (!boardData.genres[genre]) boardData.genres[genre] = [];
            if (!boardData.genres[genre].includes(role.id)) boardData.genres[genre].push(role.id);

            boardData.updatedAt = new Date().toISOString();

            await updateDoc(doc(interaction.client.db, 'roleboards', boardId), {
                roles: boardData.roles,
                genres: boardData.genres,
                updatedAt: boardData.updatedAt
            });

            const embed = createSuccessEmbed('ロール追加完了', `**${role.name}** をロールボードに追加しました。`)
                .addFields([
                    { name: 'ボードID', value: `\`${boardId}\``, inline: true },
                    { name: 'ジャンル', value: genre, inline: true }
                ]);

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: '[ERROR] ロールの追加に失敗しました。' });
        }
    },

    async handleRemove(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        const role = interaction.options.getRole('role');

        try {
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                return await interaction.editReply({ content: '[ERROR] ロールボードが見つかりません。' });
            }

            const boardData = boardDoc.data();
            if (!boardData.roles[role.id]) {
                return await interaction.editReply({ content: '[ERROR] 登録されていないロールです。' });
            }

            const roleGenre = boardData.roles[role.id].genre;
            delete boardData.roles[role.id];

            if (boardData.genres && boardData.genres[roleGenre]) {
                const index = boardData.genres[roleGenre].indexOf(role.id);
                if (index > -1) {
                    boardData.genres[roleGenre].splice(index, 1);
                    if (boardData.genres[roleGenre].length === 0) delete boardData.genres[roleGenre];
                }
            }

            boardData.updatedAt = new Date().toISOString();

            await updateDoc(doc(interaction.client.db, 'roleboards', boardId), {
                roles: boardData.roles,
                genres: boardData.genres,
                updatedAt: boardData.updatedAt
            });

            const embed = createSuccessEmbed('ロール削除完了', `**${role.name}** を削除しました。`)
                .addFields([{ name: 'ボードID', value: `\`${boardId}\``, inline: true }]);

            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: '[ERROR] ロールの削除に失敗しました。' });
        }
    },

    async handleSend(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const password = interaction.options.getString('password');

        try {
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                return await interaction.editReply({ content: '[ERROR] ロールボードが見つかりません。' });
            }

            const boardData = boardDoc.data();
            const roles = Object.keys(boardData.roles);

            if (roles.length === 0) {
                return await interaction.editReply({ content: '[ERROR] ロールが登録されていません。' });
            }

            let passwordToUse = boardData.password;
            if (password) {
                passwordToUse = password;
                await updateDoc(doc(interaction.client.db, 'roleboards', boardId), {
                    password: password,
                    updatedAt: new Date().toISOString()
                });
            }

            const embed = createStandardEmbed({
                title: `[ROLEBOARD] ${boardData.title}`,
                description: boardData.description,
                color: boardData.color,
                footer: { text: `ID: ${boardId} | ${roles.length} Roles${passwordToUse ? ' | [PASS] Protected' : ''}` }
            });

            const genreFields = {};
            const validRoles = roles.filter(roleId => interaction.guild.roles.cache.has(roleId));

            validRoles.forEach(roleId => {
                const roleData = boardData.roles[roleId];
                const role = interaction.guild.roles.cache.get(roleId);
                const genre = roleData.genre || 'Others';

                if (!genreFields[genre]) genreFields[genre] = [];
                const roleText = roleData.emoji ? `${roleData.emoji} **${role.name}**` : `**${role.name}**`;
                genreFields[genre].push(roleText);
            });

            Object.keys(genreFields).forEach(genre => {
                embed.addFields([{ name: `[GENRE] ${genre}`, value: genreFields[genre].join('\n'), inline: false }]);
            });

            const components = [];
            const genreKeys = Object.keys(genreFields);
            let buttonCount = 0;
            let currentRow = new ActionRowBuilder();

            for (const genre of genreKeys) {
                const genreRoles = boardData.genres[genre] || [];
                for (const roleId of genreRoles) {
                    if (buttonCount >= 25) break;
                    const roleData = boardData.roles[roleId];
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (role) {
                        const button = new ButtonBuilder()
                            .setCustomId(`role_${roleId}|${boardId}`)
                            .setLabel(role.name)
                            .setStyle(ButtonStyle.Secondary);
                        if (roleData.emoji) try { button.setEmoji(roleData.emoji); } catch (e) {}
                        currentRow.addComponents(button);
                        buttonCount++;
                        if (currentRow.components.length === 5) {
                            components.push(currentRow);
                            currentRow = new ActionRowBuilder();
                        }
                    }
                }
                if (buttonCount >= 25) break;
            }
            if (currentRow.components.length > 0 && components.length < 5) components.push(currentRow);

            await targetChannel.send({ embeds: [embed], components });
            await interaction.editReply({ content: `[OK] ロールボードを ${targetChannel} に送信しました。` });
        } catch (error) {
            await interaction.editReply({ content: '[ERROR] ロールボードの送信に失敗しました。' });
        }
    },

    async handleList(interaction, guildId) {
        try {
            const boardsRef = collection(interaction.client.db, 'roleboards');
            const q = query(boardsRef, where('guildId', '==', guildId));
            const snapshot = await getDocs(q);

            if (snapshot.empty) return await interaction.editReply({ content: '[INFO] ロールボードがありません。' });

            const boards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            const embed = createStandardEmbed({
                title: '[LIST] ロールボード一覧',
                description: `このサーバーには **${boards.length}** 個のロールボードがあります。`,
                color: COLORS.PRIMARY
            });

            const boardList = boards.slice(0, 10).map((board, index) =>
                `**${index + 1}.** ${board.title}\n` +
                `　ID: \`${board.id}\` | Roles: ${Object.keys(board.roles || {}).length}`
            ).join('\n\n');

            embed.addFields([{ name: 'ボード一覧', value: boardList || 'なし', inline: false }]);
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: '[ERROR] 取得に失敗しました。' });
        }
    },

    async handleDelete(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        try {
            const boardRef = doc(interaction.client.db, 'roleboards', boardId);
            const boardDoc = await getDoc(boardRef);
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                return await interaction.editReply({ content: '[ERROR] ロールボードが見つかりません。' });
            }
            await deleteDoc(boardRef);
            await interaction.editReply({ embeds: [createSuccessEmbed('削除完了', `ロールボードを削除しました。`)] });
        } catch (error) {
            await interaction.editReply({ content: '[ERROR] 削除に失敗しました。' });
        }
    }
};
