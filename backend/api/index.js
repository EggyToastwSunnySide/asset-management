const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { notFound, errorHandler } = require('./errors');
const { authenticate, noStore, requireCsrf } = require('./middleware/auth');
const { cors } = require('./middleware/origin');
const { protectedApiRateLimit } = require('./middleware/rateLimits');
const openapi = require('./openapi');
const authRoutes = require('./routes/auth');

const router = express.Router();

const PUBLIC_ROUTES = [
  ['/health', require('./routes/health')],
  ['/auth', authRoutes.publicRouter],
];

const PROTECTED_ROUTES = [
  ['/auth', authRoutes.protectedRouter],
  ['/reference-data', require('./routes/referenceData')],
  ['/asset-types', require('./routes/assetTypes')],
  ['/assets', require('./routes/assets')],
  ['/export-profiles', require('./routes/exportProfiles')],
  ['/exports', require('./routes/exports')],
  ['/permissions', require('./routes/permissions')],
  ['/roles', require('./routes/roles')],
  ['/users', require('./routes/users')],
];

const ROUTES = [...PUBLIC_ROUTES, ...PROTECTED_ROUTES];

router.use(cors);

// API documentation is explicitly public. Swagger UI fetches the document
// instead of inlining it because replacement patterns in descriptions can
// otherwise corrupt the generated script.
router.get('/openapi.json', (req, res) => res.json(openapi));
router.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerUrl: '../openapi.json',
    customSiteTitle: 'Asset Management API',
    swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true, withCredentials: true },
  }),
);

// Parse API JSON here so malformed bodies always use the JSON error envelope.
router.use(express.json({ limit: '1mb' }));
for (const [path, handler] of PUBLIC_ROUTES) router.use(path, handler);

// Deny by default below the explicit public allowlist. Every unsafe protected
// method passes the central approved-origin and CSRF check before route logic.
router.use(noStore);
router.use(authenticate);
router.use(protectedApiRateLimit);
router.use(requireCsrf);
for (const [path, handler] of PROTECTED_ROUTES) router.use(path, handler);

router.use(notFound);
router.use(errorHandler);

module.exports = router;
module.exports.PUBLIC_ROUTES = PUBLIC_ROUTES;
module.exports.PROTECTED_ROUTES = PROTECTED_ROUTES;
module.exports.ROUTES = ROUTES;
