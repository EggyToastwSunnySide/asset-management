const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { notFound, errorHandler } = require('./errors');
const openapi = require('./openapi');

const router = express.Router();

// JSON API mounted at /api. The nginx gateway forwards /api/* here unchanged,
// so these paths are the public ones.
const ROUTES = [
  ['/health', require('./routes/health')],
  ['/reference-data', require('./routes/referenceData')],
  ['/asset-types', require('./routes/assetTypes')],
  ['/assets', require('./routes/assets')],
  ['/export-profiles', require('./routes/exportProfiles')],
  ['/exports', require('./routes/exports')],
];

// API documentation: the OpenAPI document and Swagger UI rendering it.
router.get('/openapi.json', (req, res) => res.json(openapi));
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    customSiteTitle: 'Asset Management API',
    swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true },
  }),
);

// Parsed here rather than app-wide so a malformed body reaches this router's
// JSON error handler instead of the scaffold's HTML error page.
router.use(express.json({ limit: '1mb' }));

for (const [path, handler] of ROUTES) router.use(path, handler);

// Anything else under /api answers in JSON, never with the HTML error page.
router.use(notFound);
router.use(errorHandler);

module.exports = router;
module.exports.ROUTES = ROUTES;
