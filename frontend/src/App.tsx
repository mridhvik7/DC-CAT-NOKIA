import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as XLSX from 'xlsx'

type Screen = 'home' | 'progress' | 'results' | 'viewer' | 'placeholder'
type IconName = 'home' | 'history' | 'reports' | 'settings' | 'help' | 'upload' | 'file' | 'remove' | 'spell' | 'link' | 'search' | 'arrow' | 'chevron' | 'check' | 'document'
type Severity = 'High' | 'Medium' | 'Low'
type PageCountSource = 'client' | 'backend' | 'unavailable'
type NavigationItem = { label: string; icon: IconName }
type Feature = { id: string; name: string; description: string; icon: IconName }
type DocumentRecord = { name: string; type: 'PDF' | 'DOCX'; size: number; pageCount: number | null; pageCountSource: PageCountSource }
type Finding = { id: number; page: number; featureId: string; finding: string; suggestion: string; severity: Severity; original?: string; context?: string; correctedSentence?: string; paragraphIndex?: number; boundingBox?: { x: number; y: number; width: number; height: number } }
type AnalysisResult = { document: DocumentRecord; findings: Finding[]; completedAt: string }

const navigation: NavigationItem[] = [{ label: 'Home', icon: 'home' }, { label: 'History', icon: 'history' }, { label: 'Reports', icon: 'reports' }]
const secondaryNavigation: NavigationItem[] = [{ label: 'Settings', icon: 'settings' }, { label: 'Help', icon: 'help' }]

// Future analysis checks and backend-supplied fields flow through these typed records.
const features: Feature[] = [
  { id: 'spell-check', name: 'Spell Check', description: 'Detect spelling errors and suggested corrections.', icon: 'spell' },
  { id: 'broken-links', name: 'Broken Links', description: 'Find invalid hyperlinks and document references.', icon: 'link' },
  { id: 'keyword-search', name: 'Keyword Search', description: 'Search for specific terms across the document.', icon: 'search' },
]



GlobalWorkerOptions.workerSrc = pdfWorker

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Zm6 11v-6h6v6" />,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></>,
    reports: <><path d="M5 3h10a2 2 0 0 1 2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M7 8h6M7 12h6M7 16h3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V20h-3v-.09A1.7 1.7 0 0 0 10.7 18.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15a1.7 1.7 0 0 0-1.55-1.03H5v-3h.09A1.7 1.7 0 0 0 6.6 9.94a1.7 1.7 0 0 0-.34-1.88L6.2 8 8.3 5.9l.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.55V4h3v.09a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.55 1.03H20v3h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.4 9a2.7 2.7 0 1 1 4.7 1.8c-.9.9-2.1 1.4-2.1 3M12 17h.01" /></>,
    upload: <><path d="M12 16V4M8 8l4-4 4 4" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
    file: <><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5M8 13h8M8 17h5" /></>,
    remove: <><path d="M18 6 6 18M6 6l12 12" /></>,
    spell: <><path d="M4 5h10M9 5c0 7-2 11-5 14M6 13c2 0 5-1 7-4M15 15l2-5 2 5M16 13h4" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 1 0 12 20l1.1-1.1" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    chevron: <path d="m8 10 4 4 4-4" />, check: <path d="m5 12 4 4L19 6" />,
    document: <><path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h5" /></>,
  }
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const formatSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
const featureById = (id: string) => features.find((feature) => feature.id === id)
const pageCountLabel = (document: DocumentRecord) => document.pageCount === null ? 'Page count available after analysis' : `${document.pageCount.toLocaleString()} pages`

