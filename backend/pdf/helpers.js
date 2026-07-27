const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Company logo paths
// ---------------------------------------------------------------------------

const companyBlueLogoPath = path.join(__dirname, '..', '..', 'public', 'alfosac-logo-azul.png');
const companyWhiteLogoPath = path.join(__dirname, '..', '..', 'public', 'alfosac-logo-blanco.png');

const getCompanyLogoPath = (background = 'light') => {
  const darkBackground = String(background || '').trim().toLowerCase() === 'dark';
  if (darkBackground && fs.existsSync(companyWhiteLogoPath)) {
    return companyWhiteLogoPath;
  }

  if (fs.existsSync(companyBlueLogoPath)) {
    return companyBlueLogoPath;
  }

  if (fs.existsSync(companyWhiteLogoPath)) {
    return companyWhiteLogoPath;
  }

  return null;
};

// ---------------------------------------------------------------------------
// Brand colors
// ---------------------------------------------------------------------------

const PDF_BRAND_COLORS = {
  primary: '#3b82f6',
  primaryDark: '#1e40af',
  line: '#bfdbfe',
  surface: '#f8fafc',
  sectionHeader: '#e0edff',
  textPrimary: '#1e293b',
  textSecondary: '#64748b',
};

// ---------------------------------------------------------------------------
// Text / formatting helpers
// ---------------------------------------------------------------------------

const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim() || 'N/D';

const formatCurrency = (value, currency = 'PEN') => `${Number(value || 0).toFixed(2)} ${safeText(currency)}`;

const PET_TIME_ZONE = 'America/Lima';

const formatPetDateTime = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: PET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

const currentPetDateTime = () => formatPetDateTime(new Date());

// ---------------------------------------------------------------------------
// Normalization helpers (needed by approval functions)
// ---------------------------------------------------------------------------

const normalize = (v) => String(v || '').trim().toUpperCase();

