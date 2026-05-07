const express = require('express');
const path = require('path');
const router = express.Router();
const dashboardModel = require('../models/dashboard');
const { requireAuth } = require('../middleware/auth');

router.get('/list', async (req, res, next) => {
  try {
    const dashboards = await dashboardModel.list();
    res.json(dashboards.map(d => ({
      ...d,
      config: typeof d.config === 'string' ? JSON.parse(d.config) : d.config
    })));
  } catch (err) { next(err); }
});

router.get('/default', async (req, res, next) => {
  try {
    const dashboard = await dashboardModel.getDefault();
    if (!dashboard) return res.status(404).json({ error: 'Ingen standard-dashboard satt' });
    if (!dashboard.is_public) {
      const token = req.cookies && req.cookies.session_token;
      const { getSession } = require('../services/auth');
      if (!token || !getSession(token)) {
        return res.status(401).json({ error: 'Denna dashboard kräver inloggning' });
      }
    }
    await dashboardModel.resolveMapMarkers(dashboard.widgets);
    res.json(dashboard);
  } catch (err) { next(err); }
});

router.get('/slug/:slug', async (req, res, next) => {
  try {
    const dashboard = await dashboardModel.getBySlug(req.params.slug);
    if (!dashboard) return res.status(404).json({ error: 'Dashboard hittades inte' });
    if (!dashboard.is_public) {
      const token = req.cookies && req.cookies.session_token;
      const { getSession } = require('../services/auth');
      if (!token || !getSession(token)) {
        return res.status(401).json({ error: 'Denna dashboard kräver inloggning' });
      }
    }
    const widgets = await dashboardModel.getWidgets(dashboard.id);
    await dashboardModel.resolveMapMarkers(widgets);
    res.json({ ...dashboard, widgets });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const dashboard = await dashboardModel.getById(req.params.id);
    if (!dashboard) return res.status(404).json({ error: 'Hittades inte' });
    const widgets = await dashboardModel.getWidgets(dashboard.id);
    await dashboardModel.resolveMapMarkers(widgets);
    res.json({ ...dashboard, widgets });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, is_public } = req.body;
    if (!name) return res.status(400).json({ error: 'Namn krävs' });
    const dashboard = await dashboardModel.create({ name, description, is_public });
    res.status(201).json(dashboard);
  } catch (err) { next(err); }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const dashboard = await dashboardModel.update(req.params.id, req.body);
    if (!dashboard) return res.status(404).json({ error: 'Hittades inte' });
    res.json(dashboard);
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await dashboardModel.remove(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:id/set-default', requireAuth, async (req, res, next) => {
  try {
    await dashboardModel.setDefault(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/:id/widgets', requireAuth, async (req, res, next) => {
  try {
    const { title, widget_type, connection_id, tag_id, config, position } = req.body;
    if (!title || !widget_type) return res.status(400).json({ error: 'Titel och widget-typ krävs' });
    const widget = await dashboardModel.addWidget(req.params.id, { title, widget_type, connection_id, tag_id, config, position });
    res.status(201).json(widget);
  } catch (err) { next(err); }
});

router.put('/widgets/:widgetId', requireAuth, async (req, res, next) => {
  try {
    await dashboardModel.updateWidget(req.params.widgetId, req.body);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/widgets/:widgetId', requireAuth, async (req, res, next) => {
  try {
    await dashboardModel.removeWidget(req.params.widgetId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/history/:source', async (req, res, next) => {
  try {
    const minutes = req.query.minutes || 60;
    const rows = await dashboardModel.getHistoryBySource(req.params.source, minutes);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
