const { PermissionsBitField } = require('discord.js');
const { doc, getDoc, setDoc } = require('firebase/firestore');
const { generateWelcomeWithGemini, replacePlaceholders } = require('../src/services/welcomeService');
const { createStandardEmbed, COLORS } = require('../src/utils/embedBuilder');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member, client) {
        try {
            const guildId = member.guild.id;
            const user = member.user;

            const guildSettingsRef = doc(client.db, 'guild_settings', guildId);
            const guildConfigRef = doc(client.db, 'guilds', guildId);
            const [guildSettingsSnap, guildConfigSnap] = await Promise.all([
                getDoc(guildSettingsRef),
                getDoc(guildConfigRef)
            ]);

            const guildSettings = guildSettingsSnap.exists() ? guildSettingsSnap.data() : {};
            let guildConfig = guildConfigSnap.exists() ? guildConfigSnap.data() : {};

            if (user.bot) {
                console.log(`[INFO] Bot ${user.tag} joined ${member.guild.name}`);
                if (guildSettings.botAutoroleId) {
                    const role = member.guild.roles.cache.get(guildSettings.botAutoroleId);
                    if (role && member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles) && role.position < member.guild.members.me.roles.highest.position) {
                        await member.roles.add(role).catch(e => console.error('[ERROR] Bot role add failure:', e.message));
                        console.log(`[OK] Role ${role.name} assigned to Bot ${user.tag}`);
                    }
                }
                return;
            }

            console.log(`[JOIN] ${user.tag} joined ${member.guild.name}`);

            if (guildConfig.welcomeChannelId) {
                const welcomeChannel = member.guild.channels.cache.get(guildConfig.welcomeChannelId);
                if (welcomeChannel && welcomeChannel.permissionsFor(client.user).has([PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks])) {
                    const welcomeMsgConfig = guildSettings.welcomeMessage || { enabled: false };
                    let title, description;

                    if (welcomeMsgConfig.enabled) {
                        if (welcomeMsgConfig.type === 'gemini') {
                            const generated = await generateWelcomeWithGemini(client, member);
                            title = generated.title;
                            description = generated.description;
                        } else {
                            title = replacePlaceholders(welcomeMsgConfig.title || 'Welcome!', member, guildConfig.rulesChannelId);
                            description = replacePlaceholders(welcomeMsgConfig.description || 'Welcome to the server!', member, guildConfig.rulesChannelId);
                        }
                    } else {
                        title = `[WELCOME] ${member.guild.name}`;
                        description = `**${user.displayName}** さん、サーバーへのご参加ありがとうございます！`;
                    }

                    const welcomeEmbed = createStandardEmbed({
                        color: COLORS.SUCCESS,
                        title: title,
                        description: description,
                        thumbnail: user.displayAvatarURL({ dynamic: true, size: 256 }),
                        image: welcomeMsgConfig.imageUrl || null
                    });

                    if (!welcomeMsgConfig.enabled && guildConfig.rulesChannelId) {
                        const rulesChannel = member.guild.channels.cache.get(guildConfig.rulesChannelId);
                        if (rulesChannel) welcomeEmbed.addFields([{ name: 'Information', value: `まずは ${rulesChannel} をご確認ください！` }]);
                    }

                    await welcomeChannel.send({
                        content: guildConfig.mentionOnWelcome ? `<@${user.id}>` : null,
                        embeds: [welcomeEmbed]
                    });
                }
            }

            if (guildConfig.welcomeRoleId) {
                const welcomeRole = member.guild.roles.cache.get(guildConfig.welcomeRoleId);
                if (welcomeRole && member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles) && welcomeRole.position < member.guild.members.me.roles.highest.position) {
                    await member.roles.add(welcomeRole).catch(e => console.error('[ERROR] Welcome role add failure:', e.message));
                }
            }

            try {
                const currentStats = guildConfig.statistics || {};
                await setDoc(guildConfigRef, {
                    statistics: {
                        ...currentStats,
                        totalJoins: (currentStats.totalJoins || 0) + 1,
                        lastJoin: { userId: user.id, tag: user.tag, timestamp: Date.now() },
                        updatedAt: Date.now()
                    }
                }, { merge: true });
            } catch (error) {
                console.error(`[ERROR] Statistics update failure:`, error.message);
            }

        } catch (error) {
            console.error('[ERROR] guildMemberAdd error:', error);
        }
    },
};