const normalizeRoleName = (value) => normalize(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizePermissionName = (value) => normalizeRoleName(value)
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

// ---------------------------------------------------------------------------
// Role name cache (populated externally via setRoleNamesCache)
// ---------------------------------------------------------------------------

let ROLE_NAME_BY_ID = new Map();

const setRoleNamesCache = (map) => {
  ROLE_NAME_BY_ID = map instanceof Map ? map : new Map();
};

// ---------------------------------------------------------------------------
// Approval helpers
// ---------------------------------------------------------------------------

const getApprovalRoleLabel = (roleId, roleName = '') => {
  const numericRoleId = Number(roleId || 0);
  const explicitName = String(roleName || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const cachedName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (cachedName) {
    return cachedName;
  }

  return numericRoleId > 0 ? `Rol ${numericRoleId}` : '';
};

const getApprovalStageKeyByRoleId = (roleId) => {
  const fallback = normalizePermissionName(getApprovalRoleLabel(roleId));
  if (!fallback) return '';

  return fallback
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
};

const buildPdfApprovalEntries = ({ approvals = [], creatorUserId = 0, creatorRoleId = 0, creatorName = '' } = {}) => {
  const ordered = Array.isArray(approvals)
    ? approvals
      .map((row) => ({
        orden: Number(row.orden || 0),
        rol_aprobador: Number(row.rol_aprobador || 0),
        rol: String(row.rol || '').trim(),
        etapa: String(row.etapa || getApprovalStageKeyByRoleId(row.rol_aprobador)).trim(),
        aprobador: String(row.aprobador || '').trim(),
        usuario_id: Number(row.usuario_id || 0) || null,
        fecha: row.fecha || null,
      }))
      .filter((row) => row.aprobador || row.rol_aprobador > 0)
    : [];

  const creatorId = Number(creatorUserId || 0);
  const numericCreatorRoleId = Number(creatorRoleId || 0);
  const creatorLabel = String(creatorName || '').trim();

  if (creatorId > 0 && creatorLabel) {
    const creatorAlreadyIncluded = ordered.some((row) => Number(row.usuario_id || 0) === creatorId || Number(row.rol_aprobador || 0) === numericCreatorRoleId);
    if (!creatorAlreadyIncluded) {
      ordered.unshift({
        orden: 0,
        rol_aprobador: numericCreatorRoleId,
        rol: getApprovalRoleLabel(numericCreatorRoleId) || 'Solicitante',
        etapa: 'SOLICITANTE',
        aprobador: creatorLabel,
        usuario_id: creatorId,
        fecha: null,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  ordered
    .sort((a, b) => Number(a.orden || 0) - Number(b.orden || 0) || Number(a.rol_aprobador || 0) - Number(b.rol_aprobador || 0))
    .forEach((row) => {
      const key = `${Number(row.usuario_id || 0)}:${Number(row.rol_aprobador || 0)}:${String(row.aprobador || '').toLowerCase()}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      deduped.push(row);
    });

  return deduped;
};

// ---------------------------------------------------------------------------
// Receipt info parser
// ---------------------------------------------------------------------------

const parseReceiptInfo = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(.*?)(?:\s*-\s*DNI\s*(.+))?$/i);
  const nombre = String(match?.[1] || '').trim();
  const dni = String(match?.[2] || '').trim();
  return {
    nombre: nombre || text,
    dni,
  };
};

// ---------------------------------------------------------------------------
// Shared PDF drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw the dark header bar with company logo, title, and subtitle.
 *
 * @param {PDFDocument} doc   - PDFKit document
 * @param {object} opts
 * @param {string} opts.title          - e.g. 'ORDEN DE COMPRA'
 * @param {string} [opts.companyAddress]
 * @param {string} [opts.companyRuc]
 * @param {string} [opts.companyWeb]
 * @param {number} [opts.pageWidth]
 * @param {number} [opts.left]
 * @param {number} [opts.right]
 * @param {number} [opts.usableWidth]
 */
const drawHeader = (doc, opts = {}) => {
  const {
    title = 'DOCUMENTO',
    companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao',
    companyRuc = '20606777257',
    companyWeb = 'www.alfosac.pe',
    pageWidth = 595.28,
    left = 36,
    right = 36,
    usableWidth = pageWidth - left - right,
  } = opts;

  const logoPath = getCompanyLogoPath('dark');

  doc.rect(left, 18, usableWidth, 62).fill(PDF_BRAND_COLORS.primaryDark);

  if (logoPath) {
    doc.image(logoPath, left + 12, 24, {
      fit: [84, 50],
      align: 'left',
      valign: 'center',
    });
  }

  doc.font('Helvetica-Bold').fontSize(15).fillColor('#ffffff').text(title, left, 32, { width: usableWidth - 14, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND_COLORS.textSecondary).text(`Dirección: ${companyAddress}`, left, 94, { width: usableWidth, align: 'center' });
  doc.text(`RUC: ${companyRuc}`, left, 106, { width: usableWidth, align: 'center' });
  doc.text(`Sitio Web: ${companyWeb}`, left, 118, { width: usableWidth, align: 'center' });
  doc.moveTo(left, 132).lineTo(pageWidth - right, 132).strokeColor(PDF_BRAND_COLORS.line).lineWidth(0.9).stroke();
};

/**
 * Ensure there is enough vertical space on the current page.
 * If not, add a new page and redraw the header.
 */
const ensureSpace = (doc, opts, needed = 24) => {
  const { bottomLimit, drawHeaderFn } = opts;
  if (doc.y + needed > bottomLimit) {
    doc.addPage();
    drawHeaderFn();
  }
};

/**
 * Draw a section title with a color-coded badge.
 *
 * @param {PDFDocument} doc
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.badgeColor]  - hex color for the badge background
 * @param {number} [opts.left]
 * @param {number} [opts.right]
 * @param {number} [opts.pageWidth]
 * @param {number} [opts.usableWidth]
 * @param {function} [opts.ensureSpaceFn]
 * @param {function} [opts.drawHeaderFn]
 */
const drawSectionTitle = (doc, opts = {}) => {
  const {
    title,
    badgeColor = PDF_BRAND_COLORS.primary,
    left = 36,
    right = 36,
    pageWidth = 595.28,
    usableWidth = pageWidth - left - right,
    ensureSpaceFn = () => {},
  } = opts;

  ensureSpaceFn(28);

  const badgePadX = 8;
  const badgePadY = 3;
  doc.font('Helvetica-Bold').fontSize(11);
  const titleWidth = doc.widthOfString(title);
  const badgeWidth = titleWidth + badgePadX * 2;
  const badgeHeight = 18;
  const badgeY = doc.y;

  doc.roundedRect(left, badgeY, badgeWidth, badgeHeight, 4).fill(badgeColor);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text(title, left + badgePadX, badgeY + badgePadY, {
    width: titleWidth,
    align: 'left',
  });

  doc.y = badgeY + badgeHeight + 4;
};

/**
 * Draw a rounded info card with a title bar and two columns of key-value rows.
 */
const drawInfoBlock = (doc, { title, rows, x, y, width }) => {
  const rowGap = 6;
  const paddingX = 10;
  const paddingY = 6;
  const titleHeight = 18;
  const labelWidth = Math.max(98, Math.floor(width * 0.38));
  const valueWidth = width - (paddingX * 2) - labelWidth - 8;

  const measureRowHeight = (label, value) => {
    const textLabel = `${safeText(label)}:`;
    const textValue = safeText(value);
    doc.font('Helvetica-Bold').fontSize(8.5);
    const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
    doc.font('Helvetica').fontSize(8.5);
    const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
    return {
      textLabel,
      textValue,
      rowHeight: Math.max(18, Math.max(labelHeight, valueHeight)),
    };
  };

  let contentHeight = 0;
  rows.forEach(([label, value]) => {
    const measured = measureRowHeight(label, value);
    contentHeight += measured.rowHeight + rowGap;
  });

  const blockHeight = titleHeight + (paddingY * 2) + contentHeight;

  doc.roundedRect(x, y, width, blockHeight, 4).fillAndStroke(PDF_BRAND_COLORS.surface, '#dbe3ec');
  doc.rect(x, y, width, titleHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#dbe3ec');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(title, x + paddingX, y + 5, {
    width: width - (paddingX * 2),
  });

  let rowY = y + titleHeight + paddingY;
  rows.forEach(([label, value]) => {
    const { textLabel, textValue, rowHeight } = measureRowHeight(label, value);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(textLabel, x + paddingX, rowY, {
      width: labelWidth,
    });

    const isTotalFinal = String(label || '').toLowerCase().replace(/\s+/g, '') === 'totalfinal'
      || String(label || '').toLowerCase().includes('total final')
      || String(label || '').toLowerCase().includes('totalfinal');

    if (isTotalFinal) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
        width: valueWidth,
      });
    } else {
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(textValue, x + paddingX + labelWidth + 8, rowY, {
        width: valueWidth,
      });
    }

    rowY += rowHeight + rowGap;
  });

  return y + blockHeight;
};

/**
 * Draw a styled table with header and alternating row colors.
 *
 * @param {PDFDocument} doc
 * @param {object} opts
 * @param {string[]} opts.headers     - column header labels
 * @param {number[]} opts.colWidths   - column widths
 * @param {Array<string[]>} opts.rows - array of row cell arrays
 * @param {number} [opts.left]
 * @param {number} [opts.pageWidth]
 * @param {number} [opts.right]
 * @param {number} [opts.usableWidth]
 * @param {number} [opts.bottomLimit]
 * @param {function} [opts.ensureSpaceFn]
 * @param {function} [opts.drawHeaderFn]
 * @param {function} [opts.writeSectionTitleFn]
 * @param {function} [opts.sectionTitle]
 */
const drawTable = (doc, opts = {}) => {
  const {
    headers = [],
    colWidths = [],
    rows = [],
    left = 36,
    pageWidth = 595.28,
    right = 36,
    usableWidth = pageWidth - left - right,
    bottomLimit = 770,
    ensureSpaceFn = () => {},
    drawHeaderFn = () => {},
    writeSectionTitleFn = () => {},
    sectionTitle = 'Items',
  } = opts;

  if (rows.length === 0) return;

  const headerHeight = 20;
  const rowGap = 0;

  const drawTableHeader = (startY) => {
    let headerX = left;
    headers.forEach((header, index) => {
      doc.rect(headerX, startY, colWidths[index], headerHeight).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#cbd5e1');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary);
      doc.text(header, headerX + 6, startY + 6, {
        width: colWidths[index] - 12,
        align: index === 0 ? 'left' : 'center',
      });
      headerX += colWidths[index];
    });
    return startY + headerHeight;
  };

  ensureSpaceFn(headerHeight + 24);
  writeSectionTitleFn(sectionTitle);
  let rowY = drawTableHeader(doc.y);

  doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary);
  rows.forEach((cells, rowIndex) => {
    const maxRowHeight = cells.reduce((max, cell, cellIndex) => {
      const h = doc.heightOfString(String(cell), { width: colWidths[cellIndex] - 12 }) + 8;
      return Math.max(max, h);
    }, 20);

    if (rowY + maxRowHeight > bottomLimit - 32) {
      doc.addPage();
      drawHeaderFn();
      writeSectionTitleFn(sectionTitle);
      rowY = drawTableHeader(doc.y);
    }

    const isAlternate = rowIndex % 2 === 0;
    const bgColor = isAlternate ? '#f0f5ff' : '#ffffff';

    let cellX = left;
    cells.forEach((cell, cellIndex) => {
      doc.rect(cellX, rowY, colWidths[cellIndex], maxRowHeight).fillAndStroke(bgColor, '#e2e8f0');
      doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary);
      doc.text(String(cell), cellX + 6, rowY + 5, {
        width: colWidths[cellIndex] - 12,
        align: cellIndex === 0 ? 'left' : 'center',
      });
      cellX += colWidths[cellIndex];
    });
    rowY += maxRowHeight + rowGap;
  });

  return rowY;
};

/**
 * Draw the footer with page numbers and generation date.
 */
const drawFooter = (doc, opts = {}) => {
  const {
    left = 36,
    right = 36,
    pageWidth = 595.28,
    usableWidth = pageWidth - left - right,
    bottomLimit = 770,
  } = opts;

  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textSecondary);
    doc.text(
      `Página ${i + 1} de ${pageCount}`,
      left,
      bottomLimit + 24,
      { width: usableWidth, align: 'center', lineBreak: false }
    );
    doc.text(
      `Generado: ${currentPetDateTime() || ''}`,
      left,
      bottomLimit + 34,
      { width: usableWidth, align: 'center', lineBreak: false }
    );
  }
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  companyBlueLogoPath,
  companyWhiteLogoPath,
  getCompanyLogoPath,
  PDF_BRAND_COLORS,
  safeText,
  formatCurrency,
  formatPetDateTime,
  currentPetDateTime,
  normalize,
  normalizeRoleName,
  normalizePermissionName,
  setRoleNamesCache,
  getApprovalRoleLabel,
  getApprovalStageKeyByRoleId,
  buildPdfApprovalEntries,
  parseReceiptInfo,
  drawHeader,
  ensureSpace,
  drawSectionTitle,
  drawInfoBlock,
  drawTable,
  drawFooter,
};
