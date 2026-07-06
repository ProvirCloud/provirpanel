'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const GATEWAY_URL = process.env.ZEUS_GATEWAY_URL || '';
const GATEWAY_API_KEY = process.env.ZEUS_API_KEY || '';

const collectionName = (ws, co, pr) =>
  `${ws}_${co}_${pr}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

// ─── Workspaces ───────────────────────────────────────────────────────────────

router.get('/workspaces', async (req, res, next) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      include: {
        companies: {
          include: { projects: true, childPanel: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ workspaces });
  } catch (err) { next(err); }
});

router.post('/workspaces', async (req, res, next) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) return res.status(400).json({ message: 'name e slug são obrigatórios' });
    const workspace = await prisma.workspace.create({ data: { name, slug: slug.toLowerCase() } });
    res.status(201).json({ workspace });
  } catch (err) { next(err); }
});

router.delete('/workspaces/:id', async (req, res, next) => {
  try {
    await prisma.workspace.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Companies ────────────────────────────────────────────────────────────────

router.get('/workspaces/:workspaceId/companies', async (req, res, next) => {
  try {
    const companies = await prisma.company.findMany({
      where: { workspaceId: req.params.workspaceId },
      include: { projects: true, childPanel: true },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ companies });
  } catch (err) { next(err); }
});

router.post('/workspaces/:workspaceId/companies', async (req, res, next) => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) return res.status(400).json({ message: 'name e slug são obrigatórios' });
    const company = await prisma.company.create({
      data: { name, slug: slug.toLowerCase(), workspaceId: req.params.workspaceId },
      include: { projects: true, childPanel: true }
    });
    res.status(201).json({ company });
  } catch (err) { next(err); }
});

router.delete('/workspaces/:workspaceId/companies/:id', async (req, res, next) => {
  try {
    await prisma.company.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Projects ─────────────────────────────────────────────────────────────────

router.get('/companies/:companyId/projects', async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      where: { companyId: req.params.companyId },
      orderBy: { createdAt: 'asc' }
    });
    res.json({ projects });
  } catch (err) { next(err); }
});

router.post('/companies/:companyId/projects', async (req, res, next) => {
  try {
    const { name, slug, gitUrl, gitBranch } = req.body;
    if (!name || !slug) return res.status(400).json({ message: 'name e slug são obrigatórios' });
    const project = await prisma.project.create({
      data: { name, slug: slug.toLowerCase(), companyId: req.params.companyId, gitUrl, gitBranch: gitBranch || 'main' }
    });
    res.status(201).json({ project });
  } catch (err) { next(err); }
});

router.delete('/companies/:companyId/projects/:id', async (req, res, next) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Invite ───────────────────────────────────────────────────────────────────

router.post('/workspaces/:workspaceId/companies/:companyId/invite', async (req, res, next) => {
  try {
    const { workspaceId, companyId } = req.params;
    const panelUrl = process.env.PROVIRPANEL_PUBLIC_URL || '';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const token = jwt.sign({ workspaceId, companyId, panelUrl }, JWT_SECRET, { expiresIn: '24h' });
    await prisma.workspaceInvite.create({ data: { token, workspaceId, companyId, expiresAt } });
    res.json({ token, expiresAt });
  } catch (err) { next(err); }
});

// ─── Child Panels ─────────────────────────────────────────────────────────────

router.get('/workspaces/:workspaceId/children', async (req, res, next) => {
  try {
    const companies = await prisma.company.findMany({
      where: { workspaceId: req.params.workspaceId },
      include: { childPanel: true }
    });
    const children = companies.filter(c => c.childPanel).map(c => ({ ...c.childPanel, companyName: c.name, companySlug: c.slug }));
    res.json({ children });
  } catch (err) { next(err); }
});

router.delete('/children/:id/revoke', async (req, res, next) => {
  try {
    await prisma.childPanel.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Handshake (chamado pelo filho) ──────────────────────────────────────────

// This endpoint is called ON the parent panel (the one that generated the invite)
router.post('/child/connect', async (req, res, next) => {
  try {
    const { token, panelName, panelUrl } = req.body;
    if (!token || !panelName || !panelUrl) return res.status(400).json({ message: 'token, panelName e panelUrl são obrigatórios' });

    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); }
    catch { return res.status(401).json({ message: 'Token inválido ou expirado' }); }

    const invite = await prisma.workspaceInvite.findUnique({ where: { token } });
    if (!invite) return res.status(404).json({ message: 'Convite não encontrado' });
    if (invite.usedAt) return res.status(409).json({ message: 'Token já utilizado' });
    if (invite.expiresAt < new Date()) return res.status(410).json({ message: 'Token expirado' });

    await prisma.workspaceInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });

    const apiKey = crypto.randomBytes(32).toString('hex');
    const childPanel = await prisma.childPanel.upsert({
      where: { companyId: invite.companyId },
      update: { name: panelName, url: panelUrl, apiKey, revokedAt: null },
      create: { name: panelName, url: panelUrl, companyId: invite.companyId, apiKey }
    });

    const company = await prisma.company.findUnique({
      where: { id: invite.companyId },
      include: { workspace: true }
    });

    res.json({
      workspaceSlug: company.workspace.slug,
      companySlug: company.slug,
      gatewayUrl: GATEWAY_URL,
      gatewayApiKey: GATEWAY_API_KEY,
      childPanelId: childPanel.id
    });
  } catch (err) { next(err); }
});

// This endpoint is called ON the child panel — it proxies the connect to the parent
router.post('/child/connect-remote', async (req, res, next) => {
  try {
    const { token, panelName, panelUrl } = req.body;
    if (!token) return res.status(400).json({ message: 'token é obrigatório' });

    // Decode token (without verifying — the parent will verify)
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.panelUrl) {
      return res.status(400).json({ message: 'Token inválido — não contém panelUrl do pai' });
    }

    const parentUrl = decoded.panelUrl.replace(/\/$/, '');
    const myName = panelName || process.env.ZEUS_PANEL_NAME || 'Unknown';
    const myUrl = panelUrl || process.env.PROVIRPANEL_PUBLIC_URL || '';

    // Forward handshake to parent panel
    const response = await fetch(`${parentUrl}/api/child/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, panelName: myName, panelUrl: myUrl }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: `Parent returned ${response.status}` }));
      return res.status(response.status).json(err);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) { next(err); }
});

// ─── Listar todos os projetos (para selects) ──────────────────────────────────

router.get('/workspaces/projects/all', async (req, res, next) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      include: { companies: { include: { projects: true } } },
      orderBy: { name: 'asc' }
    });
    const projects = [];
    for (const ws of workspaces) {
      for (const co of ws.companies) {
        for (const pr of co.projects) {
          projects.push({
            id: pr.id,
            label: `${ws.name} › ${co.name} › ${pr.name}`,
            collection: collectionName(ws.slug, co.slug, pr.slug),
            workspaceSlug: ws.slug,
            companySlug: co.slug,
            projectSlug: pr.slug
          });
        }
      }
    }
    res.json({ projects });
  } catch (err) { next(err); }
});

module.exports = router;
