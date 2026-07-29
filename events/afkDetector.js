const chalk = require('chalk');
const { doc, getDoc } = require('firebase/firestore');
const { ref, set, get, remove } = require('firebase/database');
const { createStandardEmbed } = require('../src/utils/embedBuilder');

const CHECK_INTERVAL = 30000;

let checkTimer = null;

module.exports = (client) => {
    client.once('ready', () => {
        console.log(chalk.blue('[AFK] AFK Detector initialized. Checking every 30 seconds.'));
        checkTimer = setInterval(() => runAfkCheck(client), CHECK_INTERVAL);
    });

    process.on('SIGINT', () => cleanup());
    process.on('SIGTERM', () => cleanup());
};

async function runAfkCheck(client) {
    const { db, rtdb } = client;
    if (!db || !rtdb) return;

    try {
        const guilds = client.guilds.cache;
        for (const [, guild] of guilds) {
            await checkGuildAfk(client, guild);
        }
    } catch (error) {
        console.error(chalk.red('[AFK] Error during AFK check cycle:'), error);
    }
}

async function checkGuildAfk(client, guild) {
    const { db, rtdb } = client;
    const guildId = guild.id;

    const settingsSnap = await getDoc(doc(db, 'guild_settings', guildId));
    const guildSettings = settingsSnap.exists() ? settingsSnap.data() : {};

    if (!guildSettings.afk || guildSettings.afk.enabled === false) return;

    const defaultTimeout = guildSettings.afk?.defaultTimeout || 300;
    const defaultAction = guildSettings.afk?.defaultAction || 'mute';
    const afkChannelId = guildSettings.afk?.afkChannelId || null;
    const logChannelId = guildSettings.afk?.logChannelId || null;

    const vcMembers = getGuildVoiceMembers(guild);

    for (const [userId, member] of vcMembers) {
        if (member.user.bot) continue;

        await checkUserAfk(client, guild, member, {
            defaultTimeout,
            defaultAction,
            afkChannelId,
            logChannelId
        });
    }

    await cleanupStaleTracking(rtdb, guildId, vcMembers);
}

function getGuildVoiceMembers(guild) {
    const members = new Map();
    for (const [, channel] of guild.channels.cache) {
        if (!channel.isVoiceBased()) continue;
        for (const [, member] of channel.members) {
            if (!member.user.bot) {
                members.set(member.id, member);
            }
        }
    }
    return members;
}

async function checkUserAfk(client, guild, member, config) {
    const { db, rtdb } = client;
    const guildId = guild.id;
    const userId = member.id;

    const userSettingsRef = doc(db, 'afk_settings', `${guildId}_${userId}`);
    const userSnap = await getDoc(userSettingsRef);
    const userSettings = userSnap.exists() ? userSnap.data() : {};

    if (userSettings.autoDetect !== true) return;

    const afkTrackingRef = ref(rtdb, `afkTracking/${guildId}/${userId}`);
    const afkSnap = await get(afkTrackingRef);
    if (afkSnap.exists() && afkSnap.val().isAfk) return;

    const timeout = userSettings.timeout || config.defaultTimeout;
    const action = userSettings.action || config.defaultAction;
    const afkMessage = userSettings.afkMessage || 'AFK中';

    const conditionsRef = ref(rtdb, `afkConditions/${guildId}/${userId}`);
    const condSnap = await get(conditionsRef);

    const muteDeafenCondition = detectMuteDeafenCondition(member);

    if (muteDeafenCondition.isAfk) {
        if (!condSnap.exists() || condSnap.val().condition !== muteDeafenCondition.reason) {
            await set(conditionsRef, {
                conditionMetSince: Date.now(),
                condition: muteDeafenCondition.reason,
                channelId: member.voice.channelId,
                channelName: member.voice.channel?.name || 'Unknown'
            });
            console.log(chalk.gray(`[AFK] ${member.user.tag} started meeting AFK conditions: ${muteDeafenCondition.reason}`));
            return;
        }

        const condData = condSnap.val();
        const elapsed = Date.now() - condData.conditionMetSince;

        if (elapsed >= timeout * 1000) {
            await applyAfkAction(client, guild, member, config, {
                action, afkMessage, timeout,
                condition: condData.condition
            });
            await remove(conditionsRef);
        }
        return;
    }

    const inactiveCondition = await detectInactiveCondition(rtdb, guildId, userId, timeout);

    if (inactiveCondition.isAfk) {
        if (!condSnap.exists() || condSnap.val().condition !== 'inactive') {
            await set(conditionsRef, {
                conditionMetSince: inactiveCondition.conditionMetSince,
                condition: 'inactive',
                channelId: member.voice.channelId,
                channelName: member.voice.channel?.name || 'Unknown'
            });
            console.log(chalk.gray(`[AFK] ${member.user.tag} started meeting AFK conditions: inactive (${Math.round(inactiveCondition.inactiveSeconds)}s)`));
            return;
        }

        const elapsed = Date.now() - condSnap.val().conditionMetSince;
        if (elapsed >= timeout * 1000) {
            await applyAfkAction(client, guild, member, config, {
                action, afkMessage, timeout,
                condition: 'inactive'
            });
            await remove(conditionsRef);
        }
        return;
    }

    if (condSnap.exists()) {
        await remove(conditionsRef);
        console.log(chalk.gray(`[AFK] ${member.user.tag} no longer meets AFK conditions, cleared tracking.`));
    }
}

