const PDFDocument = require('pdfkit');
const {
  PDF_BRAND_COLORS,
  safeText,
  formatCurrency,
  formatPetDateTime,
  currentPetDateTime,
  normalize,
  normalizeRoleName,
  buildPdfApprovalEntries,
  drawHeader: sharedDrawHeader,
  ensureSpace: sharedEnsureSpace,
  drawSectionTitle,
  drawInfoBlock,
  drawFooter,
} = require('./helpers');

const buildServicioPdfBase64 = (servicio) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
  const chunks = [];

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const left = 36;
  const right = 36;
  const usableWidth = pageWidth - left - right;
  const bottomLimit = pageHeight - 72;

  const currencyLabel = safeText(servicio.moneda || servicio.proveedor_moneda || 'PEN');
  const money = (value, currency = currencyLabel) => formatCurrency(value, currency);
  const companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao';
  const companyRuc = '20606777257';
  const companyWeb = 'www.alfosac.pe';

  const headerOpts = { companyAddress, companyRuc, companyWeb, pageWidth, left, right, usableWidth };

  const drawHeader = () => sharedDrawHeader(doc, { title: 'ORDEN DE SERVICIO', ...headerOpts });

  const ensureSpace = (needed = 24) => sharedEnsureSpace(doc, { bottomLimit, drawHeaderFn: drawHeader }, needed);

  const writeSectionTitle = (title) => {
    ensureSpace(28);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(PDF_BRAND_COLORS.primaryDark).text(title, left, doc.y, { width: usableWidth });
    doc.moveDown(0.2);
    doc.moveTo(left, doc.y).lineTo(pageWidth - right, doc.y).strokeColor(PDF_BRAND_COLORS.line).lineWidth(0.8).stroke();
    doc.moveDown(0.5);
  };

  const colorCodedSectionTitle = (title, badgeColor = PDF_BRAND_COLORS.primary) => {
    drawSectionTitle(doc, {
      title,
      badgeColor,
      left,
      right,
      pageWidth,
      usableWidth,
      ensureSpaceFn: ensureSpace,
    });
  };

  const infoBlock = ({ title, rows, x, y, width }) => drawInfoBlock(doc, { title, rows, x, y, width });

  const estimateBlockHeight = (rows = []) => {
    const measureRowHeight = (label, value, labelWidth, valueWidth) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      return Math.max(18, Math.max(labelHeight, valueHeight));
    };

    let total = 24;
    const labelWidth = 98;
    const valueWidth = 136;
    rows.forEach(([label, value]) => {
      total += measureRowHeight(label, value, labelWidth, valueWidth) + 6;
    });
    return total + 6;
  };

  const renderTwoColumnBlocks = (blocks) => {
    const colGap = 12;
    const colWidth = (usableWidth - colGap) / 2;
    let cursorY = doc.y;

    for (let i = 0; i < blocks.length; i += 2) {
      const leftBlock = blocks[i];
      const rightBlock = blocks[i + 1] || null;
      const estimatedPairHeight = Math.max(
        estimateBlockHeight(leftBlock?.rows || []),
        rightBlock ? estimateBlockHeight(rightBlock.rows || []) : 0,
      ) + 10;

      ensureSpace(estimatedPairHeight);
      cursorY = Math.max(cursorY, doc.y);

      const leftBottom = infoBlock({
        title: leftBlock.title,
        rows: leftBlock.rows,
        x: left,
        y: cursorY,
        width: colWidth,
      });

      let pairBottom = leftBottom;
      if (rightBlock) {
        const rightBottom = infoBlock({
          title: rightBlock.title,
          rows: rightBlock.rows,
          x: left + colWidth + colGap,
          y: cursorY,
          width: colWidth,
        });
        pairBottom = Math.max(leftBottom, rightBottom);
      }

      cursorY = pairBottom + 1;
      doc.y = cursorY;
    }
  };

  // --- Event listeners ---

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 140;
  });

  drawHeader();

  // --- Calculations ---

  const parseAmount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const hasSubtotal = servicio.subtotal !== null
    && servicio.subtotal !== undefined
    && String(servicio.subtotal).trim() !== '';

  const igv = Number(servicio.igv || 0);
  const costoEnvio = Number(servicio.costo_envio || 0);
  const otrosCostos = Number(servicio.otros_costos || 0);
  let subtotal = hasSubtotal ? parseAmount(servicio.subtotal) : 0;
  if (!hasSubtotal) {
    const sourceTotal = parseAmount(servicio.total || servicio.costo || 0);
    const derivedSubtotal = Number((sourceTotal - igv - costoEnvio - otrosCostos).toFixed(2));
    subtotal = derivedSubtotal > 0 ? derivedSubtotal : parseAmount(servicio.costo || 0);
  }

  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2));
  const porcentajeRetencion = Number(servicio.proveedor_retencion_pct || servicio.retencion || 0);
  const currencyNorm = normalizeRoleName(servicio.proveedor_moneda || currencyLabel || servicio.moneda || '');
  const isUsdCurrency = currencyNorm.includes('USD') || currencyNorm.includes('DOLAR');
  const isPenCurrency = currencyNorm.includes('PEN') || currencyNorm.includes('SOL');
  const totalBaseSoles = isUsdCurrency ? Number((totalBase * 3.5).toFixed(2)) : totalBase;
  const exceedsThreshold = (isPenCurrency && totalBase > 700) || (isUsdCurrency && totalBaseSoles > 700);
  const providerAllowsRetention = normalize(servicio.proveedor_retencion) === 'SI' && porcentajeRetencion > 0;
  const aplicaRetencion = Boolean(servicio.aplica_retencion) || (providerAllowsRetention && exceedsThreshold);
  const montoRetenido = aplicaRetencion ? Number((totalBase * (porcentajeRetencion / 100)).toFixed(2)) : 0;
  let totalFinal = parseAmount(servicio.total || totalBase);
  if (aplicaRetencion) {
    totalFinal = Number((totalBase - montoRetenido).toFixed(2));
  }
  const approverEntries = buildPdfApprovalEntries({
    approvals: servicio.aprobadores,
    creatorUserId: servicio.id_usuario,
    creatorRoleId: servicio.usuario_rol_id,
    creatorName: servicio.usuario,
  });
  const approversSummary = approverEntries
    .filter((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase();
      const rolLabel = String(row.rol || '').trim().toUpperCase();
      const isRequesterRow = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE';
      return !isRequesterRow || approverEntries.length === 1;
    })
    .map((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase();
      const rolLabel = String(row.rol || '').trim().toUpperCase();
      const fallbackRoleLabel = safeText(row.rol || '');
      const label = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE'
        ? fallbackRoleLabel
        : safeText(row.etapa || row.rol || '');
      return `${label} - ${safeText(row.aprobador || 'Pendiente')}`;
    })
    .join('\n');

  // --- Section: Resumen ---

  colorCodedSectionTitle('Resumen', PDF_BRAND_COLORS.primary);
  ensureSpace(50);

  const estadoServicio = normalize(servicio.estado_flujo || servicio.estado_servicio) === 'PENDIENTE'
    ? 'PENDIENTE DE REALIZACION'
    : (servicio.estado_flujo || servicio.estado_servicio);

  const servicioEstadoBottom = infoBlock({
    title: 'Servicio y estado',
    rows: [
      ['Nombre', servicio.nombre_servicio || servicio.descripcion_servicio],
      ['Descripción', servicio.descripcion_servicio],
      ['Prioridad', servicio.prioridad],
      ['Estado', estadoServicio],
      ['Estado aprobación', servicio.estado_aprobacion],
    ],
    x: left,
    y: doc.y,
    width: usableWidth,
  });
  doc.y = servicioEstadoBottom;

  // --- Two-column info blocks ---

  renderTwoColumnBlocks([
    {
      title: 'Datos de la orden',
      rows: [
        ['Número de orden', servicio.numero_orden || `OS-${servicio.id}`],
        ['Fecha', String(formatPetDateTime(servicio.fecha || currentPetDateTime()) || '').split(' ')[0]],
        ['Proveedor', servicio.proveedor],
        ['Área destino', servicio.area],
      ],
    },
    {
      title: 'Proveedor',
      rows: [
        ['Moneda', currencyLabel],
        ['RUC', servicio.proveedor_ruc],
        ['Dirección', servicio.proveedor_direccion],
        ['Banco', servicio.proveedor_banco],
        ['Cuenta', servicio.proveedor_cuenta],
        ['CCI', servicio.proveedor_cci],
        ['Condiciones de pago', servicio.proveedor_condiciones_pago],
      ],
    },
    {
      title: 'Detalle financiero',
      rows: [
        ['Subtotal', money(subtotal)],
        ['IGV', money(igv)],
        ['Costo envío', money(costoEnvio)],
        ['Otros costos', money(otrosCostos)],
        ['Total base', money(totalBase)],
        ['Retención aplicada', aplicaRetencion ? 'SÍ' : 'NO'],
        ['Porcentaje', `${porcentajeRetencion.toFixed(2)}%`],
        ['Monto retenido', money(montoRetenido)],
        ['Total final', money(totalFinal)],
      ],
    },
    {
      title: 'Aprobaciones',
      rows: [
        ['Flujo', approversSummary || 'Sin aprobaciones registradas'],
      ],
    },
  ]);

  // --- Contact footer ---

  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8).fillColor(PDF_BRAND_COLORS.textSecondary).text(
    'Si tienes dudas sobre el servicio u orden de compra, contactar a:\ncompras@alfosac.pe\n+51 978772509',
    left,
    bottomLimit - 24,
    { width: usableWidth, align: 'center' }
  );

  // --- Page numbers ---

  drawFooter(doc, { left, right, pageWidth, usableWidth, bottomLimit });

  doc.end();
});

module.exports = { buildServicioPdfBase64 };
