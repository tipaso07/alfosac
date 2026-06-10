import { useState, useRef } from 'react'
import * as XLSX from 'xlsx/dist/xlsx.full.min.js'
import { bulkImportProveedores, fetchMonedas, fetchAreas } from '../services/api'
import '../styles/ImportProveedoresModal.css'

const EXPECTED_COLUMNS = [
  'nombre',
  'razon_social',
  'ruc',
  'categoria',
  'tipo',
  'direccion',
  'distrito',
  'correo',
  'telefono',
  'persona_responsable',
  'banco',
  'numero_cuenta',
  'cci',
  'moneda',
  'condiciones_pago',
  'retencion',
  'area_destino',
  'tipo_retencion',
  'descripcion',
  'descuento',
]

const normalizeColumnName = (name) => String(name || '')
  .trim()
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[%]/g, '')
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')

const resolveMonedaId = (monedaName, monedasList = []) => {
  if (!monedaName) return null
  const normalized = String(monedaName || '').trim().toUpperCase()
  const found = monedasList.find((m) => {
    const nombre = String(m.nombre || '').trim().toUpperCase()
    const simbolo = String(m.simbolo || '').trim().toUpperCase()
    return nombre === normalized || simbolo === normalized || String(m.id) === normalized
  })
  return found?.id || null
}

const resolveAreaId = (areaName, areasList = []) => {
  if (!areaName) return null
  const normalized = String(areaName || '').trim().toUpperCase()
  const found = areasList.find((a) => String(a.nombre || '').trim().toUpperCase() === normalized || String(a.id) === normalized)
  return found?.id || null
}

const normalizeBooleanValue = (value) => {
  const normalized = String(value || '').trim().toUpperCase()
  if (['SI', 'S', 'TRUE', 'T', 'YES', 'Y'].includes(normalized)) return 'SI'
  if (['NO', 'N', 'FALSE', 'F'].includes(normalized)) return 'NO'
  return ''
}

