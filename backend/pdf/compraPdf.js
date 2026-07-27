const PDFDocument = require('pdfkit');
const {
  PDF_BRAND_COLORS,
  safeText,
  formatCurrency,
  formatPetDateTime,
  currentPetDateTime,
  buildPdfApprovalEntries,
  parseReceiptInfo,
  drawHeader: sharedDrawHeader,
  ensureSpace: sharedEnsureSpace,
  drawSectionTitle,
  drawInfoBlock,
  drawTable,
  drawFooter,
} = require('./helpers');

const buildCompraPdfBase64 = (compra) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
  const chunks = [];

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const left = 36;
  const right = 36;
  const usableWidth = pageWidth - left - right;
  const bottomLimit = pageHeight - 72;

  const currencyLabel = safeText(compra.moneda || 'PEN');
  const money = (value, currency = currencyLabel) => formatCurrency(value, currency);
  const companyAddress = 'Av Nestor Gambeta N°4783 Callao - Callao';
  const companyRuc = '20606777257';
  const companyWeb = 'www.alfosac.pe';

  const headerOpts = { companyAddress, companyRuc, companyWeb, pageWidth, left, right, usableWidth };

  const drawHeader = () => sharedDrawHeader(doc, { title: 'ORDEN DE COMPRA', ...headerOpts });

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
    const labelWidth = Math.max(98, Math.floor((usableWidth / 2 - 20) * 0.38));
    const valueWidth = usableWidth / 2 - 20 - labelWidth - 8;
    const titleHeight = 18;
    const rowGap = 6;
    const paddingY = 6;

    let total = titleHeight + (paddingY * 2);
    rows.forEach(([label, value]) => {
      const textLabel = `${safeText(label)}:`;
      const textValue = safeText(value);
      doc.font('Helvetica-Bold').fontSize(8.5);
      const labelHeight = doc.heightOfString(textLabel, { width: labelWidth, align: 'left' });
      doc.font('Helvetica').fontSize(8.5);
      const valueHeight = doc.heightOfString(textValue, { width: valueWidth, align: 'left' });
      total += Math.max(18, Math.max(labelHeight, valueHeight)) + rowGap;
    });
    return total;
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
      );

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
    doc.y = 124;
  });

  drawHeader();

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
  const approverEntries = buildPdfApprovalEntries({
    approvals: compra.aprobadores,
    creatorUserId: compra.id_usuario,
    creatorRoleId: compra.usuario_rol_id,
    creatorName: compra.usuario,
  });
  const approversSummary = approverEntries
    .filter((row) => {
      const etapaLabel = String(row.etapa || '').trim().toUpperCase();
      const rolLabel = String(row.rol || '').trim().toUpperCase();
      const isRequesterRow = etapaLabel === 'SOLICITANTE' || rolLabel === 'SOLICITANTE';
      return !isRequesterRow || approverEntries.length === 1;
    })
    .map((row) => {
      const fallbackRoleLabel = safeText(row.rol || '');
      const aprobadorNombre = safeText(row.aprobador || 'Pendiente');
      return `${aprobadorNombre} (${fallbackRoleLabel})`;
    })
    .join('\n');
  const entregaInfo = compra.entrega_area && compra.entrega_area.entregado === true
    ? {
      ...compra.entrega_area,
      ...parseReceiptInfo(compra.recibido_por),
    }
    : null;

  // --- Section: Resumen ---

  colorCodedSectionTitle('Resumen', PDF_BRAND_COLORS.primary);
  ensureSpace(98);
  const resumenTop = doc.y;
  const resumenRows = [
    ['Número de orden', compra.numero_orden || `OC-${compra.id}`],
    ['Fecha', String(formatPetDateTime(compra.fecha_creacion || currentPetDateTime()) || '').split(' ')[0]],
    ['Proveedor', compra.proveedor || compra.razon_social],
    ['Área destino', compra.area_final],
  ];
  const resumenRowHeight = 20;
  const resumenLabelWidth = 160;

  doc.roundedRect(left, resumenTop, usableWidth, 20, 3).fillAndStroke(PDF_BRAND_COLORS.sectionHeader, '#cbd5e1');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text('Datos de la orden', left + 10, resumenTop + 6, {
    width: usableWidth - 20,
    align: 'left',
  });

  let resumenY = resumenTop + 20;
  resumenRows.forEach(([label, value], index) => {
    const isAlternate = index % 2 === 0;
    const valueHeight = doc.heightOfString(safeText(value), {
      width: usableWidth - resumenLabelWidth - 20,
      align: 'left',
    });
    const rowHeight = Math.max(resumenRowHeight, valueHeight + 12);
    doc.rect(left, resumenY, usableWidth, rowHeight).fillAndStroke(isAlternate ? '#f0f5ff' : '#ffffff', '#e2e8f0');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textSecondary).text(`${label}:`, left + 10, resumenY + 6, {
      width: resumenLabelWidth,
      align: 'left',
    });
    doc.font('Helvetica').fontSize(8.5).fillColor(PDF_BRAND_COLORS.textPrimary).text(safeText(value), left + 10 + resumenLabelWidth, resumenY + 6, {
      width: usableWidth - resumenLabelWidth - 20,
      align: 'left',
    });
    resumenY += rowHeight;
  });
  doc.y = resumenY + 2;

  // --- Two-column info blocks ---

  renderTwoColumnBlocks([
    {
      title: 'Orden y solicitante',
      rows: [
        ['Área solicitante', compra.area_solicitante],
        ['Solicitante', compra.usuario],
        ['Moneda', currencyLabel],
      ],
    },
    {
      title: 'Proveedor',
      rows: [
        ['RUC', compra.ruc],
        ['Dirección', compra.direccion],
        ['Distrito', compra.distrito],
        ['Banco', compra.banco],
        ['Cuenta', compra.cuenta || compra.numero_cuenta],
        ['CCI', compra.cci],
        ['Condiciones de pago', compra.condiciones_pago],
      ],
    },
    {
      title: 'Detalle financiero',
      rows: [
        ['Subtotal', money(subtotal, compra.moneda)],
        ['IGV', money(igv, compra.moneda)],
        ['Costo envío', money(costoEnvio, compra.moneda)],
        ['Otros costos', money(otrosCostos, compra.moneda)],
        ['Total base', money(totalBase, compra.moneda)],
        ['Retención aplicada', aplicaRetencion ? 'SÍ' : 'NO'],
        ['Porcentaje', `${porcentajeRetencion.toFixed(2)}%`],
        ['Monto retenido', money(montoRetenido, compra.moneda)],
      ],
    },
    {
      title: 'Contacto y observaciones',
      rows: [
        ['Correo', compra.correo || compra.contacto_proveedor],
        ['Persona responsable', compra.persona_responsable || compra.contacto_proveedor],
        ['Teléfono', compra.telefono],
        ['Aprobaciones', approversSummary || 'Sin aprobaciones registradas'],
        ...(String(compra.comentarios || '').trim()
          ? [['Comentarios', compra.comentarios]]
          : []),
      ],
    },
  ]);

  // --- Entrega area (if delivered) ---

  const purchaseDetailText = String(compra.detalle || compra.comentarios || '').trim();
  if (entregaInfo) {
    renderTwoColumnBlocks([
      {
        title: 'Entrega al area',
        rows: [
          ['DNI receptor', entregaInfo.receptor_dni || entregaInfo.dni || 'N/D'],
          ['Nombre receptor', entregaInfo.receptor_nombre || entregaInfo.nombre || 'N/D'],
        ],
      },
      {
        title: 'Estado de entrega',
        rows: [
          ['Entregado', 'SI'],
          ['Fecha entrega', entregaInfo.fecha_entrega_area ? new Date(entregaInfo.fecha_entrega_area).toLocaleString() : 'N/D'],
        ],
      },
    ]);
  }

  // --- Purchase detail text ---

  if (purchaseDetailText) {
    writeSectionTitle('Detalle de la solicitud');
    ensureSpace(40);
    const detailBoxTop = doc.y;
    const detailHeight = Math.max(28, doc.heightOfString(purchaseDetailText, { width: usableWidth - 20 }) + 14);
    doc.roundedRect(left, detailBoxTop, usableWidth, detailHeight, 4).fillAndStroke('#ffffff', '#e2e8f0');
    doc.font('Helvetica').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary).text(purchaseDetailText, left + 10, detailBoxTop + 7, {
      width: usableWidth - 20,
      align: 'left',
    });
    doc.y = detailBoxTop + detailHeight + 3;
  }

  // --- Items table ---

  const items = Array.isArray(compra.items) ? compra.items : [];
  if (items.length > 0) {
    const colWidths = [403, 120];
    const headers = ['Material/Servicio', 'Cantidad'];

    const tableRows = items.map((item) => {
      const qty = Number(item.cantidad || 0);
      const descripcion = safeText(item.material || item.descripcion || item.nombre);
      return [descripcion, String(qty)];
    });

    let rowY = drawTable(doc, {
      headers,
      colWidths,
      rows: tableRows,
      left,
      pageWidth,
      right,
      usableWidth,
      bottomLimit,
      ensureSpaceFn: ensureSpace,
      drawHeaderFn: drawHeader,
      writeSectionTitleFn: writeSectionTitle,
      sectionTitle: 'Items',
    });

    // --- Total bar ---

    if (rowY && rowY + 24 > bottomLimit - 4) {
      doc.addPage();
      drawHeader();
      writeSectionTitle('Items');
      rowY = doc.y;
    }

    const resumenTotalY = rowY || doc.y;
    doc.roundedRect(left, resumenTotalY, usableWidth - 130, 22, 3)
      .fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');

    doc.roundedRect(left + usableWidth - 130, resumenTotalY, 130, 22, 3)
      .fillAndStroke(PDF_BRAND_COLORS.surface, '#cbd5e1');

    doc.font('Helvetica-Bold').fontSize(9).fillColor(PDF_BRAND_COLORS.textPrimary)
      .text('TOTAL GENERAL', left + 8, resumenTotalY + 7, {
        width: usableWidth - 146,
        align: 'right',
      });

    doc.text(money(totalFinal || 0, compra.moneda), left + usableWidth - 124, resumenTotalY + 7, {
      width: 118,
      align: 'center',
    });

    doc.y = resumenTotalY + 2;
  }

  // --- Contact footer ---

  doc.moveDown(1);
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

module.exports = { buildCompraPdfBase64 };
