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
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Try Gateway-based invite if configured
    if (GATEWAY_URL && GATEWAY_API_KEY) {
      try {
        const gwWorkspaceId = process.env.ZEUS_WORKSPACE_ID || process.env.ZEUS_SCOPE_ID || null;
        if (gwWorkspaceId) {
          const response = await fetch(`${GATEWAY_URL}/api/panels/generate-invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': GATEWAY_API_KEY },
            body: JSON.stringify({ workspaceId: gwWorkspaceId, parentPanelId: process.env.ZEUS_PANEL_ID || null }),
            signal: AbortSignal.timeout(10000)
          });
          if (response.ok) {
            const data = await response.json();
            await prisma.workspaceInvite.create({ data: { token: data.token, workspaceId, companyId, expiresAt } }).catch(() => {});
            return res.json({ token: data.token, expiresAt, workspaceName: data.workspaceName });
          }
        }
      } catch {}
    }

    // Fallback: generate locally
    const panelUrl = process.env.PROVIRPANEL_PUBLIC_URL || '';
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

// ─── Handshake ───────────────────────────────────────────────────────────────

// Called by child panel frontend — handshake goes entirely through Gateway
router.post('/child/connect-remote', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'token é obrigatório' });

    const myName = process.env.ZEUS_PANEL_NAME || 'Unknown';
    const myUrl = process.env.PROVIRPANEL_PUBLIC_URL || '';

    const response = await fetch(`${GATEWAY_URL}/api/panels/proxy-connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': GATEWAY_API_KEY },
      body: JSON.stringify({ token, panelName: myName, panelUrl: myUrl }),
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: `Gateway returned ${response.status}` }));
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
