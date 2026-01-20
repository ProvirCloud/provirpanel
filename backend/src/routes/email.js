'use strict';

const express = require('express');
const nodemailer = require('nodemailer');
const prisma = require('../config/prisma');

const router = express.Router();

const sanitizeConfig = (config) => ({
  id: config.id,
  name: config.name,
  provider: config.provider,
  host: config.host,
  port: config.port,
  secure: config.secure,
  username: config.username,
  fromName: config.fromName,
  fromEmail: config.fromEmail,
  replyTo: config.replyTo,
  tlsRejectUnauthorized: config.tlsRejectUnauthorized,
  tlsCaText: config.tlsCaText ? '***' : null,
  isActive: config.isActive,
  createdAt: config.createdAt,
  updatedAt: config.updatedAt
});

const buildTransporter = (config) => {
  const transportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username
      ? {
          user: config.username,
          pass: config.password || ''
        }
      : undefined,
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized
    }
  };
  if (config.tlsCaText) {
    transportOptions.tls.ca = config.tlsCaText;
  }
  return nodemailer.createTransport(transportOptions);
};

const applyPreheader = (html, preheader) => {
  if (!preheader) return html;
  const trimmed = String(preheader).trim();
  if (!trimmed) return html;
  const hidden = `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${trimmed}</div>`;
  if (html.includes('<body')) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}${hidden}`);
  }
  return `${hidden}${html}`;
};

const resolveConfig = async (configId) => {
  if (configId) {
    return prisma.smtpConfig.findUnique({ where: { id: configId } });
  }
  return prisma.smtpConfig.findFirst({ where: { isActive: true } });
};

const sendEmail = async ({ to, subject, html, templateId, configId }) => {
  if (!to) {
    throw new Error('to is required');
  }

  const config = await resolveConfig(configId ? Number(configId) : null);
  if (!config) {
    throw new Error('SMTP config not found');
  }

  let finalSubject = subject || '';
  let finalHtml = html || '';
  if (templateId) {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: Number(templateId) }
    });
    if (!template) {
      throw new Error('Template not found');
    }
    finalSubject = template.subject;
    finalHtml = applyPreheader(template.html, template.preheader);
  } else {
    finalHtml = applyPreheader(finalHtml, null);
  }

  if (!finalSubject || !finalHtml) {
    throw new Error('subject and html are required');
  }

  const transporter = buildTransporter(config);
  const from = config.fromName
    ? `${config.fromName} <${config.fromEmail}>`
    : config.fromEmail;
  const info = await transporter.sendMail({
    from,
    to,
    replyTo: config.replyTo || undefined,
    subject: finalSubject,
    html: finalHtml
  });

  return info;
};

router.get('/configs', async (req, res, next) => {
  try {
    const configs = await prisma.smtpConfig.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ configs: configs.map(sanitizeConfig) });
  } catch (err) {
    next(err);
  }
});

router.post('/configs', async (req, res, next) => {
  try {
    const {
      name,
      provider,
      host,
      port,
      secure,
      username,
      password,
      fromName,
      fromEmail,
      replyTo,
      tlsRejectUnauthorized,
      tlsCaText,
      isActive
    } = req.body || {};

    if (!name || !host || !fromEmail) {
      return res.status(400).json({ message: 'name, host and fromEmail are required' });
    }

    if (isActive) {
      await prisma.smtpConfig.updateMany({ data: { isActive: false } });
    }

    const config = await prisma.smtpConfig.create({
      data: {
        name,
        provider: provider || 'smtp',
        host,
        port: Number(port) || 587,
        secure: !!secure,
        username: username || null,
        password: password || null,
        fromName: fromName || null,
        fromEmail,
        replyTo: replyTo || null,
        tlsRejectUnauthorized: tlsRejectUnauthorized !== false,
        tlsCaText: tlsCaText || null,
        isActive: isActive !== false
      }
    });

    res.json({ config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

router.put('/configs/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.smtpConfig.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Config not found' });
    }

    const {
      name,
      provider,
      host,
      port,
      secure,
      username,
      password,
      fromName,
      fromEmail,
      replyTo,
      tlsRejectUnauthorized,
      tlsCaText,
      isActive
    } = req.body || {};

    if (isActive) {
      await prisma.smtpConfig.updateMany({ data: { isActive: false } });
    }

    const config = await prisma.smtpConfig.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        provider: provider ?? existing.provider,
        host: host ?? existing.host,
        port: port !== undefined ? Number(port) || 587 : existing.port,
        secure: secure !== undefined ? !!secure : existing.secure,
        username: username !== undefined ? username || null : existing.username,
        password: password !== undefined ? password || null : existing.password,
        fromName: fromName !== undefined ? fromName || null : existing.fromName,
        fromEmail: fromEmail ?? existing.fromEmail,
        replyTo: replyTo !== undefined ? replyTo || null : existing.replyTo,
        tlsRejectUnauthorized:
          tlsRejectUnauthorized !== undefined ? !!tlsRejectUnauthorized : existing.tlsRejectUnauthorized,
        tlsCaText: tlsCaText !== undefined ? tlsCaText || null : existing.tlsCaText,
        isActive: isActive !== undefined ? !!isActive : existing.isActive
      }
    });

    res.json({ config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

router.delete('/configs/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.smtpConfig.delete({ where: { id } });
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.get('/templates', async (req, res, next) => {
  try {
    const templates = await prisma.emailTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

router.post('/templates', async (req, res, next) => {
  try {
    const { name, subject, preheader, html, design } = req.body || {};
    if (!name || !subject || !html) {
      return res.status(400).json({ message: 'name, subject and html are required' });
    }
    const template = await prisma.emailTemplate.create({
      data: {
        name,
        subject,
        preheader: preheader || null,
        html,
        design: design ?? null
      }
    });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

router.put('/templates/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.emailTemplate.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Template not found' });
    }
    const { name, subject, preheader, html, design } = req.body || {};
    const template = await prisma.emailTemplate.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        subject: subject ?? existing.subject,
        preheader: preheader !== undefined ? preheader || null : existing.preheader,
        html: html ?? existing.html,
        design: design !== undefined ? design : existing.design
      }
    });
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

router.delete('/templates/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.emailTemplate.delete({ where: { id } });
    res.json({ status: 'removed' });
  } catch (err) {
    next(err);
  }
});

router.post('/send', async (req, res, next) => {
  try {
    const info = await sendEmail(req.body || {});
    res.json({ status: 'sent', messageId: info.messageId });
  } catch (err) {
    next(err);
  }
});

router.post('/test', async (req, res, next) => {
  try {
    const info = await sendEmail(req.body || {});
    res.json({ status: 'sent', messageId: info.messageId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