function detectMuteDeafenCondition(member) {
    const voiceState = member.voice;

    if (voiceState.serverMute || voiceState.selfMute) {
        return { isAfk: true, reason: 'self-muted' };
    }

    if (voiceState.serverDeaf || voiceState.selfDeaf) {
        return { isAfk: true, reason: 'self-deafened' };
    }

    return { isAfk: false, reason: null };
}

async function detectInactiveCondition(rtdb, guildId, userId, timeout) {
    try {
        const actionRef = ref(rtdb, `afkActivity/${guildId}/${userId}`);
        const actionSnap = await get(actionRef);

        if (!actionSnap.exists()) {
            return { isAfk: false, conditionMetSince: null, inactiveSeconds: 0 };
        }

        const lastActionAt = actionSnap.val().lastActionAt;
        const inactiveMs = Date.now() - lastActionAt;
        const inactiveSeconds = inactiveMs / 1000;

        if (inactiveSeconds >= timeout) {
            return {
                isAfk: true,
                conditionMetSince: lastActionAt,
                inactiveSeconds
            };
        }

        return { isAfk: false, conditionMetSince: lastActionAt, inactiveSeconds };
    } catch (error) {
        console.error(chalk.red('[AFK] Error checking inactive condition:'), error);
        return { isAfk: false, conditionMetSince: null, inactiveSeconds: 0 };
    }
}

async function applyAfkAction(client, guild, member, config, { action, afkMessage, timeout, condition }) {
    const { rtdb } = client;
    const guildId = guild.id;
    const userId = member.id;

    const actionLabels = { mute: 'ミュート', deafen: 'デフン', move: 'AFKチャンネル移動', kick: 'VC切断' };
    console.log(chalk.magenta(`[AFK] ${member.user.tag} is AFK! Condition: ${condition}, Action: ${action}`));

    const previousState = {
        serverMute: member.voice.serverMute || false,
        serverDeaf: member.voice.serverDeaf || false
    };

    let actionApplied = false;
    try {
        if (action === 'mute') {
            if (!previousState.serverMute) {
                await member.voice.setMute(true);
                actionApplied = true;
            }
        } else if (action === 'deafen') {
            if (!previousState.serverMute) {
                await member.voice.setMute(true);
            }
            if (!previousState.serverDeaf) {
                await member.voice.setDeaf(true);
            }
            actionApplied = true;
        } else if (action === 'move' && config.afkChannelId) {
            await member.voice.setChannel(config.afkChannelId);
            actionApplied = true;
        } else if (action === 'kick') {
            await member.voice.disconnect('AFK auto-detect');
            actionApplied = true;
        }

        if (action === 'move' && !config.afkChannelId) {
            if (!previousState.serverMute) {
                await member.voice.setMute(true);
            }
            actionApplied = true;
            console.log(chalk.yellow(`[AFK] AFK channel not configured, falling back to mute for ${member.user.tag}`));
        }
    } catch (err) {
        console.error(chalk.red(`[AFK] Error applying action for ${member.user.tag}:`), err);
    }

    if (actionApplied) {
        const afkTrackingRef = ref(rtdb, `afkTracking/${guildId}/${userId}`);
        await set(afkTrackingRef, {
            isAfk: true,
            manual: false,
            afkSince: Date.now(),
            afkMessage,
            channelId: member.voice.channelId,
            channelName: member.voice.channel?.name || 'Unknown',
            action,
            detectedCondition: condition,
            previousState
        });

        const logChannelId = config.logChannelId;
        if (logChannelId) {
            await sendAfkLog(guild, logChannelId, member, action, condition, afkMessage, timeout);
        }
    }
}

