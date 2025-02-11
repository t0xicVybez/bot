const { Button } = require('@eartharoid/dbf');
const ExtendedEmbedBuilder = require('../lib/embed');
const { isStaff } = require('../lib/users');
const { logTicketEvent } = require('../lib/logging');

module.exports = class AddUserButton extends Button {
    constructor(client, options) {
        super(client, {
            ...options,
            id: 'add-user', // Changed to use hyphen instead of underscore
        });
    }

    /**
     * @param {*} id
     * @param {import("discord.js").ButtonInteraction} interaction
     */
    async run(id, interaction) {
        /** @type {import("client")} */
        const client = this.client;

        const ticket = await client.prisma.ticket.findUnique({
            include: { guild: true },
            where: { id: interaction.channel.id },
        });

        if (!ticket) {
            const settings = await client.prisma.guild.findUnique({ where: { id: interaction.guild.id } });
            const getMessage = client.i18n.getLocale(settings.locale);
            return await interaction.reply({
                embeds: [
                    new ExtendedEmbedBuilder({
                        iconURL: interaction.guild.iconURL(),
                        text: settings.footer,
                    })
                        .setColor(settings.errorColour)
                        .setTitle(getMessage('misc.invalid_ticket.title'))
                        .setDescription(getMessage('misc.invalid_ticket.description')),
                ],
                ephemeral: true
            });
        }

        const getMessage = client.i18n.getLocale(ticket.guild.locale);

        if (
            ticket.createdById !== interaction.member.id &&
            !(await isStaff(interaction.guild, interaction.member.id))
        ) {
            return await interaction.reply({
                embeds: [
                    new ExtendedEmbedBuilder({
                        iconURL: interaction.guild.iconURL(),
                        text: ticket.guild.footer,
                    })
                        .setColor(ticket.guild.errorColour)
                        .setTitle(getMessage('commands.slash.add.not_staff.title'))
                        .setDescription(getMessage('commands.slash.add.not_staff.description')),
                ],
                ephemeral: true
            });
        }

        await interaction.showModal({
            components: [
                {
                    components: [
                        {
                            customId: 'username',
                            label: "Username",
                            placeholder: "@username or Username#0000",
                            required: true,
                            style: 1,
                            type: 4
                        }
                    ],
                    type: 1
                }
            ],
            customId: JSON.stringify({
                action: 'add-user-modal', // Updated to use hyphen
                ticketId: ticket.id
            }),
            title: "Add User to Ticket"
        });

        try {
            const modalSubmit = await interaction.awaitModalSubmit({
                filter: i => {
                    try {
                        const data = JSON.parse(i.customId);
                        return data.action === 'add-user-modal' && data.ticketId === ticket.id; // Updated to match new action name
                    } catch {
                        return false;
                    }
                },
                time: 300000,
            });

            const userInput = modalSubmit.fields.getTextInputValue('username');
            const username = userInput.replace(/^@/, '');

            const member = await interaction.guild.members.cache.find(m =>
                m.user.tag.toLowerCase() === username.toLowerCase() ||
                m.user.username.toLowerCase() === username.toLowerCase() ||
                m.displayName.toLowerCase() === username.toLowerCase()
            );

            if (!member) {
                return await modalSubmit.reply({
                    embeds: [
                        new ExtendedEmbedBuilder({
                            iconURL: interaction.guild.iconURL(),
                            text: ticket.guild.footer,
                        })
                            .setColor(ticket.guild.errorColour)
                            .setTitle(getMessage('commands.slash.add.invalid_user.title'))
                            .setDescription('Could not find a user with that name. Please try again.'),
                    ],
                    ephemeral: true,
                });
            }

            await interaction.channel.permissionOverwrites.edit(
                member,
                {
                    AttachFiles: true,
                    EmbedLinks: true,
                    ReadMessageHistory: true,
                    SendMessages: true,
                    ViewChannel: true,
                },
                `${interaction.user.tag} added ${member.user.tag} to the ticket`,
            );

            await interaction.channel.send({
                embeds: [
                    new ExtendedEmbedBuilder()
                        .setColor(ticket.guild.primaryColour)
                        .setDescription(getMessage('commands.slash.add.added', {
                            added: member.toString(),
                            by: interaction.member.toString(),
                        })),
                ],
            });

            await modalSubmit.deferUpdate();

            logTicketEvent(client, {
                action: 'update',
                diff: {
                    original: {},
                    updated: { [getMessage('log.ticket.added')]: member.user.tag },
                },
                target: {
                    id: ticket.id,
                    name: `<#${ticket.id}>`,
                },
                userId: interaction.user.id,
            });
        } catch (error) {
            if (!error.code === 40060 && !interaction.replied) {
                await interaction.followUp({
                    embeds: [
                        new ExtendedEmbedBuilder()
                            .setColor('Red')
                            .setTitle('Error')
                            .setDescription('Failed to process the modal response.'),
                    ],
                    ephemeral: true,
                });
            }
            client.log.error(error);
        }
    }
};