const parsePercentageValue = (value) => {
  const raw = String(value || '').replace('%', '').trim()
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export default function ImportProveedoresModal({ isOpen, onClose, onImportSuccess }) {
  const fileInputRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [previewData, setPreviewData] = useState([])
  const [columnMapping, setColumnMapping] = useState({})
  const [fileColumns, setFileColumns] = useState([])
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [monedasList, setMonedasList] = useState([])
  const [areasList, setAreasList] = useState([])
  const [dragActive, setDragActive] = useState(false)

  if (!isOpen) return null

  const processSelectedFile = async (file) => {
    if (!file) return

    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

      if (data.length === 0) {
        alert('El archivo Excel no contiene datos')
        return
      }

      setSelectedFile(file)
      const preview = data.slice(0, 5)
      setPreviewData(preview)

      // Auto-detect column mapping
      const fileColumns = Object.keys(data[0] || {})
      const detected = {}
      fileColumns.forEach((col) => {
        const normalized = normalizeColumnName(col)

        if (EXPECTED_COLUMNS.includes(normalized)) {
          detected[normalized] = col
          return
        }

        if (normalized === 'retencion_porcentaje' || normalized === 'retencion_pct' || normalized === 'retencion_porcentaje' || normalized === 'retencion_pct') {
          detected.descuento = col
          return
        }

        if (['id_moneda', 'moneda_id'].includes(normalized)) {
          detected.moneda = col
          return
        }

        if (['id_area_destino', 'area_destino_id'].includes(normalized)) {
          detected.area_destino = col
          return
        }
      })
      setColumnMapping(detected)
      setFileColumns(fileColumns)

      // Load reference data
      if (monedasList.length === 0) {
        const monedas = await fetchMonedas()
        setMonedasList(monedas || [])
      }
      if (areasList.length === 0) {
        const areas = await fetchAreas('')
        setAreasList(areas || [])
      }
    } catch (error) {
      alert(`Error al leer archivo: ${error.message}`)
    }
  }

  const handleFileSelect = async (event) => {
    await processSelectedFile(event.target.files?.[0])
  }

  const handleDragEnter = (event) => {
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event) => {
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = async (event) => {
    event.preventDefault()
    setDragActive(false)

    const file = event.dataTransfer.files?.[0]
    await processSelectedFile(file)
  }

  const handleUploadAreaClick = () => {
    if (!importing) {
      fileInputRef.current?.click()
    }
  }

  const handleImport = async () => {
    if (!selectedFile || previewData.length === 0) {
      alert('Selecciona un archivo primero')
      return
    }

    const requiredMapping = ['nombre', 'ruc', 'moneda']
    const missingMapping = requiredMapping.filter((col) => !columnMapping[col])
    if (missingMapping.length > 0) {
      alert(`Debe mapear las columnas obligatorias: ${missingMapping.join(', ')}`)
      return
    }

    try {
      setImporting(true)

      const arrayBuffer = await selectedFile.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

      // Transform data using column mapping
      const providers = data.map((row) => {
        const provider = {}

        Object.entries(columnMapping).forEach(([expectedCol, fileCol]) => {
          const value = row[fileCol]

          if (expectedCol === 'moneda' && value) {
            provider.id_moneda = resolveMonedaId(value, monedasList)
          } else if (expectedCol === 'area_destino' && value) {
            provider.id_area_destino = resolveAreaId(value, areasList)
          } else if (expectedCol === 'tipo_retencion' && value) {
            const normalized = String(value || '').trim().toUpperCase()
            provider.tipo_retencion = ['RETENCION', 'DETRACCION'].includes(normalized) ? normalized : 'RETENCION'
          } else if (expectedCol === 'retencion' && value) {
            const normalized = normalizeBooleanValue(value)
            if (normalized) {
              provider.retencion = normalized
            } else {
              const pct = parsePercentageValue(value)
              if (pct !== null) {
                provider.descuento = pct
                provider.retencion = 'NO'
              } else {
                provider.retencion = 'NO'
              }
            }
          } else if (expectedCol === 'tipo' && value) {
            const normalized = String(value || '').trim().toUpperCase()
            provider.tipo = ['BIEN', 'SERVICIO'].includes(normalized) ? normalized : 'BIEN'
          } else if (expectedCol === 'descuento' && value) {
            provider.descuento = Number(value) || 0
          } else {
            provider[expectedCol] = value
          }
        })

        return provider
      })

      const result = await bulkImportProveedores(providers, false)
      setImportResult(result)

      if (result.errors.length === 0 && result.created.length > 0) {
        setTimeout(() => {
          onImportSuccess?.()
          handleClose()
        }, 2000)
      }
    } catch (error) {
      alert(`Error durante importación: ${error.message}`)
    } finally {
      setImporting(false)
    }
  }

  const handleClose = () => {
    setSelectedFile(null)
    setPreviewData([])
    setColumnMapping({})
    setFileColumns([])
    setImportResult(null)
    setMonedasList([])
    setAreasList([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content import-proveedores-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Importar Proveedores desde Excel</h2>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>

        <div className="modal-body">
          {!importResult ? (
            <>
              <div
                className={`file-upload-section ${dragActive ? 'drag-active' : ''}`}
                onClick={handleUploadAreaClick}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  disabled={importing}
                  style={{ display: 'none' }}
                />
                <div className="drag-drop-area">
                  <p>Arrastra el archivo aquí o haz clic para seleccionar</p>
                  <strong>Soporta .xlsx, .xls, .csv</strong>
                  {selectedFile && <span className="file-name">{selectedFile.name}</span>}
                </div>
              </div>

              {previewData.length > 0 && (
                <>
                  <div className="preview-section">
                    <h3>Vista previa (primeras 5 filas)</h3>
                    <div className="preview-table">
                      <table>
                        <thead>
                          <tr>
                            <th>#</th>
                            {fileColumns.map((col) => (
                              <th key={col}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewData.map((row, idx) => (
                            <tr key={idx}>
                              <td>{idx + 1}</td>
                              {fileColumns.map((col) => (
                                <td key={col}>{String(row[col] ?? '').trim() || '-'}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="info-text" style={{ marginTop: '10px', color: '#d9534f', fontWeight: 'bold' }}>Nota: Si hay algún error en los datos, la importación será rechazada completa (todo o nada).</p>
                </>
              )}
            </>
          ) : (
            <div className="import-result">
              <h3>Resultado de importación</h3>
              {importResult.created.length > 0 && (
                <div className="result-section success">
                  <h4>✓ Creados exitosamente: {importResult.created.length}</h4>
                  <ul>
                    {importResult.created.map((item, idx) => (
                      <li key={idx}>
                        {item.nombre} (RUC: {item.ruc}) - ID: {item.id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="result-section error">
                  <h4>✗ Errores: {importResult.errors.length}</h4>
                  <ul>
                    {importResult.errors.map((item, idx) => (
                      <li key={idx}>
                        Fila {item.rowIndex}: {item.nombre || item.ruc || 'Sin datos'} - {item.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn-cancel"
            onClick={handleClose}
            disabled={importing}
          >
            {importResult ? 'Cerrar' : 'Cancelar'}
          </button>
          {!importResult && selectedFile && (
            <button
              className="btn-import"
              onClick={handleImport}
              disabled={importing || Object.keys(columnMapping).length === 0}
            >
              {importing ? 'Importando...' : 'Confirmar importación'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
