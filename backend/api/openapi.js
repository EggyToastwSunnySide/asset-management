/**
 * OpenAPI 3.1 description of the /api surface, served as JSON at
 * /api/openapi.json and rendered by Swagger UI at /api/docs.
 *
 * Enumerations and limits are imported from the DTO modules that enforce
 * them, so the documentation cannot drift from validation. test/openapi.test.js
 * checks that every mounted route is documented and every documented route exists.
 */

const config = require('../config');
const {
  SORT_KEYS,
  SORT_DIRECTIONS,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  FILTER_FIELDS,
} = require('./dto/assets.dto');
const {
  EXPORT_FIELDS,
  DEFAULT_LABELS,
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
} = require('./dto/exportParams.dto');
const { ATTRIBUTE_DATA_TYPES } = require('./dto/assetTypes.dto');

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const response = (name) => ({ $ref: `#/components/responses/${name}` });
const json = (schema, example) => ({
  'application/json': example === undefined ? { schema } : { schema, example },
});

const code = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,32}$', examples: ['LAPTOP'] };
const codeList = {
  oneOf: [code, { type: 'array', items: code, maxItems: 50 }],
  description: 'One code or an array of codes.',
};

// Inlined, not a components $ref: as a path-level $ref, Swagger UI 5 (OAS 3.1) left
// it unresolved on GET /asset-types/{code}, so `{code}` could not be filled in.
const assetTypeCodeParameter = {
  name: 'code',
  in: 'path',
  required: true,
  description: 'Asset type code, case-insensitive',
  schema: code,
};

const attributeKeyParameter = {
  name: 'key',
  in: 'path',
  required: true,
  description: 'Attribute key, matched exactly',
  schema: { type: 'string', pattern: '^[a-z][a-z0-9_]*$', maxLength: 32, examples: ['screen_size'] },
};

// US18-T5. Enforcement on asset save arrives with US18-T6.
const IS_REQUIRED_DESCRIPTION =
  'Whether assets of this type must have a value. Setting or changing it never rewrites stored values: the rule applies from the next save of an asset, and only while the attribute is active.';

const FILTER_DESCRIPTIONS = {
  type: 'Asset type code',
  status: 'Asset status code',
  location: 'Location code',
};

// Query parameters for the list; the export body carries the same filters.
const filterParameters = [
  {
    name: 'search',
    in: 'query',
    description: 'Case-insensitive substring match on asset tag or name. `%` and `_` match literally.',
    schema: { type: 'string', maxLength: 100 },
  },
  ...FILTER_FIELDS.flatMap((field) => [
    {
      name: field,
      in: 'query',
      description: `${FILTER_DESCRIPTIONS[field]}. Repeat to match any of several (\`${field}=A&${field}=B\`).`,
      schema: { type: 'array', items: code },
      style: 'form',
      explode: true,
    },
    {
      name: `${field}Not`,
      in: 'query',
      description: `Exclude these ${FILTER_DESCRIPTIONS[field].toLowerCase()}s. Repeatable; every exclusion applies.`,
      schema: { type: 'array', items: code },
      style: 'form',
      explode: true,
    },
  ]),
];

const exampleAsset = {
  id: '0acaf75d-4f35-4689-ab16-4b1d01296c9a',
  tag: 'LAP-1001',
  name: 'Dell Latitude 5440',
  type: 'LAPTOP',
  typeName: 'Máy tính xách tay',
  status: 'AVAILABLE',
  statusName: 'Sẵn sàng',
  location: 'HQ',
  locationName: 'Trụ sở chính',
  purchaseDate: '2024-02-14',
  notes: null,
  extendedAttributes: { ram_gb: 16, warranty_end: '2027-02-14' },
  createdAt: '2026-09-24T04:47:45.647Z',
  updatedAt: '2026-09-24T04:47:45.647Z',
};

