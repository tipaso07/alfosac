const PDFDocument = require('pdfkit');
const {
  PDF_BRAND_COLORS,
  PAGE_WIDTH,
  PAGE_HEIGHT,
  MARGIN_LEFT,
  MARGIN_RIGHT,
  USABLE_WIDTH,
  BOTTOM_LIMIT,
  safeText,
  formatMoney,
  formatPetDateTime,
  currentPetDateTime,
  normalize,
  normalizeRoleName,
  buildPdfApprovalEntries,
  drawHeader: sharedDrawHeader,
  drawSectionBar,
  drawFieldRows,
  drawItemsTable,
  drawTotalsBlock,
  drawContactFooter,
  ensureSpace: sharedEnsureSpace,
} = require('./helpers');

const buildServicioPdfBase64 = (servicio) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: MARGIN_LEFT, size: 'A4', bufferPages: true });
  const chunks = [];

  const left = MARGIN_LEFT;
  const usableWidth = USABLE_WIDTH;
  const bottomLimit = BOTTOM_LIMIT;

  const currencyLabel = safeText(servicio.moneda || servicio.proveedor_moneda || 'PEN');
  const companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao';
  const companyRuc = '20606777257';
  const companyWeb = 'www.alfosac.pe';

  const drawHeader = () => sharedDrawHeader(doc, {
    title: 'ORDEN DE SERVICIO',
    companyAddress,
    companyRuc,
    companyWeb,
    controlFecha: String(formatPetDateTime(servicio.fecha || currentPetDateTime()) || '').split(' ')[0],
    controlNumero: servicio.numero_orden || `OS-${servicio.id}`,
    left,
    pageWidth: PAGE_WIDTH,
    usableWidth,
  });

  const ensureSpace = (needed = 24) => sharedEnsureSpace(doc, { bottomLimit, drawHeaderFn: drawHeader }, needed);

  // --- Event listeners ---

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

  doc.on('pageAdded', () => {
    doc.y = 110;
  });

  drawHeader();
  doc.y = doc.y + 8;

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

  const estadoServicio = normalize(servicio.estado_flujo || servicio.estado_servicio) === 'PENDIENTE'
    ? 'PENDIENTE DE REALIZACION'
    : (servicio.estado_flujo || servicio.estado_servicio);

  // --- Section: VENDEDOR / ENVÍE A ---

  const colGap = 55;
  const leftColW = Math.floor((usableWidth - colGap) * 0.55);
  const rightColW = usableWidth - leftColW - colGap;

  let blocksY = doc.y;

  // VENDEDOR block
  const vendorEndY = drawSectionBar(doc, { title: 'VENDEDOR', x: left, y: blocksY, width: leftColW });
  const vendorRows = [
    ['Razón Social', servicio.proveedor],
    ['RUC', servicio.proveedor_ruc],
    ['Dirección', servicio.proveedor_direccion],
    ['Banco', servicio.proveedor_banco],
    ['Cuenta', servicio.proveedor_cuenta],
    ['CCI', servicio.proveedor_cci],
    ['Condiciones de pago', servicio.proveedor_condiciones_pago],
  ].filter((r) => r[1]);
  const vendorFieldEndY = drawFieldRows(doc, { rows: vendorRows, x: left, y: vendorEndY + 2, width: leftColW, labelWidth: 50 });

  // ENVÍE A block
  const shipBarY = blocksY;
  const shipEndY = drawSectionBar(doc, { title: 'ENVÍE A', x: left + leftColW + colGap, y: shipBarY, width: rightColW });
  const areaName = servicio.area || servicio.area_destino;
  const shipRows = [
    ...(areaName ? [[areaName, '']] : []),
    ['Solicitante', servicio.usuario],
    ['Moneda', currencyLabel],
    ['', 'Av. Nestor Gambetta N° 4783 - Callao'],
  ].filter((r) => r[1]);
  const shipFieldEndY = drawFieldRows(doc, { rows: shipRows, x: left + leftColW + colGap, y: shipEndY + 2, width: rightColW, labelWidth: 50 });

  doc.y = Math.max(vendorFieldEndY, shipFieldEndY) + 10;

  // --- Service detail table (2 columns: # and Descripción) ---

  const items = Array.isArray(servicio.items) ? servicio.items : [];
  if (items.length > 0) {
    const columns = [
      { header: '#', width: 45, align: 'center' },
      { header: 'DESCRIPCIÓN DEL SERVICIO', width: usableWidth - 45, align: 'left' },
    ];

    const tableRows = items.map((item, i) => [
      String(i + 1),
      safeText(item.material || item.descripcion || item.nombre || servicio.descripcion_servicio),
    ]);

    doc.y = doc.y + 4;
    doc.y = drawItemsTable(doc, {
      columns,
      rows: tableRows,
      x: left,
      y: doc.y,
      width: usableWidth,
      bottomLimit,
      ensureSpaceFn: ensureSpace,
      drawHeaderFn: drawHeader,
    });
  } else {
    // Single description row if no items array
    if (servicio.descripcion_servicio || servicio.descripcion) {
      const columns = [
        { header: '#', width: 45, align: 'center' },
        { header: 'DESCRIPCIÓN DEL SERVICIO', width: usableWidth - 45, align: 'left' },
      ];
      const tableRows = [['1', safeText(servicio.nombre_servicio || servicio.descripcion_servicio || servicio.descripcion)]];

      doc.y = doc.y + 4;
      doc.y = drawItemsTable(doc, {
        columns,
        rows: tableRows,
        x: left,
        y: doc.y,
        width: usableWidth,
        bottomLimit,
        ensureSpaceFn: ensureSpace,
        drawHeaderFn: drawHeader,
      });
    }
  }

  // --- Bottom section: admin fields + totals ---

  doc.y = doc.y + 10;

  const adminLeftW = Math.floor(usableWidth * 0.72);
  const adminRightW = usableWidth - adminLeftW - 25;
  const bottomY = doc.y;

  // Admin fields header
  const adminBarEndY = drawSectionBar(doc, {
    title: 'Información del servicio',
    x: left,
    y: bottomY,
    width: adminLeftW,
  });

  const comentario = String(servicio.comentarios || servicio.detalle || '').trim();

  const adminRows = [
    ['Nombre', servicio.nombre_servicio || servicio.descripcion_servicio],
    ['Descripción', servicio.descripcion_servicio],
    ['Prioridad', servicio.prioridad],
    ['Estado', estadoServicio],
    ['Estado aprobación', servicio.estado_aprobacion],
    ['Correo', servicio.correo],
    ['Retención/Detracción', aplicaRetencion ? `${porcentajeRetencion.toFixed(2)}% SI APLICA ${servicio.tipo_retencion || 'RETENCIÓN'}` : '-'],
  ].filter((r) => r[1]);

  if (comentario) {
    adminRows.push(['Comentarios', comentario]);
  }

  const adminFieldEndY = drawFieldRows(doc, {
    rows: adminRows,
    x: left,
    y: adminBarEndY + 2,
    width: adminLeftW,
  });

  // Importe row
  const importeY = adminFieldEndY + 4;
  const importeBarH = 22;
  doc.rect(left, importeY, adminLeftW, importeBarH).fill(PDF_BRAND_COLORS.highlightBlue);
  doc.font('Helvetica').fontSize(7.2).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text('Importe:', left + 6, importeY + 4, { width: 80, align: 'left', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text(formatMoney(totalFinal, currencyLabel), left + 90, importeY + 3, { width: adminLeftW - 96, align: 'right', lineBreak: false });

  // Version bar
  const versionBarY = importeY + importeBarH + 6;
  doc.rect(left, versionBarY, 100, 13).fill(PDF_BRAND_COLORS.navy);
  doc.font('Helvetica').fontSize(6.5).fillColor('#ffffff');
  doc.text('Versión 1.0', left + 4, versionBarY + 3.5, { width: 92, align: 'left' });

  // --- Totals block (right side) ---

  const totalsY = bottomY;
  const totalsX = left + adminLeftW + 25;

  const totalsRows = [
    ['SUBTOTAL', subtotal],
    ['IMPUESTO IGV', igv],
    ['ENVÍO', costoEnvio],
    ['OTRO', otrosCostos],
    ['TOTAL', totalBase],
  ];

  drawTotalsBlock(doc, { rows: totalsRows, x: totalsX, y: totalsY, width: adminRightW, currency: currencyLabel });

  // --- Contact footer ---

  drawContactFooter(doc, {
    email: servicio.usuario_email || 'compras@alfosac.pe',
    phone: servicio.usuario_telefono || '+51 978772509',
    left,
    y: versionBarY + 22,
    usableWidth,
  });

  doc.end();
});

module.exports = { buildServicioPdfBase64 };
