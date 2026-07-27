const { pool } = require('../db/pool');
const { currentPetDateTime, PET_SQL_NOW } = require('../utils/datetime');

const RECEIPT_NOTE_PREFIX = '[[RECIBIDO_POR:';
const ITEM_CATEGORY_NOTE_PREFIX = '[[ITEM_CATEGORIAS:';
const AREA_DELIVERY_NOTE_PREFIX = '[[ENTREGA_AREA:';
const COMMENT_THREAD_NOTE_PREFIX = '[[COMENTARIOS_HIST:';

const normalizeItemCategoryKey = (value) => String(value || '').trim().toLowerCase();

const parseEmbeddedCommentsFromText = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/\n?\[\[COMENTARIOS_HIST:([A-Za-z0-9+/=]+)\]\]\s*$/s);
  if (!match) {
    return { text, comments: [] };
  }

  let comments = [];
  try {
    const decoded = Buffer.from(String(match[1] || ''), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) {
      comments = parsed
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          usuario_id: Number(item.usuario_id || 0) || null,
          usuario: String(item.usuario || '').trim(),
          fecha: String(item.fecha || '').trim(),
          contenido: String(item.contenido || '').trim(),
        }))
        .filter((item) => item.contenido);
    }
  } catch (_) {
    comments = [];
  }

  const cleanText = text.slice(0, match.index || 0).trim();
  return { text: cleanText, comments };
};

const buildTextWithEmbeddedComments = ({ text = '', comments = [] } = {}) => {
  const baseText = String(text || '').trim();
  const safeComments = Array.isArray(comments)
    ? comments
      .filter((item) => item && typeof item === 'object' && String(item.contenido || '').trim())
      .map((item) => ({
        usuario_id: Number(item.usuario_id || 0) || null,
        usuario: String(item.usuario || '').trim(),
        fecha: String(item.fecha || '').trim(),
        contenido: String(item.contenido || '').trim(),
      }))
    : [];

  if (safeComments.length === 0) {
    return baseText;
  }

  const encoded = Buffer.from(JSON.stringify(safeComments), 'utf8').toString('base64');
  return `${baseText}${baseText ? '\n' : ''}${COMMENT_THREAD_NOTE_PREFIX}${encoded}]]`;
};

const buildCommentEntry = ({ user, content }) => ({
  usuario_id: Number(user?.id || 0) || null,
  usuario: String(user?.nombre || user?.username || user?.email || 'Usuario').trim(),
  fecha: currentPetDateTime(),
  contenido: String(content || '').trim(),
});

const normalizeCommentEntityType = (value) => String(value || '').trim().toLowerCase();

const fetchCommentsForEntities = async (db, { tipoEntidad, entityIds = [] } = {}) => {
  const normalizedType = normalizeCommentEntityType(tipoEntidad);
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [])
    .map((id) => Number(id || 0))
    .filter((id) => Number.isInteger(id) && id > 0))];

  if (!normalizedType || ids.length === 0) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        c.id,
        c.id_entidad,
        c.id_usuario,
        COALESCE(u.nombre, 'Usuario') AS usuario,
        COALESCE(NULLIF(trim(COALESCE(to_jsonb(u)->>'foto', to_jsonb(u)->>'imagen', '')), ''), '') AS usuario_foto,
        c.contenido,
        c.fecha
      FROM comentarios c
      LEFT JOIN usuarios u ON u.id = c.id_usuario
      WHERE lower(trim(COALESCE(c.tipo_entidad, ''))) = $1
        AND c.id_entidad = ANY($2::int[])
      ORDER BY c.id_entidad ASC, c.fecha ASC, c.id ASC
    `,
    [normalizedType, ids]
  );

  const commentsByEntity = new Map();
  const seenByEntity = new Map();
  result.rows.forEach((row) => {
    const entityId = Number(row.id_entidad || 0);
    if (!entityId) return;
    const commentId = Number(row.id || 0) || null;

    if (!commentsByEntity.has(entityId)) {
      commentsByEntity.set(entityId, []);
    }

    if (!seenByEntity.has(entityId)) {
      seenByEntity.set(entityId, new Set());
    }

    if (commentId && seenByEntity.get(entityId).has(commentId)) {
      return;
    }

    if (commentId) {
      seenByEntity.get(entityId).add(commentId);
    }

    commentsByEntity.get(entityId).push({
      id: commentId,
      id_entidad: entityId,
      usuario_id: Number(row.id_usuario || 0) || null,
      usuario: String(row.usuario || 'Usuario').trim() || 'Usuario',
      foto: String(row.usuario_foto || '').trim(),
      fecha: row.fecha,
      contenido: String(row.contenido || '').trim(),
    });
  });

  return commentsByEntity;
};

module.exports = {
  RECEIPT_NOTE_PREFIX,
  ITEM_CATEGORY_NOTE_PREFIX,
  AREA_DELIVERY_NOTE_PREFIX,
  COMMENT_THREAD_NOTE_PREFIX,
  normalizeItemCategoryKey,
  parseEmbeddedCommentsFromText,
  buildTextWithEmbeddedComments,
  buildCommentEntry,
  normalizeCommentEntityType,
  fetchCommentsForEntities,
};
