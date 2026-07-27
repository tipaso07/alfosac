const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Company logo paths
// ---------------------------------------------------------------------------

const companyBlueLogoPath = path.join(__dirname, '..', 'public', 'alfosac-logo-azul.png');
const companyWhiteLogoPath = path.join(__dirname, '..', 'public', 'alfosac-logo-blanco.png');

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
// Brand colors (ERP corporate palette)
// ---------------------------------------------------------------------------

const PDF_BRAND_COLORS = {
  navy: '#1F3763',
  navyAlt: '#213558',
  logoBlue: '#163B88',
  highlightBlue: '#B0C3E4',
  grey: '#CCCCCC',
  lightGrey: '#F4F4F4',
  borderGrey: '#A6A6A6',
  textPrimary: '#000000',
  textSecondary: '#222222',
  textTender: '#C7C7C7',
  linkBlue: '#0000EE',
};

// ---------------------------------------------------------------------------
// Page constants
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 31;
const MARGIN_RIGHT = 31;
const MARGIN_TOP = 23;
const MARGIN_BOTTOM = 20;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN_BOTTOM;

// ---------------------------------------------------------------------------
// Text / formatting helpers
// ---------------------------------------------------------------------------

const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim() || 'N/D';

const formatMoney = (value) => {
  const num = Number(value || 0);
  const fixed = num.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `S/ ${withCommas}.${decPart}`;
};

const formatCurrency = (value, currency = 'PEN') => formatMoney(value);

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

const formatShortDate = (value) => {
  const str = String(formatPetDateTime(value) || '').split(' ')[0];
  return str || 'N/D';
};

// ---------------------------------------------------------------------------
// Normalization helpers
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
// Role name cache
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
  if (explicitName) return explicitName;
  const cachedName = ROLE_NAME_BY_ID.get(numericRoleId);
  if (cachedName) return cachedName;
  return numericRoleId > 0 ? `Rol ${numericRoleId}` : '';
};

const getApprovalStageKeyByRoleId = (roleId) => {
  const fallback = normalizePermissionName(getApprovalRoleLabel(roleId));
  if (!fallback) return '';
  return fallback.replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
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
    const alreadyIncluded = ordered.some(
      (row) => Number(row.usuario_id || 0) === creatorId || Number(row.rol_aprobador || 0) === numericCreatorRoleId
    );
    if (!alreadyIncluded) {
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
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(row);
    });

  return deduped;
};

const parseReceiptInfo = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(.*?)(?:\s*-\s*DNI\s*(.+))?$/i);
  return {
    nombre: String(match?.[1] || text || '').trim(),
    dni: String(match?.[2] || '').trim(),
  };
};

// ---------------------------------------------------------------------------
// Shared PDF drawing helpers (ERP corporate style)
// ---------------------------------------------------------------------------

/**
 * Draw the company header: logo + company info on left, title + control table on right.
 * Returns the Y position after the header.
 */
const drawHeader = (doc, opts = {}) => {
  const {
    title = 'DOCUMENTO',
    companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao',
    companyRuc = '20606777257',
    companyWeb = 'www.alfosac.pe',
    controlFecha = '',
    controlNumero = '',
    left = MARGIN_LEFT,
    pageWidth = PAGE_WIDTH,
    usableWidth = USABLE_WIDTH,
  } = opts;

  let headerY = MARGIN_TOP;

  // --- Left side: logo + company info ---
  const logoPath = getCompanyLogoPath('light');
  if (logoPath) {
    try {
      doc.image(logoPath, left, headerY, { fit: [175, 36], align: 'left', valign: 'top' });
    } catch (_) { /* logo not found */ }
  }

  const infoY = headerY + 40;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text('ALFOSAC S.A.C.', left, infoY, { width: 280, align: 'left' });
  doc.font('Helvetica').fontSize(7.5).fillColor(PDF_BRAND_COLORS.textSecondary);
  doc.text(companyAddress, left, infoY + 11, { width: 280, align: 'left' });
  doc.font('Helvetica').fontSize(7.5).fillColor(PDF_BRAND_COLORS.textSecondary);
  doc.text(`RUC: `, left, infoY + 21, { width: 280, align: 'left', continued: true })
    .font('Helvetica-Bold').text(companyRuc, { continued: false });
  doc.font('Helvetica').fontSize(7.5)
    .text(`Sitio Web: `, left, infoY + 31, { width: 280, align: 'left', continued: true })
    .font('Helvetica-Bold').text(companyWeb, { continued: false });

  // --- Right side: title + control table ---
  const rightX = left + 290;
  const rightWidth = usableWidth - 290;

  doc.font('Helvetica').fontSize(24).fillColor(PDF_BRAND_COLORS.navy);
  doc.text(title, rightX, headerY, { width: rightWidth, align: 'right' });

  // Control table
  const ctrlY = headerY + 38;
  const labelW = 48;
  const valueW = rightWidth - labelW - 4;

  // Fecha row
  doc.rect(rightX, ctrlY, labelW, 18).fillAndStroke(PDF_BRAND_COLORS.lightGrey, PDF_BRAND_COLORS.borderGrey);
  doc.font('Helvetica').fontSize(7).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text('FECHA', rightX + 3, ctrlY + 5, { width: labelW - 6, align: 'right' });

  doc.rect(rightX + labelW + 2, ctrlY, valueW, 18).fillAndStroke(PDF_BRAND_COLORS.lightGrey, PDF_BRAND_COLORS.borderGrey);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text(controlFecha || 'N/D', rightX + labelW + 5, ctrlY + 5, { width: valueW - 6, align: 'center' });

  // OC# row
  doc.rect(rightX, ctrlY + 20, labelW, 18).fillAndStroke(PDF_BRAND_COLORS.highlightBlue, PDF_BRAND_COLORS.borderGrey);
  doc.font('Helvetica').fontSize(7).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text('OC #', rightX + 3, ctrlY + 25, { width: labelW - 6, align: 'right' });

  doc.rect(rightX + labelW + 2, ctrlY + 20, valueW, 18).fillAndStroke(PDF_BRAND_COLORS.highlightBlue, PDF_BRAND_COLORS.borderGrey);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text(controlNumero || 'N/D', rightX + labelW + 5, ctrlY + 24, { width: valueW - 6, align: 'center' });

  return ctrlY + 48;
};

