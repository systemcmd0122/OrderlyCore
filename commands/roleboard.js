const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } = require('firebase/firestore');

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
            // インタラクションの有効性をチェック
            if (!interaction.isAutocomplete()) {
                return;
            }

            // インタラクションが既に応答済みかチェック
            if (interaction.responded) {
                return;
            }

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

                    // 再度応答済みでないかチェック
                    if (!interaction.responded) {
                        await interaction.respond(filtered);
                    }
                } catch (dbError) {
                    console.error('データベースクエリエラー:', dbError);
                    // エラーが発生した場合は空の配列で応答
                    if (!interaction.responded) {
                        try {
                            await interaction.respond([]);
                        } catch (responseError) {
                            console.error('オートコンプリート応答エラー:', responseError);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('オートコンプリートエラー:', error);
            // エラーハンドリング - 応答していない場合のみ空の配列で応答
            if (!interaction.responded) {
                try {
                    await interaction.respond([]);
                } catch (finalError) {
                    console.error('最終応答エラー:', finalError);
                }
            }
        }
    },

    async execute(interaction) {
        try {
            // インタラクションの有効性をチェック
            if (!interaction.isChatInputCommand()) {
                console.log('⚠️ チャットコマンド以外のインタラクションを受信しました');
                return;
            }

            // インタラクションが既に応答済みの場合は処理しない
            if (interaction.replied || interaction.deferred) {
                console.log('⚠️ インタラクションは既に応答済みです');
                return;
            }

            const subcommand = interaction.options.getSubcommand();
            const guildId = interaction.guild.id;

            // 最初に必ずdeferReplyを呼び出す（3秒以内に応答する必要があるため）
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
                    await this.safeEditReply(interaction, {
                        content: '⚠️ 無効なサブコマンドです。'
                    });
            }
        } catch (error) {
            console.error('ロールボードコマンドエラー:', error);
            
            const errorMessage = {
                content: '⚠️ コマンドの実行中にエラーが発生しました。しばらく時間をおいてから再度お試しください。'
            };

            await this.safeEditReply(interaction, errorMessage);
        }
    },

    // 安全な応答メソッド（deferReply後専用）
    async safeEditReply(interaction, options) {
        try {
            if (interaction.deferred) {
                return await interaction.editReply(options);
            } else {
                console.error('editReplyを呼び出そうとしましたが、インタラクションがdeferされていません');
                return null;
            }
        } catch (error) {
            console.error('応答送信エラー:', error);
            throw error;
        }
    },

    async handleCreate(interaction, guildId) {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description') || 'ボタンをクリックしてロールを取得・削除できます。';
        const color = interaction.options.getString('color');
        const password = interaction.options.getString('password');

        // カラー検証
        let embedColor = 0x5865F2; // Discord デフォルト色
        if (color) {
            const colorMatch = color.match(/^#?([A-Fa-f0-9]{6})$/);
            if (colorMatch) {
                embedColor = parseInt(colorMatch[1], 16);
            } else {
                await this.safeEditReply(interaction, {
                    content: '⚠️ 無効な色の形式です。16進数で入力してください（例: #FF0000）'
                });
                return;
            }
        }

        // パスワード検証
        if (password && password.length > 128) {
            await this.safeEditReply(interaction, {
                content: '⚠️ パスワードは128文字以内で指定してください。'
            });
            return;
        }

        // 固有IDの生成
        const boardId = `rb_${guildId}_${Date.now()}`;

        try {
            // Firestoreに保存
            const boardData = {
                guildId,
                title,
                description,
                color: embedColor,
                roles: {},
                genres: {},
                password: password || null, // パスワードを保存
                createdBy: interaction.user.id,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await setDoc(doc(interaction.client.db, 'roleboards', boardId), boardData);

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ ロールボード作成完了')
                .setDescription(`**${title}** のロールボードが作成されました。`)
                .addFields([
                    { name: '📋 ボードID', value: `\`${boardId}\``, inline: true },
                    { name: '📝 説明', value: description, inline: false },
                    { name: '🎨 カラー', value: `#${embedColor.toString(16).padStart(6, '0').toUpperCase()}`, inline: true },
                    { name: '🔐 パスワード保護', value: password ? '✅ 有効' : '❌ 無効', inline: true }
                ])
                .setFooter({
                    text: '次に /roleboard add でロールを追加してください'
                })
                .setTimestamp();

            await this.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            console.error('ロールボード作成エラー:', error);
            await this.safeEditReply(interaction, {
                content: '⚠️ ロールボードの作成中にエラーが発生しました。'
            });
        }
    },

    async handleAdd(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        const role = interaction.options.getRole('role');
        const genre = interaction.options.getString('genre');
        const emoji = interaction.options.getString('emoji');

        try {
            // ロールボードの取得
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ 指定されたロールボードが見つかりません。'
                });
                return;
            }

            // ボットのロール階層チェック
            const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
            if (role.position >= botMember.roles.highest.position) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ このロールはボットの権限より上位にあるため、管理できません。'
                });
                return;
            }

            // データ更新
            const boardData = boardDoc.data();
            boardData.roles[role.id] = {
                name: role.name,
                emoji: emoji || null,
                genre: genre,
                addedAt: new Date().toISOString()
            };

            // ジャンル情報を更新
            if (!boardData.genres) {
                boardData.genres = {};
            }
            if (!boardData.genres[genre]) {
                boardData.genres[genre] = [];
            }
            if (!boardData.genres[genre].includes(role.id)) {
                boardData.genres[genre].push(role.id);
            }

            boardData.updatedAt = new Date().toISOString();

            await updateDoc(doc(interaction.client.db, 'roleboards', boardId), {
                roles: boardData.roles,
                genres: boardData.genres,
                updatedAt: boardData.updatedAt
            });

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ ロール追加完了')
                .setDescription(`**${role.name}** をロールボードに追加しました。`)
                .addFields([
                    { name: '📋 ボードID', value: `\`${boardId}\``, inline: true },
                    { name: '🎭 ロール', value: `${role}`, inline: true },
                    { name: '🏷️ ジャンル', value: genre, inline: true }
                ]);

            if (emoji) {
                embed.addFields([
                    { name: '😀 絵文字', value: emoji, inline: true }
                ]);
            }

            embed.setTimestamp();

            await this.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            console.error('ロール追加エラー:', error);
            await this.safeEditReply(interaction, {
                content: '⚠️ ロールの追加中にエラーが発生しました。'
            });
        }
    },

    async handleRemove(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        const role = interaction.options.getRole('role');

        try {
            // ロールボードの取得
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ 指定されたロールボードが見つかりません。'
                });
                return;
            }

            const boardData = boardDoc.data();
            
            if (!boardData.roles[role.id]) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ このロールはロールボードに登録されていません。'
                });
                return;
            }

            const roleGenre = boardData.roles[role.id].genre;

            // ロール削除
            delete boardData.roles[role.id];

            // ジャンルからロールを削除
            if (boardData.genres && boardData.genres[roleGenre]) {
                const index = boardData.genres[roleGenre].indexOf(role.id);
                if (index > -1) {
                    boardData.genres[roleGenre].splice(index, 1);
                    // ジャンルが空になった場合は削除
                    if (boardData.genres[roleGenre].length === 0) {
                        delete boardData.genres[roleGenre];
                    }
                }
            }

            boardData.updatedAt = new Date().toISOString();

            await updateDoc(doc(interaction.client.db, 'roleboards', boardId), {
                roles: boardData.roles,
                genres: boardData.genres,
                updatedAt: boardData.updatedAt
            });

            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('✅ ロール削除完了')
                .setDescription(`**${role.name}** をロールボードから削除しました。`)
                .addFields([
                    { name: '📋 ボードID', value: `\`${boardId}\``, inline: true },
                    { name: '🗑️ 削除されたロール', value: `${role}`, inline: true },
                    { name: '🏷️ ジャンル', value: roleGenre, inline: true }
                ])
                .setTimestamp();

            await this.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            console.error('ロール削除エラー:', error);
            await this.safeEditReply(interaction, {
                content: '⚠️ ロールの削除中にエラーが発生しました。'
            });
        }
    },

    async handleSend(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');
        const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
        const password = interaction.options.getString('password');

        try {
            // ロールボードの取得
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ 指定されたロールボードが見つかりません。'
                });
                return;
            }

            const boardData = boardDoc.data();
            const roles = Object.keys(boardData.roles);

            if (roles.length === 0) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ このロールボードにはロールが登録されていません。'
                });
                return;
            }

            // パスワード設定時に指定パスワードを保存または更新
            let passwordToUse = boardData.password;
            if (password) {
                passwordToUse = password;
                // パスワード変更をデータベースに保存
                await updateDoc(doc(interaction.client.db, 'roleboards', boardId), {
                    password: password,
                    updatedAt: new Date().toISOString()
                });
            }

            // 埋め込み作成
            const embed = new EmbedBuilder()
                .setColor(boardData.color)
                .setTitle(`🎭 ${boardData.title}`)
                .setDescription(boardData.description)
                .setFooter({
                    text: `ロールボードID: ${boardId} | ${roles.length}個のロール${passwordToUse ? ' | 🔐 パスワード保護中' : ''}`
                })
                .setTimestamp();

            // ジャンル別にロールを整理
            const genreFields = {};
            const validRoles = roles.filter(roleId => interaction.guild.roles.cache.has(roleId));

            validRoles.forEach(roleId => {
                const roleData = boardData.roles[roleId];
                const role = interaction.guild.roles.cache.get(roleId);
                const genre = roleData.genre || 'その他';

                if (!genreFields[genre]) {
                    genreFields[genre] = [];
                }

                const roleText = roleData.emoji 
                    ? `${roleData.emoji} **${role.name}**`
                    : `**${role.name}**`;
                
                genreFields[genre].push(roleText);
            });

            // ジャンル別フィールドを追加
            Object.keys(genreFields).forEach(genre => {
                embed.addFields([
                    { 
                        name: `🏷️ ${genre}`, 
                        value: genreFields[genre].join('\n'), 
                        inline: false 
                    }
                ]);
            });

            // ボタン作成（ジャンル別に整理、最大25個まで、5列×5行）
            const components = [];
            const genreKeys = Object.keys(genreFields);
            let buttonCount = 0;
            let currentRow = new ActionRowBuilder();

            for (const genre of genreKeys) {
                const genreRoles = boardData.genres[genre] || [];
                
                for (const roleId of genreRoles) {
                    if (buttonCount >= 25) break; // 最大25個まで
                    
                    const roleData = boardData.roles[roleId];
                    const role = interaction.guild.roles.cache.get(roleId);
                    
                    if (role) {
                        const button = new ButtonBuilder()
                            .setCustomId(`role_${roleId}|${boardId}`)
                            .setLabel(role.name)
                            .setStyle(ButtonStyle.Secondary);
                        
                        if (roleData.emoji) {
                            try {
                                button.setEmoji(roleData.emoji);
                            } catch (emojiError) {
                                console.warn(`無効な絵文字をスキップしました: ${roleData.emoji}`);
                            }
                        }
                        
                        currentRow.addComponents(button);
                        buttonCount++;
                        
                        // 5個のボタンで行を完成させる
                        if (currentRow.components.length === 5) {
                            components.push(currentRow);
                            currentRow = new ActionRowBuilder();
                        }
                        
                        // 最大5行まで
                        if (components.length >= 5) break;
                    }
                }
                
                if (buttonCount >= 25 || components.length >= 5) break;
            }

            // 最後の行に残りのボタンがある場合は追加
            if (currentRow.components.length > 0 && components.length < 5) {
                components.push(currentRow);
            }

            // メッセージ送信
            await targetChannel.send({ embeds: [embed], components });
            
            await this.safeEditReply(interaction, {
                content: `✅ ロールボードを ${targetChannel} に送信しました。${passwordToUse ? '\n🔐 パスワード保護が有効です。' : ''}`
            });
        } catch (error) {
            console.error('ロールボード送信エラー:', error);
            await this.safeEditReply(interaction, {
                content: '⚠️ ロールボードの送信に失敗しました。チャンネルの権限を確認してください。'
            });
        }
    },

    async handleList(interaction, guildId) {
        try {
            const boardsRef = collection(interaction.client.db, 'roleboards');
            const q = query(boardsRef, where('guildId', '==', guildId));
            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                await this.safeEditReply(interaction, {
                    content: '📋 このサーバーにはロールボードが作成されていません。'
                });
                return;
            }

            const boards = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                const roleCount = Object.keys(data.roles || {}).length;
                const genreCount = Object.keys(data.genres || {}).length;
                boards.push({
                    id: doc.id,
                    title: data.title,
                    roleCount,
                    genreCount,
                    createdAt: new Date(data.createdAt).toLocaleDateString('ja-JP')
                });
            });

            // 作成日時で降順ソート
            boards.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('📋 ロールボード一覧')
                .setDescription(`このサーバーには **${boards.length}** 個のロールボードがあります。`)
                .setFooter({
                    text: `サーバー: ${interaction.guild.name}`
                })
                .setTimestamp();

            // ロールボードを10個まで表示
            const displayBoards = boards.slice(0, 10);
            const boardList = displayBoards.map((board, index) => 
                `**${index + 1}.** ${board.title}\n` +
                `　📋 ID: \`${board.id}\`\n` +
                `　🎭 ロール数: ${board.roleCount}個\n` +
                `　🏷️ ジャンル数: ${board.genreCount}個\n` +
                `　📅 作成日: ${board.createdAt}`
            ).join('\n\n');

            embed.addFields([
                { name: '🎭 ロールボード', value: boardList || 'なし', inline: false }
            ]);

            if (boards.length > 10) {
                embed.addFields([
                    { name: '📄 注意', value: `他に ${boards.length - 10} 個のロールボードがあります。`, inline: false }
                ]);
            }

            await this.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            console.error('ロールボード一覧取得エラー:', error);
            await this.safeEditReply(interaction, {
                content: '⚠️ ロールボード一覧の取得中にエラーが発生しました。'
            });
        }
    },

    async handleDelete(interaction, guildId) {
        const boardId = interaction.options.getString('board_id');

        try {
            // ロールボードの取得
            const boardDoc = await getDoc(doc(interaction.client.db, 'roleboards', boardId));
            
            if (!boardDoc.exists() || boardDoc.data().guildId !== guildId) {
                await this.safeEditReply(interaction, {
                    content: '⚠️ 指定されたロールボードが見つかりません。'
                });
                return;
            }

            const boardData = boardDoc.data();

            // 削除実行
            await deleteDoc(doc(interaction.client.db, 'roleboards', boardId));

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('🗑️ ロールボード削除完了')
                .setDescription(`**${boardData.title}** を削除しました。`)
                .addFields([
                    { name: '📋 削除されたボードID', value: `\`${boardId}\``, inline: true },
                    { name: '🎭 含まれていたロール数', value: `${Object.keys(boardData.roles || {}).length}個`, inline: true },
                    { name: '🏷️ 含まれていたジャンル数', value: `${Object.keys(boardData.genres || {}).length}個`, inline: true }
                ])
                .setFooter({
                    text: '注意: 既に送信されたロールボードメッセージは手動で削除してください'
                })
                .setTimestamp();

            await this.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            console.error('ロールボード削除エラー:', error);
            await this.safeEditReply(interaction, {
                content: '⚠️ ロールボードの削除中にエラーが発生しました。'
            });
        }
    }
};