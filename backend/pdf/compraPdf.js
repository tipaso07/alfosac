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
  buildPdfApprovalEntries,
  parseReceiptInfo,
  drawHeader: sharedDrawHeader,
  drawSectionBar,
  drawFieldRows,
  drawItemsTable,
  drawTotalsBlock,
  drawContactFooter,
  ensureSpace: sharedEnsureSpace,
} = require('./helpers');

const buildCompraPdfBase64 = (compra) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: MARGIN_LEFT, size: 'A4', bufferPages: true });
  const chunks = [];

  const left = MARGIN_LEFT;
  const usableWidth = USABLE_WIDTH;
  const bottomLimit = BOTTOM_LIMIT;

  const companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao';
  const companyRuc = '20606777257';
  const companyWeb = 'www.alfosac.pe';

  const drawHeader = () => sharedDrawHeader(doc, {
    title: 'ORDEN DE COMPRA',
    companyAddress,
    companyRuc,
    companyWeb,
    controlFecha: String(formatPetDateTime(compra.fecha_creacion || currentPetDateTime()) || '').split(' ')[0],
    controlNumero: compra.numero_orden || `OC-${compra.id}`,
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

  const subtotal = Number(compra.subtotal || 0);
  const igv = Number(compra.igv || 0);
  const costoEnvio = Number(compra.costo_envio || 0);
  const otrosCostos = Number(compra.otros_costos || 0);
  const totalBase = Number((subtotal + igv + costoEnvio + otrosCostos).toFixed(2));
  const aplicaRetencion = Boolean(compra.aplica_retencion);
  const porcentajeRetencion = Number(compra.descuento || 0);
  const montoRetenido = aplicaRetencion ? Number((totalBase * (porcentajeRetencion / 100)).toFixed(2)) : 0;
  const totalFinal = Number(compra.importe_final || compra.total || totalBase);

  // --- Section: VENDEDOR / ENVÍE A ---

  const colGap = 55;
  const leftColW = Math.floor((usableWidth - colGap) * 0.55);
  const rightColW = usableWidth - leftColW - colGap;

  let blocksY = doc.y;

  // VENDEDOR block
  const vendorEndY = drawSectionBar(doc, { title: 'VENDEDOR', x: left, y: blocksY, width: leftColW });
  const vendorRows = [
    [compra.razon_social || compra.proveedor, ''],
    ['Dirección', compra.direccion],
    ['Ciudad', compra.distrito],
    ['RUC', compra.ruc],
  ].filter((r) => r[1]);
  const vendorFieldEndY = drawFieldRows(doc, { rows: vendorRows, x: left, y: vendorEndY + 2, width: leftColW, labelWidth: 50 });

  // ENVÍE A block
  const shipBarY = blocksY;
  const shipEndY = drawSectionBar(doc, { title: 'ENVÍE A', x: left + leftColW + colGap, y: shipBarY, width: rightColW });
  const shipRows = [
    [compra.area_final || compra.area_solicitante, ''],
    ['Solicitante', compra.usuario],
    ['Área', compra.area_solicitante],
  ].filter((r) => r[1]);
  const shipFieldEndY = drawFieldRows(doc, { rows: shipRows, x: left + leftColW + colGap, y: shipEndY + 2, width: rightColW, labelWidth: 50 });

  doc.y = Math.max(vendorFieldEndY, shipFieldEndY) + 10;

  // --- Items table ---

  const items = Array.isArray(compra.items) ? compra.items : [];
  if (items.length > 0) {
    const columns = [
      { header: 'ARTÍCULO #', width: 48, align: 'left' },
      { header: 'DESCRIPCIÓN', width: usableWidth - 48 - 50 - 70 - 75, align: 'left' },
      { header: 'CANT', width: 50, align: 'center' },
      { header: 'P/U', width: 70, align: 'right' },
      { header: 'TOTAL', width: 75, align: 'right', isTotal: true },
    ];

    const tableRows = items.map((item, i) => {
      const qty = Number(item.cantidad || 0);
      const precio = Number(item.precio_unitario || item.precio || 0);
      const total = Number(item.total || qty * precio || 0);
      return [
        String(i + 1),
        safeText(item.material || item.descripcion || item.nombre),
        String(qty),
        precio,
        total,
      ];
    });

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

  // --- Bottom section: admin fields + totals ---

  doc.y = doc.y + 10;

  const adminLeftW = Math.floor(usableWidth * 0.72);
  const adminRightW = usableWidth - adminLeftW - 25;
  const bottomY = doc.y;

  // Admin fields header
  const adminBarEndY = drawSectionBar(doc, {
    title: 'Comentarios o instrucciones especiales',
    x: left,
    y: bottomY,
    width: adminLeftW,
  });

  const comentario = String(compra.comentarios || compra.detalle || '').trim();

  const adminRows = [
    ['Retención/Detracción', aplicaRetencion ? `${porcentajeRetencion.toFixed(2)}%` : '-'],
    ['Correo', compra.correo || compra.contacto_proveedor],
    ['Persona Responsable', compra.persona_responsable || compra.contacto_proveedor],
    ['Teléfono', compra.telefono],
    ['Condiciones de Pago', compra.condiciones_pago],
    ['Banco', compra.banco],
    ['Moneda', compra.moneda || 'PEN'],
    ['N.º CTA', compra.numero_cuenta || compra.cuenta],
    ['Área solicitante', compra.area_solicitante],
    ['Área Final', compra.area_final],
  ].filter((r) => r[1]);

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
  doc.text(formatMoney(totalFinal), left + 90, importeY + 3, { width: adminLeftW - 96, align: 'right', lineBreak: false });

  // Format code
  doc.font('Helvetica-Bold').fontSize(7).fillColor(PDF_BRAND_COLORS.textPrimary);
  doc.text('FR-33', left, importeY + importeBarH + 6, { width: adminLeftW, align: 'left' });

  // Version bar
  const versionBarY = importeY + importeBarH + 18;
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
    ['TOTAL', totalFinal],
  ];

  drawTotalsBlock(doc, { rows: totalsRows, x: totalsX, y: totalsY, width: adminRightW });

  // --- Contact footer ---

  drawContactFooter(doc, {
    email: 'compras@alfosac.pe',
    phone: '+51 978772509',
    left,
    bottomLimit,
    usableWidth,
  });

  doc.end();
});

module.exports = { buildCompraPdfBase64 };