async function cleanupStaleTracking(rtdb, guildId, currentMembers) {
    try {
        const condRef = ref(rtdb, `afkConditions/${guildId}`);
        const condSnap = await get(condRef);
        if (condSnap.exists()) {
            const conditions = condSnap.val();
            for (const userId of Object.keys(conditions)) {
                if (!currentMembers.has(userId)) {
                    await remove(ref(rtdb, `afkConditions/${guildId}/${userId}`));
                }
            }
        }

        const activityRef = ref(rtdb, `afkActivity/${guildId}`);
        const activitySnap = await get(activityRef);
        if (activitySnap.exists()) {
            const activities = activitySnap.val();
            for (const userId of Object.keys(activities)) {
                if (!currentMembers.has(userId)) {
                    await remove(ref(rtdb, `afkActivity/${guildId}/${userId}`));
                }
            }
        }

        const afkRef = ref(rtdb, `afkTracking/${guildId}`);
        const afkSnap = await get(afkRef);
        if (afkSnap.exists()) {
            const tracking = afkSnap.val();
            for (const userId of Object.keys(tracking)) {
                if (!currentMembers.has(userId)) {
                    await remove(ref(rtdb, `afkTracking/${guildId}/${userId}`));
                }
            }
        }
    } catch (error) {
        console.error(chalk.red('[AFK] Error cleaning up stale tracking:'), error);
    }
}

async function sendAfkLog(guild, logChannelId, member, action, condition, afkMessage, timeout) {
    try {
        const logChannel = guild.channels.cache.get(logChannelId);
        if (!logChannel || !logChannel.isTextBased()) return;

        const actionLabels = {
            mute: 'ミュート',
            deafen: 'デフン',
            move: 'AFKチャンネルに移動',
            kick: 'VCから切断'
        };

        const conditionLabels = {
            'self-muted': 'ミュート検出',
            'self-deafened': 'デフン検出',
            'inactive': '非アクティブ検出'
        };

        const embed = createStandardEmbed({
            color: 0xffcc00,
            author: { name: member.displayName, iconURL: member.user.displayAvatarURL() },
            title: '[AFK] 自動検出',
            fields: [
                { name: 'ユーザー', value: `${member} (${member.user.tag})`, inline: true },
                { name: 'チャンネル', value: member.voice.channel ? `${member.voice.channel.name}` : '不明', inline: true },
                { name: '検出条件', value: conditionLabels[condition] || condition, inline: true },
                { name: '猶予時間', value: `${timeout}秒`, inline: true },
                { name: '実行アクション', value: actionLabels[action] || action, inline: true },
                { name: 'メッセージ', value: afkMessage, inline: true }
            ],
            footer: { text: `${guild.name} | /afk config で設定変更` }
        });

        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error(chalk.red('[AFK] Error sending AFK log:'), error);
    }
}

function cleanup() {
    if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
        console.log(chalk.yellow('[AFK] AFK Detector shutdown completed'));
    }
}
