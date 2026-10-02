const express = require('express');
const { asyncHandler } = require('../errors');
const { requirePermissions } = require('../middleware/permissions');
const { parseExportRequest } = require('../dto/exports.dto');
const { listAllAssets } = require('../../repositories/assets.repo');
const { buildAssetWorkbook } = require('../../services/assetExport');

const router = express.Router();

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/*
 * Excel export (S-03, S-04). Every row matching the list's filters, in the
 * list's sort order (ADR-0008), shaped by the request's own parameters
 * (ADR-0011/0012), built in memory (ADR-0009) and returned synchronously in
 * the response body (ADR-0007). Body shape: api/dto/exports.dto.js.
 *
 *   POST /api/exports/assets
 *        -> 200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *           Content-Disposition: attachment; filename="inventory-export-YYYY-MM-DD.xlsx"
 */

router.post(
  '/assets',
  requirePermissions('assets.view', 'exports.run'),
  asyncHandler(async (req, res) => {
    const { filters, sort, columns, dateFormat } = parseExportRequest(req.body);
    const rows = await listAllAssets({ filters, sort });
    const buffer = await buildAssetWorkbook(rows, { columns, dateFormat });

    const filename = `inventory-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.set({
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
      'X-Export-Row-Count': String(rows.length),
    });
    res.end(buffer);
  }),
);

module.exports = router;
