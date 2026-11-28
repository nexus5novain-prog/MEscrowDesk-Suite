'use strict';

const Module = require('module');
const origRequire = Module.prototype.require;

const { PLAINAPP_SECTION, PLAINAPP_PANEL_ENTRY } = require('./plainapp-nav-catalog.cjs');
const plainAppRoutes = require('./plainapp-routes.cjs');

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildUx35PlainAppSidebarHtml(currentHref) {
    let lastGroup = '';
    const itemsHtml = PLAINAPP_SECTION.pages.map((p) => {
        let groupHtml = '';
        if (p.group && p.group !== lastGroup) {
            lastGroup = p.group;
            groupHtml = `<div style="padding:8px 14px 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.55;font-weight:600;">${escapeHtml(p.group)}</div>`;
        }
        const isActive = currentHref === p.href;
        return `${groupHtml}<a href="${escapeHtml(p.href)}" class="ux35-sidebar-item${isActive ? ' active' : ''}" data-plainapp-nav="${escapeHtml(p.page)}"><span class="material-icons" aria-hidden="true">${escapeHtml(p.icon)}</span><span>${escapeHtml(p.label)}</span></a>`;
    }).join('\n');

    return `
        <!-- MindConnect Desk Control -->
        <div class="ux35-sidebar-section" data-panel="plainapp">
            <button type="button" class="ux35-sidebar-heading ux35-sidebar-heading-toggle" data-section-toggle="plainapp" aria-expanded="true">
                <span>MindConnect Desk Control</span>
                <span class="material-icons ux35-section-chevron" aria-hidden="true">expand_less</span>
            </button>
            ${itemsHtml}
        </div>
    `;
}

Module.prototype.require = function (id) {
    const res = origRequire.apply(this, arguments);

    try {
        if (typeof id === 'string') {
            // 0. Hook express.response.render globally so UX 3.5 sidebar gets PlainApp Control on every page
            if (id === 'express' && res && res.response && !res.response.__plainAppRenderPatched) {
                res.response.__plainAppRenderPatched = true;
                const origRender = res.response.render;
                res.response.render = function (view, options, callback) {
                    const resObj = this;
                    const reqObj = this.req;
                    if (typeof options === 'function') {
                        callback = options;
                        options = {};
                    }
                    const wrappedCb = function (err, html) {
                        if (err) {
                            if (typeof callback === 'function') return callback(err);
                            return reqObj && reqObj.next ? reqObj.next(err) : resObj.status(500).send(err.message);
                        }
                        let out = html;
                        if (
                            typeof out === 'string' &&
                            out.includes('id="ux35-sidebar-nav"') &&
                            !out.includes('data-panel="plainapp"')
                        ) {
                            const hasAccess = typeof resObj.locals?.hasSectionAccess === 'function'
                                ? resObj.locals.hasSectionAccess('plainapp', 'read')
                                : true;
                            if (hasAccess) {
                                const navStart = out.indexOf('id="ux35-sidebar-nav"');
                                const markerIdx = out.indexOf('</nav>', navStart);
                                if (markerIdx !== -1) {
                                    const sectionHtml = buildUx35PlainAppSidebarHtml(reqObj ? reqObj.path : '');
                                    out = out.slice(0, markerIdx) + sectionHtml + out.slice(markerIdx);
                                }
                            }
                        }
                        if (typeof callback === 'function') return callback(null, out);
                        return resObj.send(out);
                    };
                    return origRender.call(resObj, view, options, wrappedCb);
                };
                console.log('[PlainAppHook] Attached global UX 3.5 sidebar injector to express.response.render');
            }

            // 1. Hook consoleNav.js (UX 3.6 sidebar & Ctrl+K search)
            if (id.endsWith('consoleNav.js') || id.endsWith('consoleNav')) {
                if (res && Array.isArray(res.SECTIONS)) {
                    if (!res.SECTIONS.some(s => s.id === 'plainapp')) {
                        res.SECTIONS.push(PLAINAPP_SECTION);
                        console.log('[PlainAppHook] Attached PlainApp Control section to consoleNav.SECTIONS');
                    }
                }
            }

            // 2. Hook panelAccessCatalog.js
            if (id.endsWith('panelAccessCatalog.js') || id.endsWith('panelAccessCatalog')) {
                if (res && res.getCatalogEntry) {
                    const origGet = res.getCatalogEntry;
                    res.getCatalogEntry = function (key) {
                        if (key === 'plainapp') return PLAINAPP_PANEL_ENTRY;
                        return origGet.apply(this, arguments);
                    };
                    const origPanelCatalog = res.panelCatalog;
                    res.panelCatalog = function () {
                        const cat = origPanelCatalog.apply(this, arguments);
                        if (cat && Array.isArray(cat.sections)) {
                            if (!cat.sections.some(s => s.key === 'plainapp')) {
                                cat.sections.push(PLAINAPP_PANEL_ENTRY);
                            }
                        }
                        return cat;
                    };
                    console.log('[PlainAppHook] Attached PlainApp permissions to panelAccessCatalog');
                }
            }

            // 3. Hook panelAccessPolicyService.js so 'plainapp' maps cleanly alongside 'devices'
            if (id.endsWith('panelAccessPolicyService.js') || id.endsWith('panelAccessPolicyService')) {
                if (res && typeof res.accessAllows === 'function' && !res.__plainAppAccessPatched) {
                    res.__plainAppAccessPatched = true;
                    const origAccessAllows = res.accessAllows;
                    res.accessAllows = function (policy, section, level) {
                        if (section === 'plainapp') {
                            return origAccessAllows(policy, 'devices', level);
                        }
                        return origAccessAllows.apply(this, arguments);
                    };
                    console.log('[PlainAppHook] Attached PlainApp access policy fallback');
                }
            }

            // 4. Hook middleware/panelAccess.js
            if (id.endsWith('panelAccess.js') || id.endsWith('panelAccess')) {
                if (res && Array.isArray(res.ROUTE_RULES)) {
                    if (!res.ROUTE_RULES.some(r => r.section === 'plainapp')) {
                        res.ROUTE_RULES.unshift({ prefix: '/plainapp', section: 'plainapp' });
                        res.ROUTE_RULES.unshift({ prefix: '/api/plainapp', section: 'plainapp' });
                        console.log('[PlainAppHook] Attached PlainApp route rules to panelAccess');
                    }
                }
            }

            // 5. Hook routes/index.js (attach PlainApp router)
            if (id.endsWith('routes/index.js') || id === './routes' || id === '../routes') {
                if (res && typeof res.use === 'function') {
                    res.use('/', plainAppRoutes);
                    console.log('[PlainAppHook] Attached PlainApp router to Express routes');
                }
            }
        }
    } catch (err) {
        console.error('[PlainAppHook] Error applying hook to', id, err.message);
    }

    return res;
};

console.log('[PlainAppHook] Extension hook loaded successfully.');