/**
 * Draw a section bar: navy background, white text.
 * Returns the Y after the bar.
 */
const drawSectionBar = (doc, { title, x, y, width }) => {
  const barHeight = 17;
  doc.rect(x, y, width, barHeight).fill(PDF_BRAND_COLORS.navy);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
  doc.text(title, x + 8, y + 4.5, { width: width - 16, align: 'left', lineBreak: false });
  return y + barHeight;
};

/**
 * Draw field rows (label: value) for admin info blocks.
 * Returns the Y after the last row.
 */
const drawFieldRows = (doc, { rows, x, y, width, labelWidth }) => {
  const lw = labelWidth || Math.floor(width * 0.42);
  const vw = width - lw - 4;
  const rowHeight = 17;
  let curY = y;

  rows.forEach(([label, value, opts = {}]) => {
    const text = safeText(value);
    doc.font('Helvetica').fontSize(7.2).fillColor(PDF_BRAND_COLORS.textPrimary);

    // Label
    doc.font(opts.labelBold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(7.2)
      .fillColor(PDF_BRAND_COLORS.textPrimary);
    doc.text(`${safeText(label)}:`, x, curY + 4, { width: lw, align: 'left', lineBreak: false });

    // Value
    const valueFont = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
    const valueColor = opts.color || PDF_BRAND_COLORS.textPrimary;
    doc.font(valueFont).fontSize(7.2).fillColor(valueColor);
    doc.text(text, x + lw + 4, curY + 4, { width: vw, align: 'left', lineBreak: false });

    // Underline for email
    if (opts.underline) {
      const textWidth = Math.min(doc.widthOfString(text), vw);
      doc.moveTo(x + lw + 4, curY + rowHeight - 1)
        .lineTo(x + lw + 4 + textWidth, curY + rowHeight - 1)
        .strokeColor(PDF_BRAND_COLORS.textPrimary).lineWidth(0.4).stroke();
    }

    curY += rowHeight;
  });

  return curY;
};

/**
 * Draw the items table with 5 columns (compras) or 2 columns (servicios).
 * Column TOTAL always has a #F4F4F4 background band.
 * Returns the Y after the table.
 */
const drawItemsTable = (doc, { columns, rows, x, y, width, bottomLimit, ensureSpaceFn, drawHeaderFn }) => {
  const headerHeight = 18;
  let rowY = y;

  const drawTableHeader = (startY) => {
    let cx = x;
    columns.forEach((col) => {
      doc.rect(cx, startY, col.width, headerHeight).fill(PDF_BRAND_COLORS.navy);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
      doc.text(col.header, cx + 5, startY + 5, {
        width: col.width - 10,
        align: col.align || 'left',
        lineBreak: false,
      });
      cx += col.width;
    });
    return startY + headerHeight;
  };

  ensureSpaceFn(headerHeight + 50);
  rowY = drawTableHeader(rowY);

  const formatCell = (value, col) => {
    if (col.format === 'money') return formatMoney(value);
    return String(value || '');
  };

  rows.forEach((rowData, rowIndex) => {
    // Measure row height
    let maxHeight = 28;
    let cx = x;
    const cellTexts = columns.map((col, ci) => {
      const text = formatCell(rowData[ci], col);
      const h = doc.heightOfString(text, { width: col.width - 10 }) + 8;
      if (h > maxHeight) maxHeight = h;
      cx += col.width;
      return text;
    });

    // Ensure space
    if (rowY + maxHeight > bottomLimit - 170) {
      doc.addPage();
      drawHeaderFn();
      rowY = drawTableHeader(doc.y);
    }

    // Draw row cells
    cx = x;
    columns.forEach((col, ci) => {
      // Total column gets grey background
      if (col.isTotal) {
        doc.rect(cx, rowY, col.width, maxHeight).fill(PDF_BRAND_COLORS.lightGrey);
      }
      cx += col.width;
    });

    // Draw text
    cx = x;
    columns.forEach((col, ci) => {
      const font = col.bold ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(7.5).fillColor(PDF_BRAND_COLORS.textPrimary);
      doc.text(cellTexts[ci], cx + 5, rowY + 4, {
        width: col.width - 10,
        align: col.align || 'left',
      });
      cx += col.width;
    });

    rowY += maxHeight;
  });

  return rowY;
};

/**
 * Draw the totals block (right-aligned).
 * Returns the Y after the block.
 */
const drawTotalsBlock = (doc, { rows, x, y, width }) => {
  const labelW = 66;
  const symbolW = 18;
  const valueW = width - labelW - symbolW;
  const rowH = 19;
  let curY = y;

  // Separator line before TOTAL
  const totalRowIndex = rows.length - 1;

  rows.forEach(([label, value], i) => {
    const isTotal = i === totalRowIndex;

    if (isTotal) {
      // Line above total
      doc.moveTo(x, curY).lineTo(x + width, curY)
        .strokeColor(PDF_BRAND_COLORS.textPrimary).lineWidth(1.5).stroke();
    }

    if (isTotal) {
      // Total row with highlight blue background
      doc.rect(x, curY, width, rowH).fill(PDF_BRAND_COLORS.highlightBlue);
    }

    // Label
    const font = isTotal ? 'Helvetica-Bold' : 'Helvetica';
    const fontSize = isTotal ? 8 : 7.5;
    doc.font(font).fontSize(fontSize).fillColor(PDF_BRAND_COLORS.textPrimary);
    doc.text(label, x + 4, curY + 5, { width: labelW, align: 'left', lineBreak: false });

    // Symbol
    doc.font(font).fontSize(fontSize)
      .text('S/', x + labelW + 2, curY + 5, { width: symbolW, align: 'center', lineBreak: false });

    // Value
    const displayValue = (value === 0 || value === '0' || value === '-' || value === 'S/ 0.00') && !isTotal
      ? '-'
      : formatMoney(value);
    doc.font(isTotal ? 'Helvetica-Bold' : 'Helvetica').fontSize(isTotal ? 9 : 7.5)
      .text(displayValue.replace('S/ ', ''), x + labelW + symbolW + 2, curY + 4, {
        width: valueW - 6, align: 'right', lineBreak: false,
      });

    curY += rowH;
  });

  return curY;
};

/**
 * Draw admin field rows in two-column layout (left: vendor info, right: admin fields).
 * Returns the Y after both columns.
 */
const drawTwoColumnAdmin = (doc, { leftRows, rightRows, x, y, leftWidth, rightWidth }) => {
  const leftEndY = drawFieldRows(doc, { rows: leftRows, x, y, width: leftWidth });
  const rightEndY = drawFieldRows(doc, { rows: rightRows, x: x + leftWidth + 20, y, width: rightWidth });
  return Math.max(leftEndY, rightEndY);
};

/**
 * Draw the contact footer centered at the bottom.
 */
const drawContactFooter = (doc, { email, phone, left, bottomLimit, usableWidth }) => {
  const text = `Si tienes dudas sobre la orden, contactar a:\n${email || 'compras@alfosac.pe'}\n${phone || '+51 978772509'}`;
  doc.font('Helvetica-Oblique').fontSize(6.5).fillColor(PDF_BRAND_COLORS.textSecondary);
  doc.text(text, left, bottomLimit - 18, { width: usableWidth, align: 'center', lineBreak: false });
};

/**
 * Ensure enough vertical space. If not, add a page.
 */
const ensureSpace = (doc, opts, needed = 24) => {
  const { bottomLimit, drawHeaderFn } = opts;
  if (doc.y + needed > bottomLimit) {
    doc.addPage();
    drawHeaderFn();
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
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN_LEFT,
  MARGIN_RIGHT,
  MARGIN_TOP,
  MARGIN_BOTTOM,
  USABLE_WIDTH,
  BOTTOM_LIMIT,
  safeText,
  formatMoney,
  formatCurrency,
  formatShortDate,
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
  drawSectionBar,
  drawFieldRows,
  drawItemsTable,
  drawTotalsBlock,
  drawTwoColumnAdmin,
  drawContactFooter,
  ensureSpace,
};