function App() {
  const [activePage, setActivePage] = useState('Home')
  const [screen, setScreen] = useState<Screen>('home')
  const [document, setDocument] = useState<DocumentRecord | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([])
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [activeFinding, setActiveFinding] = useState<Finding | null>(null)
  const [progress, setProgress] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [fileError, setFileError] = useState('')
  const [search, setSearch] = useState('')
  const [featureFilter, setFeatureFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [keywordQuery, setKeywordQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [viewerState, setViewerState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [highlightBox, setHighlightBox] = useState<{
  x: number
  y: number
  width: number
  height: number
} | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const canAnalyze =
  Boolean(document) &&
  selectedFeatureIds.length > 0 &&
  (!selectedFeatureIds.includes('keyword-search') || keywordQuery.trim().length > 0)

  useEffect(() => {
  if (screen !== 'progress') return

  const interval = window.setInterval(() => {
    setProgress((current) => Math.min(current + 2, 90))
  }, 250)

  return () => window.clearInterval(interval)
}, [screen])

        useEffect(() => {
    if (
      screen !== 'viewer' ||
      !activeFinding ||
      !selectedFile ||
      document?.type !== 'PDF'
    ) {
      return
    }

    let cancelled = false
    let loadingTask: ReturnType<typeof getDocument> | undefined

    const renderPage = async () => {
      setViewerState('loading')

      try {
        loadingTask = getDocument({
          data: new Uint8Array(await selectedFile.arrayBuffer()),
        })

        const pdf = await loadingTask.promise
const page = await pdf.getPage(activeFinding.page)
const viewport = page.getViewport({ scale: 1.25 * zoom })

const textContent = await page.getTextContent()
const targetText = activeFinding.original?.trim().toLowerCase()

if (targetText) {
  const textItem = textContent.items.find(
    (item) =>
      'str' in item &&
      typeof item.str === 'string' &&
      item.str.toLowerCase().includes(targetText),
  )

  if (textItem && 'str' in textItem && typeof textItem.str === 'string') {
    const transform = Util.transform(
      viewport.transform,
      textItem.transform,
    )

    const fontHeight = Math.hypot(transform[2], transform[3])
    const itemWidth = textItem.width * viewport.scale

    const startIndex = textItem.str
      .toLowerCase()
      .indexOf(targetText)

    const characterWidth = itemWidth / textItem.str.length

    setHighlightBox({
      x: transform[4] + startIndex * characterWidth,
      y: transform[5] - fontHeight,
      width: targetText.length * characterWidth,
      height: fontHeight,
    })
  } else {
    setHighlightBox(null)
  }
} else {
  setHighlightBox(null)
}

    const canvas = pdfCanvasRef.current
const context = canvas?.getContext('2d')

if (!canvas || !context || cancelled) return

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise

        page.cleanup()
        await pdf.cleanup()

        if (!cancelled) {
          setViewerState('ready')
        }
      } catch {
        if (!cancelled) {
          setViewerState('error')
        }
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [activeFinding, document?.type, screen, selectedFile, zoom])

  const chooseFile = async (file?: File) => {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (extension !== 'pdf' && extension !== 'docx') { setFileError('Please select a PDF or DOCX document.'); return }
    if (extension === 'docx') {
      setDocument({ name: file.name, type: 'DOCX', size: file.size, pageCount: null, pageCountSource: 'unavailable' })
      setSelectedFile(null); setFileError(''); return
    }
    try {
      const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
      const pdf = await task.promise
      const pageCount = pdf.numPages
      await pdf.cleanup(); await task.destroy()
      setDocument({ name: file.name, type: 'PDF', size: file.size, pageCount, pageCountSource: 'client' })
      setSelectedFile(file); setFileError('')
    } catch {
      setDocument(null); setSelectedFile(null); setFileError('This PDF could not be read. Please choose another document.')
    }
  }

  const removeDocument = () => { setDocument(null); setSelectedFile(null); setFileError(''); if (fileInputRef.current) fileInputRef.current.value = '' }
  const toggleFeature = (id: string) => setSelectedFeatureIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  const startAnalysis = async () => {
  if (!document || !selectedFile || !canAnalyze) return

  const formData = new FormData()

  formData.append('file', selectedFile)
  formData.append('features', selectedFeatureIds.join(','))
  formData.append('query', keywordQuery)

  setProgress(0)
  setScreen('progress')
  setActivePage('Home')

  try {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/analyze`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Analysis failed: ${response.status}`)
    }

    const data = await response.json()

    console.log('REAL BACKEND RESPONSE:', data)

    const featureIdMap: Record<string, string> = {
      spell_check: 'spell-check',
      broken_links: 'broken-links',
      keyword_search: 'keyword-search',
    }

    const severityMap: Record<string, Severity> = {
      warning: 'Medium',
      error: 'High',
      info: 'Low',
    }
    let nextFindingId = 1
    const realFindings: Finding[] = data.results.flatMap(
      (result: {
        feature: string
        findings: Array<{
          severity: string
          page: number | null
          message: string
          details?: {
            word?: string
            suggestion?: string
            incorrect_word?: string
            suggested_correction?: string
            original_sentence?: string
            corrected_sentence?: string
            paragraph_index?: number
          }
        }>
      }) =>
        result.findings.map((finding) => ({
          id: nextFindingId++,
          page: finding.page ?? 1,
          featureId: featureIdMap[result.feature] ?? result.feature,
          finding: finding.message,
          suggestion:
            finding.details?.suggested_correction ??
            finding.details?.suggestion ??
            '—',
          severity: severityMap[finding.severity] ?? 'Medium',
          original:
            finding.details?.incorrect_word ??
            finding.details?.word,
          context: finding.details?.original_sentence,
          correctedSentence: finding.details?.corrected_sentence,
          paragraphIndex: finding.details?.paragraph_index,
        }))
    )

    setAnalysisResult({
      document: {
        ...document,
        pageCount: data.page_count ?? document.pageCount,
        pageCountSource: data.page_count ? 'backend' : document.pageCountSource,
      },
      findings: realFindings,
      completedAt: 'Backend connected',
    })
    setProgress(100)
setScreen('results')
  } catch (error) {
    console.error('Analysis request failed:', error)
    setScreen('home')
  }
}
  const navigate = (label: string) => { setActivePage(label); setScreen(label === 'Home' ? 'home' : label === 'Reports' && analysisResult ? 'results' : 'placeholder') }
  const openFinding = (finding: Finding) => { setActiveFinding(finding); setZoom(1); setScreen('viewer') }
  const resultFindings = analysisResult?.findings ?? []
  const activeFindingIndex = activeFinding ? resultFindings.findIndex((finding) => finding.id === activeFinding.id) : -1
  const showAdjacentFinding = (offset: number) => { const next = resultFindings[activeFindingIndex + offset]; if (next) setActiveFinding(next) }
  const exportExcel = () => {
  if (!analysisResult) return

  const selectedFeatures = features.filter((feature) =>
    selectedFeatureIds.includes(feature.id)
  )

  const workbook = XLSX.utils.book_new()

  // -------------------------
  // Helper for readable Excel sheets
  // -------------------------
  const formatSheet = (
    sheet: XLSX.WorkSheet,
    widths: number[]
  ) => {
    sheet['!cols'] = widths.map((width) => ({ width }))

    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')

    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]

        if (cell) {
          cell.s = {
            alignment: {
              vertical: 'top',
              wrapText: true,
            },
          }
        }
      }
    }
  }

  // -------------------------
  // Summary
  // -------------------------
  const summary = [
    ['Feature', 'Status', 'Findings', 'Error'],
    [
      'Total Findings',
      'Complete',
      analysisResult.findings.length,
      '',
    ],
    ...selectedFeatures.map((feature) => [
      feature.name,
      'Complete',
      analysisResult.findings.filter(
        (finding) => finding.featureId === feature.id
      ).length,
      '',
    ]),
  ]

  const summarySheet = XLSX.utils.aoa_to_sheet(summary)

  formatSheet(summarySheet, [28, 16, 12, 30])

  XLSX.utils.book_append_sheet(
    workbook,
    summarySheet,
    'Summary'
  )

  // -------------------------
  // Spell Check
  // -------------------------
  const spellCheckFindings = analysisResult.findings
    .filter((finding) => finding.featureId === 'spell-check')
    .map((finding) => ({
      Page: finding.page,
      Severity: finding.severity,
      Message: `Possible spelling error: ${finding.original ?? finding.finding} → ${finding.suggestion}`,
      Confidence: '',
      'Incorrect Word': finding.original ?? '',
      'Suggested Correction':
        finding.suggestion === '—'
          ? ''
          : finding.suggestion,
      'Issue Type': 'contextual_spelling',
      'Original Sentence': finding.context ?? '',
      'Corrected Sentence':
        finding.correctedSentence ?? '',
      'Paragraph Index':
        finding.paragraphIndex ?? '',
    }))

  if (selectedFeatureIds.includes('spell-check')) {
    const sheet = XLSX.utils.json_to_sheet(
      spellCheckFindings
    )

    formatSheet(sheet, [
      10,
      14,
      45,
      14,
      20,
      24,
      24,
      55,
      55,
      18,
    ])

    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      'Spell Check'
    )
  }

  // -------------------------
  // Broken Links
  // -------------------------
  const brokenLinkFindings = analysisResult.findings
    .filter((finding) => finding.featureId === 'broken-links')
    .map((finding) => ({
      Page: finding.page,
      Severity: finding.severity,
      Message: finding.finding,
      Suggestion:
        finding.suggestion === '—'
          ? ''
          : finding.suggestion,
    }))

  if (selectedFeatureIds.includes('broken-links')) {
    const sheet = XLSX.utils.json_to_sheet(
      brokenLinkFindings
    )

    formatSheet(sheet, [
      10,
      14,
      55,
      35,
    ])

    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      'Broken Links'
    )
  }

  // -------------------------
  // Keyword Search
  // -------------------------
  const keywordSearchFindings = analysisResult.findings
    .filter(
      (finding) => finding.featureId === 'keyword-search'
    )
    .map((finding) => ({
      Page: finding.page,
      Finding: finding.finding,
    }))

  if (selectedFeatureIds.includes('keyword-search')) {
    const sheet = XLSX.utils.json_to_sheet(
      keywordSearchFindings
    )

    formatSheet(sheet, [10, 40])

    XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      'Keyword Search'
    )
  }

  // -------------------------
  // Download workbook
  // -------------------------
  const fileName =
    analysisResult.document.name.replace(
      /\.[^/.]+$/,
      ''
    )

  XLSX.writeFile(
    workbook,
    `DC-CAT_Report_${fileName}.xlsx`
  )
}
  const pageAtProgress = document?.pageCount === null || !document ? null : Math.min(document.pageCount, Math.max(1, Math.ceil(document.pageCount * progress / 100)))
  const currentStage = progress < 24 ? 'Preparing document' : progress < 67 ? 'Reviewing document content' : 'Finalizing findings'
  const filteredFindings = resultFindings.filter((finding) => (featureFilter === 'all' || finding.featureId === featureFilter) && (severityFilter === 'all' || finding.severity === severityFilter) && (`${finding.page} ${featureById(finding.featureId)?.name} ${finding.finding} ${finding.suggestion}`).toLowerCase().includes(search.toLowerCase()))
  const renderNavigation = (items: NavigationItem[]) => items.map((item) => <button key={item.label} className={`nav-item ${activePage === item.label ? 'is-active' : ''}`} onClick={() => navigate(item.label)}><Icon name={item.icon} /><span>{item.label}</span></button>)

  const home = <section className="home-content"><div className="hero"><h1>Document Compliance Analyzer</h1><p className="hero-tagline">Analyze. Verify. Understand.</p><p className="hero-copy">Review technical documents for spelling issues, broken links, and important keywords.</p></div><section className="upload-section"><div className="section-copy"><h2>Start with a document</h2><p>Upload a PDF or DOCX to begin analysis.</p></div><div className={`dropzone ${isDragging ? 'is-dragging' : ''} ${document ? 'has-file' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(false); void chooseFile(event.dataTransfer.files[0]) }}><input ref={fileInputRef} className="visually-hidden" id="document-upload" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event: ChangeEvent<HTMLInputElement>) => void chooseFile(event.target.files?.[0])} />{document ? <div className="selected-file"><div className="file-icon"><Icon name="file" /></div><div className="file-details"><strong>{document.name}</strong><span>{document.type} · {formatSize(document.size)} · {pageCountLabel(document)}</span></div><label className="replace-file" htmlFor="document-upload">Replace</label><button className="remove-file" onClick={removeDocument} aria-label="Remove selected document"><Icon name="remove" /></button></div> : <><div className="upload-icon"><Icon name="upload" /></div><p className="dropzone-title">Drag and drop your document here</p><p className="dropzone-or">or</p><label className="choose-button" htmlFor="document-upload">Choose Document</label></>}</div><p className={`file-hint ${fileError ? 'is-error' : ''}`}>{fileError || 'PDF or DOCX · Large documents supported'}</p></section><section className="analysis-section"><div className="section-heading"><div><h2>Choose analysis features</h2><p>Select one or more checks to run on your document.</p></div><button className="more-features">More features <Icon name="arrow" /></button></div><div className="feature-grid">{features.map((feature) => { const chosen = selectedFeatureIds.includes(feature.id); return <button key={feature.id} className={`feature-card ${chosen ? 'is-selected' : ''}`} onClick={() => toggleFeature(feature.id)} aria-pressed={chosen}><span className="feature-icon"><Icon name={feature.icon} /></span><span className="feature-content"><strong>{feature.name}</strong><span>{feature.description}</span></span><span className="selection-indicator">{chosen && '✓'}</span></button> })}</div></section>{selectedFeatureIds.includes('keyword-search') && (
  <div className="keyword-search-input">
    <label htmlFor="keyword-query">Keyword to search</label>
    <input
      id="keyword-query"
      type="text"
      value={keywordQuery}
      onChange={(event) => setKeywordQuery(event.target.value)}
      placeholder="Enter a keyword or phrase"
    />
  </div>
)}<div className="analysis-action"><button className="analyze-button" disabled={!canAnalyze} onClick={startAnalysis}>Analyze Document <Icon name="arrow" /></button>{!canAnalyze && <p>Select a document and at least one feature to continue.</p>}</div></section>
  const progressView = document && <section className="flow-content progress-content"><p className="view-kicker">DOCUMENT ANALYSIS</p><h1>Analyzing document</h1><div className="progress-document"><span className="progress-document-icon"><Icon name="document" /></span><div><strong>{document.name}</strong><span>{document.type} · {pageCountLabel(document)}</span></div></div><div className="progress-readout"><strong>{progress}%</strong><span>{currentStage}</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><p className="page-progress">{pageAtProgress === null ? 'Page count available after analysis' : `Processing page ${pageAtProgress} of ${document.pageCount}`}</p><div className="running-features"><p>Currently running</p>{features.filter((feature) => selectedFeatureIds.includes(feature.id)).map((feature) => <div key={feature.id}><span><Icon name="check" /></span>{feature.name}</div>)}</div><button className="text-button cancel-button" onClick={() => setScreen('home')}>Cancel</button></section>
  const results = analysisResult && <section className="flow-content results-content"><div className="results-heading"><div><p className="view-kicker">ANALYSIS COMPLETE</p><h1>Analysis Results</h1><p className="results-document">{analysisResult.document.name} <span>·</span> {analysisResult.document.type} <span>·</span> {pageCountLabel(analysisResult.document)}</p></div><div className="results-actions"><button className="export-button" onClick={exportExcel}>Export Excel</button><button className="text-button" onClick={() => setScreen('home')}>New analysis <Icon name="arrow" /></button></div></div><div className="summary-grid"><article><span>Total Findings</span><strong>{analysisResult.findings.length}</strong></article>{features.filter((feature) => selectedFeatureIds.includes(feature.id)).map((feature) => <article key={feature.id}><span>{feature.name}</span><strong>{analysisResult.findings.filter((finding) => finding.featureId === feature.id).length}</strong></article>)}</div><section className="findings-section"><div className="findings-heading"><div><h2>Findings</h2><p>{analysisResult.completedAt}</p></div><div className="filters"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search findings" /><select value={featureFilter} onChange={(event) => setFeatureFilter(event.target.value)}><option value="all">All features</option>{features.filter((feature) => selectedFeatureIds.includes(feature.id)).map((feature) => <option key={feature.id} value={feature.id}>{feature.name}</option>)}</select><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}><option value="all">All severities</option><option>High</option><option>Medium</option><option>Low</option></select></div></div><div className="table-wrap"><table><thead><tr><th>#</th><th>Page</th><th>Feature</th><th>Finding</th><th>Suggestion</th><th>Severity</th><th>Action</th></tr></thead><tbody>{filteredFindings.map((finding) => <tr key={finding.id}><td>{finding.id}</td><td>{finding.page}</td><td>{featureById(finding.featureId)?.name}</td><td>{finding.finding}</td><td>{finding.suggestion}</td><td><span className={`severity ${finding.severity.toLowerCase()}`}>{finding.severity}</span></td><td><button className="open-finding" onClick={() => openFinding(finding)}>Open in document <Icon name="arrow" /></button></td></tr>)}</tbody></table>{filteredFindings.length === 0 && <p className="no-findings">No findings match these filters.</p>}</div></section></section>
  const viewer = activeFinding && <section className="viewer-content"><header className="viewer-heading"><button className="back-button" onClick={() => setScreen('results')}>‹ Results</button><div><p className="view-kicker">FINDING DETAILS</p><h1>Document viewer</h1></div></header><div className="viewer-layout"><aside className="finding-details"><h2>Finding details</h2><dl><div><dt>Feature</dt><dd>{featureById(activeFinding.featureId)?.name}</dd></div><div><dt>Page</dt><dd>{activeFinding.page}</dd></div>{activeFinding.original && <div><dt>Original text</dt><dd><mark className="original-text">{activeFinding.original}</mark></dd></div>}{activeFinding.original && <div><dt>Suggested correction</dt><dd><mark className="suggested-text">{activeFinding.suggestion}</mark></dd></div>}<div><dt>Severity</dt><dd><span className={`severity ${activeFinding.severity.toLowerCase()}`}>{activeFinding.severity}</span></dd></div></dl>{activeFinding.context && (
  <div className="context-block">
    <span>Context</span>
    <p>{activeFinding.context}</p>
  </div>
)}</aside><section className="document-placeholder real-document-viewer"><div className="viewer-toolbar"><span>Page {activeFinding.page} / {document?.pageCount ?? '—'}</span><div><button onClick={() => showAdjacentFinding(-1)} disabled={activeFindingIndex <= 0}>Previous</button><button onClick={() => showAdjacentFinding(1)} disabled={activeFindingIndex < 0 || activeFindingIndex >= resultFindings.length - 1}>Next</button><button onClick={() => setZoom((value) => Math.max(.6, +(value - .2).toFixed(1)))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2, +(value + .2).toFixed(1)))} aria-label="Zoom in">+</button></div></div>{document?.type === 'DOCX' || !selectedFile ? <div className="viewer-message"><span className="placeholder-document-icon"><Icon name="document" /></span><h2>Document preview</h2><p>Document preview will be available after document processing.</p></div> : <div className="pdf-canvas-wrap">{viewerState === 'loading' && <p className="viewer-status">Loading page {activeFinding.page}…</p>}{viewerState === 'error' && <p className="viewer-status is-error">Unable to render this page.</p>}<div style={{ position: 'relative', display: 'inline-block' }}>
  <canvas
    ref={pdfCanvasRef}
    className={viewerState === 'ready' ? 'is-ready' : ''}
  />

  {highlightBox && viewerState === 'ready' && (
    <div
      className="pdf-finding-highlight"
      style={{
        position: 'absolute',
        left: highlightBox.x,
        top: highlightBox.y,
        width: highlightBox.width,
        height: highlightBox.height,
        border: '2px solid #d93025',
        backgroundColor: 'rgba(217, 48, 37, 0.16)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    />
  )}
  
</div></div>}</section></div></section>
  const placeholder = <section className="placeholder-page"><h1>{activePage}</h1><p>This area is ready for a future DC-CAT workflow.</p></section>
  const content = screen === 'home' ? home : screen === 'progress' ? progressView : screen === 'results' ? results : screen === 'viewer' ? viewer : placeholder
  return <div className="app-shell"><aside className="sidebar" aria-label="Primary navigation"><div className="brand"><span className="nokia-mark">NOKIA</span><span className="brand-divider" /><span className="brand-product">DC-CAT</span></div><nav className="navigation">{renderNavigation(navigation)}</nav><nav className="navigation navigation-bottom">{renderNavigation(secondaryNavigation)}</nav></aside><main className="main-content"><header className="topbar"><div className="mobile-brand"><span className="nokia-mark">NOKIA</span><span className="brand-divider" /><span className="brand-product">DC-CAT</span></div><button className="profile" aria-label="Open user profile"><span className="avatar">U</span><span>User</span><Icon name="chevron" /></button></header>{content}</main></div>
}

export default App