const exampleProfile = {
  id: '2828c1e1-adca-4cd8-9890-58ac197f808f',
  name: 'Monthly IT report',
  dateFormat: 'DD/MM/YYYY',
  columns: [
    { key: 'tag', label: 'Asset tag', included: true },
    { key: 'name', label: 'Name', included: true },
    { key: 'purchaseDate', label: 'Bought on', included: true },
    { key: 'type', label: 'Type', included: false },
    { key: 'status', label: 'Status', included: false },
    { key: 'location', label: 'Location', included: false },
  ],
  createdAt: '2026-09-24T04:47:45.647Z',
  updatedAt: '2026-09-24T04:47:45.647Z',
};

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Asset Management API',
    version: '1.0.0',
    description: [
      'Asset register (S-01, S-02), Excel export (S-03) and saved export profiles (S-04).',
      '',
      '**Conventions**',
      '- Type, status and location are reference-data **codes** (see `GET /reference-data`); responses also carry display names.',
      '- Deleted assets are soft-deleted (ADR-0002): they 404 by id, never list, never export, and can be restored.',
      '- Every error uses one envelope: `{ "error": { "code", "message", "fields"? } }`. `fields` maps request fields to messages (ADR-0005).',
      '- Cookie authentication is required by default. Only health, API documentation and sign-in are public.',
      '- Unsafe protected requests require the `X-CSRF-Token` returned by sign-in or session bootstrap and an approved `Origin`.',
      '- Role permissions are evaluated from the database on every authenticated request. Export profiles remain private to their owner.',
    ].join('\n'),
  },
  // Relative, so "Try it out" works via the nginx gateway, the Vite proxy or Express directly.
  servers: [{ url: '/api' }],
  tags: [
    { name: 'System', description: 'Health and reference data' },
    { name: 'Asset types', description: 'US17 create asset types' },
    { name: 'Assets', description: 'S-01 create/read/update/delete, S-02 browse' },
    { name: 'Exports', description: 'S-03 Excel export' },
    { name: 'Export profiles', description: 'S-04 saved export settings' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe',
        description: 'Reports whether the API can reach PostgreSQL.',
        responses: {
          200: { description: 'API and database are up', content: json(ref('Health')) },
          503: { description: 'Database unreachable', content: json(ref('Health')) },
        },
      },
    },
    '/reference-data': {
      get: {
        tags: ['System'],
        summary: 'Codes for type, status and location',
        description: 'Active reference rows, for form pickers and filters.',
        responses: {
          200: { description: 'Reference data', content: json(ref('ReferenceData')) },
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/asset-types': {
      post: {
        tags: ['Asset types'],
        summary: 'Create an asset type',
        description:
          '`code` is trimmed and upper-cased, then must match `^[A-Z0-9_-]+$`. The new type is listed by `GET /reference-data`.',
        requestBody: {
          required: true,
          content: json(ref('AssetTypeInput'), { code: 'TABLET', name: 'Máy tính bảng' }),
        },
        responses: {
          201: { description: 'Created', content: json(ref('ReferenceItem'), { code: 'TABLET', name: 'Máy tính bảng' }) },
          400: response('BadRequest'),
          409: {
            description:
              'Code already in use (`DUPLICATE_CODE`, `fields.code`), or name already in use ignoring case and surrounding spaces (`DUPLICATE_NAME`, `fields.name`).',
            content: json(ref('Error'), {
              error: {
                code: 'DUPLICATE_CODE',
                message: 'Asset type code "LAPTOP" is already in use.',
                fields: { code: 'Asset type code "LAPTOP" is already in use.' },
              },
            }),
          },
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/asset-types/{code}': {
      parameters: [assetTypeCodeParameter],
      get: {
        tags: ['Asset types'],
        summary: 'Read an asset type with its custom attributes',
        description: 'Attributes are in creation order. Inactive types are not found.',
        parameters: [{ $ref: '#/components/parameters/IncludeInactive' }],
        responses: {
          200: {
            description: 'The type',
            content: json(ref('AssetTypeDetail'), {
              code: 'LAPTOP',
              name: 'Laptop',
              attributes: [{ key: 'screen_size', label: 'Screen size', dataType: 'number', isRequired: true, isActive: true }],
            }),
          },
          404: response('NotFound'),
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/asset-types/{code}/attributes': {
      parameters: [assetTypeCodeParameter],
      get: {
        tags: ['Asset types'],
        summary: "List an asset type's custom attributes",
        description: 'The `attributes` of `GET /asset-types/{code}`, in creation order.',
        parameters: [{ $ref: '#/components/parameters/IncludeInactive' }],
        responses: {
          200: { description: 'The attributes', content: json({ type: 'array', items: ref('Attribute') }) },
          404: response('NotFound'),
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
      post: {
        tags: ['Asset types'],
        summary: 'Add a custom attribute to an asset type',
        description:
          '`key` is trimmed, then must match `^[a-z][a-z0-9_]*$`; it is not lower-cased for you. Keys are unique per type and never reused, even after the attribute is hidden. Only active types take new attributes.',
        requestBody: {
          required: true,
          content: json(ref('AttributeInput'), { key: 'screen_size', label: 'Screen size', dataType: 'number', isRequired: true }),
        },
        responses: {
          201: {
            description: 'Created',
            content: json(ref('Attribute'), {
              key: 'screen_size',
              label: 'Screen size',
              dataType: 'number',
              isRequired: true,
              isActive: true,
            }),
          },
          400: response('BadRequest'),
          404: response('NotFound'),
          409: {
            description: 'Key already used on this type, by an active or a hidden attribute (`DUPLICATE_KEY`, `fields.key`).',
            content: json(ref('Error'), {
              error: {
                code: 'DUPLICATE_KEY',
                message:
                  'Attribute key "screen_size" is already used on this asset type, possibly by a hidden attribute. Keys cannot be reused.',
                fields: {
                  key: 'Attribute key "screen_size" is already used on this asset type, possibly by a hidden attribute. Keys cannot be reused.',
                },
              },
            }),
          },
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/asset-types/{code}/attributes/{key}': {
      parameters: [assetTypeCodeParameter, attributeKeyParameter],
      put: {
        tags: ['Asset types'],
        summary: 'Edit a custom attribute',
        description: [
          'Replaces `label`, `dataType` and `isRequired`; hidden attributes can be edited too. The key never changes:',
          'it may be sent back unchanged, but a different `key` is a 422 under `fields.key`. The data type can only change',
          'while no asset of this type, deleted ones included, holds a value for the key.',
          'Changing `isRequired` leaves stored values untouched; the rule applies from the next save of an asset, active attributes only.',
        ].join(' '),
        requestBody: {
          required: true,
          content: json(ref('AttributeUpdate'), { label: 'Screen size (inches)', dataType: 'number', isRequired: true }),
        },
        responses: {
          200: {
            description: 'The edited attribute',
            content: json(ref('Attribute'), {
              key: 'screen_size',
              label: 'Screen size (inches)',
              dataType: 'number',
              isRequired: true,
              isActive: true,
            }),
          },
          400: response('BadRequest'),
          404: response('NotFound'),
          409: {
            description: 'Assets of this type hold values for the key, so its data type is locked (`DATA_TYPE_LOCKED`, `fields.dataType`).',
            content: json(ref('Error'), {
              error: {
                code: 'DATA_TYPE_LOCKED',
                message:
                  'The data type cannot be changed: 3 assets of this type, deleted ones included, already hold a value for "screen_size".',
                fields: {
                  dataType:
                    'The data type cannot be changed: 3 assets of this type, deleted ones included, already hold a value for "screen_size".',
                },
              },
            }),
          },
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
      delete: {
        tags: ['Asset types'],
        summary: 'Hide a custom attribute',
        description:
          'Sets `isActive` to false. The attribute and every asset value for it are kept, and its key stays reserved. Hiding a hidden attribute is a no-op.',
        responses: {
          204: { description: 'Hidden' },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/asset-types/{code}/attributes/{key}/restore': {
      parameters: [assetTypeCodeParameter, attributeKeyParameter],
      post: {
        tags: ['Asset types'],
        summary: 'Restore a hidden custom attribute',
        description: 'Sets `isActive` back to true; asset values kept while it was hidden show again. Restoring a visible attribute is a no-op.',
        responses: {
          200: { description: 'The restored attribute', content: json(ref('Attribute')) },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/assets': {
      get: {
        tags: ['Assets'],
        summary: 'List assets (paged, filtered, sorted)',
        description: 'Offset/limit paging with a total count (ADR-0003). Deleted assets are excluded.',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
          },
          {
            name: 'sort',
            in: 'query',
            description: '`type`, `status` and `location` sort by display name. Ties break by tag.',
            schema: { type: 'string', enum: SORT_KEYS, default: 'tag' },
          },
          { name: 'direction', in: 'query', schema: { type: 'string', enum: SORT_DIRECTIONS, default: 'asc' } },
          ...filterParameters,
        ],
        responses: {
          200: { description: 'One page of assets', content: json(ref('AssetPage')) },
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
      post: {
        tags: ['Assets'],
        summary: 'Create an asset',
        requestBody: {
          required: true,
          content: json(ref('AssetCreate'), {
            tag: 'LAP-1001',
            name: 'Dell Latitude 5440',
            type: 'LAPTOP',
            status: 'AVAILABLE',
            location: 'HQ',
            purchaseDate: '2024-02-14',
          }),
        },
        responses: {
          201: {
            description: 'Created',
            headers: { Location: { schema: { type: 'string' }, description: 'URL of the new asset' } },
            content: json(ref('Asset'), exampleAsset),
          },
          400: response('BadRequest'),
          409: {
            description:
              'Tag already in use (`DUPLICATE_TAG`). Tags are unique case-insensitively and are never reused, even by a deleted asset.',
            content: json(ref('Error'), {
              error: {
                code: 'DUPLICATE_TAG',
                message: 'Asset tag "LAP-1001" is already in use.',
                fields: { tag: 'Asset tag "LAP-1001" is already in use.' },
              },
            }),
          },
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/assets/{id}': {
      parameters: [{ $ref: '#/components/parameters/AssetId' }],
      get: {
        tags: ['Assets'],
        summary: 'Read an asset',
        responses: {
          200: { description: 'The asset', content: json(ref('Asset'), exampleAsset) },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
      put: {
        tags: ['Assets'],
        summary: 'Replace an asset (last write wins)',
        description:
          'Full replacement; no version check (ADR-0004). `tag` may be sent back unchanged but cannot be changed. ' +
          '`extendedAttributes` replaces the values of active attributes; hidden attributes keep their stored values ' +
          'whatever is sent. Changing `type` drops every value stored for the old type (recorded on the ' +
          '`updated` asset event as `droppedAttributes`) and validates against the new type.',
        requestBody: { required: true, content: json(ref('AssetUpdate')) },
        responses: {
          200: { description: 'Updated', content: json(ref('Asset')) },
          400: response('BadRequest'),
          404: response('NotFound'),
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
      delete: {
        tags: ['Assets'],
        summary: 'Delete an asset (soft)',
        description: 'Sets `deleted_at` (ADR-0002). Deleting an already-deleted asset is a 404.',
        responses: {
          204: { description: 'Deleted' },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/assets/{id}/restore': {
      parameters: [{ $ref: '#/components/parameters/AssetId' }],
      post: {
        tags: ['Assets'],
        summary: 'Restore a deleted asset',
        description: 'Clears `deleted_at`. Restoring an asset that is not deleted is a no-op, so an undo can repeat safely.',
        responses: {
          200: { description: 'The restored asset', content: json(ref('Asset')) },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/exports/assets': {
      post: {
        tags: ['Exports'],
        summary: 'Export assets to .xlsx',
        description: [
          'Every asset matching `filters`, in `sort` order, across all pages (ADR-0008), built on the server (ADR-0006)',
          'and returned in the response body (ADR-0007). The request fully describes the file (ADR-0011): to use a saved',
          'profile, copy its `columns` and `dateFormat` into the body. Dates are real date cells.',
        ].join(' '),
        requestBody: {
          required: false,
          content: json(ref('ExportRequest'), {
            filters: { search: 'LAP', status: ['AVAILABLE'], locationNot: ['WAREHOUSE'] },
            sort: { key: 'purchaseDate', direction: 'desc' },
            columns: [
              { key: 'tag', label: 'Asset tag', included: true },
              { key: 'purchaseDate', label: 'Bought on', included: true },
            ],
            dateFormat: 'YYYY-MM-DD',
          }),
        },
        responses: {
          200: {
            description: 'The workbook',
            headers: {
              'Content-Disposition': {
                schema: { type: 'string' },
                description: 'attachment; filename="inventory-export-YYYY-MM-DD.xlsx"',
              },
              'X-Export-Row-Count': { schema: { type: 'integer' }, description: 'Number of asset rows in the file' },
            },
            content: {
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          400: response('BadRequest'),
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/export-profiles': {
      get: {
        tags: ['Export profiles'],
        summary: "List the caller's profiles",
        description: 'Sorted by name.',
        responses: {
          200: { description: 'Profiles', content: json({ type: 'array', items: ref('ExportProfile') }) },
          503: response('DatabaseUnavailable'),
        },
      },
      post: {
        tags: ['Export profiles'],
        summary: 'Save a profile',
        requestBody: { required: true, content: json(ref('ExportProfileInput')) },
        responses: {
          201: {
            description: 'Created',
            headers: { Location: { schema: { type: 'string' } } },
            content: json(ref('ExportProfile'), exampleProfile),
          },
          400: response('BadRequest'),
          409: response('DuplicateName'),
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
    '/export-profiles/{id}': {
      parameters: [{ $ref: '#/components/parameters/ProfileId' }],
      get: {
        tags: ['Export profiles'],
        summary: 'Read a profile',
        responses: {
          200: { description: 'The profile', content: json(ref('ExportProfile'), exampleProfile) },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
      put: {
        tags: ['Export profiles'],
        summary: 'Replace a profile',
        requestBody: { required: true, content: json(ref('ExportProfileInput')) },
        responses: {
          200: { description: 'Updated', content: json(ref('ExportProfile')) },
          400: response('BadRequest'),
          404: response('NotFound'),
          409: response('DuplicateName'),
          422: response('ValidationFailed'),
          503: response('DatabaseUnavailable'),
        },
      },
      delete: {
        tags: ['Export profiles'],
        summary: 'Delete a profile',
        description: 'Hard delete; the name becomes free for reuse.',
        responses: {
          204: { description: 'Deleted' },
          404: response('NotFound'),
          503: response('DatabaseUnavailable'),
        },
      },
    },
  },
  components: {
    parameters: {
      AssetId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      IncludeInactive: {
        name: 'includeInactive',
        in: 'query',
        description: 'Also return hidden attributes. Only `true` or `false`; any other value is a 422.',
        schema: { type: 'boolean', default: false },
      },
      ProfileId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
    },
    responses: {
      BadRequest: {
        description: 'Body is not valid JSON (`INVALID_JSON`) or not an object (`INVALID_BODY`)',
        content: json(ref('Error'), { error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } }),
      },
      ValidationFailed: {
        description: 'One or more fields are invalid (`VALIDATION_FAILED`); every bad field is listed',
        content: json(ref('Error'), {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Some fields are invalid',
            fields: { purchaseDate: 'Not a real calendar date', type: 'Unknown asset type "SPACESHIP"' },
          },
        }),
      },
      NotFound: {
        description: 'No such resource, or it is deleted / owned by someone else (`NOT_FOUND`)',
        content: json(ref('Error'), { error: { code: 'NOT_FOUND', message: 'Asset not found' } }),
      },
      DuplicateName: {
        description: 'The caller already has a profile with this name, case-insensitively (`DUPLICATE_NAME`)',
        content: json(ref('Error')),
      },
      DatabaseUnavailable: {
        description: 'PostgreSQL is unreachable (`DATABASE_UNAVAILABLE`)',
        content: json(ref('Error')),
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                examples: [
                  'VALIDATION_FAILED',
                  'DUPLICATE_TAG',
                  'DUPLICATE_CODE',
                  'DUPLICATE_NAME',
                  'DUPLICATE_KEY',
                  'NOT_FOUND',
                  'DATABASE_UNAVAILABLE',
                ],
              },
              message: { type: 'string' },
              fields: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description:
                  'Per-field messages keyed by request path, e.g. `tag`, `filters.type`, `columns[1].key`, `extendedAttributes.ram_gb`.',
              },
            },
          },
        },
      },
      Health: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          service: { type: 'string' },
          database: { type: 'string', enum: ['up', 'down'] },
          uptimeSeconds: { type: 'integer' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ReferenceItem: {
        type: 'object',
        required: ['code', 'name'],
        properties: { code: { type: 'string', examples: ['LAPTOP'] }, name: { type: 'string' } },
      },
      AssetTypeInput: {
        type: 'object',
        required: ['code', 'name'],
        additionalProperties: false,
        properties: {
          code: { type: 'string', maxLength: 32, examples: ['TABLET'], description: 'Upper-cased by the server' },
          name: { type: 'string', maxLength: 255 },
        },
      },
      AttributeInput: {
        type: 'object',
        required: ['key', 'label', 'dataType'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', maxLength: 32, pattern: '^[a-z][a-z0-9_]*$', examples: ['screen_size'] },
          label: { type: 'string', maxLength: 255 },
          dataType: { type: 'string', enum: ATTRIBUTE_DATA_TYPES },
          isRequired: { type: 'boolean', default: false, description: IS_REQUIRED_DESCRIPTION },
        },
      },
      AttributeUpdate: {
        type: 'object',
        required: ['label', 'dataType', 'isRequired'],
        additionalProperties: false,
        properties: {
          key: { type: 'string', description: 'Optional; when sent it must equal the path `key`' },
          label: { type: 'string', maxLength: 255 },
          dataType: { type: 'string', enum: ATTRIBUTE_DATA_TYPES },
          isRequired: { type: 'boolean', description: IS_REQUIRED_DESCRIPTION },
        },
      },
      Attribute: {
        type: 'object',
        required: ['key', 'label', 'dataType', 'isRequired', 'isActive'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          dataType: { type: 'string', enum: ATTRIBUTE_DATA_TYPES },
          isRequired: { type: 'boolean', description: IS_REQUIRED_DESCRIPTION },
          isActive: { type: 'boolean', description: 'False once hidden; a hidden attribute keeps its key' },
        },
      },
      AssetTypeDetail: {
        type: 'object',
        required: ['code', 'name', 'attributes'],
        properties: {
          code: { type: 'string', examples: ['LAPTOP'] },
          name: { type: 'string' },
          attributes: { type: 'array', items: ref('Attribute') },
        },
      },
      ReferenceData: {
        type: 'object',
        required: ['types', 'statuses', 'locations'],
        properties: {
          types: { type: 'array', items: ref('ReferenceItem') },
          statuses: { type: 'array', items: ref('ReferenceItem') },
          locations: { type: 'array', items: ref('ReferenceItem') },
        },
      },
      Asset: {
        type: 'object',
        required: [
          'id', 'tag', 'name', 'type', 'typeName', 'status', 'statusName', 'location', 'locationName', 'purchaseDate',
          'extendedAttributes',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          tag: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', description: 'Asset type code' },
          typeName: { type: 'string' },
          status: { type: 'string', description: 'Asset status code' },
          statusName: { type: 'string' },
          location: { type: 'string', description: 'Location code' },
          locationName: { type: 'string' },
          purchaseDate: { type: 'string', format: 'date' },
          notes: { type: ['string', 'null'] },
          extendedAttributes: {
            type: 'object',
            additionalProperties: { type: ['string', 'number', 'boolean'] },
            description: 'Custom attribute values keyed by attribute key, hidden attributes included.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AssetCreate: {
        type: 'object',
        additionalProperties: false,
        required: ['tag', 'name', 'type', 'status', 'location', 'purchaseDate'],
        properties: {
          tag: {
            type: 'string',
            maxLength: 64,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$',
            description: 'Unique case-insensitively; immutable once created.',
          },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          type: { ...code, description: 'Active asset type code' },
          status: { ...code, examples: ['AVAILABLE'], description: 'Active asset status code' },
          location: { ...code, examples: ['HQ'], description: 'Active location code' },
          purchaseDate: { type: 'string', format: 'date', examples: ['2024-02-14'] },
          notes: { type: ['string', 'null'], maxLength: 2000, description: 'Blank is stored as null.' },
          extendedAttributes: {
            type: 'object',
            default: {},
            additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
            examples: [{ ram_gb: 16, warranty_end: '2027-02-14' }],
            description:
              'Values for the active custom attributes of the type, keyed by attribute key. By data type: `text` a string ' +
              'of at most 2000 characters, `number` a JSON number (not a numeric string), `date` a real calendar date ' +
              'as YYYY-MM-DD, `boolean` true or false. A key the type does not define is rejected; a required ' +
              'attribute must be present and non-blank; blank or null leaves an optional one unset. Keys of hidden ' +
              'attributes are ignored. Errors are reported as `fields["extendedAttributes.<key>"]`.',
          },
        },
      },
      AssetUpdate: {
        allOf: [ref('AssetCreate')],
        description: 'As AssetCreate, except `tag` is optional and, if sent, must equal the current tag.',
      },
      AssetPage: {
        type: 'object',
        required: ['items', 'total', 'page', 'pageSize'],
        properties: {
          items: { type: 'array', items: ref('Asset') },
          total: { type: 'integer', description: 'Matches across all pages' },
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
        },
      },
      ExportColumn: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label'],
        properties: {
          key: { type: 'string', enum: EXPORT_FIELDS },
          label: { type: 'string', minLength: 1, maxLength: 100, description: 'Header text in the file' },
          included: { type: 'boolean', default: true },
        },
      },
      ExportColumns: {
        type: 'array',
        items: ref('ExportColumn'),
        minItems: 1,
        maxItems: EXPORT_FIELDS.length,
        description:
          'Array order is column order. Keys must be unique and at least one column must be included. ' +
          'Excluded columns may be listed (the editor state can be sent as-is) or omitted.',
      },
      ExportFilters: {
        type: 'object',
        additionalProperties: false,
        description: 'Same filters and semantics as the list query.',
        properties: {
          search: { type: 'string', maxLength: 100 },
          ...Object.fromEntries(
            FILTER_FIELDS.flatMap((field) => [
              [field, codeList],
              [`${field}Not`, codeList],
            ]),
          ),
        },
      },
      ExportRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          filters: ref('ExportFilters'),
          sort: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', enum: SORT_KEYS, default: 'tag' },
              direction: { type: 'string', enum: SORT_DIRECTIONS, default: 'asc' },
            },
          },
          columns: {
            allOf: [ref('ExportColumns')],
            description:
              'Defaults to every field in screen order: ' +
              EXPORT_FIELDS.map((k) => `${k} ("${DEFAULT_LABELS[k]}")`).join(', ') +
              '.',
          },
          dateFormat: { type: 'string', enum: DATE_FORMATS, default: DEFAULT_DATE_FORMAT },
        },
      },
      ExportProfileInput: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'dateFormat', 'columns'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, description: 'Unique per user, case-insensitively' },
          dateFormat: { type: 'string', enum: DATE_FORMATS },
          columns: ref('ExportColumns'),
        },
      },
      ExportProfile: {
        type: 'object',
        required: ['id', 'name', 'dateFormat', 'columns'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          dateFormat: { type: 'string', enum: DATE_FORMATS },
          columns: {
            type: 'array',
            items: ref('ExportColumn'),
            description:
              'Included columns in saved order, then every excluded field with its default label. ' +
              'Labels of excluded columns are not stored.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

spec.security = [{ cookieAuth: [] }];
spec.tags.push(
  { name: 'Authentication', description: 'Opaque cookie session lifecycle' },
  { name: 'Access control', description: 'Permission catalogue, roles and user assignments' },
);

Object.assign(spec.paths, {
  '/auth/sign-in': {
    post: {
      tags: ['Authentication'],
      summary: 'Sign in with email and password',
      description: 'Public, approved-origin endpoint. All credential failures use the same generic response.',
      security: [],
      requestBody: { required: true, content: json(ref('SignInRequest')) },
      responses: {
        200: {
          description: 'Signed in; the opaque token is set only in an HttpOnly cookie',
          headers: { 'Set-Cookie': { schema: { type: 'string' } } },
          content: json(ref('AuthContext')),
        },
        401: response('InvalidCredentials'),
        403: response('Forbidden'),
        422: response('ValidationFailed'),
        429: response('RateLimited'),
        503: response('DatabaseUnavailable'),
      },
    },
  },
  '/auth/session': {
    get: {
      tags: ['Authentication'],
      summary: 'Restore the current browser session',
      responses: { 200: { description: 'Current user, roles, permissions and expiry', content: json(ref('AuthContext')) } },
    },
  },
  '/auth/sign-out': {
    post: {
      tags: ['Authentication'],
      summary: 'Revoke the current session and clear its cookie',
      responses: { 204: { description: 'Signed out' } },
    },
  },
  '/permissions': {
    get: {
      tags: ['Access control'],
      summary: 'List the stable permission catalogue',
      'x-required-permissions': ['roles.view'],
      responses: {
        200: { description: 'Permission catalogue', content: json({ type: 'array', items: ref('Permission') }) },
      },
    },
  },
  '/roles': {
    get: {
      tags: ['Access control'],
      summary: 'List built-in and custom roles',
      'x-required-permissions': ['roles.view'],
      responses: { 200: { description: 'Roles', content: json({ type: 'array', items: ref('Role') }) } },
    },
    post: {
      tags: ['Access control'],
      summary: 'Create a custom role',
      description: 'The caller may include only permissions they possess.',
      'x-required-permissions': ['roles.create'],
      requestBody: { required: true, content: json(ref('RoleCreate')) },
      responses: {
        201: {
          description: 'Created',
          headers: { Location: { schema: { type: 'string' } } },
          content: json(ref('Role')),
        },
        409: response('Conflict'),
        422: response('ValidationFailed'),
      },
    },
  },
  '/roles/{id}': {
    parameters: [{ $ref: '#/components/parameters/RoleId' }],
    get: {
      tags: ['Access control'],
      summary: 'Read a role',
      'x-required-permissions': ['roles.view'],
      responses: {
        200: { description: 'Role', content: json(ref('Role')) },
        404: response('NotFound'),
      },
    },
    put: {
      tags: ['Access control'],
      summary: 'Replace a custom role',
      description: 'Built-in roles are immutable. Affected sessions are revoked.',
      'x-required-permissions': ['roles.update'],
      requestBody: { required: true, content: json(ref('RoleUpdate')) },
      responses: {
        200: { description: 'Updated role', content: json(ref('Role')) },
        404: response('NotFound'),
        409: response('Conflict'),
        422: response('ValidationFailed'),
      },
    },
  },
  '/users': {
    get: {
      tags: ['Access control'],
      summary: 'List users without credential or session secrets',
      'x-required-permissions': ['users.view'],
      parameters: [
        { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
      ],
      responses: { 200: { description: 'One user page', content: json(ref('UserPage')) } },
    },
  },
  '/users/{id}/roles': {
    parameters: [{ $ref: '#/components/parameters/UserId' }],
    put: {
      tags: ['Access control'],
      summary: "Atomically replace another user's role assignments",
      description: [
        'Self-assignment, unknown/inactive/duplicate roles, delegation beyond the caller, and removal of the final',
        'active usable administrator are rejected. The target user’s sessions are revoked.',
      ].join(' '),
      'x-required-permissions': ['roles.assign'],
      requestBody: { required: true, content: json(ref('RoleAssignment')) },
      responses: {
        200: { description: 'Updated user', content: json(ref('UserSummary')) },
        404: response('NotFound'),
        409: response('Conflict'),
        422: response('ValidationFailed'),
      },
    },
  },
});

Object.assign(spec.components.parameters, {
  RoleId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  UserId: { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  CsrfToken: {
    name: 'X-CSRF-Token',
    in: 'header',
    required: true,
    description: 'HMAC token returned for the current session. Required with an approved Origin on unsafe protected methods.',
    schema: { type: 'string' },
  },
});

Object.assign(spec.components.responses, {
  InvalidCredentials: {
    description: 'Generic sign-in failure (`INVALID_CREDENTIALS`)',
    content: json(ref('Error'), { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }),
  },
  Unauthenticated: {
    description: 'Missing, expired, revoked or otherwise invalid session (`UNAUTHENTICATED`)',
    content: json(ref('Error'), { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } }),
  },
  Forbidden: {
    description: 'Permission/origin failure (`FORBIDDEN`) or unsafe-request validation failure (`CSRF_FAILED`)',
    content: json(ref('Error'), {
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' },
    }),
  },
  RateLimited: {
    description: 'Request limit exceeded (`RATE_LIMITED`). `Retry-After` indicates when to retry.',
    headers: { 'Retry-After': { schema: { type: 'integer' } } },
    content: json(ref('Error'), {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
    }),
  },
  Conflict: {
    description: 'A role-management invariant or uniqueness constraint would be violated',
    content: json(ref('Error')),
  },
});

Object.assign(spec.components.schemas, {
  SignInRequest: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 320 },
      password: { type: 'string', minLength: 1, maxLength: 128, writeOnly: true },
    },
  },
  AuthUser: {
    type: 'object',
    required: ['id', 'email', 'displayName'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      displayName: { type: 'string' },
    },
  },
  ActiveRole: {
    type: 'object',
    required: ['id', 'name', 'systemKey'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      systemKey: { type: ['string', 'null'], enum: ['admin', 'asset_manager', 'viewer', null] },
    },
  },
  AuthSession: {
    type: 'object',
    required: ['idleExpiresAt', 'absoluteExpiresAt'],
    properties: {
      idleExpiresAt: { type: 'string', format: 'date-time' },
      absoluteExpiresAt: { type: 'string', format: 'date-time' },
    },
  },
  AuthContext: {
    type: 'object',
    required: ['user', 'roles', 'permissions', 'session', 'csrfToken'],
    properties: {
      user: ref('AuthUser'),
      roles: { type: 'array', items: ref('ActiveRole') },
      permissions: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      session: ref('AuthSession'),
      csrfToken: { type: 'string', description: 'Bound to this server-side session; send only in X-CSRF-Token.' },
    },
  },
  Permission: {
    type: 'object',
    required: ['key', 'description'],
    properties: { key: { type: 'string' }, description: { type: 'string' } },
  },
  Role: {
    type: 'object',
    required: ['id', 'name', 'systemKey', 'isActive', 'permissionKeys', 'assignedUserCount'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      systemKey: { type: ['string', 'null'], enum: ['admin', 'asset_manager', 'viewer', null] },
      isActive: { type: 'boolean' },
      permissionKeys: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      assignedUserCount: { type: 'integer', minimum: 0 },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  RoleCreate: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'permissionKeys'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      description: { type: ['string', 'null'], maxLength: 500 },
      permissionKeys: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 100 },
    },
  },
  RoleUpdate: {
    allOf: [
      ref('RoleCreate'),
      {
        type: 'object',
        required: ['isActive'],
        properties: { isActive: { type: 'boolean' } },
      },
    ],
  },
  UserRole: {
    allOf: [
      ref('ActiveRole'),
      { type: 'object', required: ['isActive'], properties: { isActive: { type: 'boolean' } } },
    ],
  },
  UserSummary: {
    type: 'object',
    required: ['id', 'email', 'displayName', 'isActive', 'roles'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      email: { type: 'string', format: 'email' },
      displayName: { type: 'string' },
      isActive: { type: 'boolean' },
      lockedUntil: { type: ['string', 'null'], format: 'date-time' },
      lastLoginAt: { type: ['string', 'null'], format: 'date-time' },
      roles: { type: 'array', items: ref('UserRole') },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  UserPage: {
    type: 'object',
    required: ['items', 'total', 'page', 'pageSize'],
    properties: {
      items: { type: 'array', items: ref('UserSummary') },
      total: { type: 'integer', minimum: 0 },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
  RoleAssignment: {
    type: 'object',
    additionalProperties: false,
    required: ['roleIds'],
    properties: {
      roleIds: { type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true, maxItems: 100 },
    },
  },
});

spec.components.securitySchemes = {
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: config.auth.cookie.name,
    description: 'Opaque 256-bit token. The server stores only its SHA-256 hash; JavaScript cannot read the HttpOnly cookie.',
  },
};

spec.paths['/health'].get.security = [];

const requiredPermissions = {
  'GET /reference-data': ['assets.view'],
  'POST /asset-types': ['assets.view', 'assets.create'],
  'GET /asset-types/{code}': ['assets.view'],
  'GET /asset-types/{code}/attributes': ['assets.view'],
  'POST /asset-types/{code}/attributes': ['assets.view', 'assets.update'],
  'PUT /asset-types/{code}/attributes/{key}': ['assets.view', 'assets.update'],
  'DELETE /asset-types/{code}/attributes/{key}': ['assets.view', 'assets.update'],
  'POST /asset-types/{code}/attributes/{key}/restore': ['assets.view', 'assets.update'],
  'GET /assets': ['assets.view'],
  'POST /assets': ['assets.create'],
  'GET /assets/{id}': ['assets.view'],
  'PUT /assets/{id}': ['assets.update'],
  'DELETE /assets/{id}': ['assets.archive'],
  'POST /assets/{id}/restore': ['assets.restore'],
  'POST /exports/assets': ['assets.view', 'exports.run'],
  'GET /export-profiles': ['exportProfiles.view'],
  'POST /export-profiles': ['exportProfiles.create'],
  'GET /export-profiles/{id}': ['exportProfiles.view'],
  'PUT /export-profiles/{id}': ['exportProfiles.update'],
  'DELETE /export-profiles/{id}': ['exportProfiles.delete'],
};

for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    const operation = item[method];
    if (!operation) continue;
    const permissionKeys = requiredPermissions[`${method.toUpperCase()} ${path}`];
    if (permissionKeys) operation['x-required-permissions'] = permissionKeys;
    if (operation.security && operation.security.length === 0) continue;
    operation.responses[401] = operation.responses[401] || response('Unauthenticated');
    operation.responses[403] = operation.responses[403] || response('Forbidden');
    operation.responses[429] = operation.responses[429] || response('RateLimited');
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      operation.parameters = [...(operation.parameters || []), { $ref: '#/components/parameters/CsrfToken' }];
    }
  }
}

module.exports = spec;
